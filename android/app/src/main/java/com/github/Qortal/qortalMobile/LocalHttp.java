package com.github.Qortal.qortalMobile;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.ProtocolException;
import java.net.Proxy;
import java.net.URL;
import java.net.URLConnection;
import java.util.Locale;

/**
 * Opens GO's native HTTP connections the way the WebView routes the same
 * address. No Android types, so the JVM unit tests can check it.
 *
 * <p>Android copies the network's HTTP proxy (a carrier's APN proxy on mobile
 * data, a Wi-Fi proxy) into the Java proxy settings, with no exception for
 * the phone's own addresses. So a plain {@code url.openConnection()} sent a
 * request for a private node at {@code http://127.0.0.1:12398} to the
 * carrier's proxy, which tried its own 127.0.0.1 and answered "Connection
 * refused". Chromium never proxies such addresses: its implicit bypass rules
 * ({@code ProxyBypassRules::MatchesImplicitRules},
 * net/proxy_resolution/proxy_bypass_rules.cc) send these hosts direct:
 * <ul>
 *   <li>{@code localhost} and {@code *.localhost}, any case, one trailing dot
 *   allowed;</li>
 *   <li>loopback: 127.0.0.0/8, {@code [::1]}, and IPv4-mapped loopback
 *   {@code [::ffff:127.0.0.0]/104};</li>
 *   <li>link-local: 169.254.0.0/16, {@code [::ffff:169.254.0.0]/112} and
 *   {@code [fe80::]/10}.</li>
 * </ul>
 * {@link #openConnection} does the same. Every other host, a Tailscale or
 * home-network node included, keeps the system proxy exactly as before, as
 * it does in the WebView.
 *
 * <p>The host is judged from the URL text alone, never by a DNS lookup. Only
 * the plain dotted form of an IPv4 address counts ({@code 127.0.0.1}, not
 * {@code 127.1} or {@code 0177.0.0.1}): Chromium writes every address it hands
 * GO that way, and a spelling GO does not recognise simply keeps the proxy, as
 * before. A host with spaces, control characters or non-ASCII letters is never
 * a valid Chromium host, so it keeps the proxy too.
 *
 * <p>This is a proxy-routing rule only, never a trust decision: it says
 * which connections skip the proxy, not which addresses are the phone. A
 * {@code *.localhost} name or a name with a trailing dot ({@code localhost.})
 * goes direct but is then resolved by the system's DNS, unlike Chromium,
 * which maps every {@code *.localhost} name to loopback itself; and a
 * link-local address is another device on the same network. To decide where
 * the node API key may go, use {@link AppUpdatePolicy#isLoopbackHost}.
 *
 * <p>The choice is made per connection. Where GO follows redirects itself
 * ({@link RedirectPolicy}, {@link #openFollowingRedirects}), each hop is
 * opened here and gets its own choice, as in the WebView.
 */
public final class LocalHttp {
    private LocalHttp() {}

    /** As many redirects as HttpURLConnection follows by itself. */
    public static final int MAX_REDIRECTS = 20;

    /**
     * Sets up one hop before it connects: method, headers and timeouts. It
     * runs again on every redirect hop, with that hop's URL, so a header
     * that belongs to one address (a cookie) is looked up for each hop.
     */
    public interface HopSetup {
        void apply(HttpURLConnection connection, String hopUrl) throws IOException;
    }

    /**
     * Opens {@code url} direct when its host is on the phone or its link
     * (see {@link #isImplicitBypassHost}), else through the system proxy, as
     * {@code url.openConnection()} does.
     */
    public static URLConnection openConnection(URL url) throws IOException {
        if (bypassesProxy(url)) {
            return url.openConnection(Proxy.NO_PROXY);
        }
        return url.openConnection();
    }

