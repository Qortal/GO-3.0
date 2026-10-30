package com.github.Qortal.qortalMobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Writes files into the public Documents/&lt;folder&gt; directory.
 *
 * Android WebView silently drops in-page downloads (anchor `download`, blob/data
 * URLs, `Content-Disposition: attachment`) because no DownloadListener is set and
 * the WebView has no save UI. {@link QortalDownloadListener} routes those here so
 * Q-Apps and published websites can save files the same way they do on desktop.
 *
 * Every save goes through {@link SavedFilePolicy#forSave}: web pages, SVG and
 * XML (including any extension Android maps to an XML type, such as ".rss")
 * become ".txt" plain text, so no saved file is named or typed as a page.
 */
public final class DocumentSaver {

    private static final Object FILE_LOCK = new Object();

    /** Android's MIME type for an extension, for {@link SavedFilePolicy#forSave}. */
    public static final SavedFilePolicy.ExtensionTypes EXTENSION_TYPES =
        ext -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);

    private DocumentSaver() {}

    /** Stream an InputStream into Documents/<subFolder>/<displayName>. Returns the saved uri/path. */
    public static String saveStream(
        Context context,
        String subFolder,
        String displayName,
        String mimeType,
        InputStream in
    ) throws IOException {
        SavedFilePolicy.Target target = SavedFilePolicy.forSave(displayName, mimeType, EXTENSION_TYPES);
        displayName = target.name;
        mimeType = target.mime;
        byte[] buffer = new byte[64 * 1024];
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Uri uri = createMediaStoreUri(context, subFolder, displayName, mimeType);
            ContentResolver resolver = context.getContentResolver();
            synchronized (FILE_LOCK) {
                try (OutputStream os = resolver.openOutputStream(uri, "wt")) {
                    if (os == null) {
                        throw new IOException("Failed to open output stream");
                    }
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        os.write(buffer, 0, read);
                    }
                    os.flush();
                }
            }
            return uri.toString();
        }
        File file = legacyTargetFile(subFolder, displayName);
        synchronized (FILE_LOCK) {
            try (FileOutputStream fos = new FileOutputStream(file, false)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    fos.write(buffer, 0, read);
                }
                fos.flush();
            }
        }
        return file.getAbsolutePath();
    }

    private static Uri createMediaStoreUri(
        Context context,
        String subFolder,
        String displayName,
        String mimeType
    ) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        String relativePath = Environment.DIRECTORY_DOCUMENTS;
        if (subFolder != null && !subFolder.isEmpty()) {
            relativePath = relativePath + "/" + subFolder;
        }
        if (!relativePath.endsWith("/")) {
            relativePath = relativePath + "/";
        }

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, resolveMimeType(mimeType, displayName));
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);

        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        // MediaStore auto-dedupes the display name (e.g. "file (1).pdf") when one exists.
        Uri uri = resolver.insert(collection, values);
        if (uri == null) {
            throw new IOException("Failed to create file in Documents");
        }
        return uri;
    }

    private static File legacyTargetFile(String subFolder, String displayName) throws IOException {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
        if (subFolder != null && !subFolder.isEmpty()) {
            dir = new File(dir, subFolder);
        }
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Failed to create Documents directory");
        }
        File file = new File(dir, displayName);
        // Avoid clobbering an existing download: append a counter.
        if (file.exists()) {
            int dot = displayName.lastIndexOf('.');
            String stem = dot > 0 ? displayName.substring(0, dot) : displayName;
            String ext = dot > 0 ? displayName.substring(dot) : "";
            int n = 1;
            do {
                file = new File(dir, stem + " (" + n + ")" + ext);
                n++;
            } while (file.exists() && n < 1000);
        }
        return file;
    }

    private static String resolveMimeType(String mimeType, String displayName) {
        if (mimeType != null && !mimeType.trim().isEmpty()
                && !"application/force-download".equalsIgnoreCase(mimeType.trim())) {
            return mimeType.trim();
        }
        String ext = MimeTypeMap.getFileExtensionFromUrl(displayName);
        if (ext != null && !ext.isEmpty()) {
            String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
            if (guessed != null) {
                return guessed;
            }
        }
        return "application/octet-stream";
    }
}
