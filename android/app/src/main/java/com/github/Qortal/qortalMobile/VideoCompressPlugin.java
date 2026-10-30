package com.github.Qortal.qortalMobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.otaliastudios.transcoder.Transcoder;
import com.otaliastudios.transcoder.TranscoderListener;
import com.otaliastudios.transcoder.source.UriDataSource;
import com.otaliastudios.transcoder.strategy.DefaultAudioStrategy;
import com.otaliastudios.transcoder.strategy.DefaultVideoStrategies;
import com.otaliastudios.transcoder.strategy.DefaultVideoStrategy;
import com.otaliastudios.transcoder.strategy.RemoveTrackStrategy;
import com.otaliastudios.transcoder.strategy.TrackStrategy;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import fi.iki.elonen.NanoHTTPD;

/**
 * Hardware MediaCodec video compression via DeepMedia Transcoder
 * (open-source, no Google Media3 / Play Services).
 *
 * Cross-device approach:
 * - Prefer plain DefaultVideoStrategy (no KEY_PROFILE/LEVEL/OPERATING_RATE hacks)
 * - Align dimensions to multiples of 16 (OEM MediaCodec requirement)
 * - Always re-encode AAC (pass-through muxes break on many devices)
 * - Stage content:// to a local file before decode
 * - Retry ladder: preferred → safer → CTS preset → video-only
 */
@CapacitorPlugin(name = "VideoCompress")
public class VideoCompressPlugin extends Plugin {
    private static final String TAG = "VideoCompress";
    private static final String CHANNEL_ID = "qortal_video_compress";
    private static final String CHANNEL_NAME = "Video compression";
    private static final int NOTIFICATION_ID = 0x71C0;
    private static final long DEFAULT_SKIP_BELOW = 0L;
    private static final long MIN_VALID_OUTPUT_BYTES = 32L * 1024L;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicInteger lastNotifiedProgress = new AtomicInteger(-1);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private Future<?> runningJob;
    private Future<Void> transcoderFuture;
    private PluginCall activeCall;
    /**
     * Loopback file servers keyed by their random URL token. Several can run at
     * once: the composer streams the growing compress output while the final
     * read (or Qortino audio save) serves another file.
     */
    private final Map<String, LocalFileHttpServer> fileServers = new LinkedHashMap<>();
    private static final int MAX_FILE_SERVERS = 4;
    private final SecureRandom tokenRandom = new SecureRandom();
    /** File the running transcode attempt is writing (null when idle). */
    @Nullable private volatile String currentOutputPath;

    private static final class Attempt {
        final String label;
        final TrackStrategy video;
        final TrackStrategy audio;

        Attempt(String label, TrackStrategy video, TrackStrategy audio) {
            this.label = label;
            this.video = video;
            this.audio = audio;
        }
    }

    @Override
    public void load() {
        super.load();
        ensureChannel();
    }