    /**
     * Opens an http(s) {@code url}, connected, and follows its redirects one
     * hop at a time, each hop opened by {@link #openConnection}. When
     * HttpURLConnection follows redirects itself, the first address picks
     * the route for the whole chain (Android sets the proxy on the client
     * that also makes the follow-ups): a web link that redirects to the node
     * still went to the carrier's proxy, and a node that redirects elsewhere
     * skipped it. Here each hop gets its own route, as in the WebView.
     *
     * <p>Otherwise it behaves as HttpURLConnection's own following: a
     * redirect to another scheme (http to https or back), or one without a
     * usable Location, is not followed and comes back as the reply; more
     * than {@code maxRedirects} redirects throw a {@link ProtocolException}.
     * {@code setup} must not connect; redirect following stays off on every
     * hop whatever it sets.
     *
     * @return the first reply that is not followed; the caller disconnects it
     */
    public static HttpURLConnection openFollowingRedirects(URL url, int maxRedirects, HopSetup setup) throws IOException {
        String current = url.toString();
        URL hop = url;
        for (int followed = 0; ; followed++) {
            URLConnection opened = openConnection(hop);
            if (!(opened instanceof HttpURLConnection)) {
                throw new IOException("Not an http(s) address");
            }
            HttpURLConnection connection = (HttpURLConnection) opened;
            String next;
            try {
                if (setup != null) setup.apply(connection, current);
                connection.setInstanceFollowRedirects(false);
                int status = connection.getResponseCode();
                if (!RedirectPolicy.isRedirect(status)) return connection;
                next = RedirectPolicy.resolve(current, connection.getHeaderField("Location"));
                if (next == null || !sameScheme(current, next)) return connection;
            } catch (IOException | RuntimeException e) {
                connection.disconnect();
                throw e;
            }
            connection.disconnect();
            if (followed >= maxRedirects) {
                throw new ProtocolException("Too many redirects (" + (followed + 1) + ")");
            }
            current = next;
            hop = new URL(next);
        }
    }

    private static boolean sameScheme(String a, String b) {
        try {
            return new URL(a).getProtocol().equalsIgnoreCase(new URL(b).getProtocol());
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * Home-network and VPN addresses GO also sends direct, in native code and
     * (as Chromium bypass rules, {@link WebViewProxyBypass}) in the WebView: a
     * carrier or Wi-Fi proxy cannot reach a node on the owner's LAN or
     * Tailscale network, and must not see its traffic. Private IPv4
     * (10/8, 172.16/12, 192.168/16), shared/CGNAT 100.64/10 (Tailscale),
     * unique-local IPv6 fc00::/7 (Tailscale's fd7a:115c:a1e0::/48) and
     * Tailscale MagicDNS names.
     */
    static final String[] PRIVATE_NETWORK_BYPASS_RULES = {
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "100.64.0.0/10",
        "fc00::/7",
        "*.ts.net",
    };

    /** True for an http(s) URL GO sends direct, never through a proxy. */
    static boolean bypassesProxy(URL url) {
        if (url == null) return false;
        String protocol = url.getProtocol() == null ? "" : url.getProtocol().toLowerCase(Locale.ROOT);
        if (!"http".equals(protocol) && !"https".equals(protocol)) return false;
        String host = url.getHost();
        return isImplicitBypassHost(host) || isPrivateNetworkHost(host);
    }

    /** The hosts of {@link #PRIVATE_NETWORK_BYPASS_RULES}; same input rules as {@link #isImplicitBypassHost}. */
    static boolean isPrivateNetworkHost(String host) {
        if (host == null || host.isEmpty()) return false;
        for (int i = 0; i < host.length(); i++) {
            char c = host.charAt(i);
            if (c <= 0x20 || c >= 0x7f) return false;
        }
        String h = host.toLowerCase(Locale.ROOT);
        if (h.startsWith("[")) {
            if (h.length() <= 2 || !h.endsWith("]")) return false;
            h = h.substring(1, h.length() - 1);
        }
        if (h.indexOf(':') >= 0) {
            int zone = h.indexOf('%');
            if (zone >= 0) h = h.substring(0, zone);
            byte[] a = parseIpv6(h);
            return a != null && (a[0] & 0xfe) == 0xfc;
        }
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.endsWith(".ts.net")) return true;
        int[] ip = parseIpv4(h);
        if (ip == null) return false;
        return ip[0] == 10
            || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31)
            || (ip[0] == 192 && ip[1] == 168)
            || (ip[0] == 100 && ip[1] >= 64 && ip[1] <= 127);
    }

    /**
     * Chromium's implicit proxy bypass: localhost names, loopback and
     * link-local addresses. Takes a URL host as written, with or without the
     * brackets of an IPv6 literal; case and one trailing dot do not matter.
     * A routing rule, not a trust check (see the class comment).
     */
    static boolean isImplicitBypassHost(String host) {
        if (host == null || host.isEmpty()) return false;
        for (int i = 0; i < host.length(); i++) {
            // Spaces, control characters and non-ASCII never appear in a
            // host Chromium has canonicalised: no match there.
            char c = host.charAt(i);
            if (c <= 0x20 || c >= 0x7f) return false;
        }
        String h = host.toLowerCase(Locale.ROOT);
        if (h.startsWith("[")) {
            return h.length() > 2 && h.endsWith("]") && isLocalIpv6(h.substring(1, h.length() - 1));
        }
        if (h.indexOf(':') >= 0) {
            return isLocalIpv6(h);
        }
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.isEmpty()) return false;
        if ("localhost".equals(h)) return true;
        if (h.endsWith(".localhost")) return true;
        int[] ipv4 = parseIpv4(h);
        if (ipv4 == null) return false;
        return isLoopbackOrLinkLocalIpv4(ipv4[0], ipv4[1]);
    }

