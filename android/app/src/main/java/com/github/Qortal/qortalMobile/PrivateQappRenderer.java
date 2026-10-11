package com.github.Qortal.qortalMobile;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Answers a request for a file of a private Q-App that GO unpacked itself
 * ({@link PrivateQappArchive}), the way the node answers its own preview of
 * the same zip: /render/hash/&lt;hash&gt; (Core's RenderResource,
 * ArbitraryDataRenderer and HTMLParser). No Android types, so the JVM unit
 * tests can check it.
 *
 * <p>As in Core for a preview (service ARBITRARY_DATA):
 * <ul>
 *   <li>a folder, or "/", serves the first index file the app's root has
 *   (index.html, index.htm, default.html, ...), in that folder;</li>
 *   <li>an app of one single file serves that file at every address;</li>
 *   <li>a missing file is a 404: no fallback to the index (that is only for
 *   published APPs, not previews);</li>
 *   <li>an HTML page gets the same additions as from the node: meta charset,
 *   a base href at the app's own address, the _qdn* variables and the node's
 *   /apps/q-apps.js, which gives the app qortalRequest;</li>
 *   <li>the same Content-Security-Policy as from the node, plus GO's own frame
 *   policy ({@link QappFramePolicy#contentSecurityPolicy}), as for every
 *   other Q-App page.</li>
 * </ul>
 * Unlike Core, the theme and language from the address are only taken when
 * they are plain words, and every value is escaped for where it goes.
 */
public final class PrivateQappRenderer {
    private PrivateQappRenderer() {}

    /** Core's ArbitraryDataRenderer.indexFiles(), in Core's order. */
    static final String[] INDEX_FILES = {
        "index.html", "index.htm", "default.html", "default.htm", "home.html", "home.htm",
    };

    /** What the node sends with an app's HTML page (ArbitraryDataRenderer.render). */
    static final String NODE_PAGE_POLICY = "default-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        + "font-src 'self' data:; "
        + "media-src 'self' data: blob: http://127.0.0.1:* http://localhost:*; "
        + "img-src 'self' data: blob:; "
        + "connect-src 'self' wss: blob:;";

    /** What the node sends with an app's other files. */
    static final String NODE_FILE_POLICY = "default-src 'self'";

    /** The node's prefix for a preview; the app's id follows it. */
    static final String PREFIX = "/render/hash";

    private static final Pattern PLAIN_WORD = Pattern.compile("[A-Za-z0-9_-]{1,32}");
    private static final Pattern HEAD_TAG = Pattern.compile("<head(?:\\s[^>]*)?>", Pattern.CASE_INSENSITIVE);
    private static final Pattern HTML_TAG = Pattern.compile("<html(?:\\s[^>]*)?>", Pattern.CASE_INSENSITIVE);
    private static final Pattern DOCTYPE = Pattern.compile("<!doctype[^>]*>", Pattern.CASE_INSENSITIVE);

    private static final Map<String, String> MIME_TYPES = new HashMap<>();

    static {
        String[][] types = {
            {"html", "text/html"}, {"htm", "text/html"}, {"xhtml", "application/xhtml+xml"},
            {"js", "text/javascript"}, {"mjs", "text/javascript"}, {"cjs", "text/javascript"},
            {"css", "text/css"}, {"json", "application/json"}, {"map", "application/json"},
            {"webmanifest", "application/manifest+json"}, {"txt", "text/plain"}, {"md", "text/markdown"},
            {"csv", "text/csv"}, {"xml", "application/xml"}, {"wasm", "application/wasm"},
            {"svg", "image/svg+xml"}, {"png", "image/png"}, {"jpg", "image/jpeg"}, {"jpeg", "image/jpeg"},
            {"gif", "image/gif"}, {"webp", "image/webp"}, {"avif", "image/avif"}, {"bmp", "image/bmp"},
            {"ico", "image/x-icon"}, {"woff", "font/woff"}, {"woff2", "font/woff2"}, {"ttf", "font/ttf"},
            {"otf", "font/otf"}, {"eot", "application/vnd.ms-fontobject"}, {"mp3", "audio/mpeg"},
            {"m4a", "audio/mp4"}, {"aac", "audio/aac"}, {"ogg", "audio/ogg"}, {"oga", "audio/ogg"},
            {"opus", "audio/opus"}, {"wav", "audio/wav"}, {"flac", "audio/flac"}, {"mp4", "video/mp4"},
            {"m4v", "video/mp4"}, {"webm", "video/webm"}, {"ogv", "video/ogg"}, {"mov", "video/quicktime"},
            {"pdf", "application/pdf"}, {"zip", "application/zip"},
        };
        for (String[] type : types) {
            MIME_TYPES.put(type[0], type[1]);
        }
    }

    /** What the WebView gets; maps one to one onto WebResourceResponse. */
    public static final class Reply {
        public final int status;
        public final String reason;
        /** Null when the type is not known: the WebView sniffs it. */
        public final String mimeType;
        public final String charset;
        public final Map<String, String> headers;
        public final byte[] body;

        Reply(int status, String mimeType, String charset, Map<String, String> headers, byte[] body) {
            this.status = status;
            this.reason = QappFramePolicy.reasonPhrase(status, null);
            this.mimeType = mimeType;
            this.charset = charset;
            this.headers = headers;
            this.body = body;
        }
    }

    /**
     * The reply for {@code inPath} inside the app with id {@code id}.
     *
     * @param inPath the decoded path after /render/hash/&lt;id&gt;: "" or "/..."
     * @param theme the address's theme parameter, or null
     * @param lang the address's lang parameter, or null
     * @param goPolicy GO's frame policy for the node's origin
     */
    public static Reply render(PrivateQappArchive app, String id, String inPath, String theme, String lang, String goPolicy) {
        String path = inPath == null || inPath.isEmpty() ? "/" : inPath;
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        if (app.rootNames().size() == 1) {
            // One single file: Core serves it at every address (not for APPs,
            // and a preview is ARBITRARY_DATA).
            path = app.rootNames().get(0);
        }
        String filename = filename(app, path);
        if (app.isDirectory(key(filename)) && !path.endsWith("/")) {
            path = path + "/";
            filename = filename(app, path);
        }
        byte[] data = app.file(key(filename));
        if (data == null) {
            return notFound();
        }
        Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        headers.put("Cache-Control", "no-store");
        if (isHtmlFile(filename)) {
            String page = withQdnTags(
                new String(data, StandardCharsets.UTF_8),
                id,
                path,
                plainWord(theme, "light"),
                plainWord(lang, "en")
            );
            headers.put(QappFramePolicy.CSP_HEADER, NODE_PAGE_POLICY + ", " + goPolicy);
            return new Reply(200, mimeType(filename), "utf-8", headers, page.getBytes(StandardCharsets.UTF_8));
        }
        headers.put(QappFramePolicy.CSP_HEADER, NODE_FILE_POLICY + ", " + goPolicy);
        String mime = mimeType(filename);
        return new Reply(200, mime, charsetFor(mime), headers, data);
    }

    /** Core's getFilename: "/" or a folder gets the first index file the root has. */
    static String filename(PrivateQappArchive app, String path) {
        if (path.isEmpty() || path.endsWith("/")) {
            for (String index : INDEX_FILES) {
                if (app.file(index) != null) {
                    return path + index;
                }
            }
        }
        return path;
    }

    /** The archive key for a served path: no leading "/", no empty or "." parts. */
    static String key(String path) {
        StringBuilder out = new StringBuilder();
        for (String part : path.split("/")) {
            if (part.isEmpty() || ".".equals(part)) {
                continue;
            }
            if ("..".equals(part)) {
                // The WebView resolves these before asking; never leave the app.
                return "\0";
            }
            if (out.length() > 0) {
                out.append('/');
            }
            out.append(part);
        }
        return out.toString();
    }

    /** Core's HTMLParser.isHtmlFile. */
    static boolean isHtmlFile(String filename) {
        return filename.endsWith(".html") || filename.endsWith(".htm") || filename.isEmpty();
    }

    static String mimeType(String filename) {
        String name = filename.substring(filename.lastIndexOf('/') + 1);
        int dot = name.lastIndexOf('.');
        if (dot < 0) {
            return null;
        }
        return MIME_TYPES.get(name.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    private static String charsetFor(String mime) {
        if (mime == null) {
            return null;
        }
        boolean text = mime.startsWith("text/")
            || "application/json".equals(mime)
            || "application/manifest+json".equals(mime)
            || "application/xml".equals(mime)
            || "image/svg+xml".equals(mime);
        return text ? "utf-8" : null;
    }

    /**
     * The page with Core's additions at the start of its head, in Core's
     * order: meta charset, base href, the _qdn* variables, q-apps.js.
     */
    static String withQdnTags(String page, String id, String path, String theme, String lang) {
        String qdnBase = PREFIX + "/" + id;
        String dir = path.contains("/") ? path.substring(0, path.lastIndexOf('/')) : "/" + path;
        String qdnBaseWithPath = qdnBase + dir;
        String tags = "<meta charset=\"UTF-8\">"
            + "<base href=\"" + htmlAttribute(QappFramePolicy.encodeRequestTarget(qdnBaseWithPath + "/")) + "\">"
            + "<script>var _qdnContext=" + jsString("render")
            + "; var _qdnTheme=" + jsString(theme)
            + "; var _qdnLang=" + jsString(lang)
            + "; var _qdnService=" + jsString("ARBITRARY_DATA")
            + "; var _qdnName=" + jsString(id)
            + "; var _qdnIdentifier=" + jsString("default")
            + "; var _qdnPath=" + jsString(path)
            + "; var _qdnBase=" + jsString(qdnBase)
            + "; var _qdnBaseWithPath=" + jsString(qdnBaseWithPath)
            + ";</script>"
            + "<script src=\"/apps/q-apps.js?time=" + System.currentTimeMillis() + "\"></script>";
        Matcher head = HEAD_TAG.matcher(page);
        if (head.find()) {
            return page.substring(0, head.end()) + tags + page.substring(head.end());
        }
        Matcher html = HTML_TAG.matcher(page);
        if (html.find()) {
            return page.substring(0, html.end()) + "<head>" + tags + "</head>" + page.substring(html.end());
        }
        Matcher doctype = DOCTYPE.matcher(page);
        if (doctype.find() && page.substring(0, doctype.start()).trim().isEmpty()) {
            return page.substring(0, doctype.end()) + "<head>" + tags + "</head>" + page.substring(doctype.end());
        }
        return "<head>" + tags + "</head>" + page;
    }

    private static String plainWord(String value, String fallback) {
        return value != null && PLAIN_WORD.matcher(value).matches() ? value : fallback;
    }

    /** A JavaScript string literal that is also safe inside an HTML script element. */
    static String jsString(String value) {
        StringBuilder out = new StringBuilder(value.length() + 2).append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"':
                    out.append("\\\"");
                    break;
                case '\\':
                    out.append("\\\\");
                    break;
                case '\n':
                    out.append("\\n");
                    break;
                case '\r':
                    out.append("\\r");
                    break;
                default:
                    if (c < 0x20 || c == '<' || c == '>' || c == '&' || c == ' ' || c == ' ') {
                        out.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        return out.append('"').toString();
    }

    private static String htmlAttribute(String text) {
        return text.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /** Core's answer for a file the app does not have. */
    static Reply notFound() {
        Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        headers.put(QappFramePolicy.CSP_HEADER, "sandbox; default-src 'none'");
        headers.put("Cache-Control", "no-store");
        byte[] body = "Error 404: File Not Found".getBytes(StandardCharsets.UTF_8);
        return new Reply(404, "text/plain", "utf-8", headers, body);
    }
}