    @PluginMethod
    public void compress(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        if (runningJob != null && !runningJob.isDone()) {
            call.reject("A video is already compressing");
            return;
        }

        call.setKeepAlive(true);
        cancelRequested.set(false);

        long skipIfBelow = call.getLong("skipIfBelowBytes", DEFAULT_SKIP_BELOW);
        boolean forceTranscode = Boolean.TRUE.equals(call.getBoolean("forceTranscode", false));
        Long targetMaxBytes = call.getLong("targetMaxBytes");
        int maxHeight = call.getInt("maxHeight", 720);
        int frameRate = call.getInt("frameRate", 30);
        Double keyFrameIntervalObj = call.getDouble("keyFrameInterval", 3.0);
        float keyFrameInterval = keyFrameIntervalObj != null ? keyFrameIntervalObj.floatValue() : 3f;
        int audioBitRate = call.getInt("audioBitRate", 96_000);
        int audioChannels = call.getInt("audioChannels", 0); // 0 = as input, 1 = mono
        Double durationSecObj = call.getDouble("durationSec");
        double durationSec = durationSecObj != null ? durationSecObj : 0.0;
        String title = call.getString("notificationTitle", "Compressing video");

        Uri sourceUri = resolveUri(path);
        File sourceFile = fileFromUri(sourceUri);
        long sourceSize = sourceFile != null && sourceFile.exists() ? sourceFile.length() : -1;

        if (!forceTranscode && sourceSize >= 0 && sourceSize < skipIfBelow) {
            resolveReadableFile(call, sourceFile, true, false);
            return;
        }

        final int clampedHeight = align16(Math.max(360, Math.min(720, maxHeight)));
        final int clampedFps = Math.max(15, Math.min(30, frameRate));
        final float clampedGop = Math.max(2f, Math.min(5f, keyFrameInterval));
        final int safeAudioBitRate = Math.max(64_000, Math.min(128_000, audioBitRate));
        final long bitrate = estimateBitrate(
                sourceSize,
                targetMaxBytes,
                clampedHeight,
                clampedFps,
                durationSec,
                safeAudioBitRate
        );

        // Build a ladder of increasingly conservative strategies for OEM quirks.
        final List<Attempt> attempts = buildAttempts(
                clampedHeight,
                clampedFps,
                clampedGop,
                bitrate,
                safeAudioBitRate,
                audioChannels
        );

        activeCall = call;
        lastNotifiedProgress.set(-1);
        showProgressNotification(title, "Starting…", 0, true);
        emitProgress(0, "starting");

        runningJob = executor.submit(() -> {
            File localSource = null;
            File outFile = null;
            try {
                // Always prefer a real local file for MediaExtractor — content://
                // and some OEM providers are flaky across devices.
                Uri decodeUri = sourceUri;
                if (sourceFile != null && sourceFile.exists()) {
                    decodeUri = Uri.fromFile(sourceFile);
                } else {
                    localSource = materializeSource(sourceUri);
                    if (localSource == null) {
                        failCall("Could not read source video", null);
                        return;
                    }
                    decodeUri = Uri.fromFile(localSource);
                    Log.i(TAG, "Staged source locally: " + localSource.length() + " bytes");
                }

                File outDir = new File(getContext().getCacheDir(), "quitter-out");
                //noinspection ResultOfMethodCallIgnored
                outDir.mkdirs();

                Throwable lastError = null;
                for (int i = 0; i < attempts.size(); i++) {
                    if (cancelRequested.get()) {
                        failCall("Compression canceled", null);
                        return;
                    }
                    Attempt attempt = attempts.get(i);
                    outFile = new File(
                            outDir,
                            "quitter-a" + i + "-" + System.currentTimeMillis() + ".mp4"
                    );
                    Log.i(TAG, "Attempt " + (i + 1) + "/" + attempts.size() + ": " + attempt.label);
                    // Progress events carry this path so JS can upload the
                    // finished part of the file while the rest is encoding.
                    currentOutputPath = outFile.getAbsolutePath();
                    if (i > 0) {
                        showProgressNotification(
                                title,
                                "Retrying with safer settings…",
                                Math.max(1, lastNotifiedProgress.get()),
                                true
                        );
                        emitProgress(Math.max(1, lastNotifiedProgress.get()), "retrying");
                    }

                    TranscodeOutcome outcome = runOneAttempt(
                            decodeUri,
                            outFile,
                            attempt,
                            title
                    );

                    if (outcome.canceled) {
                        //noinspection ResultOfMethodCallIgnored
                        outFile.delete();
                        failCall("Compression canceled", null);
                        return;
                    }

                    if (outcome.success
                            && outFile.exists()
                            && outFile.length() >= MIN_VALID_OUTPUT_BYTES
                            && looksLikeMp4(outFile)) {
                        Log.i(TAG, "Attempt OK: " + attempt.label
                                + " → " + outFile.length() + " bytes");
                        finishSuccess(outFile);
                        return;
                    }

                    lastError = outcome.error != null
                            ? outcome.error
                            : new IOException(
                            "Invalid output (" + (outFile.exists() ? outFile.length() : 0) + " bytes)"
                    );
                    Log.w(TAG, "Attempt failed: " + attempt.label + " — " + lastError.getMessage());
                    currentOutputPath = null;
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                    outFile = null;
                }

                String msg = lastError != null && lastError.getMessage() != null
                        ? lastError.getMessage()
                        : "Compression failed on this device";
                failCall(msg, null);
            } catch (Exception e) {
                Log.e(TAG, "Compress worker failed", e);
                if (outFile != null) {
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                }
                failCall(
                        e.getMessage() != null ? e.getMessage() : "Compression failed",
                        null
                );
            } finally {
                transcoderFuture = null;
                currentOutputPath = null;
                if (localSource != null) {
                    //noinspection ResultOfMethodCallIgnored
                    localSource.delete();
                }
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelRequested.set(true);
        Future<Void> future = transcoderFuture;
        if (future != null) {
            future.cancel(true);
        }
        if (runningJob != null && !runningJob.isDone()) {
            runningJob.cancel(true);
        }
        mainHandler.postDelayed(() -> {
            if (activeCall != null) {
                failCall("Compression canceled", null);
            }
        }, 400);
        call.resolve();
    }

    /**
     * Return size + path for a local file.
     */
    @PluginMethod
    public void stat(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        File file = resolveExistingFile(path);
        if (file == null) {
            call.reject("File not found");
            return;
        }
        JSObject result = new JSObject();
        result.put("path", file.getAbsolutePath());
        // Use double so Capacitor/JS keeps full size for files under 2^53 bytes.
        result.put("size", (double) file.length());
        result.put("exists", true);
        call.resolve(result);
    }

    /**
     * Serve a local file over http://127.0.0.1 so WebView fetch() can read the
     * full bytes. convertFileSrc + content:// are unreliable for large videos.
     */
    @PluginMethod
    public void serveFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        File file = resolveExistingFile(path);
        if (file == null || !file.exists()) {
            // content:// — stage first
            try {
                File staged = materializeSource(resolveUri(path));
                if (staged != null) {
                    file = ensureWebReadableCopy(staged);
                    //noinspection ResultOfMethodCallIgnored
                    staged.delete();
                }
            } catch (Exception e) {
                Log.w(TAG, "serveFile stage failed", e);
            }
        }
        if (file == null || !file.exists()) {
            call.reject("File not found");
            return;
        }
        if (file.length() < 1024L) {
            call.reject("File too small (" + file.length() + " bytes)");
            return;
        }

        LocalFileHttpServer server = null;
        try {
            String token = newServeToken();
            server = new LocalFileHttpServer(file, token);
            server.start();
            registerFileServer(token, server);
            int port = server.getListeningPort();
            String url = "http://127.0.0.1:" + port + "/" + token;
            Log.i(TAG, "Serving " + file.length() + " bytes on port " + port);
            JSObject result = new JSObject();
            result.put("url", url);
            result.put("path", file.getAbsolutePath());
            result.put("size", (double) file.length());
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "serveFile failed", e);
            if (server != null) {
                try {
                    server.stop();
                } catch (Exception ignored) {
                }
            }
            call.reject(e.getMessage() != null ? e.getMessage() : "Failed to serve file");
        }
    }

    /** Stop the server behind `url`, or every server when `url` is omitted. */
    @PluginMethod
    public void stopServe(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            stopAllFileServers();
        } else {
            stopFileServer(tokenFromUrl(url));
        }
        call.resolve();
    }

