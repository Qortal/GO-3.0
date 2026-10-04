package com.github.Qortal.qortalMobile;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Pure rules for Q-App and QDN-site frames (N-03, N-39). No Android types, so
 * the JVM unit tests can check them.
 *
 * <p>A Q-App runs in a frame loaded from the node. The node's own policy lets
 * it open a WebSocket to any host ({@code connect-src 'self' wss: blob:}), and
 * other node addresses (/arbitrary/...) send no policy at all. The desktop Hub
 * replaces the node's policy with its own, which keeps Q-Apps to the node
 * (electron/src/setup.ts, setupContentSecurityPolicy). The WebView gives GO no
 * way to add a header to a reply it fetched itself, so
 * {@link AppOriginGuardWebViewClient} fetches each frame's page natively
 * ({@link QappDocumentFetcher}) and returns it with a second policy,
 * {@link #contentSecurityPolicy}. A browser enforces every policy a page
 * carries, so the node's own limits still apply as well.
 *
 * <p>Only frame pages are fetched this way: GO's own page, sub-resources and
 * anything that is not a GET stay with the WebView.
 */
public final class QappFramePolicy {
    private QappFramePolicy() {}

    static final String CSP_HEADER = "Content-Security-Policy";

    /** What {@link AppOriginGuardWebViewClient} does with a request; see {@link #decide}. */
    public enum Decision {
        /** Outside content asking for a page or Capacitor path on GO's own origin ({@link AppOriginGuardPolicy}). */
        REFUSE_APP_ORIGIN,
        /** A service worker's script: GO lets no service worker be installed. */
        REFUSE_SERVICE_WORKER,
        /** A prefetch from a frame or resource to another origin. */
        REFUSE_PREFETCH,
        /** A page loading into a frame: GO fetches it and adds its policy. */
        FETCH_FRAME_PAGE,
        /** Everything else goes to Capacitor and the WebView, as before. */
        PASS
    }

    /** Bytes GO looks at to tell whether an untyped reply is HTML. */
    static final int SNIFF_BYTES = 512;

    /** Request headers GO does not pass on when it fetches a frame page itself. */
    private static final Set<String> DROPPED_REQUEST_HEADERS = new HashSet<>(
        Arrays.asList(
            "host",
            "connection",
            "keep-alive",
            "proxy-authorization",
            "proxy-connection",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade",
            "content-length",
            "expect",
            // GO's fetch sends no cookies and keeps none. The WebView does keep
            // them for frames (Capacitor allows third-party cookies), so this
            // is a change, made on purpose: Core and the public node set none,
            // and GO cannot apply the WebView's SameSite rules from here.
            "cookie",
            "cookie2",
            // HttpURLConnection asks for gzip and unpacks it itself; a copied
            // Accept-Encoding would hand the WebView packed bytes.
            "accept-encoding",
            // GO's fetch has no cache of its own, and a 304 or 206 cannot be
            // handed back as a page.
            "if-none-match",
            "if-modified-since",
            "if-match",
            "if-unmodified-since",
            "if-range",
            "range",
            "service-worker"
        )
    );

    /**
     * Reply headers GO does not hand back: the connection's own (hop-by-hop),
     * the ones that describe the bytes as sent over the wire (GO streams them
     * unpacked), cookies (see above) and the type, which goes in separately
     * (QappDocumentFetcher puts it back for replies other than 200).
     */
    private static final Set<String> DROPPED_RESPONSE_HEADERS = new HashSet<>(
        Arrays.asList(
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-connection",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade",
            "content-length",
            "content-encoding",
            "content-type",
            "set-cookie",
            "set-cookie2"
        )
    );

    /** Plain-HTTP media from this phone: GO's own media server (as the node's policy allows). */
    static final String LOCAL_MEDIA_SOURCE = "http://127.0.0.1:*";

    /**
     * The order {@link AppOriginGuardWebViewClient#shouldInterceptRequest}
     * applies: GO's own origin first ({@link AppOriginGuardPolicy#refuse}),
     * then service worker scripts, then prefetches to other origins, then
     * frame pages, which GO fetches itself. Anything else passes.
     */
    public static Decision decide(
        AppOriginGuardPolicy.Request req,
        String method,
        String appScheme,
        String appHost,
        int appPort
    ) {
        if (req == null) {
            return Decision.PASS;
        }
        if (AppOriginGuardPolicy.refuse(req, appScheme, appHost, appPort)) {
            return Decision.REFUSE_APP_ORIGIN;
        }
        if (isServiceWorkerScript(req.headers)) {
            return Decision.REFUSE_SERVICE_WORKER;
        }
        if (refusesPrefetch(req, appScheme, appHost, appPort)) {
            return Decision.REFUSE_PREFETCH;
        }
        if (fetchesFrameDocument(req, method, appScheme, appHost, appPort)) {
            return Decision.FETCH_FRAME_PAGE;
        }
        return Decision.PASS;
    }

    /**
     * True for a prefetch ({@code <link rel=prefetch>}) that is not for GO's
     * own origin. No policy directive covers prefetch, so a Q-App could send
     * data to any host with one. Refusing it costs nothing: a prefetch only
     * warms up a later load, which still happens (and is checked) as usual.
     */
    public static boolean refusesPrefetch(AppOriginGuardPolicy.Request req, String appScheme, String appHost, int appPort) {
        return req != null
            && !req.mainFrame
            && isPrefetch(req.headers)
            && !AppOriginGuardPolicy.sameOrigin(req, appScheme, appHost, appPort);
    }

    /** Chromium marks a prefetch with {@code Purpose: prefetch} and {@code Sec-Purpose: prefetch[;...]}. */
    public static boolean isPrefetch(Map<String, String> headers) {
        if (headers == null) {
            return false;
        }
        for (Map.Entry<String, String> header : headers.entrySet()) {
            String name = header.getKey();
            String value = header.getValue();
            if (value == null || !("Purpose".equalsIgnoreCase(name) || "Sec-Purpose".equalsIgnoreCase(name))) {
                continue;
            }
            if (value.trim().toLowerCase(Locale.ROOT).startsWith("prefetch")) {
                return true;
            }
        }
        return false;
    }

    /**
     * True for a request GO fetches itself to add {@link #contentSecurityPolicy}:
     * a page (navigation) loading into a frame, by GET, over http(s), from
     * anywhere but GO's own origin. The main frame is GO itself and is never
     * fetched here.
     *
     * @param method the request's HTTP method, as the WebView reports it
     */
    public static boolean fetchesFrameDocument(
        AppOriginGuardPolicy.Request req,
        String method,
        String appScheme,
        String appHost,
        int appPort
    ) {
        if (req == null || req.mainFrame) {
            return false;
        }
        if (method == null || !"GET".equalsIgnoreCase(method)) {
            return false;
        }
        if (!isWebScheme(req.scheme) || req.host == null || req.host.isEmpty()) {
            return false;
        }
        if (isServiceWorkerScript(req.headers)) {
            return false;
        }
        if (!AppOriginGuardPolicy.isDocumentRequest(req)) {
            return false;
        }
        return !AppOriginGuardPolicy.sameOrigin(req, appScheme, appHost, appPort);
    }

    /**
     * True for the fetch of a service worker's script (Chromium marks it with
     * {@code Service-Worker: script}). A service worker can answer its app's
     * page loads itself, with no GO policy on them, and GO uses none, so GO
     * refuses these.
     */
    public static boolean isServiceWorkerScript(Map<String, String> headers) {
        if (headers == null) {
            return false;
        }
        for (Map.Entry<String, String> header : headers.entrySet()) {
            if ("Service-Worker".equalsIgnoreCase(header.getKey())) {
                String value = header.getValue();
                return value != null && "script".equalsIgnoreCase(value.trim());
            }
        }
        return false;
    }

    /**
     * True when a frame's navigation to {@code scheme} must be stopped without
     * opening another app (N-39). The WebView ignores the frame's sandbox for
     * these, and Capacitor would hand any of them to Android as a VIEW intent:
     * intent:, market:, tel:, sms:, mailto:, file:, content:, javascript:,
     * another browser's scheme. Kept as before: http(s) (the WebView loads
     * those itself), data: and blob: (stay in the frame) and GO's own qortal:
     * links. GO's own page (the main frame) is left to Capacitor as before.
     */
    public static boolean blocksFrameNavigation(boolean mainFrame, String scheme) {
        return !mainFrame && blocksFrameNavigation(scheme);
    }

    /** {@link #blocksFrameNavigation(boolean, String)} for a frame. */
    public static boolean blocksFrameNavigation(String scheme) {
        if (scheme == null) {
            return true;
        }
        switch (scheme.toLowerCase(Locale.ROOT)) {
            case "http":
            case "https":
            case "data":
            case "blob":
            case "qortal":
                return false;
            default:
                return true;
        }
    }

    /**
     * GO's policy for a frame page from {@code scheme://host:port}: network,
     * images, media, scripts, styles, fonts, workers, frames and form posts
     * only to that origin (for a Q-App, the node), data: and blob:. Media may
     * also come from GO's media server on 127.0.0.1. No bare {@code wss:}, so
     * no WebSocket to any other host.
     *
     * <p>Workers are narrower: only scripts under the origin's /render/ path,
     * where the node sends its own policy with every file. A worker script
     * takes its policy from its own reply, and the node's /arbitrary/
     * addresses send none, so a worker loaded from there would have no limits.
     *
     * <p>A host a policy cannot name (an IPv6 address, a name with an
     * underscore) is covered by 'self' alone, with no path rule for workers.
     */
    public static String contentSecurityPolicy(String scheme, String host, int port) {
        String origin = sourceOrigin(scheme, host, port);
        String socket = origin == null ? null : socketOrigin(scheme, host, port);
        String self = origin == null ? "'self'" : "'self' " + origin;
        String local = " data: blob:";
        List<String> directives = new ArrayList<>();
        directives.add("default-src " + self + local);
        directives.add("script-src " + self + " 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'" + local);
        directives.add("style-src " + self + " 'unsafe-inline'" + local);
        directives.add("img-src " + self + local);
        directives.add("font-src " + self + local);
        directives.add("media-src " + self + local + " " + LOCAL_MEDIA_SOURCE);
        directives.add("connect-src " + self + (socket == null ? "" : " " + socket) + local);
        directives.add("worker-src " + (origin == null ? "'self'" : origin + "/render/") + local);
        directives.add("frame-src " + self + local);
        directives.add("object-src " + self);
        directives.add("manifest-src " + self);
        directives.add("form-action " + self);
        return String.join("; ", directives);
    }

    /**
     * The headers GO sends when it fetches a frame page: the WebView's own,
     * minus {@link #DROPPED_REQUEST_HEADERS}, with the WebView's user agent
     * when the request did not carry one.
     *
     * <p>Android's HttpURLConnection throws on a header value with anything
     * but visible ASCII, space and tab, which would blank the frame. Such a
     * header is left out, except the user agent (which carries the phone's
     * model name, not always ASCII): there the other characters become '?'.
     */
    public static Map<String, String> requestHeaders(Map<String, String> fromWebView, String userAgent) {
        Map<String, String> out = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        if (fromWebView != null) {
            for (Map.Entry<String, String> header : fromWebView.entrySet()) {
                String name = header.getKey();
                String value = header.getValue();
                if (name == null || value == null || !isToken(name)) {
                    continue;
                }
                String lower = name.toLowerCase(Locale.ROOT);
                if (DROPPED_REQUEST_HEADERS.contains(lower) || lower.startsWith("proxy-")) {
                    continue;
                }
                if ("user-agent".equals(lower)) {
                    out.put(name, sendableUserAgent(value));
                } else if (isSendableHeaderValue(value)) {
                    out.put(name, value);
                }
            }
        }
        if (!out.containsKey("User-Agent") && userAgent != null && !userAgent.isEmpty()) {
            out.put("User-Agent", sendableUserAgent(userAgent));
        }
        return out;
    }

    /** Visible ASCII, space and tab: what Android's HttpURLConnection accepts in a header value. */
    static boolean isSendableHeaderValue(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (!isSendableHeaderChar(value.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    /** The user agent with every character HttpURLConnection would refuse replaced by '?'. */
    static String sendableUserAgent(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            out.append(isSendableHeaderChar(c) ? c : '?');
        }
        return out.toString();
    }

    private static boolean isSendableHeaderChar(char c) {
        return c == '\t' || (c >= 0x20 && c < 0x7f);
    }

    /**
     * The headers GO hands back with a frame page: the reply's own, minus
     * {@link #DROPPED_RESPONSE_HEADERS}, with GO's policy added after any the
     * reply carried. Several policies in one header, comma-separated, are each
     * enforced.
     *
     * @param received as HttpURLConnection.getHeaderFields() gives them (the
     *     null key is the status line)
     */
    public static Map<String, String> responseHeaders(Map<String, List<String>> received, String goPolicy) {
        Map<String, String> out = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        List<String> policies = new ArrayList<>();
        if (received != null) {
            for (Map.Entry<String, List<String>> header : received.entrySet()) {
                String name = header.getKey();
                List<String> values = header.getValue();
                if (name == null || values == null || !isToken(name)) {
                    continue;
                }
                String lower = name.toLowerCase(Locale.ROOT);
                if (DROPPED_RESPONSE_HEADERS.contains(lower) || lower.startsWith("x-android-")) {
                    continue;
                }
                for (String value : values) {
                    if (value == null) {
                        continue;
                    }
                    String clean = withoutControls(value).trim();
                    if (CSP_HEADER.equalsIgnoreCase(name)) {
                        if (!clean.isEmpty()) {
                            policies.add(clean);
                        }
                        continue;
                    }
                    String before = out.get(name);
                    out.put(name, before == null ? clean : before + ", " + clean);
                }
            }
        }
        policies.add(goPolicy);
        out.put(CSP_HEADER, String.join(", ", policies));
        return out;
    }

    /**
     * {mime type, charset} from a Content-Type header, each null when absent
     * or not well formed. The mime type is lower case and has no parameters.
     */
    public static String[] mimeAndCharset(String contentType) {
        if (contentType == null) {
            return new String[] {null, null};
        }
        String[] parts = contentType.split(";");
        String mime = parts[0].trim().toLowerCase(Locale.ROOT);
        if (!isMimeType(mime)) {
            mime = "";
        }
        String charset = null;
        for (int i = 1; i < parts.length; i++) {
            String param = parts[i].trim();
            int eq = param.indexOf('=');
            if (eq <= 0 || !"charset".equalsIgnoreCase(param.substring(0, eq).trim())) {
                continue;
            }
            String value = param.substring(eq + 1).trim();
            if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
                value = value.substring(1, value.length() - 1).trim();
            }
            if (!value.isEmpty() && isToken(value)) {
                charset = value;
            }
            break;
        }
        return new String[] {mime.isEmpty() ? null : mime, charset};
    }

    /** The Content-Type header value for a parsed type, or null without one. */
    public static String contentTypeHeader(String mime, String charset) {
        if (mime == null) {
            return null;
        }
        return charset == null ? mime : mime + "; charset=" + charset;
    }

    /** Chromium's HTML signatures (net/base/mime_sniffer.cc, kSniffableTags), lower case. */
    private static final String[] HTML_SIGNATURES = {
        "<!doctype html", "<script", "<html", "<!--", "<head", "<iframe", "<h1", "<div", "<font",
        "<table", "<a", "<style", "<title", "<b", "<body", "<br", "<p",
    };

    /**
     * True when the start of a reply that names no type is HTML by Chromium's
     * own test (SniffForHTML): after leading whitespace, it starts with one
     * of {@link #HTML_SIGNATURES}, in any case. The node's "building the app"
     * page is such a reply. Anything else is left untyped, for the WebView's
     * own sniffer (the one the network stack uses), which also finds XML,
     * images and binary files.
     *
     * @param length how many bytes of {@code head} were read
     */
    public static boolean looksLikeHtml(byte[] head, int length) {
        if (head == null) {
            return false;
        }
        int end = Math.min(length, head.length);
        int start = 0;
        while (start < end && isSniffWhitespace(head[start])) {
            start++;
        }
        for (String signature : HTML_SIGNATURES) {
            if (start + signature.length() > end) {
                continue;
            }
            boolean match = true;
            for (int i = 0; match && i < signature.length(); i++) {
                int c = head[start + i] & 0xff;
                if (c >= 'A' && c <= 'Z') {
                    c += 'a' - 'A';
                }
                match = c == signature.charAt(i);
            }
            if (match) {
                return true;
            }
        }
        return false;
    }

    private static boolean isSniffWhitespace(byte b) {
        return b == ' ' || b == '\t' || b == '\n' || b == 0x0b || b == '\f' || b == '\r';
    }

    /**
     * The address GO's fetch asks the server for: {@code url} without its
     * #fragment (never sent anyway), with a path of at least "/", and with
     * every character that java.net.URI refuses percent-encoded. Chromium
     * leaves some of those as they are, in queries in particular: { } | ^
     * [ ] \ ` and a % that starts no escape. Letters, digits, existing %XX
     * escapes and the RFC 3986 delimiters stay as they are, so the server
     * reads the same address. Scheme and host are not touched.
     *
     * @return null for anything but an http(s) address with a host
     */
    public static String wireUrl(String url) {
        if (url == null) {
            return null;
        }
        int separator = url.indexOf("://");
        if (separator <= 0 || !isWebScheme(url.substring(0, separator))) {
            return null;
        }
        int authorityStart = separator + 3;
        int authorityEnd = url.length();
        for (int i = authorityStart; i < url.length(); i++) {
            char c = url.charAt(i);
            if (c == '/' || c == '?' || c == '#') {
                authorityEnd = i;
                break;
            }
        }
        String authority = url.substring(authorityStart, authorityEnd);
        if (authority.isEmpty()) {
            return null;
        }
        for (int i = 0; i < authority.length(); i++) {
            char c = authority.charAt(i);
            if (c <= 0x20 || c >= 0x7f || c == '\\') {
                return null;
            }
        }
        String target = url.substring(authorityEnd);
        int hash = target.indexOf('#');
        if (hash >= 0) {
            target = target.substring(0, hash);
        }
        if (!target.startsWith("/")) {
            target = "/" + target;
        }
        return url.substring(0, authorityStart) + authority + encodeRequestTarget(target);
    }

    /** Path and query with everything but RFC 3986 pchar, '/', '?' and valid %XX escapes encoded. */
    static String encodeRequestTarget(String target) {
        byte[] bytes = target.getBytes(StandardCharsets.UTF_8);
        StringBuilder out = new StringBuilder(bytes.length + 16);
        for (int i = 0; i < bytes.length; i++) {
            int c = bytes[i] & 0xff;
            boolean keep;
            if (c == '%') {
                keep = i + 2 < bytes.length && isHexDigit(bytes[i + 1]) && isHexDigit(bytes[i + 2]);
            } else {
                keep = (c >= 'a' && c <= 'z')
                    || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9')
                    || "-._~!$&'()*+,;=:@/?".indexOf(c) >= 0;
            }
            if (keep) {
                out.append((char) c);
            } else {
                appendEscape(out, c);
            }
        }
        return out.toString();
    }

    private static boolean isHexDigit(byte b) {
        return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F');
    }

    private static void appendEscape(StringBuilder out, int c) {
        out.append('%')
            .append(Character.toUpperCase(Character.forDigit(c >> 4, 16)))
            .append(Character.toUpperCase(Character.forDigit(c & 0xf, 16)));
    }

    /**
     * The status GO hands back. The WebView refuses 1xx/3xx and anything
     * outside 100-599 in a reply it did not fetch itself (redirects are
     * handled before this), so those become 502.
     */
    public static int responseStatus(int status) {
        if (status < 200 || status > 599 || (status >= 300 && status < 400)) {
            return 502;
        }
        return status;
    }

    /** A reason phrase the WebView accepts: printable ASCII and not empty. */
    public static String reasonPhrase(int status, String fromServer) {
        if (fromServer != null) {
            String trimmed = fromServer.trim();
            boolean ok = !trimmed.isEmpty();
            for (int i = 0; ok && i < trimmed.length(); i++) {
                char c = trimmed.charAt(i);
                ok = c >= 0x20 && c < 0x7f;
            }
            if (ok) {
                return trimmed;
            }
        }
        switch (status) {
            case 200:
                return "OK";
            case 201:
                return "Created";
            case 202:
                return "Accepted";
            case 204:
                return "No Content";
            case 206:
                return "Partial Content";
            case 400:
                return "Bad Request";
            case 401:
                return "Unauthorized";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 405:
                return "Method Not Allowed";
            case 410:
                return "Gone";
            case 429:
                return "Too Many Requests";
            case 500:
                return "Internal Server Error";
            case 502:
                return "Bad Gateway";
            case 503:
                return "Service Unavailable";
            case 504:
                return "Gateway Timeout";
            default:
                return status >= 400 ? "Error" : "OK";
        }
    }

    /**
     * Where a redirect from {@code requestUrl} leads: an absolute http(s) URL,
     * or null (no Location, unparsable, or another scheme such as intent:).
     */
    public static String redirectTarget(String requestUrl, String location) {
        return RedirectPolicy.resolve(requestUrl, location);
    }

    /**
     * The page GO hands back for a redirect. The WebView cannot take a 3xx
     * from GO, and following it here would leave the frame at the old address
     * (relative links would break). This page moves the frame on itself,
     * replacing its own history entry, so the next address is a new frame
     * page that GO fetches and covers like the first.
     */
    public static String redirectDocument(String target) {
        String safe = htmlAttribute(percentEncodeUnsafe(target));
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
            + "<meta http-equiv=\"refresh\" content=\"0; url='" + safe + "'\">"
            + "</head><body><a href=\"" + safe + "\">" + safe + "</a></body></html>";
    }

    /**
     * Percent-encodes what may not stand in a quoted attribute or a refresh
     * URL (quotes, angle brackets, backslash, backtick, spaces, control and
     * non-ASCII characters). Other characters, % included, stay as they are.
     */
    static String percentEncodeUnsafe(String url) {
        StringBuilder out = new StringBuilder();
        for (byte b : url.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            boolean unsafe = c <= 0x20 || c >= 0x7f || c == '"' || c == '\'' || c == '<' || c == '>'
                || c == '\\' || c == '`' || c == '^' || c == '{' || c == '}' || c == '|';
            if (unsafe) {
                appendEscape(out, c);
            } else {
                out.append((char) c);
            }
        }
        return out.toString();
    }

    private static String htmlAttribute(String text) {
        return text.replace("&", "&amp;");
    }

    private static boolean isWebScheme(String scheme) {
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    /** scheme://host[:port] as a policy source, or null when a policy cannot name the host. */
    static String sourceOrigin(String scheme, String host, int port) {
        if (!isWebScheme(scheme) || !isPolicyHost(host)) {
            return null;
        }
        String s = scheme.toLowerCase(Locale.ROOT);
        return s + "://" + host.toLowerCase(Locale.ROOT) + portSuffix(s, port);
    }

    /** The WebSocket form of the origin: ws:// for http, wss:// for https. */
    private static String socketOrigin(String scheme, String host, int port) {
        String s = scheme.toLowerCase(Locale.ROOT);
        String ws = "https".equals(s) ? "wss" : "ws";
        return ws + "://" + host.toLowerCase(Locale.ROOT) + portSuffix(s, port);
    }

    private static String portSuffix(String scheme, int port) {
        boolean defaultPort = port < 0
            || ("http".equals(scheme) && port == 80)
            || ("https".equals(scheme) && port == 443);
        return defaultPort ? "" : ":" + port;
    }

    /** CSP host-source grammar: labels of letters, digits and hyphens. */
    static boolean isPolicyHost(String host) {
        if (host == null || host.isEmpty() || host.startsWith(".") || host.endsWith(".")) {
            return false;
        }
        for (String label : host.split("\\.", -1)) {
            if (label.isEmpty()) {
                return false;
            }
            for (int i = 0; i < label.length(); i++) {
                char c = label.charAt(i);
                boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
                if (!ok) {
                    return false;
                }
            }
        }
        return true;
    }

    /** type/subtype, each an HTTP token. */
    private static boolean isMimeType(String mime) {
        int slash = mime.indexOf('/');
        return slash > 0
            && slash < mime.length() - 1
            && isToken(mime.substring(0, slash))
            && isToken(mime.substring(slash + 1));
    }

    /** An HTTP token (header name, charset): visible ASCII with no separators. */
    private static boolean isToken(String name) {
        if (name.isEmpty()) {
            return false;
        }
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c <= 0x20 || c >= 0x7f || "()<>@,;:\\\"/[]?={}".indexOf(c) >= 0) {
                return false;
            }
        }
        return true;
    }

    /** The value without control characters (tab aside), which no header value may carry. */
    private static String withoutControls(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\t' || (c >= 0x20 && c != 0x7f)) {
                out.append(c);
            }
        }
        return out.toString();
    }
}
