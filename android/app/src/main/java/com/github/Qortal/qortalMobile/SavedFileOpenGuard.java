package com.github.Qortal.qortalMobile;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import java.io.InputStream;

/**
 * Android side of {@link PackageArchivePolicy} for the two places that open a
 * file GO saved or received in another app: the saved-file notification
 * (QortalForegroundService) and the in-app Open button (ReticulumPlugin
 * qchatFileOpen). Neither may hand an app package to the installer.
 */
public final class SavedFileOpenGuard {
    private SavedFileOpenGuard() {}

    /**
     * True when the file is an app package by any account: the name GO was
     * given, the path, the type GO was given, or the name and type Android
     * has on record for a content:// URI.
     */
    public static boolean isPackageArchive(
        Context context,
        Uri uri,
        String rawValue,
        String fileName,
        String mimeType
    ) {
        String recordedName = null;
        String recordedType = null;
        if (uri != null && ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            ContentResolver resolver = context.getContentResolver();
            try {
                recordedType = resolver.getType(uri);
            } catch (Exception ignored) {
                // A provider that cannot say is judged on the rest.
            }
            recordedName = displayName(resolver, uri);
        }
        String path = uri != null ? uri.getPath() : null;
        return PackageArchivePolicy.isPackageArchive(
            new String[] {fileName, rawValue, path, recordedName},
            new String[] {mimeType, recordedType}
        );
    }

    /**
     * The type to open the file with. A wildcard type is never handed out,
     * since the installer matches it: a ZIP behind one (an APK under a
     * harmless name) opens as application/zip, anything else as
     * application/octet-stream ({@link PackageArchivePolicy#viewType}).
     */
    public static String viewType(Context context, Uri uri, String type) {
        if (!PackageArchivePolicy.isWildcardMime(type)) return type;
        return PackageArchivePolicy.viewType(type, readHead(context, uri));
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(
            uri,
            new String[] {OpenableColumns.DISPLAY_NAME},
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) return cursor.getString(column);
            }
        } catch (Exception ignored) {
            // No name on record; the other signals still apply.
        }
        return null;
    }

    private static byte[] readHead(Context context, Uri uri) {
        if (uri == null) return null;
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            byte[] head = new byte[4];
            int filled = 0;
            while (filled < head.length) {
                int read = in.read(head, filled, head.length - filled);
                if (read < 0) break;
                filled += read;
            }
            return filled == head.length ? head : null;
        } catch (Exception e) {
            return null;
        }
    }
}
