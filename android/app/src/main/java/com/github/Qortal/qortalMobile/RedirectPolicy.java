package com.github.Qortal.qortalMobile;

import java.net.URL;
import java.util.Locale;

/**
 * Redirects for GO's native downloads (the updater, Qortino's pack download),
 * followed by hand. No Android types, so the JVM unit tests can drive the
 * whole loop with a fake transport.
 *
 * HttpURLConnection's own redirect following would carry the X-API-KEY
 * header to wherever a reply points, and would not hold each hop to the
 * updater's address rule. Here:
 * <ul>
 *   <li>every hop, the first one included, passes the caller's address
 *   check;</li>
 *   <li>the key only goes to a hop on the starting URL's origin (scheme, host
 *   and port), compared with the start, never with the hop before;</li>
 *   <li>at most {@code maxRedirects} redirects are followed.</li>
 * </ul>
 */
public final class RedirectPolicy {
    private RedirectPolicy() {}

    /** One hop of a download; the plugins implement it over HttpURLConnection. */
    public interface Transport<C> {
        /** Opens and connects {@code url}, with the API key header only when {@code withKey}. */
        C open(String url, boolean withKey) throws Exception;

        int status(C connection) throws Exception;

        /** The Location header, or null. */
        String location(C connection);

        void close(C connection);
    }

    /** Throws the caller's own refusal when a hop's address is not allowed. */
    public interface AddressCheck {
        void check(String url) throws Exception;
    }

    /** A redirect GO does not follow: one too many, or no usable Location. */
    public static final class RedirectRefused extends Exception {
        private static final long serialVersionUID = 1L;
        public final int status;

        RedirectRefused(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    public static boolean isRedirect(int status) {
        return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
    }

    /**
     * The absolute http(s) URL a Location header points to, resolved against
     * the hop that sent it. Null when there is none, it does not parse, or it
     * names another scheme.
     */
    @SuppressWarnings("deprecation")
    public static String resolve(String current, String location) {
        if (current == null || location == null || location.trim().isEmpty()) return null;
        try {
            URL next = new URL(new URL(current), location.trim());
            String protocol = next.getProtocol() == null ? "" : next.getProtocol().toLowerCase(Locale.ROOT);
            if (!"http".equals(protocol) && !"https".equals(protocol)) return null;
            if (next.getHost() == null || next.getHost().isEmpty()) return null;
            return next.toString();
        } catch (Exception e) {
            return null;
        }
    }

    /** The key goes to a hop only on the origin the download started on. */
    public static boolean sendKey(String startUrl, String hopUrl, String apiKey) {
        return apiKey != null && !apiKey.isEmpty() && SecretRedaction.sameOrigin(startUrl, hopUrl);
    }

    /**
     * Opens {@code startUrl}, following up to {@code maxRedirects} redirects,
     * and returns the first reply that is not a redirect (any status; the
     * caller judges it). Redirect replies are closed on the way.
     *
     * @param check run on every hop's URL before it is opened; may be null
     * @throws RedirectRefused for one redirect too many or a Location that
     *     does not resolve to an http(s) URL
     */
    public static <C> C open(
        String startUrl,
        String apiKey,
        int maxRedirects,
        AddressCheck check,
        Transport<C> transport
    ) throws Exception {
        String current = startUrl;
        for (int followed = 0; ; followed++) {
            if (check != null) check.check(current);
            C connection = transport.open(current, sendKey(startUrl, current, apiKey));
            int status;
            String location;
            try {
                status = transport.status(connection);
                if (!isRedirect(status)) return connection;
                location = transport.location(connection);
            } catch (Exception e) {
                transport.close(connection);
                throw e;
            }
            transport.close(connection);
            if (followed >= maxRedirects) {
                throw new RedirectRefused(status, "Too many redirects (HTTP " + status + ")");
            }
            String next = resolve(current, location);
            if (next == null) {
                throw new RedirectRefused(status, "HTTP " + status + " without a usable Location");
            }
            current = next;
        }
    }
}
