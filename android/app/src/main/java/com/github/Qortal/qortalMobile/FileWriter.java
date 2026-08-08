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

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "FileWriter")
public class FileWriter extends Plugin {

    private static final Object fileLock = new Object();

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String filename = call.getString("filename");
        String dataBase64 = call.getString("dataBase64");
        Boolean append = call.getBoolean("append", false);
        // When set, the file is filed under a per-type folder
        // (Images / Videos / Audio / Documents / Apps / GO state).
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

    /**
     * Delete stale files of one extension from a folder, keeping `keepName`.
     * Used when a new GO state (.bin) replaces the previous one.
     */
    @PluginMethod
    public void pruneFolder(PluginCall call) {
        String subFolder = call.getString("subFolder");
        String extension = call.getString("extension");
        String keepName = call.getString("keepName");

        if (subFolder == null || subFolder.isEmpty()) {
            call.reject("subFolder is required");
            return;
        }
        if (extension == null || extension.isEmpty()) {
            call.reject("extension is required");
            return;
        }
        String suffix = extension.startsWith(".")
            ? extension.toLowerCase()
            : "." + extension.toLowerCase();

        try {
            int deleted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? pruneWithMediaStore(subFolder, suffix, keepName)
                : pruneLegacy(subFolder, suffix, keepName);
            JSObject ret = new JSObject();
            ret.put("deleted", deleted);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to prune folder: " + e.getMessage());
        }
    }

    private int pruneWithMediaStore(String subFolder, String suffix, String keepName) {
        ContentResolver resolver = getContext().getContentResolver();
        String relativePath = Environment.DIRECTORY_DOCUMENTS + "/" + subFolder;
        if (!relativePath.endsWith("/")) {
            relativePath = relativePath + "/";
        }
        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        String selection = MediaStore.MediaColumns.RELATIVE_PATH + "=?";
        String[] args = { relativePath };
        int deleted = 0;

        try (Cursor cursor = resolver.query(
            collection,
            new String[] { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME },
            selection,
            args,
            null
        )) {
            if (cursor == null) return 0;
            while (cursor.moveToNext()) {
                String name = cursor.getString(1);
                if (name == null) continue;
                if (!name.toLowerCase().endsWith(suffix)) continue;
                if (keepName != null && keepName.equals(name)) continue;
                Uri uri = ContentUris.withAppendedId(collection, cursor.getLong(0));
                try {
                    deleted += resolver.delete(uri, null, null);
                } catch (Exception ignored) {
                    // Another app may own the row — skip it.
                }
            }
        }
        return deleted;
    }

    private int pruneLegacy(String subFolder, String suffix, String keepName) {
        File dir = new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
            subFolder
        );
        File[] entries = dir.listFiles();
        if (entries == null) return 0;
        int deleted = 0;
        for (File entry : entries) {
            if (!entry.isFile()) continue;
            String name = entry.getName();
            if (!name.toLowerCase().endsWith(suffix)) continue;
            if (keepName != null && keepName.equals(name)) continue;
            if (entry.delete()) deleted++;
        }
        return deleted;
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
        Uri targetUri = findExistingFile(resolver, collection, displayName, relativePath);

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
