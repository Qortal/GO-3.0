package com.github.Qortal.qortalMobile;

import java.util.Locale;

/**
 * Pure rules for files GO saves from in-page downloads
 * ({@link QortalDownloadListener} and {@link DocumentSaver}): no Android
 * types, so the JVM unit tests can check them.
 *
 * A Q-App or website picks the name and the type of every in-page download,
 * and GO saves it to Documents with no prompt. Two things are made safe:
 * <ul>
 *   <li>The name. Control, bidi and other invisible format characters are
 *   removed, so a right-to-left override cannot make "photo[RLO]gpj.apk"
 *   show as "photokpa.jpg". Path separators and characters Android storage
 *   refuses become "_", and leading dots go (no hidden files, no "." or
 *   "..").</li>
 *   <li>Types a browser or WebView renders as a page that can run script
 *   (HTML, XHTML, SVG, XML, XSLT, MHTML). A file named like one is saved as
 *   plain text: ".txt" is added and the type becomes text/plain (GO-01).
 *   "Named like one" means a page extension from the fixed list, or any
 *   extension the platform maps to a page type (".rss", ".kml", ".atom" and
 *   other "+xml" types). MediaProvider and file managers often work a
 *   file's type out from its extension, so such a name is unsafe whatever
 *   type it was saved with. When only the declared type is a page type, the
 *   name stays and the type becomes application/octet-stream, so MediaStore
 *   neither adds a page extension to the name nor records the file as a
 *   page.</li>
 * </ul>
 */
public final class SavedFilePolicy {
    private SavedFilePolicy() {}

    static final String FALLBACK_NAME = "download";
    static final int MAX_NAME_LENGTH = 200;
    /** Longest extension kept whole when a long name is shortened. */
    private static final int MAX_KEPT_EXTENSION = 16;
    static final String TEXT_SUFFIX = ".txt";
    static final String TEXT_MIME = "text/plain";
    static final String BINARY_MIME = "application/octet-stream";

    /** Same list as AppOriginGuardPolicy: types rendered as a scriptable document. */
    private static final String[] PAGE_EXTENSIONS = {
        ".html", ".htm", ".xhtml", ".xht", ".shtml", ".mht", ".mhtml",
        ".svg", ".svgz", ".xml", ".xsl", ".xslt",
    };

    private static final String[] PAGE_MIME_TYPES = {
        "text/html",
        "application/xhtml+xml",
        "application/vnd.wap.xhtml+xml",
        "image/svg+xml",
        "text/xml",
        "application/xml",
        "application/xslt+xml",
        "text/xsl",
        "text/x-server-parsed-html",
        "multipart/related",
        "message/rfc822",
        "application/x-mimearchive",
    };

    /** Name and type to save under. {@code mime} may be null (unknown). */
    public static final class Target {
        public final String name;
        public final String mime;

        Target(String name, String mime) {
            this.name = name;
            this.mime = mime;
        }
    }

    /**
     * The MIME type the platform gives a file extension (on Android,
     * {@code MimeTypeMap}: see {@link DocumentSaver#EXTENSION_TYPES}).
     */
    public interface ExtensionTypes {
        /** {@code ext} is lower case, without the dot. Null when unknown. */
        String mimeFor(String ext);
    }

    /**
     * The name and type a download is saved under, checking page extensions
     * against the fixed list only. Android callers use the three-argument
     * form with {@link DocumentSaver#EXTENSION_TYPES}.
     */
    public static Target forSave(String name, String mime) {
        return forSave(name, mime, null);
    }

    /**
     * The name and type a download is saved under. {@code types} may be null
     * (fixed list only).
     */
    public static Target forSave(String name, String mime, ExtensionTypes types) {
        String clean = cleanName(name);
        if (hasPageExtension(clean) || isPageMime(extensionMime(clean, types))) {
            return new Target(limitLength(clean + TEXT_SUFFIX), TEXT_MIME);
        }
        if (isPageMime(mime)) {
            return new Target(clean, BINARY_MIME);
        }
        return new Target(clean, mime);
    }

