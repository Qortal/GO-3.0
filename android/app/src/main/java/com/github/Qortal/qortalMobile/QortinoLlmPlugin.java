package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * On-device GGUF inference for the Qortino Offline Agent (llama.cpp via JNI).
 * Models are never bundled in the APK — only loaded from app-private files.
 */
@CapacitorPlugin(name = "QortinoLlm")
public class QortinoLlmPlugin extends Plugin {
    private static final String TAG = "QortinoLlm";

    /** Loads llama.cpp on first use (a plugin or executor thread), not at launch on the UI thread. */
    private static final class NativeLib {
        static final boolean LOADED = load();

        private static boolean load() {
            try {
                System.loadLibrary("qortino_llm");
                return true;
            } catch (UnsatisfiedLinkError e) {
                Log.e(TAG, "Failed to load qortino_llm native library", e);
                return false;
            }
        }
    }

    /** True once Qortino has asked for llama.cpp; native calls before that have nothing to act on. */
    private static volatile boolean nativeRequested;

    /** Loads llama.cpp on first use; waits if another thread is loading it. */
    private static boolean ensureNativeLibrary() {
        nativeRequested = true;
        return NativeLib.LOADED;
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean backendReady = new AtomicBoolean(false);
    private final AtomicBoolean completing = new AtomicBoolean(false);
    private final AtomicBoolean downloadCancel = new AtomicBoolean(false);
    private final AtomicBoolean legacyReclaimChecked = new AtomicBoolean(false);
    private Future<?> downloadJob;
    /** What the native side has loaded; names the saved warmup state. */
    private volatile String loadedPath = "";
    private volatile int loadedCtx = 0;
    /**
     * Bumped by every cancel. Work remembers the value from when JS asked for
     * it and starts only if no cancel came in between: a Stop pressed while a
     * reply still waited on the executor used to be lost.
     */
    private final AtomicInteger cancelEpoch = new AtomicInteger();
    private final Object cancelLock = new Object();

    private void cancelNow() {
        synchronized (cancelLock) {
            cancelEpoch.incrementAndGet();
            if (nativeRequested) {
                ensureNativeLibrary();
                nativeCancel();
            }
        }
    }

    /** False when a cancel came after the request; otherwise clears the native flag. */
    private boolean beginWork(int epoch) {
        synchronized (cancelLock) {
            if (cancelEpoch.get() != epoch) return false;
            nativeResetCancel();
            return true;
        }
    }

    /** Capacitor bridge listeners must be notified on the UI thread for live streaming. */
    private void notifyListenersOnMain(String eventName, JSObject data) {
        Runnable r = () -> notifyListeners(eventName, data);
        if (Looper.myLooper() == Looper.getMainLooper()) {
            r.run();
            return;
        }
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(r);
        } else {
            mainHandler.post(r);
        }
    }

    private native boolean nativeInitBackend();
    private native String nativeLoadModel(
        String path, int nCtx, int nThreads, int nThreadsBatch, int nBatch, int nUbatch);
    private native void nativeUnload();
    private native void nativeCancel();
    private native void nativeResetCancel();
    private native void nativeSetTokenListener(Object listener);
    private native String nativeWarmup(String prompt, String cachePath);
    private native String nativeComplete(
        String prompt,
        int maxTokens,
        float temperature,
        int topK,
        float topP,
        float minP,
        float repeatPenalty,
        float presencePenalty
    );
    private native String nativeApplyChatTemplate(
        String system,
        String messagesPacked,
        String contextJson,
        boolean addAssistant
    );

    /** Called from JNI on the worker thread. */
    @SuppressWarnings("unused")
    public void onNativeToken(String token, boolean done, String error) {
        JSObject event = new JSObject();
        event.put("token", token != null ? token : "");
        event.put("done", done);
        if (error != null && !error.isEmpty()) {
            event.put("error", error);
        }
        notifyListenersOnMain("token", event);
        if (done) {
            completing.set(false);
        }
    }

