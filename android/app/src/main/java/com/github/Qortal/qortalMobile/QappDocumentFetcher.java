package com.github.Qortal.qortalMobile;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.TreeMap;

/**
 * Fetches a frame's page (a Q-App or QDN site) natively, so that
 * {@link AppOriginGuardWebViewClient} can hand it to the WebView with GO's
 * policy added ({@link QappFramePolicy}). Plain java.net, no Android types,
 * so the JVM unit tests run it against a local server.
 *
 * <p>The reply keeps the status, type, charset, body and headers the server
 * sent, the node's own policy included. Differences from the WebView's own
 * fetch:
 * <ul>
 *   <li>no cookies are sent or kept. The WebView did send and keep them for
 *   frames (Capacitor allows third-party cookies); Core and the public node
 *   set none, so Q-Apps do not notice. Their sub-resources still go through
 *   the WebView, cookies and all;</li>
 *   <li>a redirect becomes a small page that moves the frame on, so the next
 *   address is fetched and covered the same way;</li>
 *   <li>when the server cannot be reached the frame gets an empty 502 or 504,
 *   never an uncovered retry by the WebView.</li>
 * </ul>
 *
 * <p>How the WebView treats the type (Chromium,
 * components/embedder_support/android/util/android_stream_reader_url_loader.cc):
 * it takes {@link Result#mimeType} and {@link Result#charset} only for a 200,
 * and sniffs the body itself, with the network stack's own sniffer, for any
 * other status and for a 200 with no type. So a page the node sends untyped
 * (its "building the app" 503) still renders as HTML; GO also types such a
 * page itself when it starts like HTML.
 */
public final class QappDocumentFetcher {
    private QappDocumentFetcher() {}

    /** Generous: the node can take a while to build an app it has not cached. */
    static final int CONNECT_TIMEOUT_MS = 30_000;
    static final int READ_TIMEOUT_MS = 180_000;

    /** What the WebView gets; maps one to one onto WebResourceResponse. */
    public static final class Result {
        public final int status;
        public final String reason;
        /** Null when the server sent no type and the body does not start like HTML. */
        public final String mimeType;
        /** Null when the server named none. */
        public final String charset;
        public final Map<String, String> headers;
        public final InputStream body;

        Result(int status, String reason, String mimeType, String charset, Map<String, String> headers, InputStream body) {
            this.status = status;
            this.reason = reason;
            this.mimeType = mimeType;
            this.charset = charset;
            this.headers = headers;
            this.body = body;
        }
    }

    /**
     * GETs {@code url} and returns the reply with GO's policy added. Never
     * throws: a failure is an empty 502 (504 on a timeout).
     *
     * @param url the frame's address as the WebView reports it; characters
     *     Chromium leaves unescaped are escaped first ({@link QappFramePolicy#wireUrl})
     * @param webViewHeaders the request headers the WebView reported
     * @param userAgent the WebView's user agent, used when the request has none
     */
    public static Result fetch(String url, Map<String, String> webViewHeaders, String userAgent) {
        return fetch(url, webViewHeaders, userAgent, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);
    }

    @SuppressWarnings("deprecation")
    static Result fetch(String url, Map<String, String> webViewHeaders, String userAgent, int connectTimeoutMs, int readTimeoutMs) {
        String wire = QappFramePolicy.wireUrl(url);
        if (wire == null) {
            return failure(502);
        }
        HttpURLConnection connection = null;
        try {
            URL target = new URL(wire);
            String host = target.getHost();
            if (host == null || host.isEmpty()) {
                return failure(502);
            }
            String policy = QappFramePolicy.contentSecurityPolicy(target.getProtocol(), host, target.getPort());
            // Direct for the phone's own addresses, as the WebView itself does:
            // a carrier's APN proxy cannot reach a node at 127.0.0.1.
            connection = (HttpURLConnection) LocalHttp.openConnection(target);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setRequestMethod("GET");
            for (Map.Entry<String, String> header : QappFramePolicy.requestHeaders(webViewHeaders, userAgent).entrySet()) {
                connection.setRequestProperty(header.getKey(), header.getValue());
            }
            int status = connection.getResponseCode();
            if (RedirectPolicy.isRedirect(status)) {
                String next = QappFramePolicy.redirectTarget(wire, connection.getHeaderField("Location"));
                connection.disconnect();
                connection = null;
                return next == null ? failure(502) : redirect(next, policy);
            }
            int shown = QappFramePolicy.responseStatus(status);
            if (shown != status) {
                connection.disconnect();
                connection = null;
                return failure(shown);
            }
            InputStream raw;
            if (status >= 400) {
                raw = connection.getErrorStream();
            } else {
                raw = connection.getInputStream();
            }
            InputStream body = raw == null ? new ByteArrayInputStream(new byte[0]) : raw;
            String[] type = QappFramePolicy.mimeAndCharset(connection.getContentType());
            String mime = type[0];
            if (mime == null) {
                BufferedInputStream buffered = new BufferedInputStream(body);
                if (startsLikeHtml(buffered)) {
                    mime = "text/html";
                }
                body = buffered;
            }
            Map<String, String> headers = QappFramePolicy.responseHeaders(connection.getHeaderFields(), policy);
            String contentType = QappFramePolicy.contentTypeHeader(type[0], type[1]);
            if (status != 200 && contentType != null) {
                // The WebView types only a 200 from the fields; keep the server's word on the others.
                headers.put("Content-Type", contentType);
            }
            String reason = QappFramePolicy.reasonPhrase(status, connection.getResponseMessage());
            Result result = new Result(status, reason, mime, type[1], headers, new DisconnectingStream(body, connection));
            connection = null;
            return result;
        } catch (SocketTimeoutException e) {
            return failure(504);
        } catch (IOException | RuntimeException e) {
            return failure(502);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /** Peeks at the first {@link QappFramePolicy#SNIFF_BYTES} bytes and puts them back. */
    private static boolean startsLikeHtml(BufferedInputStream in) throws IOException {
        byte[] head = new byte[QappFramePolicy.SNIFF_BYTES];
        in.mark(head.length);
        int filled = 0;
        while (filled < head.length) {
            int n = in.read(head, filled, head.length - filled);
            if (n < 0) {
                break;
            }
            filled += n;
        }
        in.reset();
        return QappFramePolicy.looksLikeHtml(head, filled);
    }

    private static Result redirect(String target, String policy) {
        Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        headers.put(QappFramePolicy.CSP_HEADER, policy);
        headers.put("Cache-Control", "no-store");
        byte[] page = QappFramePolicy.redirectDocument(target).getBytes(StandardCharsets.UTF_8);
        return new Result(200, "OK", "text/html", "utf-8", headers, new ByteArrayInputStream(page));
    }

    /** An empty reply that cannot run anything. */
    static Result failure(int status) {
        Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        headers.put(QappFramePolicy.CSP_HEADER, "sandbox; default-src 'none'");
        headers.put("Cache-Control", "no-store");
        return new Result(
            status,
            QappFramePolicy.reasonPhrase(status, null),
            "text/plain",
            "utf-8",
            headers,
            new ByteArrayInputStream(new byte[0])
        );
    }

    /** Closes the connection with the body, when the WebView is done with it. */
    private static final class DisconnectingStream extends FilterInputStream {
        private final HttpURLConnection connection;

        DisconnectingStream(InputStream in, HttpURLConnection connection) {
            super(in);
            this.connection = connection;
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                connection.disconnect();
            }
        }
    }
}
