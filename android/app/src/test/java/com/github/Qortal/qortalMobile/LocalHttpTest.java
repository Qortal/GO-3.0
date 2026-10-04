package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.ProtocolException;
import java.net.ProxySelector;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * GO's native connections reach the phone's own addresses direct, as the
 * WebView does, and keep the system proxy for everything else.
 */
public class LocalHttpTest {
    private ProxySelector systemSelector;
    private RecordingHttpServer proxy;
    private RecordingHttpServer node;
    private String nodeBase;

    @Before
    public void setUp() throws IOException {
        systemSelector = ProxySelector.getDefault();
        // The carrier's proxy: refuses whatever is local, serves the rest.
        proxy = new RecordingHttpServer((target, headers) -> {
            if (target.startsWith("http://127.") || target.startsWith("http://localhost")) {
                return RecordingHttpServer.squidRefusal(target);
            }
            if (target.equals("http://updates.invalid/go.apk")) {
                return new RecordingHttpServer.Reply(302, null, "")
                    .header("Location", nodeBase + "/files/go.apk");
            }
            return new RecordingHttpServer.Reply(200, "text/plain", "via proxy");
        });
        node = new RecordingHttpServer((target, headers) -> {
            if (target.equals("/moved")) {
                return new RecordingHttpServer.Reply(302, null, "").header("Location", "http://mirror.invalid/pack.bin");
            }
            if (target.equals("/to-https")) {
                return new RecordingHttpServer.Reply(301, null, "").header("Location", "https://mirror.invalid/pack.bin");
            }
            if (target.equals("/nowhere")) {
                return new RecordingHttpServer.Reply(302, null, "");
            }
            if (target.equals("/loop")) {
                return new RecordingHttpServer.Reply(307, null, "").header("Location", "/loop");
            }
            return new RecordingHttpServer.Reply(200, "text/plain", "from node");
        });
        nodeBase = "http://127.0.0.1:" + node.port();
        ProxySelector.setDefault(RecordingHttpServer.androidLikeSelector(proxy.port()));
    }

    @After
    public void tearDown() throws IOException {
        ProxySelector.setDefault(systemSelector);
        proxy.close();
        node.close();
    }

