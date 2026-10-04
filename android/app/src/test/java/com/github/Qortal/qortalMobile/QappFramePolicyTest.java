package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

public class QappFramePolicyTest {
    private static final Map<String, String> NAVIGATION = new HashMap<>();
    private static final Map<String, String> SUBRESOURCE = new HashMap<>();

    static {
        NAVIGATION.put("Upgrade-Insecure-Requests", "1");
        NAVIGATION.put("Accept", "text/html");
        SUBRESOURCE.put("Accept", "image/*");
    }

    private static AppOriginGuardPolicy.Request req(String scheme, String host, int port, String path, boolean mainFrame, Map<String, String> headers) {
        AppOriginGuardPolicy.Request r = new AppOriginGuardPolicy.Request();
        r.scheme = scheme;
        r.host = host;
        r.port = port;
        r.path = path;
        r.mainFrame = mainFrame;
        r.headers = headers;
        return r;
    }

    private static boolean fetched(AppOriginGuardPolicy.Request r, String method) {
        return QappFramePolicy.fetchesFrameDocument(r, method, "http", "localhost", -1);
    }

    /** directive name -> its sources, from one policy. */
    private static Map<String, List<String>> parse(String policy) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (String directive : policy.split(";")) {
            String[] tokens = directive.trim().split("\\s+");
            if (tokens.length == 0 || tokens[0].isEmpty()) continue;
            out.put(tokens[0], new ArrayList<>(Arrays.asList(tokens).subList(1, tokens.length)));
        }
        return out;
    }

    // --- Which requests GO fetches itself ---

    @Test
    public void qappAndQdnFramePagesAreFetchedByGo() {
        assertTrue(fetched(req("http", "127.0.0.1", 12391, "/render/APP/Q-Tube", false, NAVIGATION), "GET"));
        assertTrue(fetched(req("https", "ext-node.qortal.link", -1, "/render/WEBSITE/site/", false, NAVIGATION), "GET"));
        // Any page the frame moves to, on the node or elsewhere.
        assertTrue(fetched(req("http", "127.0.0.1", 12391, "/arbitrary/APP/x/default", false, NAVIGATION), "GET"));
        assertTrue(fetched(req("https", "example.com", -1, "/", false, NAVIGATION), "get"));
        // Same host as GO on another port is another origin.
        assertTrue(fetched(req("http", "localhost", 12391, "/render/APP/x", false, NAVIGATION), "GET"));
    }

    @Test
    public void goItselfAndSubResourcesAreLeftToTheWebView() {
        // The main frame is GO.
        assertFalse(fetched(req("http", "localhost", -1, "/", true, NAVIGATION), "GET"));
        assertFalse(fetched(req("https", "example.com", -1, "/", true, NAVIGATION), "GET"));
        // Images, scripts, fetch(): no navigation header.
        assertFalse(fetched(req("http", "127.0.0.1", 12391, "/render/APP/x/a.png", false, SUBRESOURCE), "GET"));
        assertFalse(fetched(req("http", "127.0.0.1", 12391, "/render/APP/x/a.png", false, null), "GET"));
        // A form post: the body is not available to GO.
        assertFalse(fetched(req("http", "127.0.0.1", 12391, "/render/APP/x", false, NAVIGATION), "POST"));
        assertFalse(fetched(req("http", "127.0.0.1", 12391, "/render/APP/x", false, NAVIGATION), null));
        // GO's own origin is AppOriginGuardPolicy's business.
        assertFalse(fetched(req("http", "localhost", -1, "/index.html", false, NAVIGATION), "GET"));
        assertFalse(fetched(req("HTTP", "LOCALHOST", 80, "/index.html", false, NAVIGATION), "GET"));
        // Not a web address.
        assertFalse(fetched(req("data", null, -1, "text/html,x", false, NAVIGATION), "GET"));
        assertFalse(fetched(req("blob", null, -1, "http://127.0.0.1:12391/uuid", false, NAVIGATION), "GET"));
        assertFalse(fetched(null, "GET"));
    }

    @Test
    public void serviceWorkerScriptsAreRecognised() {
        Map<String, String> sw = new HashMap<>();
        sw.put("service-worker", " Script ");
        assertTrue(QappFramePolicy.isServiceWorkerScript(sw));
        sw.put("service-worker", "navigation-preload");
        assertFalse(QappFramePolicy.isServiceWorkerScript(sw));
        assertFalse(QappFramePolicy.isServiceWorkerScript(NAVIGATION));
        assertFalse(QappFramePolicy.isServiceWorkerScript(null));
        // And they are never fetched as a page.
        Map<String, String> both = new HashMap<>(NAVIGATION);
        both.put("Service-Worker", "script");
        assertFalse(fetched(req("http", "127.0.0.1", 12391, "/render/APP/x/sw.js", false, both), "GET"));
    }

    // --- The order AppOriginGuardWebViewClient applies ---

    private static QappFramePolicy.Decision decide(AppOriginGuardPolicy.Request r, String method) {
        return QappFramePolicy.decide(r, method, "http", "localhost", -1);
    }

    private static Map<String, String> with(Map<String, String> base, String name, String value) {
        Map<String, String> out = new HashMap<>(base);
        out.put(name, value);
        return out;
    }

    @Test
    public void decisionsComeInOrder() {
        // 1. GO's own origin: a frame page there, any Capacitor proxy path.
        assertEquals(QappFramePolicy.Decision.REFUSE_APP_ORIGIN, decide(req("http", "localhost", -1, "/index.html", false, NAVIGATION), "GET"));
        assertEquals(
            QappFramePolicy.Decision.REFUSE_APP_ORIGIN,
            decide(req("http", "127.0.0.1", 12391, "/_capacitor_http_interceptor_", false, with(NAVIGATION, "Service-Worker", "script")), "GET")
        );
        // 2. Service worker scripts, even when they also look like a frame page.
        assertEquals(
            QappFramePolicy.Decision.REFUSE_SERVICE_WORKER,
            decide(req("http", "127.0.0.1", 12391, "/render/APP/x/sw.js", false, with(NAVIGATION, "Service-Worker", "script")), "GET")
        );
        // 3. Prefetches to another origin, before the frame-page rule.
        assertEquals(
            QappFramePolicy.Decision.REFUSE_PREFETCH,
            decide(req("https", "attacker.example", -1, "/hit", false, with(NAVIGATION, "Purpose", "prefetch")), "GET")
        );
        assertEquals(
            QappFramePolicy.Decision.REFUSE_PREFETCH,
            decide(req("http", "127.0.0.1", 12391, "/render/APP/x/a.js", false, with(SUBRESOURCE, "Sec-Purpose", "prefetch;anonymous-client-ip")), "GET")
        );
        // 4. Frame pages are fetched by GO.
        assertEquals(QappFramePolicy.Decision.FETCH_FRAME_PAGE, decide(req("http", "127.0.0.1", 12391, "/render/APP/x", false, NAVIGATION), "GET"));
        // 5. Everything else as before.
        assertEquals(QappFramePolicy.Decision.PASS, decide(req("http", "localhost", -1, "/", true, NAVIGATION), "GET"));
        assertEquals(QappFramePolicy.Decision.PASS, decide(req("http", "localhost", -1, "/assets/a.js", false, SUBRESOURCE), "GET"));
        assertEquals(QappFramePolicy.Decision.PASS, decide(req("http", "127.0.0.1", 12391, "/render/APP/x/a.png", false, SUBRESOURCE), "GET"));
        assertEquals(QappFramePolicy.Decision.PASS, decide(req("http", "127.0.0.1", 12391, "/render/APP/x", false, NAVIGATION), "POST"));
        assertEquals(QappFramePolicy.Decision.PASS, decide(null, "GET"));
    }

    @Test
    public void prefetchIsRefusedOnlyOffGosOrigin() {
        Map<String, String> prefetch = with(SUBRESOURCE, "purpose", " Prefetch ");
        assertTrue(QappFramePolicy.isPrefetch(prefetch));
        assertTrue(QappFramePolicy.isPrefetch(with(SUBRESOURCE, "Sec-Purpose", "prefetch")));
        assertFalse(QappFramePolicy.isPrefetch(with(SUBRESOURCE, "Purpose", "preview")));
        assertFalse(QappFramePolicy.isPrefetch(with(SUBRESOURCE, "X-Purpose", "prefetch")));
        assertFalse(QappFramePolicy.isPrefetch(with(SUBRESOURCE, "Purpose", null)));
        assertFalse(QappFramePolicy.isPrefetch(SUBRESOURCE));
        assertFalse(QappFramePolicy.isPrefetch(null));
        // GO's own page may prefetch its own files.
        assertFalse(QappFramePolicy.refusesPrefetch(req("http", "localhost", -1, "/assets/a.js", false, prefetch), "http", "localhost", -1));
        assertEquals(QappFramePolicy.Decision.PASS, decide(req("http", "localhost", 80, "/assets/a.js", false, prefetch), "GET"));
        // Anywhere else, the node included, it is refused.
        assertTrue(QappFramePolicy.refusesPrefetch(req("http", "127.0.0.1", 12391, "/x", false, prefetch), "http", "localhost", -1));
        assertTrue(QappFramePolicy.refusesPrefetch(req("http", "localhost", 8080, "/x", false, prefetch), "http", "localhost", -1));
        assertTrue(QappFramePolicy.refusesPrefetch(req(null, null, -1, null, false, prefetch), "http", "localhost", -1));
        assertFalse(QappFramePolicy.refusesPrefetch(null, "http", "localhost", -1));
    }

    // --- N-39: frame links to other apps ---

    @Test
    public void onlyFramesAreHeldToTheSchemeRule() {
        assertTrue(QappFramePolicy.blocksFrameNavigation(false, "intent"));
        assertTrue(QappFramePolicy.blocksFrameNavigation(false, null));
        assertFalse(QappFramePolicy.blocksFrameNavigation(false, "https"));
        assertFalse(QappFramePolicy.blocksFrameNavigation(false, "qortal"));
        // GO's own page keeps Capacitor's handling (N-39's main-frame part is elsewhere).
        assertFalse(QappFramePolicy.blocksFrameNavigation(true, "intent"));
        assertFalse(QappFramePolicy.blocksFrameNavigation(true, "mailto"));
    }

    @Test
    public void framesCannotOpenOtherApps() {
        String[] blocked = {
            "intent", "market", "tel", "sms", "smsto", "mailto", "file", "content", "javascript",
            "about", "googlechrome", "geo", "whatsapp", "android-app", "INTENT", "", null,
        };
        for (String scheme : blocked) {
            assertTrue(String.valueOf(scheme), QappFramePolicy.blocksFrameNavigation(scheme));
        }
    }

    @Test
    public void frameLinksThatStayInGoKeepWorking() {
        for (String scheme : new String[] {"http", "https", "HTTPS", "data", "blob", "qortal", "QORTAL"}) {
            assertFalse(scheme, QappFramePolicy.blocksFrameNavigation(scheme));
        }
    }

    // --- GO's policy for a frame page ---

    @Test
    public void localNodePolicyKeepsTheAppToTheNode() {
        String policy = QappFramePolicy.contentSecurityPolicy("http", "127.0.0.1", 12391);
        Map<String, List<String>> d = parse(policy);
        String node = "http://127.0.0.1:12391";
        assertEquals(Arrays.asList("'self'", node, "ws://127.0.0.1:12391", "data:", "blob:"), d.get("connect-src"));
        assertEquals(Arrays.asList("'self'", node, "data:", "blob:"), d.get("default-src"));
        assertEquals(Arrays.asList("'self'", node, "data:", "blob:"), d.get("img-src"));
        assertEquals(Arrays.asList("'self'", node, "data:", "blob:"), d.get("frame-src"));
        assertEquals(Arrays.asList("'self'", node, "data:", "blob:", "http://127.0.0.1:*"), d.get("media-src"));
        assertEquals(Arrays.asList(node + "/render/", "data:", "blob:"), d.get("worker-src"));
        assertEquals(Arrays.asList("'self'", node), d.get("form-action"));
        assertEquals(Arrays.asList("'self'", node), d.get("object-src"));
        assertTrue(d.get("script-src").containsAll(Arrays.asList("'self'", node, "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'")));
        assertTrue(d.get("style-src").containsAll(Arrays.asList("'self'", node, "'unsafe-inline'")));
    }

    @Test
    public void httpsGatewayGetsSecureSocketsAndNoDefaultPort() {
        Map<String, List<String>> d = parse(QappFramePolicy.contentSecurityPolicy("https", "Ext-Node.Qortal.Link", 443));
        assertEquals(
            Arrays.asList("'self'", "https://ext-node.qortal.link", "wss://ext-node.qortal.link", "data:", "blob:"),
            d.get("connect-src")
        );
        assertEquals(Arrays.asList("https://ext-node.qortal.link/render/", "data:", "blob:"), d.get("worker-src"));
        Map<String, List<String>> http80 = parse(QappFramePolicy.contentSecurityPolicy("http", "node.lan", 80));
        assertEquals(Arrays.asList("'self'", "http://node.lan", "ws://node.lan", "data:", "blob:"), http80.get("connect-src"));
    }

    @Test
    public void policyNamesNoOtherHostAndNoBareScheme() {
        // The node sends connect-src 'self' wss: blob:, which lets an app open
        // a WebSocket to any host. GO's policy must name nothing beyond the
        // frame's origin, data:, blob: and GO's media server.
        Set<String> allowed = new HashSet<>(
            Arrays.asList(
                "'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "data:", "blob:",
                "https://node.example:8443", "wss://node.example:8443", "https://node.example:8443/render/"
            )
        );
        Map<String, List<String>> d = parse(QappFramePolicy.contentSecurityPolicy("https", "node.example", 8443));
        for (Map.Entry<String, List<String>> directive : d.entrySet()) {
            for (String source : directive.getValue()) {
                if ("media-src".equals(directive.getKey()) && "http://127.0.0.1:*".equals(source)) continue;
                assertTrue(directive.getKey() + " has " + source, allowed.contains(source));
            }
        }
        // Every kind of contact is named, so none falls back to something wider.
        for (String name : new String[] {
            "default-src", "script-src", "style-src", "img-src", "font-src", "media-src", "connect-src",
            "worker-src", "frame-src", "object-src", "manifest-src", "form-action",
        }) {
            assertTrue(name, d.containsKey(name));
        }
        // Not GO's own origin (http://localhost serves GO's private files).
        assertFalse(QappFramePolicy.contentSecurityPolicy("http", "127.0.0.1", 12391).contains("localhost"));
        // Nothing that reports anywhere, and no comma (that would start a new policy).
        String text = QappFramePolicy.contentSecurityPolicy("http", "127.0.0.1", 12391);
        assertFalse(text.contains("report-"));
        assertFalse(text.contains(","));
    }

    @Test
    public void hostsAPolicyCannotNameFallBackToSelf() {
        for (String host : new String[] {"::1", "fe80::1", "my_node.local", "nöde.example", "a..b", ".x", "x.", ""}) {
            Map<String, List<String>> d = parse(QappFramePolicy.contentSecurityPolicy("http", host, 12391));
            assertEquals(host, Arrays.asList("'self'", "data:", "blob:"), d.get("connect-src"));
            assertEquals(host, Arrays.asList("'self'", "data:", "blob:"), d.get("worker-src"));
            assertEquals(host, Arrays.asList("'self'"), d.get("form-action"));
        }
        assertTrue(QappFramePolicy.isPolicyHost("node-1.example.org"));
        assertFalse(QappFramePolicy.isPolicyHost(null));
        assertNull(QappFramePolicy.sourceOrigin("ftp", "node.example", 21));
    }

    // --- Headers ---

    @Test
    public void requestHeadersDropCookiesCachingAndEncoding() {
        Map<String, String> in = new HashMap<>();
        in.put("Upgrade-Insecure-Requests", "1");
        in.put("Accept", "text/html");
        in.put("Referer", "http://127.0.0.1:12391/render/APP/x/");
        in.put("User-Agent", "Mozilla/5.0 WebView");
        in.put("Cookie", "a=b");
        in.put("Accept-Encoding", "gzip, br");
        in.put("If-None-Match", "\"abc\"");
        in.put("If-Modified-Since", "Tue, 01 Oct 2026 00:00:00 GMT");
        in.put("Range", "bytes=0-");
        in.put("Host", "evil.example");
        in.put("Proxy-Authorization", "Basic x");
        in.put("Connection", "keep-alive");
        in.put("Bad Name", "x");
        in.put("X-Multi", "a\r\nInjected: 1");
        in.put("X-Nul", "a\u0000b");
        in.put("X-Tab", "a\tb");
        Map<String, String> out = QappFramePolicy.requestHeaders(in, "Fallback UA");
        assertEquals("1", out.get("upgrade-insecure-requests"));
        assertEquals("text/html", out.get("Accept"));
        assertEquals("http://127.0.0.1:12391/render/APP/x/", out.get("Referer"));
        assertEquals("Mozilla/5.0 WebView", out.get("User-Agent"));
        assertEquals("a\tb", out.get("X-Tab"));
        for (String gone : new String[] {
            "Cookie", "Accept-Encoding", "If-None-Match", "If-Modified-Since", "Range", "Host", "Proxy-Authorization",
            "Connection", "Bad Name", "X-Multi", "X-Nul",
        }) {
            assertFalse(gone, out.containsKey(gone));
        }
    }

    @Test
    public void requestWithoutUserAgentGetsTheWebViews() {
        assertEquals("WebView UA", QappFramePolicy.requestHeaders(NAVIGATION, "WebView UA").get("user-agent"));
        assertFalse(QappFramePolicy.requestHeaders(null, null).containsKey("User-Agent"));
    }

    @Test
    public void headerValuesAndroidWouldRefuseNeverReachTheConnection() {
        // Android's HttpURLConnection throws on anything but visible ASCII,
        // space and tab; a phone model name in the user agent can be in any
        // script. The user agent is kept with '?' in their place.
        String model = "Mozilla/5.0 (Linux; Android 14; \u041d\u043e\u0443\u0442 X\u00e9) Chrome/130";
        assertEquals(
            "Mozilla/5.0 (Linux; Android 14; ???? X?) Chrome/130",
            QappFramePolicy.requestHeaders(NAVIGATION, model).get("User-Agent")
        );
        Map<String, String> in = new HashMap<>(NAVIGATION);
        in.put("User-Agent", "UA\r\nX: 1\u0000");
        in.put("Accept-Language", "fr-\u00c9");
        Map<String, String> out = QappFramePolicy.requestHeaders(in, "Fallback");
        assertEquals("UA??X: 1?", out.get("User-Agent"));
        assertFalse(out.containsKey("Accept-Language"));
        for (Map.Entry<String, String> header : out.entrySet()) {
            for (char c : header.getValue().toCharArray()) {
                assertTrue(header.getKey(), c == '\t' || (c >= 0x20 && c < 0x7f));
            }
        }
    }

    @Test
    public void responseHeadersKeepTheNodesPolicyAndAddGos() {
        Map<String, List<String>> in = new HashMap<>();
        in.put(null, Collections.singletonList("HTTP/1.1 200 OK"));
        in.put(
            "Content-Security-Policy",
            Collections.singletonList("default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' wss: blob:;")
        );
        in.put("Content-Type", Collections.singletonList("text/html; charset=utf-8"));
        in.put("Content-Length", Collections.singletonList("1234"));
        in.put("Content-Encoding", Collections.singletonList("gzip"));
        in.put("Transfer-Encoding", Collections.singletonList("chunked"));
        in.put("Connection", Collections.singletonList("close"));
        in.put("Set-Cookie", Arrays.asList("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT", "b=2"));
        in.put("X-Android-Received-Millis", Collections.singletonList("1"));
        in.put("Vary", Arrays.asList("Accept", "Origin"));
        in.put("vary", Collections.singletonList("Range"));
        in.put("X-Frame-Options", Collections.singletonList("SAME\u0000ORIGIN\r\n"));
        in.put("Content-Disposition", Collections.singletonList("inline"));
        in.put("X-Tabbed", Collections.singletonList("a\tb\u007f\u0001"));
        Map<String, String> out = QappFramePolicy.responseHeaders(in, "GO-POLICY");
        assertEquals("a\tb", out.get("X-Tabbed"));
        assertEquals(
            "default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' wss: blob:;, GO-POLICY",
            out.get("Content-Security-Policy")
        );
        assertEquals("SAMEORIGIN", out.get("X-Frame-Options"));
        assertEquals("inline", out.get("Content-Disposition"));
        assertTrue(out.get("Vary").contains("Accept") && out.get("Vary").contains("Origin") && out.get("Vary").contains("Range"));
        for (String gone : new String[] {
            "Content-Type", "Content-Length", "Content-Encoding", "Transfer-Encoding", "Connection", "Set-Cookie",
            "X-Android-Received-Millis",
        }) {
            assertFalse(gone, out.containsKey(gone));
        }
    }

    @Test
    public void responseWithoutAPolicyGetsGosAlone() {
        Map<String, String> out = QappFramePolicy.responseHeaders(Collections.<String, List<String>>emptyMap(), "GO-POLICY");
        assertEquals("GO-POLICY", out.get("content-security-policy"));
        Map<String, List<String>> two = new HashMap<>();
        two.put("content-security-policy", Arrays.asList("a 'self'", " ", "b 'none'"));
        assertEquals("a 'self', b 'none', GO-POLICY", QappFramePolicy.responseHeaders(two, "GO-POLICY").get("Content-Security-Policy"));
        assertEquals("GO-POLICY", QappFramePolicy.responseHeaders(null, "GO-POLICY").get("Content-Security-Policy"));
    }

    @Test
    public void contentTypeSplitsIntoMimeAndCharset() {
        assertEquals(Arrays.asList("text/html", "utf-8"), Arrays.asList(QappFramePolicy.mimeAndCharset("text/html; charset=utf-8")));
        assertEquals(Arrays.asList("text/html", "UTF-8"), Arrays.asList(QappFramePolicy.mimeAndCharset("Text/HTML;Charset=\"UTF-8\"")));
        assertEquals(Arrays.asList("text/html", null), Arrays.asList(QappFramePolicy.mimeAndCharset("text/html")));
        assertEquals(Arrays.asList("image/svg+xml", null), Arrays.asList(QappFramePolicy.mimeAndCharset("image/svg+xml; q=1")));
        assertEquals(Arrays.asList(null, null), Arrays.asList(QappFramePolicy.mimeAndCharset(null)));
        assertEquals(Arrays.asList(null, "utf-8"), Arrays.asList(QappFramePolicy.mimeAndCharset(" ; charset=utf-8")));
        // Not well formed: left out rather than handed to the WebView.
        assertEquals(Arrays.asList(null, null), Arrays.asList(QappFramePolicy.mimeAndCharset("text")));
        assertEquals(Arrays.asList(null, null), Arrays.asList(QappFramePolicy.mimeAndCharset("text/ html")));
        assertEquals(Arrays.asList(null, null), Arrays.asList(QappFramePolicy.mimeAndCharset("/html")));
        assertEquals(Arrays.asList("text/html", null), Arrays.asList(QappFramePolicy.mimeAndCharset("text/html; charset=utf 8")));
        assertEquals(Arrays.asList("text/html", null), Arrays.asList(QappFramePolicy.mimeAndCharset("text/html; charset=\u00e9")));
        assertEquals("text/plain; charset=utf-8", QappFramePolicy.contentTypeHeader("text/plain", "utf-8"));
        assertEquals("text/plain", QappFramePolicy.contentTypeHeader("text/plain", null));
        assertNull(QappFramePolicy.contentTypeHeader(null, "utf-8"));
    }

    private static boolean html(String start) {
        byte[] bytes = start.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return QappFramePolicy.looksLikeHtml(bytes, bytes.length);
    }

    @Test
    public void untypedRepliesThatStartLikeHtmlAreHtml() {
        // The node's "building the app" page (a 503 with no type).
        assertTrue(html("<!DOCTYPE html>\n<html lang=\"en\">"));
        assertTrue(html("\r\n \t<!doctype html><head>"));
        assertTrue(html("<HTML>"));
        assertTrue(html("<html lang=en>"));
        assertTrue(html("<!-- note -->"));
        assertTrue(html("<script>x()</script>"));
        assertTrue(html("<p>hi"));
        assertTrue(html("<b>"));
        assertTrue(html("<body>"));
        // Chromium matches a plain prefix, with no check of what follows.
        assertTrue(html("<bold>"));
        assertTrue(html("<html"));
        assertTrue(html("<!--x-->"));
        assertFalse(html("Error 404: File Not Found"));
        assertFalse(html("{\"a\":1}"));
        // XML (Chromium: text/xml), images and the rest are the WebView's to sniff.
        assertFalse(html("<?xml version=\"1.0\"?><svg>"));
        assertFalse(html("<svg xmlns=\"http://www.w3.org/2000/svg\">"));
        assertFalse(html("\u0089PNG"));
        assertFalse(html(""));
        assertFalse(html("   "));
        assertFalse(QappFramePolicy.looksLikeHtml(null, 0));
        // Only the bytes that were read count.
        byte[] page = "<html>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        assertFalse(QappFramePolicy.looksLikeHtml(page, 4));
        assertTrue(QappFramePolicy.looksLikeHtml(page, 5));
        assertTrue(QappFramePolicy.looksLikeHtml(page, 99));
    }

    // --- The address GO's fetch asks for ---

    @Test
    public void wireUrlEscapesWhatChromiumLeavesRaw() {
        String node = "http://127.0.0.1:12391";
        assertEquals(node + "/render/APP/x?q=a%7Cb", QappFramePolicy.wireUrl(node + "/render/APP/x?q=a|b"));
        assertEquals(node + "/x?q=%7B%22a%22:%5B1,2%5D%7D", QappFramePolicy.wireUrl(node + "/x?q={%22a%22:[1,2]}"));
        assertEquals(node + "/go/a%5Bf%5D", QappFramePolicy.wireUrl(node + "/go/a[f]"));
        assertEquals(node + "/x?q=a%5Eb", QappFramePolicy.wireUrl(node + "/x?q=a^b"));
        assertEquals(node + "/x?q=x%60y", QappFramePolicy.wireUrl(node + "/x?q=x`y"));
        assertEquals(node + "/x?q=a%5Cb", QappFramePolicy.wireUrl(node + "/x?q=a\\b"));
        assertEquals(node + "/x?q=50%25off", QappFramePolicy.wireUrl(node + "/x?q=50%off"));
        assertEquals(node + "/x?q=1%252", QappFramePolicy.wireUrl(node + "/x?q=1%2"));
        assertEquals(node + "/x?q=%25zz%252", QappFramePolicy.wireUrl(node + "/x?q=%zz%2"));
        assertEquals(node + "/x?tags%5B%5D=a&tags%5B%5D=b", QappFramePolicy.wireUrl(node + "/x?tags[]=a&tags[]=b"));
        assertEquals(node + "/x?q=%C3%A9%20%22", QappFramePolicy.wireUrl(node + "/x?q=\u00e9 \""));
        // Already valid: unchanged, escapes included.
        String valid = node + "/render/APP/Q-Tube/?theme=dark&lang=en&q=ok%20fine&x=a%2Fb;c=d:e@f!$'()*+,~";
        assertEquals(valid, QappFramePolicy.wireUrl(valid));
        // The #fragment is never sent.
        assertEquals(node + "/x", QappFramePolicy.wireUrl(node + "/x#a{b}"));
        assertEquals(node + "/x?y=1", QappFramePolicy.wireUrl(node + "/x?y=1#/route?z|2"));
        // A path of at least "/".
        assertEquals("https://ext-node.qortal.link/", QappFramePolicy.wireUrl("https://ext-node.qortal.link"));
        assertEquals("https://h/?a=1", QappFramePolicy.wireUrl("https://h?a=1"));
        assertEquals("http://h/", QappFramePolicy.wireUrl("http://h#x"));
        // Every result is an address java.net.URI accepts.
        for (String raw : new String[] {
            node + "/x?q=a|b", node + "/go/a[f]", node + "/x?q=a^b`c\\d{e}", node + "/x?q=50%off", node + "/%",
        }) {
            try {
                new java.net.URI(QappFramePolicy.wireUrl(raw));
            } catch (java.net.URISyntaxException e) {
                throw new AssertionError(raw, e);
            }
        }
    }

    @Test
    public void wireUrlIsOnlyForWebAddressesWithAHost() {
        assertNull(QappFramePolicy.wireUrl(null));
        assertNull(QappFramePolicy.wireUrl("file:///etc/hosts"));
        assertNull(QappFramePolicy.wireUrl("data:text/html,<a href=http://x>"));
        assertNull(QappFramePolicy.wireUrl("javascript:location='http://x'"));
        assertNull(QappFramePolicy.wireUrl("not a url"));
        assertNull(QappFramePolicy.wireUrl("http://"));
        assertNull(QappFramePolicy.wireUrl("http:///x"));
        assertNull(QappFramePolicy.wireUrl("http://bad host/x"));
        assertNull(QappFramePolicy.wireUrl("http://h\u00e9/x"));
        assertEquals("HTTPS://Node.Example:8443/x", QappFramePolicy.wireUrl("HTTPS://Node.Example:8443/x"));
    }

    @Test
    public void statusAndReasonAreOnesTheWebViewAccepts() {
        assertEquals(200, QappFramePolicy.responseStatus(200));
        assertEquals(404, QappFramePolicy.responseStatus(404));
        assertEquals(503, QappFramePolicy.responseStatus(503));
        assertEquals(502, QappFramePolicy.responseStatus(304));
        assertEquals(502, QappFramePolicy.responseStatus(100));
        assertEquals(502, QappFramePolicy.responseStatus(-1));
        assertEquals(502, QappFramePolicy.responseStatus(700));
        assertEquals("Service Unavailable", QappFramePolicy.reasonPhrase(503, null));
        assertEquals("Not Found", QappFramePolicy.reasonPhrase(404, "  "));
        assertEquals("OK", QappFramePolicy.reasonPhrase(200, "Déjà"));
        assertEquals("All good", QappFramePolicy.reasonPhrase(200, " All good "));
        assertEquals("Error", QappFramePolicy.reasonPhrase(418, "\t"));
        assertEquals("OK", QappFramePolicy.reasonPhrase(299, null));
    }

    // --- Redirects ---

    @Test
    public void redirectTargetsAreWebAddressesOnly() {
        assertEquals("http://127.0.0.1:12391/render/APP/x/", QappFramePolicy.redirectTarget("http://127.0.0.1:12391/render/APP/x", "/render/APP/x/"));
        assertEquals("https://example.com/a", QappFramePolicy.redirectTarget("http://127.0.0.1:12391/", "https://example.com/a"));
        assertNull(QappFramePolicy.redirectTarget("http://127.0.0.1:12391/", "intent://x#Intent;scheme=market;end"));
        assertNull(QappFramePolicy.redirectTarget("http://127.0.0.1:12391/", "javascript:alert(1)"));
        assertNull(QappFramePolicy.redirectTarget("http://127.0.0.1:12391/", null));
        assertNull(QappFramePolicy.redirectTarget("http://127.0.0.1:12391/", " "));
    }

    @Test
    public void redirectPageMovesTheFrameOnAndCannotBeBrokenOutOf() {
        String page = QappFramePolicy.redirectDocument("https://example.com/a?x=1&y='\"><script>alert(1)</script> é");
        assertTrue(page.contains("http-equiv=\"refresh\""));
        assertTrue(page.contains("url='https://example.com/a?x=1&amp;y=%27%22%3E%3Cscript%3Ealert(1)%3C/script%3E%20%C3%A9'"));
        assertFalse(page.contains("<script"));
        // Only the attribute quotes are left; none comes from the address.
        String inner = page.substring(page.indexOf("url='") + 5, page.indexOf("'\">"));
        assertFalse(inner.contains("'") || inner.contains("\"") || inner.contains("<") || inner.contains(">"));
        assertEquals("http://a/b%20c%25d", QappFramePolicy.percentEncodeUnsafe("http://a/b c%25d"));
    }
}