    /** Prefill / generate progress for the Assembling UI. */
    @SuppressWarnings("unused")
    public void onNativeProgress(String stage, String detail, float percent) {
        JSObject event = new JSObject();
        event.put("stage", stage != null ? stage : "");
        event.put("detail", detail != null ? detail : "");
        event.put("percent", percent);
        notifyListenersOnMain("progress", event);
        Log.i(TAG, "progress " + stage + " " + Math.round(percent * 100) + "% — " + detail);
    }

    private void ensureBackend() {
        ensureNativeLibrary();
        if (backendReady.compareAndSet(false, true)) {
            try {
                // False when no CPU backend variant runs on this phone; loadModel
                // then reports that the processor can't run the model.
                if (!nativeInitBackend()) {
                    Log.e(TAG, "No llama.cpp CPU backend runs on this phone");
                }
                nativeSetTokenListener(this);
            } catch (Throwable t) {
                backendReady.set(false);
                Log.e(TAG, "nativeInitBackend failed", t);
            }
        }
    }

    /**
     * Qortino packs live in app-specific external storage
     * (Android/data/<pkg>/files/Qortino AI). That keeps multi-GB models off the
     * internal data partition while staying a real filesystem path — llama.cpp
     * memory-maps the GGUF, which a MediaStore content:// URI cannot provide.
     * Falls back to internal storage when no external volume is mounted.
     */
    private File modelsRoot() {
        File external = getContext().getExternalFilesDir(null);
        File dir = external != null
            ? new File(external, "Qortino AI")
            : new File(getContext().getFilesDir(), "qortino-agent");
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "Could not create Qortino AI dir at " + dir.getAbsolutePath());
        }
        reclaimLegacyRoot(dir);
        return dir;
    }

    /**
     * Older builds kept packs in internal files/qortino-agent. Once the new
     * root holds a model, drop the internal copy so the space comes back.
     */
    private void reclaimLegacyRoot(File currentRoot) {
        if (legacyReclaimChecked.getAndSet(true)) {
            return;
        }
        try {
            File legacy = new File(getContext().getFilesDir(), "qortino-agent");
            if (!legacy.isDirectory() || legacy.equals(currentRoot)) {
                return;
            }
            File models = new File(currentRoot, "models");
            File[] installed = models.listFiles();
            if (installed == null || installed.length == 0) {
                // Nothing usable in the new location yet — keep the old pack.
                return;
            }
            deleteRecursively(legacy);
            Log.i(TAG, "Reclaimed legacy qortino-agent storage");
        } catch (Throwable t) {
            Log.w(TAG, "Legacy storage reclaim skipped: " + t.getMessage());
        }
    }

    private void deleteRecursively(File target) {
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        target.delete();
    }

    @PluginMethod
    public void getDeviceTier(PluginCall call) {
        try {
            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mem = new ActivityManager.MemoryInfo();
            if (am != null) {
                am.getMemoryInfo(mem);
            }
            long totalRam = mem.totalMem;
            long availRam = mem.availMem;

            // The model lives under modelsRoot(), usually app-specific external
            // storage, so measure the volume it is actually written to.
            File root = modelsRoot();
            StatFs stat = new StatFs(root.exists() ? root.getPath() : Environment.getDataDirectory().getPath());
            long availStorage = stat.getAvailableBytes();
            long totalStorage = stat.getTotalBytes();

            JSObject ret = new JSObject();
            ret.put("totalRamBytes", totalRam);
            ret.put("availRamBytes", availRam);
            ret.put("availStorageBytes", availStorage);
            ret.put("totalStorageBytes", totalStorage);
            ret.put("lowMemory", mem.lowMemory);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read device tier: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getStoragePaths(PluginCall call) {
        File root = modelsRoot();
        JSObject ret = new JSObject();
        ret.put("rootDir", root.getAbsolutePath());
        ret.put("modelsDir", new File(root, "models").getAbsolutePath());
        ret.put("knowledgeDir", new File(root, "knowledge").getAbsolutePath());
        call.resolve(ret);
    }

    /**
     * Stream a remote URL straight into app-private storage (no WebView/CORS).
     * Emits {@code downloadProgress} events: { bytesReceived, bytesTotal, done, error? }.
     *
     * The node API key comes as its own {@code apiKey} argument and goes out as
     * an X-API-KEY header (native HTTP is not bound by the node's CORS rules),
     * so it is never part of a URL that reaches logcat or an error message.
     * URLs are logged and reported without their query string all the same.
     */
    @PluginMethod
    public void downloadUrl(PluginCall call) {
        String url = call.getString("url");
        String relativePath = call.getString("relativePath");
        String apiKey = call.getString("apiKey");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (relativePath == null || relativePath.isEmpty() || relativePath.contains("..")) {
            call.reject("relativePath is required");
            return;
        }
        if (downloadJob != null && !downloadJob.isDone()) {
            call.reject("A download is already running");
            return;
        }
        final String shownUrl = SecretRedaction.stripQuery(url);
        downloadCancel.set(false);
        downloadJob = executor.submit(() -> {
            HttpURLConnection conn = null;
            File partial = null;
            try {
                File target = new File(modelsRoot(), relativePath);
                File parent = target.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    call.reject("Failed to create parent directory");
                    return;
                }
                // Write beside the target and rename at the end, so a cut-off
                // download never sits under the real name looking complete.
                partial = new File(target.getPath() + ".part");
                // A download that broke off carries on where it stopped: the
                // node (and the nginx in front of public nodes) answer Range
                // requests, and a public node's connections can end part way
                // (seen at 1 GiB). The sha256 check after saving catches a bad
                // join.
                long resumeFrom = partial.isFile() ? partial.length() : 0L;
                Log.i(TAG, "downloadUrl start: " + shownUrl
                    + (resumeFrom > 0 ? " from byte " + resumeFrom : ""));
                // Redirects are followed by hand (one at most), so the key
                // header never goes to another origin.
                try {
                    conn = RedirectPolicy.open(url, apiKey, 1, null, packTransport(apiKey, resumeFrom));
                } catch (RedirectPolicy.RedirectRefused refused) {
                    call.reject("HTTP " + refused.status + " for " + shownUrl);
                    return;
                }
                int code = conn.getResponseCode();
                Log.i(TAG, "downloadUrl HTTP " + code + " len=" + conn.getContentLengthLong());
                if (code == 416 && resumeFrom > 0) {
                    // The saved bytes do not fit this file: start over next time.
                    //noinspection ResultOfMethodCallIgnored
                    partial.delete();
                    call.reject("Saved part did not match the file; starting over (" + shownUrl + ")");
                    return;
                }
                if (code < 200 || code >= 300) {
                    call.reject("HTTP " + code + " for " + shownUrl);
                    return;
                }
                // A server that ignored the range sends the whole file again.
                boolean resumed = resumeFrom > 0 && code == 206 && contentRangeStart(conn) == resumeFrom;
                long length = conn.getContentLengthLong();
                long total = length > 0 ? (resumed ? resumeFrom + length : length) : -1L;
                long received = resumed ? resumeFrom : 0L;
                byte[] buffer = new byte[256 * 1024];
                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(partial, resumed)) {
                    int read;
                    long lastEmit = 0L;
                    while ((read = in.read(buffer)) != -1) {
                        if (downloadCancel.get()) {
                            call.reject("Download cancelled");
                            // Best-effort cleanup of partial file
                            try { //noinspection ResultOfMethodCallIgnored
                                partial.delete();
                            } catch (Exception ignored) {}
                            return;
                        }
                        out.write(buffer, 0, read);
                        received += read;
                        if (received - lastEmit >= 1024L * 1024L || received == total) {
                            lastEmit = received;
                            JSObject ev = new JSObject();
                            ev.put("bytesReceived", received);
                            ev.put("bytesTotal", total > 0 ? total : 0L);
                            ev.put("done", false);
                            notifyListeners("downloadProgress", ev);
                        }
                    }
                    out.flush();
                    out.getFD().sync();
                }
                if (total > 0 && received != total) {
                    // Kept: the next try asks for the rest.
                    call.reject("Download ended early (" + received + " of " + total + " bytes)");
                    return;
                }
                if (target.exists() && !target.delete()) {
                    call.reject("Could not replace " + target.getName());
                    return;
                }
                if (!partial.renameTo(target)) {
                    call.reject("Could not finish saving " + target.getName());
                    return;
                }
                JSObject ev = new JSObject();
                ev.put("bytesReceived", received);
                ev.put("bytesTotal", total > 0 ? total : received);
                ev.put("done", true);
                notifyListeners("downloadProgress", ev);

                JSObject ret = new JSObject();
                ret.put("path", target.getAbsolutePath());
                ret.put("bytesWritten", received);
                call.resolve(ret);
            } catch (Exception e) {
                // The partial file stays, so the next try carries on from it.
                String reason = e.getMessage() != null
                    ? SecretRedaction.redactText(e.getMessage())
                    : "download failed";
                JSObject ev = new JSObject();
                ev.put("done", true);
                ev.put("error", reason);
                notifyListeners("downloadProgress", ev);
                call.reject("downloadUrl failed: " + reason);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }

    /** Start of a 206 response's Content-Range ("bytes 100-199/200"), or -1. */
    private static long contentRangeStart(HttpURLConnection conn) {
        String range = conn.getHeaderField("Content-Range");
        if (range == null) return -1L;
        String spec = range.trim();
        if (spec.startsWith("bytes")) spec = spec.substring(5).trim();
        int dash = spec.indexOf('-');
        if (dash <= 0) return -1L;
        try {
            return Long.parseLong(spec.substring(0, dash).trim());
        } catch (NumberFormatException e) {
            return -1L;
        }
    }

    /**
     * One pack-download hop over HttpURLConnection, never following redirects
     * itself; asks for the bytes from resumeFrom on when it is above zero.
     */
    private static RedirectPolicy.Transport<HttpURLConnection> packTransport(String apiKey, long resumeFrom) {
        return new RedirectPolicy.Transport<HttpURLConnection>() {
            @Override
            public HttpURLConnection open(String hopUrl, boolean withKey) throws Exception {
                HttpURLConnection hop = (HttpURLConnection) LocalHttp.openConnection(new java.net.URI(hopUrl).toURL());
                hop.setConnectTimeout(30_000);
                hop.setReadTimeout(120_000);
                hop.setInstanceFollowRedirects(false);
                hop.setRequestProperty("Accept", "*/*");
                hop.setRequestProperty("User-Agent", "QortalGO-QortinoLlm/1.0");
                if (resumeFrom > 0) hop.setRequestProperty("Range", "bytes=" + resumeFrom + "-");
                if (withKey) hop.setRequestProperty("X-API-KEY", apiKey);
                try {
                    hop.connect();
                } catch (Exception e) {
                    hop.disconnect();
                    throw e;
                }
                return hop;
            }

            @Override
            public int status(HttpURLConnection hop) throws Exception {
                return hop.getResponseCode();
            }

            @Override
            public String location(HttpURLConnection hop) {
                return hop.getHeaderField("Location");
            }

            @Override
            public void close(HttpURLConnection hop) {
                hop.disconnect();
            }
        };
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        downloadCancel.set(true);
        call.resolve();
    }

    @PluginMethod
    public void fileExists(PluginCall call) {
        String relativePath = call.getString("relativePath");
        String absolutePath = call.getString("absolutePath");
        File file;
        if (absolutePath != null && !absolutePath.isEmpty()) {
            file = new File(absolutePath);
        } else if (relativePath != null && !relativePath.isEmpty()) {
            file = new File(modelsRoot(), relativePath);
        } else {
            call.reject("relativePath or absolutePath required");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("exists", file.isFile());
        ret.put("path", file.getAbsolutePath());
        ret.put("size", file.isFile() ? file.length() : 0L);
        call.resolve(ret);
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String relativePath = call.getString("relativePath");
        String absolutePath = call.getString("absolutePath");
        File file;
        if (absolutePath != null && !absolutePath.isEmpty()) {
            file = new File(absolutePath);
        } else if (relativePath != null && !relativePath.isEmpty()) {
            if (relativePath.contains("..")) {
                call.reject("Invalid relativePath");
                return;
            }
            file = new File(modelsRoot(), relativePath);
        } else {
            call.reject("relativePath or absolutePath required");
            return;
        }
        if (!file.isFile()) {
            call.reject("File not found");
            return;
        }
        // Knowledge packs stay under a few MB; reject multi-GB accidental reads.
        if (file.length() > 32L * 1024L * 1024L) {
            call.reject("File too large to read as text");
            return;
        }
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) file.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = fis.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            JSObject ret = new JSObject();
            ret.put("text", new String(bytes, 0, offset, StandardCharsets.UTF_8));
            ret.put("path", file.getAbsolutePath());
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("readText failed: " + e.getMessage());
        }
    }

    /**
     * SHA-256 of a file under the Qortino root, as lowercase hex. Used once
     * after a download, so a corrupt or wrong file never reaches llama.cpp.
     * Emits {@code verifyProgress} events: { bytesRead, bytesTotal }.
     */
    @PluginMethod
    public void sha256File(PluginCall call) {
        String relativePath = call.getString("relativePath");
        if (relativePath == null || relativePath.isEmpty() || relativePath.contains("..")) {
            call.reject("relativePath is required");
            return;
        }
        executor.execute(() -> {
            File file = new File(modelsRoot(), relativePath);
            if (!file.isFile()) {
                call.reject("File not found: " + relativePath);
                return;
            }
            try (FileInputStream in = new FileInputStream(file)) {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                byte[] buffer = new byte[1024 * 1024];
                long total = file.length();
                long done = 0L;
                long lastEmit = 0L;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                    done += read;
                    if (done - lastEmit >= 32L * 1024L * 1024L || done == total) {
                        lastEmit = done;
                        JSObject ev = new JSObject();
                        ev.put("bytesRead", done);
                        ev.put("bytesTotal", total);
                        notifyListeners("verifyProgress", ev);
                    }
                }
                byte[] hash = digest.digest();
                StringBuilder hex = new StringBuilder(hash.length * 2);
                for (byte b : hash) {
                    hex.append(String.format("%02x", b & 0xff));
                }
                JSObject ret = new JSObject();
                ret.put("sha256", hex.toString());
                ret.put("size", total);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("sha256File failed: " + e.getMessage());
            }
        });
    }

    /**
     * Delete everything under the Qortino root except {@code keep} (relative
     * paths). Old packs left a zip, its unpacked models and a knowledge file
     * behind — several GB a phone gets back once the new model is in place.
     */
    @PluginMethod
    public void cleanupStorage(PluginCall call) {
        JSArray keepArr = call.getArray("keep");
        executor.execute(() -> {
            try {
                File root = modelsRoot();
                String rootCanonical = root.getCanonicalPath();
                Set<String> keep = new HashSet<>();
                if (keepArr != null) {
                    for (int i = 0; i < keepArr.length(); i++) {
                        String rel = keepArr.getString(i);
                        if (rel == null || rel.isEmpty() || rel.contains("..")) continue;
                        keep.add(new File(root, rel).getCanonicalPath());
                    }
                }
                long[] freed = new long[] { 0L, 0L };
                deleteExcept(root, rootCanonical, keep, freed);
                JSObject ret = new JSObject();
                ret.put("deletedFiles", freed[0]);
                ret.put("freedBytes", freed[1]);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("cleanupStorage failed: " + e.getMessage());
            }
        });
    }

    /** freed[0] = files deleted, freed[1] = bytes freed. Never leaves the root. */
    private void deleteExcept(File dir, String rootCanonical, Set<String> keep, long[] freed) throws IOException {
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            String canonical = child.getCanonicalPath();
            if (!canonical.startsWith(rootCanonical + File.separator)) continue;
            if (child.isDirectory()) {
                deleteExcept(child, rootCanonical, keep, freed);
                String[] left = child.list();
                if (left != null && left.length == 0) {
                    //noinspection ResultOfMethodCallIgnored
                    child.delete();
                }
            } else if (!keep.contains(canonical)) {
                long size = child.length();
                if (child.delete()) {
                    freed[0]++;
                    freed[1] += size;
                }
            }
        }
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        String path = call.getString("path");
        int nCtx = call.getInt("nCtx", 4096);
        // 0 lets the native side pick, on the fast cores only.
        int nThreads = call.getInt("nThreads", 0);
        int nThreadsBatch = call.getInt("nThreadsBatch", 0);
        int nBatch = call.getInt("nBatch", 0);
        int nUbatch = call.getInt("nUbatch", 0);
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        executor.execute(() -> {
            try {
                long started = System.currentTimeMillis();
                ensureBackend();
                String err = nativeLoadModel(path, nCtx, nThreads, nThreadsBatch, nBatch, nUbatch);
                if (err != null) {
                    loadedPath = "";
                    call.reject(err);
                    return;
                }
                loadedPath = path;
                loadedCtx = nCtx;
                JSObject ret = new JSObject();
                ret.put("loaded", true);
                ret.put("path", path);
                ret.put("loadMs", System.currentTimeMillis() - started);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("loadModel failed: " + t.getMessage());
            }
        });
    }

    /**
     * Read the system prompt into the KV cache now, while the user is still
     * typing, so the first answer starts straight away. Queued on the same
     * executor as complete(), which therefore waits for it and reuses it.
     */
    @PluginMethod
    public void warmup(PluginCall call) {
        String system = call.getString("system", "");
        if (system == null || system.isEmpty()) {
            call.resolve();
            return;
        }
        final int epoch = cancelEpoch.get();
        executor.execute(() -> {
            try {
                ensureBackend();
                nativeSetTokenListener(this);
                long started = System.currentTimeMillis();
                String prompt = nativeApplyChatTemplate(system, "", "[]", false);
                if (!beginWork(epoch)) {
                    call.reject("cancelled");
                    return;
                }
                String err = prompt == null || prompt.isEmpty()
                    ? "Failed to build prompt"
                    : nativeWarmup(prompt, warmupStatePath(prompt));
                if (err != null) {
                    call.reject(err);
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("warmMs", System.currentTimeMillis() - started);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("warmup failed: " + t.getMessage());
            }
        });
    }

    /**
     * File for the saved KV state of a warmed prompt. The name covers the
     * prompt, the model file and the context size, so a change to any of them
     * simply starts a new file; older ones are deleted here.
     */
    private String warmupStatePath(String prompt) {
        try {
            File model = new File(loadedPath);
            String key = prompt + "\n" + model.getAbsolutePath() + "\n" + model.length() + "\n" + loadedCtx + "\nq8_0-v1";
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 12; i++) {
                hex.append(String.format("%02x", hash[i] & 0xff));
            }
            File dir = new File(modelsRoot(), "cache");
            if (!dir.exists() && !dir.mkdirs()) return "";
            String name = "warmup-" + hex + ".kv";
            File[] old = dir.listFiles();
            if (old != null) {
                for (File f : old) {
                    if (f.getName().startsWith("warmup-") && !f.getName().equals(name)) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();
                    }
                }
            }
            return new File(dir, name).getAbsolutePath();
        } catch (Exception e) {
            Log.w(TAG, "No warmup state file: " + e.getMessage());
            return "";
        }
    }

    @PluginMethod
    public void unload(PluginCall call) {
        // Stop a running warmup or reply now; the unload itself queues
        // behind it on the executor.
        try {
            cancelNow();
        } catch (Throwable ignored) {
        }
        executor.execute(() -> {
            try {
                if (!nativeRequested) {
                    call.resolve();
                    return;
                }
                ensureNativeLibrary();
                nativeCancel();
                nativeUnload();
                loadedPath = "";
                call.resolve();
            } catch (Throwable t) {
                call.reject("unload failed: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            cancelNow();
            call.resolve();
        } catch (Throwable t) {
            call.reject("cancel failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void complete(PluginCall call) {
        if (!completing.compareAndSet(false, true)) {
            call.reject("A completion is already running");
            return;
        }

        String system = call.getString("system", "");
        JSArray messages = call.getArray("messages");
        JSArray contextChunks = call.getArray("contextChunks");
        int maxTokens = call.getInt("maxTokens", 512);
        float temperature = call.getFloat("temperature", 0.7f);
        int topK = call.getInt("topK", 20);
        float topP = call.getFloat("topP", 0.8f);
        float minP = call.getFloat("minP", 0.0f);
        float repeatPenalty = call.getFloat("repeatPenalty", 1.0f);
        float presencePenalty = call.getFloat("presencePenalty", 0.0f);
        final int epoch = cancelEpoch.get();

        executor.execute(() -> {
            try {
                ensureBackend();
                // Re-bind listener each complete so token/progress events always reach JS.
                nativeSetTokenListener(this);
                StringBuilder packed = new StringBuilder();
                if (messages != null) {
                    for (int i = 0; i < messages.length(); i++) {
                        JSONObject msg = messages.getJSONObject(i);
                        String role = msg.optString("role", "user");
                        String content = msg.optString("content", "");
                        if (i > 0) packed.append('\u001e');
                        packed.append(role).append('\u001f').append(content);
                    }
                }

                JSONArray ctxArr = new JSONArray();
                if (contextChunks != null) {
                    for (int i = 0; i < contextChunks.length(); i++) {
                        Object item = contextChunks.get(i);
                        if (item instanceof String) {
                            ctxArr.put(item);
                        } else if (item instanceof JSONObject) {
                            ctxArr.put(((JSONObject) item).optString("text", item.toString()));
                        } else if (item != null) {
                            ctxArr.put(item.toString());
                        }
                    }
                }

                String prompt = nativeApplyChatTemplate(
                    system != null ? system : "",
                    packed.toString(),
                    ctxArr.toString(),
                    true
                );
                if (prompt == null || prompt.isEmpty()) {
                    completing.set(false);
                    call.reject("Failed to build prompt");
                    return;
                }
                if (!beginWork(epoch)) {
                    completing.set(false);
                    call.reject("cancelled");
                    return;
                }

                String result = nativeComplete(
                    prompt,
                    maxTokens,
                    temperature,
                    topK,
                    topP,
                    minP,
                    repeatPenalty,
                    presencePenalty
                );
                // Native returns "ERR\u001f…" on failure, otherwise the full reply text.
                if (result != null && result.startsWith("ERR\u001f")) {
                    completing.set(false);
                    call.reject(result.substring("ERR\u001f".length()));
                    return;
                }
                completing.set(false);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("text", result != null ? result : "");
                call.resolve(ret);
            } catch (Throwable t) {
                completing.set(false);
                call.reject("complete failed: " + t.getMessage());
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (nativeRequested) {
            try {
                ensureNativeLibrary();
                nativeCancel();
                nativeUnload();
            } catch (Throwable ignored) {
            }
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
