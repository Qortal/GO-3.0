package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ProxySelector;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * Runs the native frame-page fetch against a local server standing in for the
 * node. The stand-in is plain java.net (no com.sun.net.httpserver), so the
 * test compiles against android.jar like the rest of the unit tests.
 */
public class QappDocumentFetcherTest {
    private static final String NODE_POLICY =
        "default-src 'self' 'unsafe-inline' 'unsafe-eval'; font-src 'self' data:; "
            + "media-src 'self' data: blob: http://127.0.0.1:* http://localhost:*; "
            + "img-src 'self' data: blob:; connect-src 'self' wss: blob:;";

    private static final String LONG_UNTYPED_PAGE;

    static {
        StringBuilder page = new StringBuilder("<!DOCTYPE html>\n<html><head><meta charset=\"UTF-8\"><title>Loading</title></head><body>");
        for (int i = 0; i < 3000; i++) page.append('x');
        LONG_UNTYPED_PAGE = page.append("</body></html>").toString();
    }

    private StandInNode server;
    private String base;
    private final Map<String, Map<String, List<String>>> seenHeaders = new ConcurrentHashMap<>();
    private final AtomicInteger redirectTargetHits = new AtomicInteger();
    private final List<String> seenTargets = new CopyOnWriteArrayList<>();

    /** One reply of the stand-in node. */
    private static final class Reply {
        final int status;
        final String body;
        final List<String[]> headers = new ArrayList<>();
        long delayMs;

        Reply(int status, String type, String body) {
            this.status = status;
            this.body = body;
            if (type != null) header("Content-Type", type);
        }

        Reply header(String name, String value) {
            headers.add(new String[] {name, value});
            return this;
        }
    }

    private interface Handler {
        Reply handle(String target, Map<String, List<String>> headers);
    }

    /** HTTP/1.1 on 127.0.0.1, one request per connection, longest path prefix wins. */
    private static final class StandInNode {
        private final ServerSocket socket;
        private final Map<String, Handler> handlers = new LinkedHashMap<>();

        StandInNode() throws IOException {
            socket = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        }

        int port() {
            return socket.getLocalPort();
        }

        void on(String prefix, Handler handler) {
            handlers.put(prefix, handler);
        }

        void start() {
            Thread acceptor = new Thread(() -> {
                while (!socket.isClosed()) {
                    try {
                        Socket client = socket.accept();
                        Thread worker = new Thread(() -> serve(client));
                        worker.setDaemon(true);
                        worker.start();
                    } catch (IOException e) {
                        return;
                    }
                }
            });
            acceptor.setDaemon(true);
            acceptor.start();
        }

        void stop() throws IOException {
            socket.close();
        }

        private void serve(Socket client) {
            try (Socket s = client) {
                InputStream in = s.getInputStream();
                ByteArrayOutputStream head = new ByteArrayOutputStream();
                int b;
                while ((b = in.read()) != -1) {
                    head.write(b);
                    byte[] sofar = head.toByteArray();
                    int n = sofar.length;
                    if (n >= 4 && sofar[n - 4] == '\r' && sofar[n - 3] == '\n' && sofar[n - 2] == '\r' && sofar[n - 1] == '\n') break;
                }
                String[] lines = new String(head.toByteArray(), StandardCharsets.ISO_8859_1).split("\r\n");
                String[] requestLine = lines[0].split(" ");
                String target = requestLine[1];
                Map<String, List<String>> headers = new LinkedHashMap<>();
                for (int i = 1; i < lines.length; i++) {
                    int colon = lines[i].indexOf(':');
                    if (colon <= 0) continue;
                    headers.computeIfAbsent(lines[i].substring(0, colon), k -> new ArrayList<>()).add(lines[i].substring(colon + 1).trim());
                }
                int q = target.indexOf('?');
                String path = q < 0 ? target : target.substring(0, q);
                Handler handler = null;
                int best = -1;
                for (Map.Entry<String, Handler> h : handlers.entrySet()) {
                    if (path.startsWith(h.getKey()) && h.getKey().length() > best) {
                        handler = h.getValue();
                        best = h.getKey().length();
                    }
                }
                Reply reply = handler == null ? new Reply(404, "text/plain", "no handler") : handler.handle(target, headers);
                if (reply.delayMs > 0) Thread.sleep(reply.delayMs);
                byte[] body = reply.body.getBytes(StandardCharsets.UTF_8);
                StringBuilder out = new StringBuilder("HTTP/1.1 " + reply.status + " " + reason(reply.status) + "\r\n");
                for (String[] h : reply.headers) out.append(h[0]).append(": ").append(h[1]).append("\r\n");
                boolean bodyless = reply.status == 304 || reply.status == 204;
                if (!bodyless) out.append("Content-Length: ").append(body.length).append("\r\n");
                out.append("Connection: close\r\n\r\n");
                OutputStream os = s.getOutputStream();
                os.write(out.toString().getBytes(StandardCharsets.UTF_8));
                if (!bodyless) os.write(body);
                os.flush();
            } catch (IOException | InterruptedException | RuntimeException e) {
                // The client went away (the timeout test) or sent nonsense.
            }
        }