    private static boolean isLoopbackOrLinkLocalIpv4(int first, int second) {
        return first == 127 || (first == 169 && second == 254);
    }

    private static boolean isLocalIpv6(String text) {
        // A zone ("fe80::1%wlan0", "%25" when escaped) names the interface,
        // not the address.
        int zone = text.indexOf('%');
        if (zone >= 0) {
            if (zone == text.length() - 1) return false; // "%" with no zone
            text = text.substring(0, zone);
        }
        byte[] a = parseIpv6(text);
        if (a == null) return false;
        boolean leadingZeros = true;
        for (int i = 0; i < 10; i++) {
            if (a[i] != 0) {
                leadingZeros = false;
                break;
            }
        }
        if (leadingZeros && a[10] == 0 && a[11] == 0 && a[12] == 0 && a[13] == 0 && a[14] == 0 && a[15] == 1) {
            return true; // ::1
        }
        if (leadingZeros && (a[10] & 0xff) == 0xff && (a[11] & 0xff) == 0xff) {
            // ::ffff:a.b.c.d, an IPv4 address in IPv6 form.
            return isLoopbackOrLinkLocalIpv4(a[12] & 0xff, a[13] & 0xff);
        }
        return (a[0] & 0xff) == 0xfe && (a[1] & 0xc0) == 0x80; // fe80::/10
    }

    /** {a, b, c, d} for a plain dotted IPv4 address, else null. */
    private static int[] parseIpv4(String text) {
        String[] parts = text.split("\\.", -1);
        if (parts.length != 4) return null;
        int[] out = new int[4];
        for (int i = 0; i < 4; i++) {
            String part = parts[i];
            if (part.isEmpty() || part.length() > 3) return null;
            // A leading zero means octal to Chromium: not the plain form.
            if (part.length() > 1 && part.charAt(0) == '0') return null;
            int value = 0;
            for (int j = 0; j < part.length(); j++) {
                char c = part.charAt(j);
                if (c < '0' || c > '9') return null;
                value = value * 10 + (c - '0');
            }
            if (value > 255) return null;
            out[i] = value;
        }
        return out;
    }

    /** The 16 bytes of an IPv6 address (RFC 4291 text forms), else null. */
    private static byte[] parseIpv6(String text) {
        if (text.isEmpty()) return null;
        int gap = text.indexOf("::");
        if (gap >= 0 && text.indexOf("::", gap + 1) >= 0) return null;
        int[] head;
        int[] tail;
        if (gap >= 0) {
            head = parseGroups(text.substring(0, gap), false);
            tail = parseGroups(text.substring(gap + 2), true);
            if (head == null || tail == null || head.length + tail.length > 7) return null;
        } else {
            head = parseGroups(text, true);
            tail = new int[0];
            if (head == null || head.length != 8) return null;
        }
        int[] groups = new int[8];
        System.arraycopy(head, 0, groups, 0, head.length);
        System.arraycopy(tail, 0, groups, 8 - tail.length, tail.length);
        byte[] out = new byte[16];
        for (int i = 0; i < 8; i++) {
            out[2 * i] = (byte) (groups[i] >> 8);
            out[2 * i + 1] = (byte) groups[i];
        }
        return out;
    }

    /**
     * The 16-bit groups of one side of "::"; an empty side has none. When
     * {@code ipv4Last}, the last item may be a dotted IPv4 address, which
     * counts as two groups.
     */
    private static int[] parseGroups(String text, boolean ipv4Last) {
        if (text.isEmpty()) return new int[0];
        String[] items = text.split(":", -1);
        int count = items.length;
        int[] ipv4 = null;
        if (ipv4Last && items[count - 1].indexOf('.') >= 0) {
            ipv4 = parseIpv4(items[count - 1]);
            if (ipv4 == null) return null;
            count--;
        }
        int[] out = new int[count + (ipv4 == null ? 0 : 2)];
        for (int i = 0; i < count; i++) {
            String item = items[i];
            if (item.isEmpty() || item.length() > 4) return null;
            int value = 0;
            for (int j = 0; j < item.length(); j++) {
                int digit = hexDigit(item.charAt(j));
                if (digit < 0) return null;
                value = (value << 4) | digit;
            }
            out[i] = value;
        }
        if (ipv4 != null) {
            out[count] = (ipv4[0] << 8) | ipv4[1];
            out[count + 1] = (ipv4[2] << 8) | ipv4[3];
        }
        return out;
    }

    /** ASCII only: Character.digit would also take other scripts' digits. */
    private static int hexDigit(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }
}
