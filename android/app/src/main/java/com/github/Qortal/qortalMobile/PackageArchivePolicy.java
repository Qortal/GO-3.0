package com.github.Qortal.qortalMobile;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Pure rules for files GO saved or received (Q-App SAVE_FILE, chat
 * attachments): no Android types, so the JVM unit tests can check them.
 *
 * GO may hold the "Install unknown apps" grant because of its updater. If GO
 * itself sent an APK from a Q-App or a chat peer to the package installer,
 * Android would skip the "allow this source" step and go straight to the final
 * install prompt for an app nobody checked. So the open paths never hand out
 * app packages; only {@link AppUpdatePlugin}, after its signer, package and
 * version checks, starts an install.
 */
public final class PackageArchivePolicy {
    private PackageArchivePolicy() {}

    public static final String APK_MIME = "application/vnd.android.package-archive";
    /** Error code the JS side can recognise when an open is refused. */
    public static final String REFUSED_CODE = "PACKAGE_ARCHIVE_REFUSED";

    /** App packages and the bundle formats side-loading tools install. */
    private static final String[] PACKAGE_EXTENSIONS = {"apk", "apks", "xapk", "apkm", "aab"};

    /**
     * Letters drawn like the Latin ones in the extensions above (Cyrillic and
     * Greek), so "GO.\u0430pk" with a Cyrillic "a" is still caught. Same list as
     * src/utils/androidPackageFiles.ts.
     */
    private static final String LOOK_ALIKES = "\u0430\u0251\u03b1\u0440\u03c1\u043a\u03ba\u0445\u03c7\u0455";
    private static final String LATIN = "aaappkkxxs";

    /**
     * True when the name ends in an app-package extension, read the way a
     * person reads it: invisible format characters (zero-width space, bidi
     * marks) removed, look-alike letters folded, and trailing dots, spaces and
     * underscores ignored ("GO.apk_" is what GO's own name cleaning makes of
     * "GO.apk?").
     */
    public static boolean isPackageArchiveName(String name) {
        if (name == null) return false;
        String value = readable(name);
        while (!value.isEmpty()) {
            char last = value.charAt(value.length() - 1);
            if (last != '.' && last != '_' && !Character.isWhitespace(last)) break;
            value = value.substring(0, value.length() - 1);
        }
        int slash = value.lastIndexOf('/');
        if (slash >= 0) value = value.substring(slash + 1);
        int dot = value.lastIndexOf('.');
        if (dot < 0) return false;
        String ext = value.substring(dot + 1);
        for (String candidate : PACKAGE_EXTENSIONS) {
            if (candidate.equals(ext)) return true;
        }
        return false;
    }

    /** True for the package-archive MIME type, with or without parameters. */
    public static boolean isPackageArchiveMime(String mime) {
        String base = baseMime(mime);
        return base.equals(APK_MIME);
    }

    /** True when any of the names or MIME types marks an app package. */
    public static boolean isPackageArchive(String[] names, String[] mimes) {
        if (names != null) {
            for (String name : names) {
                if (isPackageArchiveName(name)) return true;
            }
        }
        if (mimes != null) {
            for (String mime : mimes) {
                if (isPackageArchiveMime(mime)) return true;
            }
        }
        return false;
    }

    /**
     * A type with a wildcard (any type, any application type), or none. The
     * package installer matches those too, whatever the file holds.
     */
    public static boolean isWildcardMime(String mime) {
        String base = baseMime(mime);
        return base.isEmpty() || base.contains("*");
    }

    /** ZIP local-file header ("PK\3\4"): APKs are ZIP files. */
    public static boolean looksLikeZip(byte[] head) {
        return head != null
            && head.length >= 4
            && head[0] == 'P'
            && head[1] == 'K'
            && head[2] == 3
            && head[3] == 4;
    }

    /** What a file of unknown type is opened as: never a wildcard. */
    public static final String UNKNOWN_TYPE = "application/octet-stream";

    /**
     * The MIME type to open a file with. A wildcard type (any type, any
     * application type, or none) is never handed out: the package installer
     * matches it, and the file behind the URI can change between the moment
     * the type is decided and the moment an app reads it (a Q-App SAVE_FILE
     * under the same name rewrites the same file). The installer only claims
     * the package-archive type, so a ZIP is opened as application/zip and
     * anything else as application/octet-stream, which file managers and
     * "any file" viewers still accept.
     */
    public static String viewType(String type, byte[] head) {
        if (!isWildcardMime(type)) return type.trim();
        return looksLikeZip(head) ? "application/zip" : UNKNOWN_TYPE;
    }

    private static String readable(String name) {
        String value = Normalizer.normalize(name, Normalizer.Form.NFKC);
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); ) {
            int codePoint = value.codePointAt(i);
            i += Character.charCount(codePoint);
            if (Character.getType(codePoint) == Character.FORMAT) continue;
            out.appendCodePoint(codePoint);
        }
        String lower = out.toString().toLowerCase(Locale.ROOT);
        StringBuilder folded = new StringBuilder(lower.length());
        for (int i = 0; i < lower.length(); i++) {
            char c = lower.charAt(i);
            int lookAlike = LOOK_ALIKES.indexOf(c);
            folded.append(lookAlike >= 0 ? LATIN.charAt(lookAlike) : c);
        }
        return folded.toString().trim();
    }

    private static String baseMime(String mime) {
        if (mime == null) return "";
        String value = mime.trim().toLowerCase(Locale.ROOT);
        int semicolon = value.indexOf(';');
        if (semicolon >= 0) value = value.substring(0, semicolon).trim();
        return value;
    }
}