        private static String reason(int status) {
            switch (status) {
                case 200: return "OK";
                case 301: return "Moved Permanently";
                case 302: return "Found";
                case 304: return "Not Modified";
                case 307: return "Temporary Redirect";
                case 404: return "Not Found";
                case 503: return "Service Unavailable";
                default: return "Status";
            }
        }
    }

    @Before
    public void startNode() throws IOException {
        server = new StandInNode();
        server.on("/render/APP/Q-Tube", (target, headers) -> {
            seenHeaders.put("render", headers);
            return new Reply(200, "text/html;charset=utf-8", "<html><head></head><body>Q-Tube \u00e9</body></html>")
                .header("Content-Security-Policy", NODE_POLICY)
                .header("Set-Cookie", "tracker=1")
                .header("X-Frame-Options", "SAMEORIGIN");
        });
        server.on("/arbitrary/APP/x/default", (target, headers) -> new Reply(200, "text/html", "<p>no node policy</p>"));
        server.on("/missing", (target, headers) -> new Reply(404, "text/plain", "Error 404: File Not Found"));
        // As Core sends it: a 503 with no type and no policy.
        server.on("/loading", (target, headers) -> new Reply(503, null, LONG_UNTYPED_PAGE));
        server.on("/untyped-page", (target, headers) -> new Reply(200, null, LONG_UNTYPED_PAGE));
        server.on("/untyped-text", (target, headers) -> new Reply(200, null, "just some words"));
        server.on("/untyped-empty", (target, headers) -> new Reply(404, null, ""));
        server.on("/go/", (target, headers) -> {
            seenTargets.add(target);
            seenHeaders.put("go", headers);
            return new Reply(200, "text/html; charset=utf-8", "<p>ok</p>");
        });
        server.on("/moved", (target, headers) -> new Reply(302, null, "").header("Location", "/render/APP/Q-Tube/"));
        server.on("/render/APP/Q-Tube/", (target, headers) -> {
            redirectTargetHits.incrementAndGet();
            return new Reply(200, "text/html", "target");
        });
        server.on("/to-intent", (target, headers) -> new Reply(301, null, "").header("Location", "intent://scan/#Intent;scheme=zxing;end"));
        server.on("/no-location", (target, headers) -> new Reply(307, null, ""));
        server.on("/not-modified", (target, headers) -> new Reply(304, null, ""));
        server.on("/slow", (target, headers) -> {
            Reply late = new Reply(200, "text/html", "late");
            late.delayMs = 1500;
            return late;
        });
        server.start();
        base = "http://127.0.0.1:" + server.port();
    }

    @After
    public void stopNode() throws IOException {
        server.stop();
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        in.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static Map<String, String> navigationHeaders() {
        Map<String, String> h = new HashMap<>();
        h.put("Upgrade-Insecure-Requests", "1");
        h.put("Accept", "text/html,application/xhtml+xml");
        h.put("Referer", "http://localhost/");
        h.put("Cookie", "session=secret");
        h.put("Range", "bytes=0-");
        return h;
    }

    private static String header(Map<String, List<String>> headers, String name) {
        for (Map.Entry<String, List<String>> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) return e.getValue().get(0);
        }
        return null;
    }