    /** A file name that is safe to show and to create in shared storage. */
    public static String cleanName(String name) {
        if (name == null) {
            return FALLBACK_NAME;
        }
        StringBuilder out = new StringBuilder(name.length());
        int i = 0;
        while (i < name.length()) {
            int cp = name.codePointAt(i);
            i += Character.charCount(cp);
            if (isInvisible(cp)) {
                continue;
            }
            if (isForbidden(cp)) {
                out.append('_');
            } else {
                out.appendCodePoint(cp);
            }
        }
        String n = trimEnds(out.toString());
        n = trimEnds(limitLength(n));
        return n.isEmpty() ? FALLBACK_NAME : n;
    }

    /** True when the name ends in an extension a browser shows as a page. */
    public static boolean hasPageExtension(String name) {
        if (name == null) {
            return false;
        }
        String lower = trimTrailing(name).toLowerCase(Locale.ROOT);
        for (String ext : PAGE_EXTENSIONS) {
            if (lower.endsWith(ext)) {
                return true;
            }
        }
        return false;
    }

    /** The platform's type for the name's extension, or null. */
    private static String extensionMime(String name, ExtensionTypes types) {
        if (types == null) {
            return null;
        }
        String ext = extension(name);
        return ext.isEmpty() ? null : types.mimeFor(ext);
    }

    /** "Feed.RSS" becomes "rss"; no extension becomes "". */
    static String extension(String name) {
        if (name == null) {
            return "";
        }
        String trimmed = trimTrailing(name);
        int dot = trimmed.lastIndexOf('.');
        if (dot < 0 || dot == trimmed.length() - 1) {
            return "";
        }
        return trimmed.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** True when the MIME type is one a browser shows as a page. */
    public static boolean isPageMime(String mime) {
        String base = baseMime(mime);
        if (base.isEmpty()) {
            return false;
        }
        for (String type : PAGE_MIME_TYPES) {
            if (type.equals(base)) {
                return true;
            }
        }
        // Every "+xml" type is an XML document to a browser, and an XML
        // document can carry XHTML script.
        return base.endsWith("+xml");
    }

    /** "Text/HTML; charset=utf-8" becomes "text/html"; null becomes "". */
    static String baseMime(String mime) {
        if (mime == null) {
            return "";
        }
        int semi = mime.indexOf(';');
        String base = semi >= 0 ? mime.substring(0, semi) : mime;
        return base.trim().toLowerCase(Locale.ROOT);
    }

    /** Cc, Cf (bidi controls, zero-width characters), line/paragraph separators, lone surrogates. */
    private static boolean isInvisible(int cp) {
        switch (Character.getType(cp)) {
            case Character.CONTROL:
            case Character.FORMAT:
            case Character.LINE_SEPARATOR:
            case Character.PARAGRAPH_SEPARATOR:
            case Character.SURROGATE:
                return true;
            default:
                return false;
        }
    }

    private static boolean isForbidden(int cp) {
        switch (cp) {
            case '/':
            case '\\':
            case '?':
            case '%':
            case '*':
            case ':':
            case '|':
            case '"':
            case '<':
            case '>':
                return true;
            default:
                return false;
        }
    }

    /** Drops surrounding whitespace, leading dots and trailing dots. */
    private static String trimEnds(String s) {
        String t = trimTrailing(s);
        int start = 0;
        while (start < t.length() && isTrimmable(t.charAt(start))) {
            start++;
        }
        return t.substring(start);
    }

    /** Drops trailing whitespace and dots: "x.html. " is still an .html file to some viewers. */
    private static String trimTrailing(String s) {
        int end = s.length();
        while (end > 0 && isTrimmable(s.charAt(end - 1))) {
            end--;
        }
        return s.substring(0, end);
    }

    private static boolean isTrimmable(char c) {
        return c == '.' || Character.isWhitespace(c) || Character.isSpaceChar(c);
    }

    /** Shortens a long name, keeping a short extension and whole characters. */
    static String limitLength(String n) {
        if (n.length() <= MAX_NAME_LENGTH) {
            return n;
        }
        int dot = n.lastIndexOf('.');
        String ext = dot > 0 && n.length() - dot <= MAX_KEPT_EXTENSION ? n.substring(dot) : "";
        int cut = MAX_NAME_LENGTH - ext.length();
        if (cut > 0 && Character.isHighSurrogate(n.charAt(cut - 1))) {
            cut--;
        }
        return n.substring(0, cut) + ext;
    }
}
