package com.github.Qortal.qortalMobile;

import java.net.URI;
import java.util.Locale;

/**
 * Scheme, host and port of a URL, for the checks around GO's native downloads
 * (which hop may get the node API key, which address an update may come
 * from). No Android types, so the JVM unit tests can check it.
 *
 * java.net.URI only fills in getHost() for names that fit RFC 2396. A node
 * whose name has an underscore ("my_node.local") or is written in another
 * script is still a host HttpURLConnection connects to, so for those the host
 * is read from the raw authority instead, and {@link #strictHost} says so.
 */
public final class UrlOrigin {
    /** Lower case. */
    public final String scheme;
    /** Lower case, without the brackets of an IPv6 literal. */
    public final String host;
    /** The port written in the URL, else the scheme's default, else -1. */
    public final int port;
    /**
     * True when java.net.URI itself read the host. Only such a host is
     * trusted for decisions a misread host could turn into a leak, such as
     * plain HTTP to "this phone".
     */
    public final boolean strictHost;

    private UrlOrigin(String scheme, String host, int port, boolean strictHost) {
        this.scheme = scheme;
        this.host = host;
        this.port = port;
        this.strictHost = strictHost;
    }

    /** Null when the text is not an absolute URL with a host. */
    public static UrlOrigin parse(String url) {
        if (url == null) return null;
        URI uri;
        try {
            uri = new URI(url.trim());
        } catch (Exception e) {
            return null;
        }
        if (uri.getScheme() == null) return null;
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost();
        int port = uri.getPort();
        boolean strict = host != null && !host.isEmpty();
        if (!strict) {
            String[] parts = splitAuthority(uri.getRawAuthority());
            if (parts == null) return null;
            host = parts[0];
            if (parts[1] == null) {
                port = -1;
            } else {
                try {
                    port = Integer.parseInt(parts[1]);
                } catch (NumberFormatException e) {
                    return null;
                }
                if (port > 65535) return null;
            }
        }
        if (host.startsWith("[") && host.endsWith("]")) {
            host = host.substring(1, host.length() - 1);
        }
        if (host.isEmpty()) return null;
        if (port < 0) port = defaultPort(scheme);
        return new UrlOrigin(scheme, host.toLowerCase(Locale.ROOT), port, strict);
    }

    /** Same scheme, host and port. */
    public boolean sameAs(UrlOrigin other) {
        return other != null
            && scheme.equals(other.scheme)
            && host.equals(other.host)
            && port == other.port;
    }

    /**
     * {host, port or null} from "user@host:port", or null when there is no
     * host or the port is not a number.
     */
    private static String[] splitAuthority(String rawAuthority) {
        if (rawAuthority == null) return null;
        String authority = rawAuthority;
        int at = authority.lastIndexOf('@');
        if (at >= 0) authority = authority.substring(at + 1);
        String host;
        String port = null;
        if (authority.startsWith("[")) {
            int close = authority.indexOf(']');
            if (close < 0) return null;
            host = authority.substring(0, close + 1);
            String rest = authority.substring(close + 1);
            if (!rest.isEmpty()) {
                if (!rest.startsWith(":")) return null;
                port = rest.substring(1);
            }
        } else {
            int colon = authority.lastIndexOf(':');
            if (colon >= 0) {
                host = authority.substring(0, colon);
                port = authority.substring(colon + 1);
            } else {
                host = authority;
            }
        }
        if (host.isEmpty()) return null;
        if (port != null) {
            if (port.isEmpty()) {
                port = null;
            } else if (!port.matches("[0-9]{1,5}")) {
                return null;
            }
        }
        return new String[] {host, port};
    }

    private static int defaultPort(String scheme) {
        if ("https".equals(scheme)) return 443;
        if ("http".equals(scheme)) return 80;
        return -1;
    }
}