    private static String read(HttpURLConnection connection) throws IOException {
        InputStream in = connection.getResponseCode() >= 400 ? connection.getErrorStream() : connection.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        in.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    @Test
    public void privateNetworkHostsGoDirect() {
        for (String host : new String[] {
            "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254",
            "192.168.1.4", "100.64.0.1", "100.127.255.254", "100.101.102.103",
            "[fd7a:115c:a1e0::1]", "fd7a:115c:a1e0::1", "[fc00::1]",
            "mynode.tail1234.ts.net", "MyNode.Tail1234.TS.NET.",
        }) {
            assertTrue(host, LocalHttp.isPrivateNetworkHost(host));
        }
        for (String host : new String[] {
            "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.63.255.255", "100.128.0.1",
            "11.0.0.1", "8.8.8.8", "[fe00::1]", "[2001:db8::1]", "ts.net", "evil-ts.net",
            "ext-node.qortal.link", "10.0.0.1 ", "", null,
        }) {
            assertFalse(String.valueOf(host), LocalHttp.isPrivateNetworkHost(host));
        }
    }

    @Test
    public void bypassesWhatChromiumBypasses() {
        String[] direct = {
            "localhost",
            "LOCALHOST.",
            "Localhost",
            "foo.localhost",
            "Foo.LocalHost.",
            "a.b.localhost",
            "127.0.0.1",
            "127.0.0.1.",
            "127.255.255.254",
            "127.1.2.3",
            "[::1]",
            "::1",
            "[0:0:0:0:0:0:0:1]",
            "[::ffff:127.0.0.1]",
            "[::FFFF:127.9.8.7]",
            "[::ffff:7f00:1]",
            "[0:0:0:0:0:ffff:127.0.0.1]",
            "169.254.1.1",
            "169.254.0.0",
            "[::ffff:169.254.10.20]",
            "[fe80::1]",
            "[FE80::1]",
            "fe80::1",
            "[febf:ffff::1]",
            "fe80::1%wlan0",
            "[fe80::1%25wlan0]",
        };
        for (String host : direct) {
            assertTrue(host, LocalHttp.isImplicitBypassHost(host));
        }
    }

    @Test
    public void everythingElseKeepsTheProxy() {
        String[] proxied = {
            null,
            "",
            " ",
            ".",
            "[]",
            "[",
            "[::1",
            "128.0.0.1",
            "126.255.255.255",
            "10.0.0.1",
            "192.168.1.4",
            "100.64.1.2", // Tailscale
            "169.255.1.1",
            "169.253.1.1",
            "0.0.0.0",
            "localhost.example.com",
            "example.localhost.com",
            "notlocalhost",
            "localhostx",
            "localhost..",
            "node.example",
            "ext-node.qortal.link",
            "[::2]",
            "[::]",
            "[::127.0.0.1]", // IPv4-compatible, not IPv4-mapped
            "[::ffff:128.0.0.1]",
            "[::ffff:10.0.0.1]",
            "[fec0::1]", // site-local, not link-local
            "[fe00::1]",
            "[2001:db8::1]",
            "[fd7a:115c:a1e0::1]", // Tailscale IPv6
            // Spellings Chromium would never hand GO; they keep the proxy, as before.
            "127.1",
            "127.0.0",
            "127.0.0.1.1",
            "0127.0.0.1",
            "127.000.000.001",
            "127.0.0.256",
            "0x7f.0.0.1",
            "2130706433",
            "[::1::]",
            "[:::1]",
            "[1:2:3:4:5:6:7:8:9]",
            "[1:2:3:4:5:6:7]",
            "[12345::1]",
            "[::g]",
            "[::ffff:127.0.0.1.1]",
            "1::1:",
            "１２７.0.0.1", // full-width digits
            // Never a canonical Chromium host: spaces, control characters,
            // non-ASCII letters, an empty zone.
            " 127.0.0.1 ",
            "127.0.0.1 ",
            "\u0000127.0.0.1",
            " localhost\t",
            "localhost\n",
            "foo bar.localhost",
            "f\u00f3o.localhost",
            "[ ::1]",
            "fe80::1%",
            "[fe80::1%]",
        };
        for (String host : proxied) {
            assertFalse(String.valueOf(host), LocalHttp.isImplicitBypassHost(host));
        }
    }

    @Test
    public void onlyWebAddressesAreJudged() throws IOException {
        assertTrue(LocalHttp.bypassesProxy(new URL("http://127.0.0.1:12398/render/APP/Torq")));
        assertTrue(LocalHttp.bypassesProxy(new URL("https://[::1]:12398/")));
        assertTrue(LocalHttp.bypassesProxy(new URL("HTTP://LOCALHOST:12391/admin/status")));
        assertTrue(LocalHttp.bypassesProxy(new URL("http://100.64.1.2:12391/")));
        assertFalse(LocalHttp.bypassesProxy(new URL("https://ext-node.qortal.link/")));
        assertFalse(LocalHttp.bypassesProxy(new URL("file://localhost/etc/hosts")));
        assertFalse(LocalHttp.bypassesProxy(null));
    }

    @Test
    public void phoneProxySeesLoopbackWithoutTheHelper() throws IOException {
        // The bug as it was on the phone: a plain openConnection() hands the
        // node's address to the proxy, which cannot reach it.
        HttpURLConnection plain = (HttpURLConnection) new URL(nodeBase + "/render/APP/Torq").openConnection();
        assertEquals(503, plain.getResponseCode());
        assertTrue(read(plain).contains("Generated by mproxy"));
        plain.disconnect();
        assertEquals(Collections.singletonList(nodeBase + "/render/APP/Torq"), proxy.targets());
        assertTrue(node.requests.isEmpty());
    }

    @Test
    public void loopbackGoesDirectAndRemoteStillUsesTheProxy() throws IOException {
        HttpURLConnection local = (HttpURLConnection) LocalHttp.openConnection(new URL(nodeBase + "/render/APP/Torq"));
        assertEquals(200, local.getResponseCode());
        assertEquals("from node", read(local));
        local.disconnect();
        assertEquals(Collections.singletonList("/render/APP/Torq"), node.targets());
        assertTrue(proxy.requests.isEmpty());

        HttpURLConnection remote = (HttpURLConnection) LocalHttp.openConnection(new URL("http://remote-node.invalid:12391/admin/status"));
        assertEquals(200, remote.getResponseCode());
        assertEquals("via proxy", read(remote));
        remote.disconnect();
        assertEquals(Collections.singletonList("http://remote-node.invalid:12391/admin/status"), proxy.targets());
        assertEquals(1, node.requests.size());
    }

    /** One hop the way the plugins' RedirectPolicy transports open it. */
    private static RedirectPolicy.Transport<HttpURLConnection> transport(String apiKey) {
        return new RedirectPolicy.Transport<HttpURLConnection>() {
            @Override
            public HttpURLConnection open(String url, boolean withKey) throws Exception {
                HttpURLConnection connection = (HttpURLConnection) LocalHttp.openConnection(new URL(url));
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(5_000);
                connection.setReadTimeout(5_000);
                if (withKey) connection.setRequestProperty("X-API-KEY", apiKey);
                connection.connect();
                return connection;
            }

            @Override
            public int status(HttpURLConnection connection) throws Exception {
                return connection.getResponseCode();
            }

            @Override
            public String location(HttpURLConnection connection) {
                return connection.getHeaderField("Location");
            }

            @Override
            public void close(HttpURLConnection connection) {
                connection.disconnect();
            }
        };
    }

    @Test
    public void eachRedirectHopChoosesItsOwnRoute() throws Exception {
        // Remote start, loopback hop: the first goes through the proxy, the second direct.
        HttpURLConnection fromRemote = RedirectPolicy.open("http://updates.invalid/go.apk", null, 3, null, transport(null));
        assertEquals(200, fromRemote.getResponseCode());
        assertEquals("from node", read(fromRemote));
        fromRemote.disconnect();
        assertEquals(Collections.singletonList("http://updates.invalid/go.apk"), proxy.targets());
        assertEquals(Collections.singletonList("/files/go.apk"), node.targets());

        // Loopback start, remote hop: the node direct, with its key; the
        // mirror through the proxy, without it.
        HttpURLConnection fromNode = RedirectPolicy.open(nodeBase + "/moved", "node-key", 3, null, transport("node-key"));
        assertEquals(200, fromNode.getResponseCode());
        assertEquals("via proxy", read(fromNode));
        fromNode.disconnect();
        assertEquals(Arrays.asList("/files/go.apk", "/moved"), node.targets());
        assertEquals("node-key", node.requests.get(1).headers.get("X-API-KEY"));
        assertEquals(Arrays.asList("http://updates.invalid/go.apk", "http://mirror.invalid/pack.bin"), proxy.targets());
        assertNull(proxy.requests.get(1).headers.get("X-API-KEY"));
    }

    /** Sets a Range and a per-address Cookie on every hop, as the callers do. */
    private static final LocalHttp.HopSetup SETUP = (hop, hopUrl) -> {
        hop.setConnectTimeout(5_000);
        hop.setReadTimeout(5_000);
        hop.setRequestProperty("Range", "bytes=0-99");
        hop.setRequestProperty("Cookie", "for=" + new URL(hopUrl).getHost());
        // Turning following back on must not matter: GO follows by hand.
        hop.setInstanceFollowRedirects(true);
    };

    @Test
    public void followedRedirectsAreRoutedHopByHop() throws IOException {
        // A web link that redirects to the node: the link through the
        // proxy, the node direct. HttpURLConnection's own following would
        // have asked the proxy for the node too.
        HttpURLConnection fromRemote = LocalHttp.openFollowingRedirects(new URL("http://updates.invalid/go.apk"), LocalHttp.MAX_REDIRECTS, SETUP);
        assertEquals(200, fromRemote.getResponseCode());
        assertEquals("from node", read(fromRemote));
        fromRemote.disconnect();
        assertEquals(Collections.singletonList("http://updates.invalid/go.apk"), proxy.targets());
        assertEquals(Collections.singletonList("/files/go.apk"), node.targets());
        assertEquals("for=updates.invalid", proxy.requests.get(0).headers.get("Cookie"));
        assertEquals("for=127.0.0.1", node.requests.get(0).headers.get("Cookie"));
        assertEquals("bytes=0-99", node.requests.get(0).headers.get("Range"));

        // A node that redirects elsewhere: the node direct, the mirror
        // through the proxy, each with its own cookie and the same Range.
        HttpURLConnection fromNode = LocalHttp.openFollowingRedirects(new URL(nodeBase + "/moved"), LocalHttp.MAX_REDIRECTS, SETUP);
        assertEquals(200, fromNode.getResponseCode());
        assertEquals("via proxy", read(fromNode));
        fromNode.disconnect();
        assertEquals(Arrays.asList("/files/go.apk", "/moved"), node.targets());
        assertEquals(Arrays.asList("http://updates.invalid/go.apk", "http://mirror.invalid/pack.bin"), proxy.targets());
        assertEquals("for=mirror.invalid", proxy.requests.get(1).headers.get("Cookie"));
        assertEquals("bytes=0-99", proxy.requests.get(1).headers.get("Range"));
    }

    @Test
    public void redirectsHttpURLConnectionWouldNotFollowComeBackAsTheReply() throws IOException {
        // Another scheme (http to https), as HttpURLConnection: not followed.
        HttpURLConnection toHttps = LocalHttp.openFollowingRedirects(new URL(nodeBase + "/to-https"), LocalHttp.MAX_REDIRECTS, SETUP);
        assertEquals(301, toHttps.getResponseCode());
        assertEquals("https://mirror.invalid/pack.bin", toHttps.getHeaderField("Location"));
        toHttps.disconnect();

        // No Location at all.
        HttpURLConnection nowhere = LocalHttp.openFollowingRedirects(new URL(nodeBase + "/nowhere"), LocalHttp.MAX_REDIRECTS, SETUP);
        assertEquals(302, nowhere.getResponseCode());
        nowhere.disconnect();

        assertEquals(Arrays.asList("/to-https", "/nowhere"), node.targets());
        assertTrue(proxy.requests.isEmpty());
    }

    @Test
    public void endlessRedirectsStop() throws IOException {
        try {
            LocalHttp.openFollowingRedirects(new URL(nodeBase + "/loop"), 3, SETUP);
            fail("followed an endless redirect");
        } catch (ProtocolException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("Too many redirects"));
        }
        // The first request and 3 redirects, then no more.
        assertEquals(Arrays.asList("/loop", "/loop", "/loop", "/loop"), node.targets());
        assertTrue(proxy.requests.isEmpty());
    }

