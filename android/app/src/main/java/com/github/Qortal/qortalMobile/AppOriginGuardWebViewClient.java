package com.github.Qortal.qortalMobile;

import android.net.Uri;
import android.util.Log;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Capacitor's WebView client plus GO's rules for outside content:
 * <ul>
 *   <li>{@link AppOriginGuardPolicy}: outside content (Q-Apps, QDN sites,
 *   links in chat) never gets a page on GO's own origin. Closes GO-01 and the
 *   CVE-2026-103922 proxy route.</li>
 *   <li>{@link QappFramePolicy}: every page that loads into a frame (Q-Apps,
 *   QDN sites) is fetched here and gets GO's policy on top of the node's, so
 *   what a Q-App loads, fetches and connects to is held to the node, as on
 *   the desktop Hub (N-03). Not covered by any policy: the frame moving
 *   itself to another address, WebRTC, DNS prefetch and preconnect.</li>
 *   <li>A frame cannot open other apps through intent:, market:, tel:,
 *   mailto: and similar links; qortal: links work as before (N-39).</li>
 *   <li>No service worker can be installed: one could answer a Q-App's page
 *   loads without GO's policy. GO itself uses none.</li>
 *   <li>No prefetch to another origin: no policy covers prefetch.</li>
 *   <li>Private Q-Apps that GO unpacked itself are answered from memory at
 *   their address on the node ({@link PrivateQappStore}), with the node's
 *   policy and GO's.</li>
 * </ul>
 * The decisions themselves, and their order, are in {@link QappFramePolicy#decide}.
 */
public class AppOriginGuardWebViewClient extends BridgeWebViewClient {
    private static final String TAG = "AppOriginGuard";

    private final String appScheme;
    private final String appHost;
    private final int appPort;
    private final String userAgent;

    public AppOriginGuardWebViewClient(Bridge bridge) {
        super(bridge);
        Uri app = Uri.parse(bridge.getLocalUrl());
        appScheme = app.getScheme();
        appHost = app.getHost();
        appPort = app.getPort();
        userAgent = webViewUserAgent(bridge);
        installServiceWorkerGuard();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        AppOriginGuardPolicy.Request req = new AppOriginGuardPolicy.Request();
        Uri url = request.getUrl();
        req.scheme = url.getScheme();
        req.host = url.getHost();
        req.port = url.getPort();
        req.path = url.getPath();
        req.mainFrame = request.isForMainFrame();
        req.headers = request.getRequestHeaders();
        QappFramePolicy.Decision decision = QappFramePolicy.decide(req, request.getMethod(), appScheme, appHost, appPort);
        if (decision == QappFramePolicy.Decision.FETCH_FRAME_PAGE || decision == QappFramePolicy.Decision.PASS) {
            WebResourceResponse privateApp = privateAppReply(request, req);
            if (privateApp != null) {
                return privateApp;
            }
        }
        switch (decision) {
            case REFUSE_APP_ORIGIN:
                Log.w(TAG, "Refused " + (req.mainFrame ? "page" : "frame/resource") + " load of " + req.path);
                return refusal();
            case REFUSE_SERVICE_WORKER:
                Log.w(TAG, "Refused a service worker script");
                return refusal();
            case REFUSE_PREFETCH:
                Log.w(TAG, "Refused a prefetch to another origin");
                return refusal();
            case FETCH_FRAME_PAGE: {
                QappDocumentFetcher.Result page = QappDocumentFetcher.fetch(url.toString(), req.headers, userAgent);
                return new WebResourceResponse(page.mimeType, page.charset, page.status, page.reason, page.headers, page.body);
            }
            default:
                return super.shouldInterceptRequest(view, request);
        }
    }

    /**
     * A private Q-App that GO unpacked itself answers its own addresses on the
     * node ({@link PrivateQappStore}): the page and its files come from memory,
     * nothing goes to the network. Null for every other request.
     */
    private static WebResourceResponse privateAppReply(WebResourceRequest request, AppOriginGuardPolicy.Request req) {
        if (req.mainFrame || !"GET".equalsIgnoreCase(request.getMethod())) {
            return null;
        }
        Uri url = request.getUrl();
        PrivateQappRenderer.Reply reply = PrivateQappStore.shared().respond(
            req.scheme,
            req.host,
            req.port,
            req.path,
            queryParameter(url, "theme"),
            queryParameter(url, "lang")
        );
        if (reply == null) {
            return null;
        }
        return new WebResourceResponse(
            reply.mimeType,
            reply.charset,
            reply.status,
            reply.reason,
            reply.headers,
            new ByteArrayInputStream(reply.body)
        );
    }

    private static String queryParameter(Uri url, String name) {
        try {
            return url.getQueryParameter(name);
        } catch (RuntimeException e) {
            return null;
        }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String scheme = request.getUrl().getScheme();
        if (QappFramePolicy.blocksFrameNavigation(request.isForMainFrame(), scheme)) {
            Log.w(TAG, "Blocked a frame's " + logScheme(scheme) + " link");
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }

    /**
     * Chromium fetches a service worker's script through the service worker
     * client, not through this one, so the refusal is set there too. It is
     * process-wide; this client is the WebView's only one.
     */
    private static void installServiceWorkerGuard() {
        try {
            ServiceWorkerController.getInstance().setServiceWorkerClient(
                new ServiceWorkerClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                        if (QappFramePolicy.isServiceWorkerScript(request.getRequestHeaders())) {
                            Log.w(TAG, "Refused a service worker script");
                            return refusal();
                        }
                        return null;
                    }
                }
            );
        } catch (RuntimeException e) {
            Log.w(TAG, "Service worker guard not installed", e);
        }
    }

    private static String webViewUserAgent(Bridge bridge) {
        try {
            WebView webView = bridge.getWebView();
            return webView == null ? null : webView.getSettings().getUserAgentString();
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The scheme for the log, without anything a page could use to flood or forge it. */
    private static String logScheme(String scheme) {
        if (scheme == null) {
            return "(none)";
        }
        String clean = scheme.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9+.-]", "");
        return clean.length() > 24 ? clean.substring(0, 24) : clean;
    }

    private static WebResourceResponse refusal() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", "sandbox; default-src 'none'");
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(
            "text/plain",
            "utf-8",
            403,
            "Forbidden",
            headers,
            new ByteArrayInputStream(new byte[0])
        );
    }
}