    @Test
    public void qappPageComesBackWithBothPolicies() throws IOException {
        QappDocumentFetcher.Result r = QappDocumentFetcher.fetch(base + "/render/APP/Q-Tube?theme=dark&lang=en", navigationHeaders(), "Test WebView UA");
        assertEquals(200, r.status);
        assertEquals("OK", r.reason);
        assertEquals("text/html", r.mimeType);
        assertEquals("utf-8", r.charset);
        assertEquals("<html><head></head><body>Q-Tube é</body></html>", read(r.body));
        String expected = NODE_POLICY + ", " + QappFramePolicy.contentSecurityPolicy("http", "127.0.0.1", server.port());
        assertEquals(expected, r.headers.get("Content-Security-Policy"));
        // GO's own part names neither GO's origin nor any outside host.
        String goPart = r.headers.get("Content-Security-Policy").substring(NODE_POLICY.length() + 2);
        assertFalse(goPart.contains("localhost"));
        assertFalse(goPart.contains("wss:") && !goPart.contains("wss://"));
        assertEquals("SAMEORIGIN", r.headers.get("X-Frame-Options"));
        assertFalse(r.headers.containsKey("Set-Cookie"));
        assertFalse(r.headers.containsKey("Content-Type"));
        assertFalse(r.headers.containsKey("Content-Length"));

        Map<String, List<String>> sent = seenHeaders.get("render");
        assertEquals("Test WebView UA", header(sent, "User-Agent"));
        assertEquals("http://localhost/", header(sent, "Referer"));
        assertEquals("1", header(sent, "Upgrade-Insecure-Requests"));
        assertNull(header(sent, "Cookie"));
        assertNull(header(sent, "Range"));
    }

    @Test
    public void nodePageWithoutAPolicyGetsGos() throws IOException {
        QappDocumentFetcher.Result r = QappDocumentFetcher.fetch(base + "/arbitrary/APP/x/default", navigationHeaders(), null);
        assertEquals(200, r.status);
        assertEquals(
            QappFramePolicy.contentSecurityPolicy("http", "127.0.0.1", server.port()),
            r.headers.get("Content-Security-Policy")
        );
        assertEquals("<p>no node policy</p>", read(r.body));
    }

    @Test
    public void errorPagesKeepTheirStatusAndBody() throws IOException {
        QappDocumentFetcher.Result missing = QappDocumentFetcher.fetch(base + "/missing", navigationHeaders(), null);
        assertEquals(404, missing.status);
        assertEquals("text/plain", missing.mimeType);
        assertEquals("Error 404: File Not Found", read(missing.body));
        assertTrue(missing.headers.get("Content-Security-Policy").contains("connect-src"));

        // The WebView types only a 200 from the fields, so the server's type
        // goes along as a header on the others.
        assertEquals("text/plain", missing.headers.get("Content-Type"));
        QappDocumentFetcher.Result ok = QappDocumentFetcher.fetch(base + "/render/APP/Q-Tube", navigationHeaders(), null);
        assertFalse(ok.headers.containsKey("Content-Type"));
        read(ok.body);
    }

    @Test
    public void nodesUntypedLoadingPageIsHtml() throws IOException {
        // The node's "building the app" page: a 503 with no type that reloads
        // itself once the app is ready.
        QappDocumentFetcher.Result loading = QappDocumentFetcher.fetch(base + "/loading", navigationHeaders(), null);
        assertEquals(503, loading.status);
        assertEquals("Service Unavailable", loading.reason);
        assertEquals("text/html", loading.mimeType);
        assertNull(loading.charset);
        assertFalse(loading.headers.containsKey("Content-Type"));
        // Looking at the start did not eat any of the page.
        assertEquals(LONG_UNTYPED_PAGE, read(loading.body));
        assertEquals(
            QappFramePolicy.contentSecurityPolicy("http", "127.0.0.1", server.port()),
            loading.headers.get("Content-Security-Policy")
        );
    }

