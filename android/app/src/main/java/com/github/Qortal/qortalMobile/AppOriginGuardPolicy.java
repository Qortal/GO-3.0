package com.github.Qortal.qortalMobile;

import java.util.Locale;
import java.util.Map;

/**
 * Pure rules behind {@link AppOriginGuardWebViewClient}: no Android types, so
 * the JVM unit tests can check them.
 *
 * GO's own origin (http://localhost) carries the Capacitor bridge, the wallet
 * vault and GO's signing code. Anything that runs as a page on that origin can
 * reach them, so outside content must never get a document there:
 * <ul>
 *   <li>A frame (Q-App, embedded QDN site) may not load a page from GO's
 *   origin. It would be same-origin with the GO window above it.</li>
 *   <li>Capacitor's file, content and HTTP-proxy paths are never served as a
 *   page, in any frame, and never serve document types (HTML, SVG, XML). GO
 *   only uses them for images, video previews and fetch().</li>
 *   <li>The HTTP proxy is refused outright on every host: CapacitorHttp is off
 *   and nothing in GO uses it (see CVE-2026-103922).</li>
 * </ul>
 */
public final class AppOriginGuardPolicy {
    private AppOriginGuardPolicy() {}

    static final String FILE_START = "/_capacitor_file_";
    static final String CONTENT_START = "/_capacitor_content_";
    static final String HTTP_INTERCEPTOR_START = "/_capacitor_http_interceptor_";

    /** Types a browser renders as a document that can run script. */
    private static final String[] DOCUMENT_EXTENSIONS = {
        ".html", ".htm", ".xhtml", ".xht", ".shtml", ".mht", ".mhtml",
        ".svg", ".svgz", ".xml", ".xsl", ".xslt",
    };

    /** Origin parts of the request and of GO's own page, as Uri reports them. */
    public static final class Request {
        public String scheme;
        public String host;
        public int port = -1;
        /** Decoded path (Uri.getPath()), which is what Capacitor matches. */
        public String path;
        public boolean mainFrame;
        public Map<String, String> headers;
    }

    /** True when the request must get an empty refusal instead of content. */
    public static boolean refuse(Request req, String appScheme, String appHost, int appPort) {
        String path = req.path == null ? "" : req.path;
        if (path.startsWith(HTTP_INTERCEPTOR_START)) {
            return true;
        }
        if (!sameOrigin(req, appScheme, appHost, appPort)) {
            return false;
        }
        boolean capacitorPath = path.startsWith(FILE_START) || path.startsWith(CONTENT_START);
        if (capacitorPath && hasDocumentExtension(path)) {
            return true;
        }
        if (!isDocumentRequest(req)) {
            return false;
        }
        // GO itself is the only page allowed on its origin, and only in the
        // main frame.
        return !req.mainFrame || capacitorPath;
    }

    /**
     * WebView does not say whether a sub-frame request is a navigation;
     * Chromium sends Upgrade-Insecure-Requests only on navigations. Capacitor
     * 6.2.2 uses the same test.
     */
    static boolean isDocumentRequest(Request req) {
        if (req.mainFrame) {
            return true;
        }
        if (req.headers == null) {
            return false;
        }
        for (String header : req.headers.keySet()) {
            if ("Upgrade-Insecure-Requests".equalsIgnoreCase(header)) {
                return true;
            }
        }
        return false;
    }

    static boolean hasDocumentExtension(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        for (String ext : DOCUMENT_EXTENSIONS) {
            if (lower.endsWith(ext)) {
                return true;
            }
        }
        return false;
    }

    static boolean sameOrigin(Request req, String appScheme, String appHost, int appPort) {
        return req.scheme != null
            && req.host != null
            && req.scheme.equalsIgnoreCase(appScheme)
            && req.host.equalsIgnoreCase(appHost)
            && effectivePort(req.scheme, req.port) == effectivePort(appScheme, appPort);
    }

    private static int effectivePort(String scheme, int port) {
        if (port != -1) {
            return port;
        }
        return "https".equalsIgnoreCase(scheme) ? 443 : 80;
    }
}
