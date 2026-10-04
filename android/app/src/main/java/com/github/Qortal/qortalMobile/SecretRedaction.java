package com.github.Qortal.qortalMobile;

import java.util.regex.Pattern;

/**
 * Keeps the node API key (and anything else carried in a URL's query) out of
 * logcat and out of error text the app shows. No Android types, so the JVM
 * unit tests can check it.
 *
 * GO's JS side has to put the key in the query string for WebView requests
 * (Qortal Core's CORS does not allow the X-API-KEY header), so any URL that
 * came from JS may carry {@code apiKey=...}. Release builds keep raw
 * {@code android.util.Log} calls, and logcat ends up in bug reports.
 */
public final class SecretRedaction {
    private SecretRedaction() {}

    /** An http(s) URL inside free text, up to the first space or quote. */
    private static final Pattern URL_IN_TEXT = Pattern.compile("(?i)\\b(https?://[^\\s\"'<>()?#]*)[?#][^\\s\"'<>()]*");
    /** A key=value pair whose name says it is a secret, wherever it appears. */
    private static final Pattern SECRET_PARAM = Pattern.compile(
        "(?i)\\b(api[_-]?key|apikey|x-api-key|token|password|secret)(\\s*[=:]\\s*)[^\\s&\"'<>,;]+"
    );

    /**
     * The URL without its query, fragment or user info:
     * {@code http://node:12391/arbitrary/FILE/x/y?apiKey=k} becomes
     * {@code http://node:12391/arbitrary/FILE/x/y}.
     */
    public static String stripQuery(String url) {
        if (url == null) return "";
        String value = url.trim();
        int cut = value.length();
        int query = value.indexOf('?');
        int fragment = value.indexOf('#');
        if (query >= 0) cut = Math.min(cut, query);
        if (fragment >= 0) cut = Math.min(cut, fragment);
        value = value.substring(0, cut);
        // user:pass@host
        int scheme = value.indexOf("://");
        if (scheme >= 0) {
            int hostStart = scheme + 3;
            int pathStart = value.indexOf('/', hostStart);
            int authorityEnd = pathStart < 0 ? value.length() : pathStart;
            int at = value.lastIndexOf('@', authorityEnd - 1);
            if (at >= hostStart) {
                value = value.substring(0, hostStart) + value.substring(at + 1);
            }
        }
        return value;
    }

    /**
     * Free text (an exception message, a server reply) with every URL's query
     * removed and any {@code apiKey=...}-style value masked.
     */
    public static String redactText(String text) {
        if (text == null) return "";
        String out = URL_IN_TEXT.matcher(text).replaceAll("$1");
        return SECRET_PARAM.matcher(out).replaceAll("$1$2<redacted>");
    }

    /**
     * True when both URLs have the same scheme, host and port. Hosts
     * java.net.URI cannot read (an underscore, another script) still compare,
     * so the key keeps reaching a node with such a name.
     */
    public static boolean sameOrigin(String a, String b) {
        UrlOrigin left = UrlOrigin.parse(a);
        UrlOrigin right = UrlOrigin.parse(b);
        return left != null && left.sameAs(right);
    }
}
