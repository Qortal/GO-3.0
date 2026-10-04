package com.github.Qortal.qortalMobile;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pure rules for ReticulumPlugin.qchatFileOpen, which hands a file GO holds to
 * another app through the Android chooser, and qchatFileStat, which says
 * whether a file is there. No Android types, so the JVM unit tests can check
 * them.
 *
 * Both take a path from JS. They only act inside the folders GO's own flows
 * use, so script in GO's page cannot hand the Reticulum identity or any other
 * private app file to another app, or probe for it (N-19):
 * <ul>
 *   <li>Open: received chat files (current and legacy folders), the copies
 *   mobileFileShare stages for Share / Open with (cache/shared-files) and,
 *   on Android 8/9 only, two public folders: GO's saves under
 *   Documents/Qortal Go, and Downloads, where builds up to v0.0.14 copied
 *   received files. Later versions use MediaStore content:// uris for
 *   both.</li>
 *   <li>Stat: received chat files and the copies qchatFilePrepare stages for
 *   sending (cache/qchat-send).</li>
 * </ul>
 * A content:// uri of GO's own providers is refused: GO's FileProvider
 * exposes the whole files and cache directories.
 *
 * A page type (HTML, SVG, XML, any "+xml" type, script) is handed out as
 * text/plain, judged by the names, by the given type and by the type the
 * platform gives the extension, the same test SavedFilePolicy applies to a
 * save (N-27).
 */
public final class FileOpenPolicy {
    private FileOpenPolicy() {}

    /** The type every page-like file is handed to another app as. */
    public static final String TEXT_MIME = "text/plain";
    /** Folder under the cache dir that mobileFileShare stages copies in. */
    public static final String SHARE_STAGING_DIR = "shared-files";
    /** Folder under the cache dir qchatFilePrepare copies a file to send to. */
    public static final String SEND_STAGING_DIR = "qchat-send";
    /** Android 10: from here GO saves through MediaStore (content:// uris). */
    static final int SCOPED_STORAGE_SDK = 29;

    private static final String[] SCRIPT_EXTENSIONS = {".js", ".mjs"};
    private static final String[] SCRIPT_MIME_TYPES = {
        "text/javascript",
        "application/javascript",
        "application/x-javascript",
        "application/ecmascript",
    };

    /**
     * Folders qchatFileOpen may hand a plain path or file:// uri from.
     * {@code receivedRoots} are the received-file folders; {@code
     * publicRoots} (public Documents/Qortal Go and Downloads) are used only
     * below Android 10, where GO's saves and older builds' Downloads copies
     * are plain paths. Everything in them is readable by any app with the
     * storage permission anyway. Null or empty entries are skipped. The
     * caller canonicalises the result before {@link
     * ReceivedFilePolicy#isInside}.
     */
    public static String[] openRoots(
        String[] receivedRoots,
        String cacheDir,
        String[] publicRoots,
        int sdkInt
    ) {
        List<String> roots = new ArrayList<>();
        addAll(roots, receivedRoots);
        add(roots, child(cacheDir, SHARE_STAGING_DIR));
        if (sdkInt < SCOPED_STORAGE_SDK) {
            addAll(roots, publicRoots);
        }
        return roots.toArray(new String[0]);
    }

    /** Folders qchatFileStat answers for: received files and staged sends. */
    public static String[] statRoots(String[] receivedRoots, String cacheDir) {
        List<String> roots = new ArrayList<>();
        addAll(roots, receivedRoots);
        add(roots, child(cacheDir, SEND_STAGING_DIR));
        return roots.toArray(new String[0]);
    }

    /**
     * True for a content:// authority that belongs to GO itself
     * ("&lt;package&gt;" or "&lt;package&gt;.anything", such as the
     * FileProvider), compared without regard to case. A missing authority
     * counts as GO's, so it is refused too.
     */
    public static boolean isOwnAuthority(String authority, String packageName) {
        if (authority == null || authority.isEmpty()) {
            return true;
        }
        if (packageName == null || packageName.isEmpty()) {
            return false;
        }
        String a = authority.toLowerCase(Locale.ROOT);
        String p = packageName.toLowerCase(Locale.ROOT);
        return a.equals(p) || a.startsWith(p + ".");
    }

    /**
     * The type to hand another app: text/plain when {@code type}, any of
     * {@code names}, or the type {@code types} gives a name's extension is
     * a page or script; {@code type} otherwise. {@code names} entries may be
     * null; each is cleaned (invisible characters, trailing dots and spaces
     * removed) before its extension is read.
     */
    public static String openType(
        String[] names,
        String type,
        SavedFilePolicy.ExtensionTypes types
    ) {
        if (isPageType(type)) {
            return TEXT_MIME;
        }
        if (names != null) {
            for (String raw : names) {
                if (raw == null || raw.isEmpty()) {
                    continue;
                }
                String name = SavedFilePolicy.cleanName(raw);
                if (SavedFilePolicy.hasPageExtension(name) || hasScriptExtension(name)) {
                    return TEXT_MIME;
                }
                if (types != null) {
                    String ext = SavedFilePolicy.extension(name);
                    if (!ext.isEmpty() && isPageType(types.mimeFor(ext))) {
                        return TEXT_MIME;
                    }
                }
            }
        }
        return type;
    }

    /** True for a type a browser shows as a page or runs as script. */
    static boolean isPageType(String type) {
        if (SavedFilePolicy.isPageMime(type)) {
            return true;
        }
        String base = SavedFilePolicy.baseMime(type);
        for (String script : SCRIPT_MIME_TYPES) {
            if (script.equals(base)) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasScriptExtension(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String ext : SCRIPT_EXTENSIONS) {
            if (lower.endsWith(ext)) {
                return true;
            }
        }
        return false;
    }

    private static String child(String dir, String name) {
        if (dir == null || dir.isEmpty()) {
            return null;
        }
        return dir.endsWith("/") ? dir + name : dir + "/" + name;
    }

    private static void add(List<String> roots, String root) {
        if (root != null && !root.isEmpty()) {
            roots.add(root);
        }
    }

    private static void addAll(List<String> roots, String[] more) {
        if (more == null) {
            return;
        }
        for (String root : more) {
            add(roots, root);
        }
    }
}