    /**
     * Download a remote URL (e.g. local node /arbitrary/VIDEO/…) into app cache
     * so extractAudio / compress can open a real file path.
     */
    @PluginMethod
    public void downloadUrlToCache(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        String filename = call.getString("filename", "qdn-media-" + System.currentTimeMillis() + ".mp4");
        filename = filename.replaceAll("[\\\\/:?%*\"<>|]+", "_");
        call.setKeepAlive(true);
        final String safeName = filename;
        final String sourceUrl = url;
        executor.execute(() -> {
            File dir = new File(getContext().getCacheDir(), "qortino-in");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File dest = new File(dir, safeName);
            try {
                // Redirects are followed hop by hop, each routed by
                // LocalHttp (direct for the phone's own addresses).
                java.net.HttpURLConnection conn = LocalHttp.openFollowingRedirects(
                        new java.net.URL(sourceUrl), LocalHttp.MAX_REDIRECTS, (hop, hopUrl) -> {
                            hop.setConnectTimeout(20_000);
                            hop.setReadTimeout(120_000);
                        });
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    call.reject("Download failed (" + code + ")");
                    return;
                }
                try (InputStream in = conn.getInputStream();
                     OutputStream out = new FileOutputStream(dest)) {
                    byte[] buf = new byte[1024 * 256];
                    int n;
                    while ((n = in.read(buf)) >= 0) {
                        out.write(buf, 0, n);
                    }
                    out.flush();
                }
                if (dest.length() < 1024L) {
                    //noinspection ResultOfMethodCallIgnored
                    dest.delete();
                    call.reject("Downloaded file too small");
                    return;
                }
                JSObject result = new JSObject();
                result.put("path", dest.getAbsolutePath());
                result.put("size", dest.length());
                call.resolve(result);
            } catch (Exception e) {
                // The exception can repeat the URL, query (API key) and all.
                Log.e(TAG, "downloadUrlToCache failed: "
                    + SecretRedaction.redactText(String.valueOf(e)));
                //noinspection ResultOfMethodCallIgnored
                dest.delete();
                call.reject(e.getMessage() != null
                    ? SecretRedaction.redactText(e.getMessage())
                    : "Download failed");
            }
        });
    }

    /**
     * Demux / re-encode audio only from a local video file (video track removed).
     * Output is an M4A/MP4 audio file in cache.
     */
    @PluginMethod
    public void extractAudio(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        if (runningJob != null && !runningJob.isDone()) {
            call.reject("A video job is already running");
            return;
        }
        call.setKeepAlive(true);
        cancelRequested.set(false);
        activeCall = call;
        lastNotifiedProgress.set(-1);
        showProgressNotification("Extracting audio", "Starting…", 0, true);
        emitProgress(0, "starting");

        runningJob = executor.submit(() -> {
            File localSource = null;
            File outFile = null;
            try {
                Uri sourceUri = resolveUri(path);
                File sourceFile = fileFromUri(sourceUri);
                Uri decodeUri;
                if (sourceFile != null && sourceFile.exists()) {
                    decodeUri = Uri.fromFile(sourceFile);
                } else {
                    localSource = materializeSource(sourceUri);
                    if (localSource == null) {
                        failCall("Could not read source video", null);
                        return;
                    }
                    decodeUri = Uri.fromFile(localSource);
                }

                File outDir = new File(getContext().getCacheDir(), "qortino-out");
                //noinspection ResultOfMethodCallIgnored
                outDir.mkdirs();
                outFile = new File(outDir, "audio-" + System.currentTimeMillis() + ".m4a");

                Attempt attempt = new Attempt(
                        "audio-only",
                        new RemoveTrackStrategy(),
                        audioStrategy(128_000, 0)
                );
                TranscodeOutcome outcome = runOneAttempt(decodeUri, outFile, attempt, "Extracting audio");
                if (outcome.canceled || cancelRequested.get()) {
                    failCall("Cancelled", outFile);
                    return;
                }
                if (!outcome.success || !outFile.exists() || outFile.length() < 1024L) {
                    failCall(
                            outcome.error != null && outcome.error.getMessage() != null
                                    ? outcome.error.getMessage()
                                    : "Audio extract failed",
                            outFile
                    );
                    return;
                }

                JSObject result = new JSObject();
                result.put("path", outFile.getAbsolutePath());
                result.put("uri", Uri.fromFile(outFile).toString());
                result.put("size", outFile.length());
                emitProgress(100, "completed");
                clearNotification();
                PluginCall c = activeCall;
                activeCall = null;
                if (c != null) c.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "extractAudio failed", e);
                failCall(e.getMessage() != null ? e.getMessage() : "Audio extract failed", outFile);
            } finally {
                if (localSource != null) {
                    //noinspection ResultOfMethodCallIgnored
                    localSource.delete();
                }
            }
        });
    }

    private String newServeToken() {
        byte[] bytes = new byte[16];
        tokenRandom.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b));
        }
        return sb.toString();
    }

    @Nullable
    private static String tokenFromUrl(String url) {
        int slash = url.lastIndexOf('/');
        if (slash < 0 || slash == url.length() - 1) return null;
        return url.substring(slash + 1);
    }

    private void registerFileServer(String token, LocalFileHttpServer server) {
        LocalFileHttpServer evicted = null;
        synchronized (fileServers) {
            fileServers.put(token, server);
            if (fileServers.size() > MAX_FILE_SERVERS) {
                // Callers that forget stopServe must not leak threads/ports.
                Iterator<Map.Entry<String, LocalFileHttpServer>> it =
                        fileServers.entrySet().iterator();
                Map.Entry<String, LocalFileHttpServer> oldest = it.next();
                evicted = oldest.getValue();
                it.remove();
            }
        }
        if (evicted != null) {
            try {
                evicted.stop();
            } catch (Exception ignored) {
            }
        }
    }

    private void stopFileServer(@Nullable String token) {
        if (token == null) return;
        LocalFileHttpServer server;
        synchronized (fileServers) {
            server = fileServers.remove(token);
        }
        if (server != null) {
            try {
                server.stop();
            } catch (Exception ignored) {
            }
        }
    }

    private void stopAllFileServers() {
        List<LocalFileHttpServer> servers;
        synchronized (fileServers) {
            servers = new ArrayList<>(fileServers.values());
            fileServers.clear();
        }
        for (LocalFileHttpServer server : servers) {
            try {
                server.stop();
            } catch (Exception ignored) {
            }
        }
    }

    /**
     * Tiny NanoHTTPD that serves one file with CORS + Range support so the
     * Capacitor WebView can fetch large MP4s reliably over loopback HTTP.
     * Only `/<token>` answers, so other apps probing loopback ports cannot
     * read the file.
     */
    private static final class LocalFileHttpServer extends NanoHTTPD {
        private final File file;
        private final String path;

        LocalFileHttpServer(@NonNull File file, @NonNull String token) {
            super("127.0.0.1", 0); // loopback only, ephemeral port
            this.file = file;
            this.path = "/" + token;
        }

        @Override
        public Response serve(IHTTPSession session) {
            String uri = session.getUri();
            if ("/favicon.ico".equals(uri)) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "");
            }
            if (!path.equals(uri)) {
                return cors(newFixedLengthResponse(
                        Response.Status.NOT_FOUND,
                        MIME_PLAINTEXT,
                        "not found"
                ));
            }
            if (Method.OPTIONS.equals(session.getMethod())) {
                Response preflight = newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, "");
                return cors(preflight);
            }

            long fileLen = file.length();
            String rangeHeader = session.getHeaders().get("range");
            try {
                if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                    String spec = rangeHeader.substring(6).trim();
                    long start = 0;
                    long end = fileLen - 1;
                    int dash = spec.indexOf('-');
                    if (dash >= 0) {
                        String a = spec.substring(0, dash).trim();
                        String b = spec.substring(dash + 1).trim();
                        if (!a.isEmpty()) start = Long.parseLong(a);
                        if (!b.isEmpty()) end = Long.parseLong(b);
                    }
                    if (start < 0) start = 0;
                    if (end >= fileLen) end = fileLen - 1;
                    if (start > end) {
                        Response r = newFixedLengthResponse(
                                Response.Status.RANGE_NOT_SATISFIABLE,
                                MIME_PLAINTEXT,
                                ""
                        );
                        r.addHeader("Content-Range", "bytes */" + fileLen);
                        return cors(r);
                    }
                    long length = end - start + 1;
                    FileInputStream fis = new FileInputStream(file);
                    long skipped = fis.skip(start);
                    if (skipped < start) {
                        //noinspection ResultOfMethodCallIgnored
                        fis.close();
                        return cors(newFixedLengthResponse(
                                Response.Status.INTERNAL_ERROR,
                                MIME_PLAINTEXT,
                                "seek failed"
                        ));
                    }
                    Response res = newFixedLengthResponse(
                            Response.Status.PARTIAL_CONTENT,
                            "video/mp4",
                            fis,
                            length
                    );
                    res.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + fileLen);
                    res.addHeader("Accept-Ranges", "bytes");
                    res.addHeader("Content-Length", String.valueOf(length));
                    return cors(res);
                }

                FileInputStream fis = new FileInputStream(file);
                Response res = newFixedLengthResponse(
                        Response.Status.OK,
                        "video/mp4",
                        fis,
                        fileLen
                );
                res.addHeader("Accept-Ranges", "bytes");
                res.addHeader("Content-Length", String.valueOf(fileLen));
                return cors(res);
            } catch (Exception e) {
                Log.e(TAG, "LocalFileHttpServer serve error", e);
                return cors(newFixedLengthResponse(
                        Response.Status.INTERNAL_ERROR,
                        MIME_PLAINTEXT,
                        e.getMessage() != null ? e.getMessage() : "error"
                ));
            }
        }

        private static Response cors(Response response) {
            response.addHeader("Access-Control-Allow-Origin", "*");
            response.addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            response.addHeader("Access-Control-Allow-Headers", "*");
            response.addHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
            return response;
        }
    }

    @Nullable
    private File resolveExistingFile(String path) {
        Uri uri = resolveUri(path);
        File file = fileFromUri(uri);
        if (file != null && file.exists() && file.isFile()) {
            return file;
        }
        // Absolute path that wasn't a file:// URI
        if (path.startsWith("/")) {
            File direct = new File(path);
            if (direct.exists() && direct.isFile()) return direct;
        }
        return null;
    }

    @NonNull
    private List<Attempt> buildAttempts(
            int height,
            int fps,
            float gop,
            long bitrate,
            int audioBitRate,
            int audioChannels
    ) {
        List<Attempt> list = new ArrayList<>();

        // 1) Preferred: scale with atMost(height) only — preserves aspect, even dims.
        list.add(new Attempt(
                "atMost-" + height + "p@" + fps,
                DefaultVideoStrategy.atMost(height)
                        .bitRate(bitrate)
                        .frameRate(fps)
                        .keyFrameInterval(gop)
                        .build(),
                audioStrategy(audioBitRate, audioChannels)
        ));

        // 2) Safer: 30fps, classic 3s GOP, stereo AAC — fewer OEM edge cases.
        int safeHeight = Math.min(height, 720);
        list.add(new Attempt(
                "safe-" + safeHeight + "p@30",
                DefaultVideoStrategy.atMost(safeHeight)
                        .bitRate(Math.min(bitrate, safeHeight <= 480 ? 1_500_000L : 2_000_000L))
                        .frameRate(30)
                        .keyFrameInterval(3f)
                        .build(),
                audioStrategy(96_000, 0)
        ));

        // 3) CTS-guaranteed exact size (may letterbox/crop) — widest device support.
        if (height >= 720) {
            list.add(new Attempt(
                    "cts-720x1280",
                    DefaultVideoStrategies.for720x1280(),
                    audioStrategy(96_000, 0)
            ));
        } else {
            list.add(new Attempt(
                    "cts-360x480",
                    DefaultVideoStrategies.for360x480(),
                    audioStrategy(64_000, 0)
            ));
        }

        // 4) Low-res last resort with stereo AAC (mono breaks some encoders).
        list.add(new Attempt(
                "fallback-360p@24",
                DefaultVideoStrategy.atMost(360)
                        .bitRate(800_000L)
                        .frameRate(24)
                        .keyFrameInterval(3f)
                        .build(),
                audioStrategy(64_000, 0)
        ));

        // 5) Video-only if audio codecs are the problem.
        list.add(new Attempt(
                "video-only-360p",
                DefaultVideoStrategy.atMost(360)
                        .bitRate(800_000L)
                        .frameRate(24)
                        .keyFrameInterval(3f)
                        .build(),
                new RemoveTrackStrategy()
        ));

        return list;
    }

    @NonNull
    private static TrackStrategy audioStrategy(int bitRate, int channels) {
        DefaultAudioStrategy.Builder builder = DefaultAudioStrategy.builder()
                .bitRate(Math.max(48_000, Math.min(160_000, bitRate)))
                // Avoid resampling — SAMPLE_RATE_AS_INPUT is the portable choice.
                .sampleRate(DefaultAudioStrategy.SAMPLE_RATE_AS_INPUT);
        if (channels == 1) {
            builder.channels(1);
        } else if (channels == 2) {
            builder.channels(2);
        } else {
            builder.channels(DefaultAudioStrategy.CHANNELS_AS_INPUT);
        }
        return builder.build();
    }

    private static final class TranscodeOutcome {
        final boolean success;
        final boolean canceled;
        @Nullable final Throwable error;

        TranscodeOutcome(boolean success, boolean canceled, @Nullable Throwable error) {
            this.success = success;
            this.canceled = canceled;
            this.error = error;
        }
    }

    @NonNull
    private TranscodeOutcome runOneAttempt(
            Uri decodeUri,
            File outFile,
            Attempt attempt,
            String title
    ) {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Throwable> errorRef = new AtomicReference<>();
        AtomicBoolean ok = new AtomicBoolean(false);
        AtomicBoolean canceled = new AtomicBoolean(false);

        try {
            // Wrapped so the source's GPS location is not copied into the
            // output (MediaMuxer would write it as moov/udta/©xyz).
            Future<Void> future = Transcoder.into(outFile.getAbsolutePath())
                    .addDataSource(new LocationFreeDataSource(
                            new UriDataSource(getContext(), decodeUri)))
                    .setVideoTrackStrategy(attempt.video)
                    .setAudioTrackStrategy(attempt.audio)
                    .setListener(new TranscoderListener() {
                        @Override
                        public void onTranscodeProgress(double progress) {
                            if (cancelRequested.get()) return;
                            int pct = (int) Math.max(0, Math.min(99, Math.round(progress * 100.0)));
                            int previous = lastNotifiedProgress.get();
                            if (pct == previous || (pct > 0 && pct - previous < 2 && pct < 99)) {
                                return;
                            }
                            lastNotifiedProgress.set(pct);
                            showProgressNotification(
                                    title,
                                    "Compressing… " + pct + "%",
                                    pct,
                                    true
                            );
                            emitProgress(pct, "compressing");
                        }

                        @Override
                        public void onTranscodeCompleted(int successCode) {
                            ok.set(true);
                            done.countDown();
                        }

                        @Override
                        public void onTranscodeCanceled() {
                            canceled.set(true);
                            done.countDown();
                        }

                        @Override
                        public void onTranscodeFailed(Throwable exception) {
                            errorRef.set(exception);
                            done.countDown();
                        }
                    })
                    .transcode();

            transcoderFuture = future;

            // Wait with cancel polling so UI cancel works mid-attempt.
            while (!done.await(250, TimeUnit.MILLISECONDS)) {
                if (cancelRequested.get()) {
                    future.cancel(true);
                    canceled.set(true);
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                    return new TranscodeOutcome(false, true, null);
                }
            }

            if (canceled.get() || cancelRequested.get()) {
                return new TranscodeOutcome(false, true, null);
            }
            if (!ok.get()) {
                return new TranscodeOutcome(false, false, errorRef.get());
            }
            return new TranscodeOutcome(true, false, null);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new TranscodeOutcome(false, true, e);
        } catch (Exception e) {
            return new TranscodeOutcome(false, false, e);
        } finally {
            transcoderFuture = null;
        }
    }

    private File materializeSource(Uri uri) {
        if (uri == null) return null;
        File dir = new File(getContext().getCacheDir(), "quitter-in");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File dest = new File(dir, "src-" + System.currentTimeMillis() + ".mp4");
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(dest)) {
            if (in == null) {
                //noinspection ResultOfMethodCallIgnored
                dest.delete();
                return null;
            }
            byte[] buf = new byte[1024 * 256];
            int n;
            while ((n = in.read(buf)) >= 0) {
                out.write(buf, 0, n);
            }
            out.flush();
            if (dest.length() < 1024L) {
                //noinspection ResultOfMethodCallIgnored
                dest.delete();
                return null;
            }
            return dest;
        } catch (Exception e) {
            Log.w(TAG, "Could not stage source locally", e);
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
            return null;
        }
    }

    /** Quick container sniff — rejects empty/corrupt muxer stubs. */
    private static boolean looksLikeMp4(File file) {
        if (file == null || !file.exists() || file.length() < 32) return false;
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            byte[] header = new byte[12];
            if (raf.read(header) < 12) return false;
            // bytes 4..7 should be 'ftyp' for ISO BMFF / MP4
            return header[4] == 'f'
                    && header[5] == 't'
                    && header[6] == 'y'
                    && header[7] == 'p';
        } catch (IOException e) {
            return false;
        }
    }

    /** MediaCodec on many SoCs requires width/height divisible by 16. */
    private static int align16(int value) {
        if (value <= 16) return 16;
        return (value / 16) * 16;
    }

    private void finishSuccess(File outFile) {
        long outSize = outFile.exists() ? outFile.length() : 0;
        Log.i(TAG, "Transcode finished: " + outFile.getAbsolutePath() + " (" + outSize + " bytes)");
        if (outSize < MIN_VALID_OUTPUT_BYTES || !looksLikeMp4(outFile)) {
            failCall("Compression produced an invalid file (" + outSize + " bytes)", outFile);
            return;
        }
        try {
            File readable = ensureWebReadableCopy(outFile);
            // Drop cache original once copied into filesDir (saves space).
            if (!readable.getAbsolutePath().equals(outFile.getAbsolutePath())) {
                //noinspection ResultOfMethodCallIgnored
                outFile.delete();
            }
            showProgressNotification(
                    "Video ready",
                    "Compressed to " + humanSize(readable.length()),
                    100,
                    false
            );
            emitProgress(100, "completed");
            resolveCall(readableResult(readable, false, true));
        } catch (Exception e) {
            Log.e(TAG, "Failed to publish readable URI", e);
            failCall(
                    e.getMessage() != null ? e.getMessage() : "Failed to finalize compressed video",
                    outFile
            );
        }
    }

    private void resolveReadableFile(
            PluginCall call,
            File sourceFile,
            boolean skipped,
            boolean compressed
    ) {
        try {
            File readable = ensureWebReadableCopy(sourceFile);
            call.resolve(readableResult(readable, skipped, compressed));
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Failed to read video");
        }
    }

    private JSObject readableResult(File file, boolean skipped, boolean compressed) {
        String authority = getContext().getPackageName() + ".fileprovider";
        Uri contentUri = FileProvider.getUriForFile(getContext(), authority, file);
        getContext().grantUriPermission(
                getContext().getPackageName(),
                contentUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
        );
        JSObject result = new JSObject();
        result.put("path", file.getAbsolutePath());
        result.put("uri", contentUri.toString());
        // double keeps full precision in JS for typical video sizes
        result.put("size", (double) file.length());
        result.put("skipped", skipped);
        result.put("compressed", compressed);
        return result;
    }

    private File ensureWebReadableCopy(File source) throws IOException {
        if (source == null || !source.exists()) {
            throw new IOException("Source file missing");
        }
        File dir = new File(getContext().getFilesDir(), "quitter-web");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        if (source.getAbsolutePath().startsWith(dir.getAbsolutePath()) && source.length() > 0) {
            return source;
        }
        File dest = new File(dir, "video-" + System.currentTimeMillis() + "-" + source.getName());
        try (FileInputStream in = new FileInputStream(source);
             FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[1024 * 256];
            int n;
            while ((n = in.read(buf)) >= 0) {
                out.write(buf, 0, n);
            }
            out.flush();
        }
        if (dest.length() != source.length()) {
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
            throw new IOException("Failed to copy video for WebView read");
        }
        return dest;
    }

    private void resolveCall(JSObject result) {
        mainHandler.post(() -> {
            PluginCall call = activeCall;
            activeCall = null;
            if (call != null) {
                call.resolve(result);
            }
            mainHandler.postDelayed(this::clearNotification, 4000);
        });
    }

    private void failCall(String message, File outFile) {
        if (outFile != null) {
            //noinspection ResultOfMethodCallIgnored
            outFile.delete();
        }
        boolean canceled = message != null && message.toLowerCase(Locale.US).contains("cancel");
        showProgressNotification(
                canceled ? "Compression canceled" : "Compression failed",
                message,
                -1,
                false
        );
        emitProgress(-1, canceled ? "canceled" : "failed");
        mainHandler.post(() -> {
            PluginCall call = activeCall;
            activeCall = null;
            if (call != null) {
                call.reject(message);
            }
            mainHandler.postDelayed(this::clearNotification, canceled ? 2500 : 5000);
        });
    }

    private void emitProgress(int progress, String state) {
        JSObject data = new JSObject();
        data.put("progress", progress);
        data.put("state", state);
        String outputPath = currentOutputPath;
        if (outputPath != null && progress >= 0 && progress < 100) {
            data.put("path", outputPath);
        }
        notifyListeners("progress", data);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Progress while preparing videos for Quitter");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private void showProgressNotification(
            String title,
            String text,
            int progress,
            boolean ongoing
    ) {
        ensureChannel();
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager == null) return;

        Intent openIntent = new Intent(getContext(), MainActivity.class);
        openIntent.setFlags(
                Intent.FLAG_ACTIVITY_SINGLE_TOP |
                        Intent.FLAG_ACTIVITY_CLEAR_TOP |
                        Intent.FLAG_ACTIVITY_NEW_TASK
        );
        PendingIntent pendingIntent = PendingIntent.getActivity(
                getContext(),
                NOTIFICATION_ID,
                openIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
                .setSmallIcon(getContext().getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pendingIntent)
                .setOngoing(ongoing)
                .setAutoCancel(!ongoing)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS);

        if (progress >= 0 && progress <= 100) {
            builder.setProgress(100, progress, false);
        } else if (progress < 0 && ongoing) {
            builder.setProgress(0, 0, true);
        }

        Notification notification = builder.build();
        manager.notify(NOTIFICATION_ID, notification);
    }

    private void clearNotification() {
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID);
        }
    }

    private static String humanSize(long bytes) {
        if (bytes < 1024L * 1024L) {
            return Math.max(1, bytes / 1024) + " KB";
        }
        return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0));
    }

    private static long estimateBitrate(
            long sourceSize,
            Long targetMaxBytes,
            int maxHeight,
            int frameRate,
            double durationSec,
            int audioBitRate
    ) {
        long target = targetMaxBytes != null && targetMaxBytes > 0
                ? targetMaxBytes
                : Math.max(16L * 1024L * 1024L, sourceSize / 2);
        // JS sizes targetMaxBytes from the clip length it passes as durationSec.
        // Guessing the length here instead (at 5 Mbps) halved the bitrate of
        // typical 10–16 Mbps phone clips, so High landed at the 1 Mbps floor.
        double assumedSeconds = 120.0;
        if (durationSec > 0.5) {
            assumedSeconds = Math.min(1800.0, durationSec);
        } else if (sourceSize > 0) {
            assumedSeconds = Math.max(15.0, Math.min(1800.0, (sourceSize * 8.0) / 5_000_000.0));
        }
        long bitrate = (long) ((target * 8.0) / assumedSeconds);
        if (durationSec > 0.5) {
            // JS sized the target as (video + audio) × seconds × 1.03 mux overhead.
            bitrate = (long) (bitrate / 1.03) - audioBitRate;
        }
        long min;
        long max;
        if (maxHeight <= 360) {
            min = 350_000L;
            max = 1_000_000L;
        } else if (maxHeight <= 480) {
            min = 600_000L;
            max = 1_600_000L;
        } else {
            min = 1_000_000L;
            max = 3_200_000L;
        }
        if (frameRate >= 30 && maxHeight >= 720) {
            max = Math.min(max + 400_000L, 3_600_000L);
        }
        return Math.max(min, Math.min(max, bitrate));
    }

    private Uri resolveUri(String path) {
        if (path.startsWith("content://") || path.startsWith("file://")) {
            return Uri.parse(path);
        }
        if (path.startsWith("/")) {
            return Uri.fromFile(new File(path));
        }
        return Uri.parse(path);
    }

    private File fileFromUri(Uri uri) {
        if (uri == null) return null;
        String scheme = uri.getScheme();
        if (scheme == null || "file".equalsIgnoreCase(scheme)) {
            String p = uri.getPath();
            return p != null ? new File(p) : null;
        }
        return null;
    }
}
