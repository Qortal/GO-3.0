package com.github.Qortal.qortalMobile;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FileWriter")
public class FileWriter extends Plugin {

    private static final Object fileLock = new Object();
    private static final int STREAM_BUFFER_BYTES = 64 * 1024;
    private final ExecutorService downloadWorker = Executors.newSingleThreadExecutor();
    private String appendTargetKey;
    private Uri appendTargetUri;

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

        downloadWorker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(30_000);
                // QDN can stall mid-stream while the node serves a large file;
                // a short read timeout would abort an otherwise healthy save.
                connection.setReadTimeout(120_000);
                connection.connect();

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    call.reject("Download failed with status " + status);
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
        values.put(
            MediaStore.MediaColumns.MIME_TYPE,
            mimeHint != null && !mimeHint.trim().isEmpty()
                ? mimeHint.trim()
                : guessMimeType(displayName)
        );
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

    private void resolveWrite(PluginCall call, String path) {
        JSObject ret = new JSObject();
        ret.put("path", path);
        ret.put("uri", path.startsWith("content://") ? path : "file://" + path);
        call.resolve(ret);
    }
}
