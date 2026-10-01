package com.github.Qortal.qortalMobile;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "FileWriter",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class FileWriter extends Plugin {

    private static final String TAG = "FileWriter";
    private static final Object fileLock = new Object();
    private static final int STREAM_BUFFER_BYTES = 64 * 1024;
    /** JS object the binary save channel appears as in GO's own page. */
    private static final String FILE_SINK_OBJECT = "goFileSink";
    private final ExecutorService downloadWorker = Executors.newSingleThreadExecutor();
    /** Owns {@link #sinkSession}; everything the sink does happens here, in order. */
    private final ExecutorService sinkWorker = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SinkSession sinkSession;
    private ScriptHandler frameScriptHandler;
    private WebView frameScriptWebView;
    private String frameScript;
    private String appendTargetKey;
    private Uri appendTargetUri;

    @Override
    public void load() {
        installFileSink();
    }

    /**
     * Opens a binary channel from GO's page to storage.
     *
     * {@link #writeChunk} takes base64 inside a JSON plugin call: every byte is
     * encoded in JS, parsed back out of JSON, decoded here, and the output
     * stream is reopened for every chunk. For a file of 100 MB+ that is most of
     * the save. ArrayBuffers posted to {@code goFileSink} arrive here as bytes
     * and go straight into one open stream.
     *
     * Only the frames that may call plugins at all get the object, so a Q-App
     * cannot write through it.
     */
    private void installFileSink() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) {
            return;
        }
        try {
            WebViewCompat.addWebMessageListener(
                getBridge().getWebView(),
                FILE_SINK_OBJECT,
                getBridge().getAllowedOriginRules(),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> onSinkMessage(message, replyProxy)
            );
        } catch (Exception e) {
            Log.w(TAG, "binary save channel unavailable, saves use writeChunk", e);
        }
    }

    /**
     * Runs a script at document start in every frame that loads from now on.
     * GO uses it to see big QDN downloads a Q-App makes on its own (Q-Share
     * pulls a whole file before it asks GO to save it), so the wait can be shown.
     */
    @PluginMethod
    public void installFrameScript(PluginCall call) {
        String script = call.getString("script");
        if (script == null || script.isEmpty()) {
            call.reject("script is required");
            return;
        }
        mainHandler.post(() -> {
            JSObject ret = new JSObject();
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                ret.put("installed", false);
                call.resolve(ret);
                return;
            }
            try {
                WebView webView = getBridge().getWebView();
                boolean current = frameScriptHandler != null
                    && frameScriptWebView == webView
                    && script.equals(frameScript);
                if (!current) {
                    if (frameScriptHandler != null) {
                        frameScriptHandler.remove();
                    }
                    frameScriptHandler = WebViewCompat.addDocumentStartJavaScript(
                        webView,
                        script,
                        Collections.singleton("*")
                    );
                    frameScriptWebView = webView;
                    frameScript = script;
                }
                ret.put("installed", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not install frame script: " + e.getMessage());
            }
        });
    }

    /**
     * Android 8/9 write to shared storage as plain files, which needs the
     * storage permission granted at runtime; without it every save failed.
     * Android 10+ saves through MediaStore and needs nothing.
     */
    @PluginMethod
    public void ensureStoragePermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            || getPermissionState("storage") == PermissionState.GRANTED) {
            resolveStoragePermission(call, true);
            return;
        }
        requestPermissionForAlias("storage", call, "storagePermissionCallback");
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        resolveStoragePermission(call, getPermissionState("storage") == PermissionState.GRANTED);
    }

    private void resolveStoragePermission(PluginCall call, boolean granted) {
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /**
     * Streams a URL straight into Documents/&lt;category&gt;/&lt;name&gt;.
     *
     * The chunked {@link #writeChunk} path costs a base64 round trip plus a
     * MediaStore lookup and a fresh output stream for every chunk, which for a
     * large attachment means hundreds of bridge crossings and re-encodes. Since
     * the QDN endpoint is just an HTTP URL, fetching it here keeps the bytes
     * binary and touches MediaStore once.
     */
    @PluginMethod
    public void downloadToDocuments(PluginCall call) {
        String url = call.getString("url");
        String filename = call.getString("filename");
        Boolean categorize = call.getBoolean("categorize", false);
        String mimeHint = call.getString("mimeType");
        String downloadId = call.getString("downloadId");

        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (filename == null || filename.isEmpty()) {
            call.reject("Filename is required");
            return;
        }

        String apiKey = call.getString("apiKey");

        downloadWorker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(30_000);
                // QDN can stall mid-stream while the node serves a large file;
                // a short read timeout would abort an otherwise healthy save.
                connection.setReadTimeout(120_000);
                if (apiKey != null && !apiKey.isEmpty()) {
                    connection.setRequestProperty("X-API-KEY", apiKey);
                }
                connection.connect();

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    call.reject("HTTP " + status + " from node");
                    return;
                }

                String displayName = filename;
                String subFolder = "";
                int slash = filename.lastIndexOf('/');
                if (slash >= 0) {
                    subFolder = filename.substring(0, slash);
                    displayName = filename.substring(slash + 1);
                }
                if (Boolean.TRUE.equals(categorize)) {
                    subFolder = SaveCategory.folderFor(subFolder, displayName, mimeHint);
                }

                long totalBytes = connection.getContentLengthLong();
                ProgressReporter progress = new ProgressReporter(downloadId, totalBytes);

                long[] written = new long[1];
                String target;
                try (InputStream in = new BufferedInputStream(
                    connection.getInputStream(),
                    STREAM_BUFFER_BYTES
                )) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        target = streamToMediaStore(
                            displayName, subFolder, mimeHint, in, written, progress
                        );
                    } else {
                        target = streamToLegacyFile(
                            subFolder.isEmpty() ? displayName : subFolder + "/" + displayName,
                            in,
                            written,
                            progress
                        );
                    }
                }
                progress.finish(written[0]);

                JSObject ret = new JSObject();
                ret.put("path", target);
                ret.put("uri", target.startsWith("content://") ? target : "file://" + target);
                ret.put("bytesWritten", written[0]);
                call.resolve(ret);
            } catch (IOException e) {
                call.reject("Failed to save file: " + e.getMessage());
            } catch (Exception e) {
                call.reject("Unexpected error: " + e.getMessage());
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        });
    }

    /**
     * GET a URL and drop the body. Used to kick {@code /arbitrary/...?async=true}
     * on a remote core when the WebView fetch is blocked by CORS.
     */
    @PluginMethod
    public void probeUrl(PluginCall call) {
        String url = call.getString("url");
        String apiKey = call.getString("apiKey");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        downloadWorker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                if (apiKey != null && !apiKey.isEmpty()) {
                    connection.setRequestProperty("X-API-KEY", apiKey);
                }
                connection.connect();
                int status = connection.getResponseCode();
                InputStream stream =
                    status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (stream != null) {
                    try (InputStream in = stream) {
                        byte[] buf = new byte[4096];
                        // One read is enough for async=true; the node has started.
                        //noinspection ResultOfMethodCallIgnored
                        in.read(buf);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("ok", status >= 200 && status < 300);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("HTTP probe failed: " + e.getMessage());
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        });
    }

    /**
     * Tells the web layer how far a download has got, so it can drive the
     * progress bar in the notification tray.
     *
     * A large file is thousands of buffer writes; sending one event each would
     * cost more than the copy itself, so updates are rate limited and the last
     * one is always sent.
     */
    private final class ProgressReporter {

        private static final long MIN_INTERVAL_MS = 250;

        private final String downloadId;
        private final long totalBytes;
        private long lastEmitAt;

        ProgressReporter(String downloadId, long totalBytes) {
            this.downloadId = downloadId;
            this.totalBytes = totalBytes;
        }

        void report(long bytesWritten) {
            if (downloadId == null || downloadId.isEmpty()) return;
            long now = System.currentTimeMillis();
            if (now - lastEmitAt < MIN_INTERVAL_MS) return;
            lastEmitAt = now;
            emit(bytesWritten, false);
        }

        void finish(long bytesWritten) {
            if (downloadId == null || downloadId.isEmpty()) return;
            emit(bytesWritten, true);
        }

        private void emit(long bytesWritten, boolean done) {
            JSObject event = new JSObject();
            event.put("downloadId", downloadId);
            event.put("bytesWritten", bytesWritten);
            event.put("totalBytes", totalBytes > 0 ? totalBytes : 0);
            event.put("done", done);
            notifyListeners("downloadProgress", event);
        }
    }

    private String streamToMediaStore(
        String displayName,
        String subFolder,
        String mimeHint,
        InputStream in,
        long[] written,
        ProgressReporter progress
    ) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        Uri targetUri = resolveTargetUri(resolver, displayName, subFolder, mimeHint);
        byte[] buffer = new byte[STREAM_BUFFER_BYTES];
        synchronized (fileLock) {
            try (OutputStream os = resolver.openOutputStream(targetUri, "wt")) {
                if (os == null) {
                    throw new IOException("Failed to open output stream");
                }
                int read;
                while ((read = in.read(buffer)) != -1) {
                    os.write(buffer, 0, read);
                    written[0] += read;
                    progress.report(written[0]);
                }
                os.flush();
            }
        }
        return targetUri.toString();
    }

    private String streamToLegacyFile(
        String filename,
        InputStream in,
        long[] written,
        ProgressReporter progress
    ) throws IOException {
        File documentsDir = Environment.getExternalStoragePublicDirectory(
            Environment.DIRECTORY_DOCUMENTS
        );
        File file = new File(documentsDir, filename);
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Failed to create parent directory");
        }
        byte[] buffer = new byte[STREAM_BUFFER_BYTES];
        synchronized (fileLock) {
            try (FileOutputStream fos = new FileOutputStream(file, false)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    fos.write(buffer, 0, read);
                    written[0] += read;
                    progress.report(written[0]);
                }
                fos.flush();
            }
        }
        return file.getAbsolutePath();
    }

    private Uri resolveTargetUri(
        ContentResolver resolver,
        String displayName,
        String subFolder,
        String mimeHint
    ) throws IOException {
        String relativePath = Environment.DIRECTORY_DOCUMENTS;
        if (subFolder != null && !subFolder.isEmpty()) {
            relativePath = relativePath + "/" + subFolder;
        }
        if (!relativePath.endsWith("/")) {
            relativePath = relativePath + "/";
        }

        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri targetUri = findExistingFile(resolver, collection, displayName, relativePath);
        if (targetUri != null) {
            return targetUri;
        }

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mediaStoreMimeType(displayName, mimeHint));
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
        targetUri = resolver.insert(collection, values);
        if (targetUri == null) {
            throw new IOException("Failed to create file in Documents");
        }
        return targetUri;
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String filename = call.getString("filename");
        String dataBase64 = call.getString("dataBase64");
        Boolean append = call.getBoolean("append", false);
        // When set, the file is filed under a per-type folder
        // (Images / Videos / Audio / Documents / Apps / Qortino AI).
        Boolean categorize = call.getBoolean("categorize", false);
        String mimeHint = call.getString("mimeType");

        if (filename == null || filename.isEmpty()) {
            call.reject("Filename is required");
            return;
        }

        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("dataBase64 is required");
            return;
        }

        try {
            byte[] bytes = Base64.decode(dataBase64, Base64.NO_WRAP);
            String displayName = filename;
            String subFolder = "";

            int slash = filename.lastIndexOf('/');
            if (slash >= 0) {
                subFolder = filename.substring(0, slash);
                displayName = filename.substring(slash + 1);
            }

            if (Boolean.TRUE.equals(categorize)) {
                subFolder = SaveCategory.folderFor(subFolder, displayName, mimeHint);
                filename = subFolder + "/" + displayName;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeWithMediaStore(call, displayName, subFolder, bytes, append);
            } else {
                writeLegacy(call, filename, bytes, append);
            }
        } catch (IllegalArgumentException e) {
            call.reject("Invalid Base64 data: " + e.getMessage());
        } catch (IOException e) {
            call.reject("Failed to write file: " + e.getMessage());
        } catch (Exception e) {
            call.reject("Unexpected error: " + e.getMessage());
        }
    }

    private void writeLegacy(PluginCall call, String filename, byte[] bytes, boolean append)
        throws IOException {
        File documentsDir = Environment.getExternalStoragePublicDirectory(
            Environment.DIRECTORY_DOCUMENTS
        );

        if (!documentsDir.exists() && !documentsDir.mkdirs()) {
            call.reject("Failed to create Documents directory");
            return;
        }

        File file = new File(documentsDir, filename);
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            call.reject("Failed to create parent directory");
            return;
        }

        synchronized (fileLock) {
            try (FileOutputStream fos = new FileOutputStream(file, append)) {
                fos.write(bytes);
                fos.flush();
            }
        }

        resolveWrite(call, file.getAbsolutePath());
    }

    private void writeWithMediaStore(
        PluginCall call,
        String displayName,
        String subFolder,
        byte[] bytes,
        boolean append
    ) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        String relativePath = Environment.DIRECTORY_DOCUMENTS;
        if (subFolder != null && !subFolder.isEmpty()) {
            relativePath = relativePath + "/" + subFolder;
        }
        if (!relativePath.endsWith("/")) {
            relativePath = relativePath + "/";
        }

        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        // A streamed save appends hundreds of times to the same file; without
        // this the MediaStore lookup below runs once per chunk.
        String targetKey = relativePath + displayName;
        Uri targetUri = append && targetKey.equals(appendTargetKey) ? appendTargetUri : null;

        if (targetUri == null) {
            targetUri = findExistingFile(resolver, collection, displayName, relativePath);
        }

        if (targetUri == null) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, guessMimeType(displayName));
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
            targetUri = resolver.insert(collection, values);
        }

        if (targetUri == null) {
            call.reject("Failed to create file in Documents");
            return;
        }

        appendTargetKey = targetKey;
        appendTargetUri = targetUri;

        synchronized (fileLock) {
            try (OutputStream os = resolver.openOutputStream(targetUri, append ? "wa" : "wt")) {
                if (os == null) {
                    call.reject("Failed to open output stream");
                    return;
                }
                os.write(bytes);
                os.flush();
            }
        }

        resolveWrite(call, targetUri.toString());
    }

    private Uri findExistingFile(
        ContentResolver resolver,
        Uri collection,
        String displayName,
        String relativePath
    ) {
        String selection =
            MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " +
            MediaStore.MediaColumns.RELATIVE_PATH + "=?";
        String[] args = { displayName, relativePath };

        try (Cursor cursor = resolver.query(
            collection,
            new String[] { MediaStore.MediaColumns._ID },
            selection,
            args,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                long id = cursor.getLong(0);
                return ContentUris.withAppendedId(collection, id);
            }
        }

        return null;
    }

    private String guessMimeType(String displayName) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(displayName);
        if (extension != null) {
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            if (mime != null) {
                return mime;
            }
        }
        return "application/octet-stream";
    }

    /** One save in progress over the binary channel. Touched only on sinkWorker. */
    private static final class SinkSession {
        final String sid;
        final OutputStream out;
        final String path;
        /** Entry this save created, removed again if the save does not finish. */
        final Uri createdUri;
        final File createdFile;
        long written;

        SinkSession(String sid, OutputStream out, String path, Uri createdUri, File createdFile) {
            this.sid = sid;
            this.out = out;
            this.path = path;
            this.createdUri = createdUri;
            this.createdFile = createdFile;
        }
    }

    /**
     * Protocol, all replies JSON strings carrying {@code sid}:
     * {@code {op:"open",sid,filename,categorize?}} → {@code opened};
     * then ArrayBuffers → one {@code ack} each; {@code {op:"close",sid}} →
     * {@code closed} with path/uri/bytesWritten; {@code {op:"abort",sid}} →
     * {@code aborted}. Any failure → {@code error} and the partial file is gone.
     */
    private void onSinkMessage(WebMessageCompat message, JavaScriptReplyProxy replyProxy) {
        if (message.getType() == WebMessageCompat.TYPE_ARRAY_BUFFER) {
            byte[] bytes = message.getArrayBuffer();
            sinkWorker.execute(() -> writeSinkChunk(bytes, replyProxy));
            return;
        }
        String data = message.getData();
        sinkWorker.execute(() -> handleSinkCommand(data, replyProxy));
    }

    private void handleSinkCommand(String data, JavaScriptReplyProxy replyProxy) {
        String sid = "";
        try {
            JSONObject command = new JSONObject(data == null ? "{}" : data);
            sid = command.optString("sid", "");
            String op = command.optString("op", "");
            switch (op) {
                case "open":
                    openSinkSession(sid, command, replyProxy);
                    break;
                case "close":
                    closeSinkSession(sid, replyProxy);
                    break;
                case "abort":
                    if (sinkSession != null && sinkSession.sid.equals(sid)) {
                        discardSinkSession();
                    }
                    replySink(replyProxy, sinkReply("aborted", sid));
                    break;
                default:
                    replySinkError(replyProxy, sid, "Unknown save command");
            }
        } catch (Exception e) {
            discardSinkSession();
            replySinkError(replyProxy, sid, e.getMessage());
        }
    }

    private void openSinkSession(String sid, JSONObject command, JavaScriptReplyProxy replyProxy)
        throws IOException {
        // A save left open by a page that reloaded mid-way is dead; it must not
        // swallow the next file's bytes.
        discardSinkSession();

        String filename = command.optString("filename", "");
        if (sid.isEmpty() || filename.isEmpty()) {
            replySinkError(replyProxy, sid, "sid and filename are required");
            return;
        }
        String displayName = filename;
        String subFolder = "";
        int slash = filename.lastIndexOf('/');
        if (slash >= 0) {
            subFolder = filename.substring(0, slash);
            displayName = filename.substring(slash + 1);
        }
        displayName = DocumentSaver.safeName(displayName);
        if (command.optBoolean("categorize", false)) {
            subFolder = SaveCategory.folderFor(subFolder, displayName, command.optString("mimeType", null));
        }
        if (subFolder.contains("..")) {
            replySinkError(replyProxy, sid, "Invalid folder");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContext().getContentResolver();
            String relativePath = Environment.DIRECTORY_DOCUMENTS
                + (subFolder.isEmpty() ? "" : "/" + subFolder) + "/";
            Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            // Same file name as before overwrites it, as writeChunk does.
            Uri target = findExistingFile(resolver, collection, displayName, relativePath);
            Uri created = null;
            if (target == null) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
                values.put(
                    MediaStore.MediaColumns.MIME_TYPE,
                    mediaStoreMimeType(displayName, command.optString("mimeType", null))
                );
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
                // Hidden from other apps until the last byte is in.
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                target = resolver.insert(collection, values);
                if (target == null) {
                    throw new IOException("Failed to create file in Documents");
                }
                created = target;
            }
            OutputStream out = resolver.openOutputStream(target, "wt");
            if (out == null) {
                if (created != null) resolver.delete(created, null, null);
                throw new IOException("Failed to open output stream");
            }
            sinkSession = new SinkSession(sid, out, target.toString(), created, null);
        } else {
            File documentsDir = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOCUMENTS
            );
            File dir = subFolder.isEmpty() ? documentsDir : new File(documentsDir, subFolder);
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IOException("Failed to create " + dir.getName() + " directory");
            }
            File file = new File(dir, displayName);
            boolean existed = file.exists();
            OutputStream out = new FileOutputStream(file, false);
            sinkSession = new SinkSession(sid, out, file.getAbsolutePath(), null, existed ? null : file);
        }
        replySink(replyProxy, sinkReply("opened", sid));
    }

    private void writeSinkChunk(byte[] bytes, JavaScriptReplyProxy replyProxy) {
        SinkSession session = sinkSession;
        if (session == null) {
            replySinkError(replyProxy, "", "No save is open");
            return;
        }
        try {
            session.out.write(bytes);
            session.written += bytes.length;
            JSONObject ack = sinkReply("ack", session.sid);
            ack.put("written", session.written);
            replySink(replyProxy, ack);
        } catch (Exception e) {
            discardSinkSession();
            replySinkError(replyProxy, session.sid, e.getMessage());
        }
    }

    private void closeSinkSession(String sid, JavaScriptReplyProxy replyProxy) throws Exception {
        SinkSession session = sinkSession;
        if (session == null || !session.sid.equals(sid)) {
            replySinkError(replyProxy, sid, "No such save is open");
            return;
        }
        try {
            session.out.flush();
            session.out.close();
            if (session.createdUri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContext().getContentResolver().update(session.createdUri, done, null, null);
            }
        } catch (Exception e) {
            discardSinkSession();
            throw e;
        }
        sinkSession = null;
        JSONObject closed = sinkReply("closed", sid);
        closed.put("path", session.path);
        closed.put("uri", session.path.startsWith("content://") ? session.path : "file://" + session.path);
        closed.put("bytesWritten", session.written);
        replySink(replyProxy, closed);
    }

    /** Close and delete whatever the current save created. */
    private void discardSinkSession() {
        SinkSession session = sinkSession;
        sinkSession = null;
        if (session == null) return;
        try {
            session.out.close();
        } catch (IOException ignored) {
            /* already broken */
        }
        try {
            if (session.createdUri != null) {
                getContext().getContentResolver().delete(session.createdUri, null, null);
            } else if (session.createdFile != null) {
                //noinspection ResultOfMethodCallIgnored
                session.createdFile.delete();
            }
        } catch (Exception e) {
            Log.w(TAG, "could not remove unfinished save", e);
        }
    }

    private static JSONObject sinkReply(String op, String sid) {
        JSONObject reply = new JSONObject();
        try {
            reply.put("op", op);
            reply.put("sid", sid);
        } catch (Exception ignored) {
            /* put on a fresh object with string values does not throw */
        }
        return reply;
    }

    private void replySinkError(JavaScriptReplyProxy replyProxy, String sid, String message) {
        JSONObject error = sinkReply("error", sid);
        try {
            error.put("message", message == null ? "Save failed" : message);
        } catch (Exception ignored) {
            /* see sinkReply */
        }
        replySink(replyProxy, error);
    }

    /** JavaScriptReplyProxy must be used on the UI thread. */
    private void replySink(JavaScriptReplyProxy replyProxy, JSONObject reply) {
        String text = reply.toString();
        mainHandler.post(() -> {
            try {
                replyProxy.postMessage(text);
            } catch (Exception e) {
                Log.w(TAG, "save channel reply dropped", e);
            }
        });
    }

    /**
     * MIME type to create a MediaStore entry with. MediaStore renames the file
     * when type and extension disagree: an .apk announced as application/zip
     * (how QDN labels them) is saved as "….apk.zip". So the name decides
     * whenever its extension is known; an unknown extension stays
     * octet-stream, which keeps the name as given; the hint only counts for a
     * name without any extension. Unlike
     * {@link MimeTypeMap#getFileExtensionFromUrl}, this copes with spaces in
     * the name ("GO 3.0 v0.0.11.apk").
     */
    private static String mediaStoreMimeType(String displayName, String mimeHint) {
        String ext = SaveCategory.extensionOf(displayName);
        if (!ext.isEmpty()) {
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            return mime != null ? mime : "application/octet-stream";
        }
        if (mimeHint != null && !mimeHint.trim().isEmpty()
            && !"application/force-download".equalsIgnoreCase(mimeHint.trim())) {
            return mimeHint.trim();
        }
        return "application/octet-stream";
    }

    private void resolveWrite(PluginCall call, String path) {
        JSObject ret = new JSObject();
        ret.put("path", path);
        ret.put("uri", path.startsWith("content://") ? path : "file://" + path);
        call.resolve(ret);
    }
}