    /**
     * Every native HTTP connection goes through LocalHttp: a new
     * url.openConnection() or url.openStream() elsewhere would take the
     * carrier's proxy to the phone's own node again. Comment lines do not
     * count.
     */
    @Test
    public void everyNativeConnectionGoesThroughLocalHttp() throws IOException {
        String pkg = "src/main/java/com/github/Qortal/qortalMobile";
        File dir = null;
        for (String base : new String[] {"", "app/", "android/app/"}) {
            File candidate = new File(base + pkg);
            if (candidate.isDirectory()) {
                dir = candidate;
                break;
            }
        }
        assertTrue("main sources not found from " + new File("").getAbsolutePath(), dir != null);
        File[] files = dir.listFiles((d, name) -> name.endsWith(".java") || name.endsWith(".kt"));
        assertTrue(files != null && files.length > 10);
        List<String> found = new ArrayList<>();
        for (File file : files) {
            if (file.getName().equals("LocalHttp.java")) continue;
            List<String> lines = Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i).trim();
                if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
                String code = line.replace("LocalHttp.openConnection(", "");
                if (code.contains(".openConnection(") || code.contains(".openStream(")) {
                    found.add(file.getName() + ":" + (i + 1) + ": " + line);
                }
            }
        }
        assertEquals("use LocalHttp.openConnection or openFollowingRedirects", Collections.emptyList(), found);
    }
}