    @Test
    public void untypedRepliesAreTypedOnlyWhenTheyAreHtml() throws IOException {
        QappDocumentFetcher.Result page = QappDocumentFetcher.fetch(base + "/untyped-page", navigationHeaders(), null);
        assertEquals(200, page.status);
        assertEquals("text/html", page.mimeType);
        assertEquals(LONG_UNTYPED_PAGE, read(page.body));

        // Anything else is left for the WebView's own sniffer.
        QappDocumentFetcher.Result text = QappDocumentFetcher.fetch(base + "/untyped-text", navigationHeaders(), null);
        assertEquals(200, text.status);
        assertNull(text.mimeType);
        assertEquals("just some words", read(text.body));

        QappDocumentFetcher.Result empty = QappDocumentFetcher.fetch(base + "/untyped-empty", navigationHeaders(), null);
        assertEquals(404, empty.status);
        assertNull(empty.mimeType);
        assertEquals("", read(empty.body));
    }

    @Test
    public void addressesChromiumLeavesUnescapedStillLoad() throws IOException {
        String[][] cases = {
            {"/go/x?q=a|b", "/go/x?q=a%7Cb"},
            {"/go/x?q={%22a%22:[1,2]}", "/go/x?q=%7B%22a%22:%5B1,2%5D%7D"},
            {"/go/a[f]", "/go/a%5Bf%5D"},
            {"/go/x?q=a^b", "/go/x?q=a%5Eb"},
            {"/go/x?q=x`y", "/go/x?q=x%60y"},
            {"/go/x?q=a\\b", "/go/x?q=a%5Cb"},
            {"/go/x?q=50%off", "/go/x?q=50%25off"},
            {"/go/x?tags[]=a&tags[]=b", "/go/x?tags%5B%5D=a&tags%5B%5D=b"},
            {"/go/x#a{b}", "/go/x"},
            {"/go/x?q=ok%20fine", "/go/x?q=ok%20fine"},
            {"/go/APP/Q-Tube/?theme=dark&lang=en", "/go/APP/Q-Tube/?theme=dark&lang=en"},
        };
        for (String[] c : cases) {
            seenTargets.clear();
            QappDocumentFetcher.Result r = QappDocumentFetcher.fetch(base + c[0], navigationHeaders(), null);
            assertEquals(c[0], 200, r.status);
            assertEquals(c[0], "<p>ok</p>", read(r.body));
            assertEquals(c[0], Collections.singletonList(c[1]), new ArrayList<>(seenTargets));
            // The policy is still the node's origin.
            assertEquals(
                c[0],
                QappFramePolicy.contentSecurityPolicy("http", "127.0.0.1", server.port()),
                r.headers.get("Content-Security-Policy")
            );
        }
    }

    @Test
    public void phoneModelOutsideAsciiDoesNotBlankTheFrame() throws IOException {
        String ua = "Mozilla/5.0 (Linux; Android 14; \u041d\u043e\u0443\u0442 X\u00e9) Chrome/130";
        QappDocumentFetcher.Result r = QappDocumentFetcher.fetch(base + "/go/ua", navigationHeaders(), ua);
        assertEquals(200, r.status);
        read(r.body);
        assertEquals("Mozilla/5.0 (Linux; Android 14; ???? X?) Chrome/130", header(seenHeaders.get("go"), "User-Agent"));
    }

    @Test
    public void redirectBecomesAPageThatMovesTheFrame() throws IOException {
        QappDocumentFetcher.Result r = QappDocumentFetcher.fetch(base + "/moved", navigationHeaders(), null);
        assertEquals(200, r.status);
        assertEquals("text/html", r.mimeType);
        String page = read(r.body);
        assertTrue(page, page.contains("url='" + base + "/render/APP/Q-Tube/'"));
        // The target is not fetched here: the frame asks for it next, and GO covers that load too.
        assertEquals(0, redirectTargetHits.get());
        assertEquals(
            QappFramePolicy.contentSecurityPolicy("http", "127.0.0.1", server.port()),
            r.headers.get("Content-Security-Policy")
        );
        assertEquals("no-store", r.headers.get("Cache-Control"));
    }

