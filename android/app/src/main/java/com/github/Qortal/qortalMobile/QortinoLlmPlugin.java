package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.util.Base64;
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
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * On-device GGUF inference for the Qortino Offline Agent (llama.cpp via JNI).
 * Models are never bundled in the APK — only loaded from app-private files.
 */
@CapacitorPlugin(name = "QortinoLlm")
public class QortinoLlmPlugin extends Plugin {
    private static final String TAG = "QortinoLlm";
    private static final Object FILE_LOCK = new Object();

    static {
        try {
            System.loadLibrary("qortino_llm");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load qortino_llm native library", e);
        }
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean backendReady = new AtomicBoolean(false);
    private final AtomicBoolean completing = new AtomicBoolean(false);
    private final AtomicBoolean downloadCancel = new AtomicBoolean(false);
    private final AtomicBoolean legacyReclaimChecked = new AtomicBoolean(false);
    private Future<?> downloadJob;

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
    private native String nativeLoadModel(String path, int nCtx, int nThreads);
    private native String nativeLoadEmbedder(String path, int nThreads);
    private native void nativeUnload();
    private native void nativeCancel();
    private native void nativeSetTokenListener(Object listener);
    private native String nativeComplete(String prompt, int maxTokens, float temperature);
    private native float[] nativeEmbed(String text);
    private native String nativeApplyChatTemplate(String system, String messagesPacked, String contextJson);
    private native boolean nativeIsModelLoaded();
    private native boolean nativeIsEmbedderLoaded();

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
        if (backendReady.compareAndSet(false, true)) {
            try {
                nativeInitBackend();
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

            File data = Environment.getDataDirectory();
            StatFs stat = new StatFs(data.getPath());
            long availStorage = stat.getAvailableBytes();
            long totalStorage = stat.getTotalBytes();

            // Offer medium (3B) only when the device has enough headroom.
            String recommended = totalRam >= 7L * 1024L * 1024L * 1024L ? "medium" : "small";
            if (availStorage < 3L * 1024L * 1024L * 1024L) {
                recommended = "small";
            }

            JSObject ret = new JSObject();
            ret.put("totalRamBytes", totalRam);
            ret.put("availRamBytes", availRam);
            ret.put("availStorageBytes", availStorage);
            ret.put("totalStorageBytes", totalStorage);
            ret.put("recommendedPack", recommended);
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
     */
    @PluginMethod
    public void downloadUrl(PluginCall call) {
        String url = call.getString("url");
        String relativePath = call.getString("relativePath");
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
        downloadCancel.set(false);
        downloadJob = executor.submit(() -> {
            HttpURLConnection conn = null;
            try {
                File target = new File(modelsRoot(), relativePath);
                File parent = target.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    call.reject("Failed to create parent directory");
                    return;
                }
                Log.i(TAG, "downloadUrl start: " + url);
                URL parsed = new java.net.URI(url).toURL();
                conn = (HttpURLConnection) parsed.openConnection();
                conn.setConnectTimeout(30_000);
                conn.setReadTimeout(120_000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("User-Agent", "QortalGO-QortinoLlm/1.0");
                conn.connect();
                int code = conn.getResponseCode();
                Log.i(TAG, "downloadUrl HTTP " + code + " len=" + conn.getContentLengthLong());
                // Follow one redirect manually if needed (some stacks disable auto)
                if (code == HttpURLConnection.HTTP_MOVED_PERM
                        || code == HttpURLConnection.HTTP_MOVED_TEMP
                        || code == HttpURLConnection.HTTP_SEE_OTHER
                        || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = (HttpURLConnection) new java.net.URI(loc).toURL().openConnection();
                    conn.setConnectTimeout(30_000);
                    conn.setReadTimeout(120_000);
                    conn.setRequestProperty("User-Agent", "QortalGO-QortinoLlm/1.0");
                    conn.connect();
                    code = conn.getResponseCode();
                    Log.i(TAG, "downloadUrl redirected HTTP " + code);
                }
                if (code < 200 || code >= 300) {
                    call.reject("HTTP " + code + " for " + url);
                    return;
                }
                long total = conn.getContentLengthLong();
                long received = 0L;
                byte[] buffer = new byte[256 * 1024];
                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(target, false)) {
                    int read;
                    long lastEmit = 0L;
                    while ((read = in.read(buffer)) != -1) {
                        if (downloadCancel.get()) {
                            call.reject("Download cancelled");
                            // Best-effort cleanup of partial file
                            try { //noinspection ResultOfMethodCallIgnored
                                target.delete();
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
                JSObject ev = new JSObject();
                ev.put("done", true);
                ev.put("error", e.getMessage() != null ? e.getMessage() : "download failed");
                notifyListeners("downloadProgress", ev);
                call.reject("downloadUrl failed: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        downloadCancel.set(true);
        call.resolve();
    }

    /**
     * Copy an on-device file (e.g. /sdcard/Download/Qortino-Standard.zip) into
     * the agent directory. Used for QA staging and offline assemble without QDN.
     */
    @PluginMethod
    public void copyFileIntoAgent(PluginCall call) {
        String absoluteSource = call.getString("absoluteSource");
        String relativeDest = call.getString("relativeDest");
        if (absoluteSource == null || absoluteSource.isEmpty()) {
            call.reject("absoluteSource is required");
            return;
        }
        if (relativeDest == null || relativeDest.isEmpty() || relativeDest.contains("..")) {
            call.reject("relativeDest is required");
            return;
        }
        executor.execute(() -> {
            File src = new File(absoluteSource);
            if (!src.isFile()) {
                // Common public Download aliases
                File alt = new File("/storage/emulated/0/Download/" + src.getName());
                if (alt.isFile()) {
                    src = alt;
                } else {
                    call.reject("Source file not found: " + absoluteSource);
                    return;
                }
            }
            File target = new File(modelsRoot(), relativeDest);
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                call.reject("Failed to create parent directory");
                return;
            }
            long total = src.length();
            long received = 0L;
            byte[] buffer = new byte[256 * 1024];
            try (InputStream in = new BufferedInputStream(new FileInputStream(src));
                 FileOutputStream out = new FileOutputStream(target, false)) {
                int read;
                long lastEmit = 0L;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    received += read;
                    if (received - lastEmit >= 1024L * 1024L || received == total) {
                        lastEmit = received;
                        JSObject ev = new JSObject();
                        ev.put("bytesReceived", received);
                        ev.put("bytesTotal", total);
                        ev.put("done", false);
                        notifyListeners("downloadProgress", ev);
                    }
                }
                out.flush();
            } catch (Exception e) {
                call.reject("copyFileIntoAgent failed: " + e.getMessage());
                return;
            }
            JSObject ev = new JSObject();
            ev.put("bytesReceived", received);
            ev.put("bytesTotal", total);
            ev.put("done", true);
            notifyListeners("downloadProgress", ev);
            JSObject ret = new JSObject();
            ret.put("path", target.getAbsolutePath());
            ret.put("bytesWritten", received);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String relativePath = call.getString("relativePath");
        String dataBase64 = call.getString("dataBase64");
        boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));

        if (relativePath == null || relativePath.isEmpty()) {
            call.reject("relativePath is required");
            return;
        }
        if (dataBase64 == null) {
            call.reject("dataBase64 is required");
            return;
        }
        if (relativePath.contains("..")) {
            call.reject("Invalid relativePath");
            return;
        }

        try {
            byte[] bytes = Base64.decode(dataBase64, Base64.NO_WRAP);
            File target = new File(modelsRoot(), relativePath);
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                call.reject("Failed to create parent directory");
                return;
            }
            synchronized (FILE_LOCK) {
                try (FileOutputStream fos = new FileOutputStream(target, append)) {
                    fos.write(bytes);
                    fos.flush();
                }
            }
            JSObject ret = new JSObject();
            ret.put("path", target.getAbsolutePath());
            ret.put("bytesWritten", bytes.length);
            call.resolve(ret);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid Base64: " + e.getMessage());
        } catch (IOException e) {
            call.reject("Write failed: " + e.getMessage());
        }
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
     * Extract a zip already stored under the qortino-agent root into that same
     * root (or an optional relative destination). Zip-slip protected.
     */
    @PluginMethod
    public void extractZip(PluginCall call) {
        String zipRelativePath = call.getString("zipRelativePath");
        String zipAbsolutePath = call.getString("zipAbsolutePath");
        String destRelative = call.getString("destRelativePath", "");
        if ((zipRelativePath == null || zipRelativePath.isEmpty())
                && (zipAbsolutePath == null || zipAbsolutePath.isEmpty())) {
            call.reject("zipRelativePath or zipAbsolutePath required");
            return;
        }
        executor.execute(() -> {
            try {
                File zipFile = zipAbsolutePath != null && !zipAbsolutePath.isEmpty()
                        ? new File(zipAbsolutePath)
                        : new File(modelsRoot(), zipRelativePath);
                if (!zipFile.isFile()) {
                    call.reject("Zip not found: " + zipFile.getAbsolutePath());
                    return;
                }
                File destRoot = (destRelative == null || destRelative.isEmpty())
                        ? modelsRoot()
                        : new File(modelsRoot(), destRelative);
                if (!destRoot.exists() && !destRoot.mkdirs()) {
                    call.reject("Failed to create extract directory");
                    return;
                }
                String destCanonical = destRoot.getCanonicalPath() + File.separator;
                int count = 0;
                byte[] buffer = new byte[1024 * 256];
                try (ZipInputStream zis = new ZipInputStream(
                        new BufferedInputStream(new FileInputStream(zipFile)))) {
                    ZipEntry entry;
                    while ((entry = zis.getNextEntry()) != null) {
                        String name = entry.getName();
                        if (name == null || name.isEmpty() || name.contains("..")) {
                            zis.closeEntry();
                            continue;
                        }
                        // Skip macOS junk / absolute paths
                        if (name.startsWith("__MACOSX/") || name.startsWith("/")) {
                            zis.closeEntry();
                            continue;
                        }
                        File outFile = new File(destRoot, name);
                        String outCanonical = outFile.getCanonicalPath();
                        if (!outCanonical.startsWith(destCanonical) && !outCanonical.equals(destRoot.getCanonicalPath())) {
                            zis.closeEntry();
                            call.reject("Zip slip blocked: " + name);
                            return;
                        }
                        if (entry.isDirectory()) {
                            if (!outFile.exists() && !outFile.mkdirs()) {
                                call.reject("Failed to create " + name);
                                return;
                            }
                        } else {
                            File parent = outFile.getParentFile();
                            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                                call.reject("Failed to create parent for " + name);
                                return;
                            }
                            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                                int read;
                                while ((read = zis.read(buffer)) != -1) {
                                    fos.write(buffer, 0, read);
                                }
                            }
                            count++;
                        }
                        zis.closeEntry();
                    }
                }
                JSObject ret = new JSObject();
                ret.put("extractedFiles", count);
                ret.put("destDir", destRoot.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("extractZip failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void deletePath(PluginCall call) {
        String relativePath = call.getString("relativePath");
        if (relativePath == null || relativePath.isEmpty() || relativePath.contains("..")) {
            call.reject("relativePath is required");
            return;
        }
        File target = new File(modelsRoot(), relativePath);
        boolean deleted = deleteRecursive(target);
        JSObject ret = new JSObject();
        ret.put("deleted", deleted);
        call.resolve(ret);
    }

    private boolean deleteRecursive(File file) {
        if (file == null || !file.exists()) {
            return true;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        return file.delete();
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        String path = call.getString("path");
        Integer nCtx = call.getInt("nCtx", 2048);
        Integer nThreads = call.getInt("nThreads", Math.max(2, Runtime.getRuntime().availableProcessors() / 2));
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        executor.execute(() -> {
            try {
                ensureBackend();
                String err = nativeLoadModel(path, nCtx != null ? nCtx : 2048, nThreads != null ? nThreads : 4);
                if (err != null) {
                    call.reject(err);
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("loaded", true);
                ret.put("path", path);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("loadModel failed: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void loadEmbedder(PluginCall call) {
        String path = call.getString("path");
        Integer nThreads = call.getInt("nThreads", 2);
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        executor.execute(() -> {
            try {
                ensureBackend();
                String err = nativeLoadEmbedder(path, nThreads != null ? nThreads : 2);
                if (err != null) {
                    call.reject(err);
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("loaded", true);
                ret.put("path", path);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("loadEmbedder failed: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void unload(PluginCall call) {
        executor.execute(() -> {
            try {
                nativeCancel();
                nativeUnload();
                call.resolve();
            } catch (Throwable t) {
                call.reject("unload failed: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            nativeCancel();
            call.resolve();
        } catch (Throwable t) {
            call.reject("cancel failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        try {
            ensureBackend();
            JSObject ret = new JSObject();
            ret.put("modelLoaded", nativeIsModelLoaded());
            ret.put("embedderLoaded", nativeIsEmbedderLoaded());
            ret.put("completing", completing.get());
            Runtime rt = Runtime.getRuntime();
            ret.put("javaUsedMemoryBytes", rt.totalMemory() - rt.freeMemory());
            ret.put("javaMaxMemoryBytes", rt.maxMemory());
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("getStatus failed: " + t.getMessage());
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
        Integer maxTokens = call.getInt("maxTokens", 384);
        Double temperature = call.getDouble("temperature", 0.7);

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
                    ctxArr.toString()
                );
                if (prompt == null || prompt.isEmpty()) {
                    completing.set(false);
                    call.reject("Failed to build prompt");
                    return;
                }

                String result = nativeComplete(
                    prompt,
                    maxTokens != null ? maxTokens : 384,
                    temperature != null ? temperature.floatValue() : 0.7f
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

    @PluginMethod
    public void embed(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        executor.execute(() -> {
            try {
                ensureBackend();
                float[] vector = nativeEmbed(text);
                if (vector == null) {
                    call.reject("Embedder not loaded or embed failed");
                    return;
                }
                JSArray arr = new JSArray();
                for (float v : vector) {
                    arr.put(v);
                }
                JSObject ret = new JSObject();
                ret.put("vector", arr);
                ret.put("dimensions", vector.length);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("embed failed: " + t.getMessage());
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        try {
            nativeCancel();
            nativeUnload();
        } catch (Throwable ignored) {
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