    @Test
    public void redirectsGoNowhereButTheWeb() throws IOException {
        QappDocumentFetcher.Result intent = QappDocumentFetcher.fetch(base + "/to-intent", navigationHeaders(), null);
        assertEquals(502, intent.status);
        assertEquals("", read(intent.body));
        assertEquals("sandbox; default-src 'none'", intent.headers.get("Content-Security-Policy"));

        assertEquals(502, QappDocumentFetcher.fetch(base + "/no-location", navigationHeaders(), null).status);
        assertEquals(502, QappDocumentFetcher.fetch(base + "/not-modified", navigationHeaders(), null).status);
    }

    @Test
    public void unreachableServerGivesAnEmptyCoveredError() throws IOException {
        int closedPort;
        try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            closedPort = socket.getLocalPort();
        }
        QappDocumentFetcher.Result r = QappDocumentFetcher.fetch("http://127.0.0.1:" + closedPort + "/render/APP/x", navigationHeaders(), null);
        assertEquals(502, r.status);
        assertEquals("Bad Gateway", r.reason);
        assertEquals("", read(r.body));
        assertEquals("sandbox; default-src 'none'", r.headers.get("Content-Security-Policy"));
    }

    @Test
    public void slowServerTimesOutCovered() throws IOException {
        QappDocumentFetcher.Result r = QappDocumentFetcher.fetch(base + "/slow", navigationHeaders(), null, 2000, 300);
        assertEquals(504, r.status);
        assertEquals("Gateway Timeout", r.reason);
        assertEquals("sandbox; default-src 'none'", r.headers.get("Content-Security-Policy"));
    }

    @Test
    public void privateNodeOnThePhoneIsFetchedPastTheCarrierProxy() throws IOException {
        // On mobile data Android hands every address, 127.0.0.1 included, to
        // the carrier's APN proxy; the owner's carrier runs squid ("mproxy"),
        // which answered for a node it cannot reach.
        ProxySelector system = ProxySelector.getDefault();
        try (RecordingHttpServer carrierProxy = new RecordingHttpServer((target, headers) -> RecordingHttpServer.squidRefusal(target))) {
            ProxySelector.setDefault(RecordingHttpServer.androidLikeSelector(carrierProxy.port()));
            try {
                // The stand-in reproduces the phone: a plain connection goes to the proxy.
                HttpURLConnection plain = (HttpURLConnection) new URL(base + "/render/APP/Q-Tube").openConnection();
                assertEquals(503, plain.getResponseCode());
                plain.disconnect();
                assertEquals(Collections.singletonList(base + "/render/APP/Q-Tube"), carrierProxy.targets());
                carrierProxy.requests.clear();

                QappDocumentFetcher.Result r = QappDocumentFetcher.fetch(base + "/render/APP/Q-Tube?theme=dark", navigationHeaders(), "Test WebView UA");
                assertEquals(200, r.status);
                assertEquals("<html><head></head><body>Q-Tube \u00e9</body></html>", read(r.body));
                assertEquals("Test WebView UA", header(seenHeaders.get("render"), "User-Agent"));
                assertTrue(carrierProxy.requests.isEmpty());

                // A node elsewhere still goes through the proxy, as the WebView's own loads do.
                QappDocumentFetcher.Result remote = QappDocumentFetcher.fetch("http://remote-node.invalid:12391/render/APP/Torq", navigationHeaders(), null);
                assertEquals(503, remote.status);
                assertTrue(read(remote.body).contains("Generated by mproxy"));
                assertEquals(Collections.singletonList("http://remote-node.invalid:12391/render/APP/Torq"), carrierProxy.targets());
            } finally {
                ProxySelector.setDefault(system);
            }
        }
    }

    @Test
    public void addressesThatAreNotWebPagesAreNotFetched() {
        assertEquals(502, QappDocumentFetcher.fetch("file:///etc/hosts", navigationHeaders(), null).status);
        assertEquals(502, QappDocumentFetcher.fetch("not a url", navigationHeaders(), null).status);
        assertEquals(502, QappDocumentFetcher.fetch(null, navigationHeaders(), null).status);
    }
}
