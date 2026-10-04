package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.ProxyInfo;
import android.net.Uri;
import android.util.Log;
import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;
import java.util.concurrent.Executor;

/**
 * Keeps the WebView on the system proxy but sends home-network and VPN
 * addresses ({@link LocalHttp#PRIVATE_NETWORK_BYPASS_RULES}) direct, the same
 * way GO's native requests go ({@link LocalHttp}). Without it a carrier proxy
 * (an APN proxy on mobile data) receives every request to a node at a LAN or
 * Tailscale address, cannot reach it, and sees the traffic in plain text.
 *
 * <p>The override copies the default network's proxy and its exclusion list
 * and adds the private ranges; Chromium's own loopback bypass stays on. With
 * no proxy, or a PAC proxy (which cannot be copied as one rule), the override
 * is cleared and the WebView follows the system as before.
 */
final class WebViewProxyBypass {
    private static final String TAG = "WebViewProxyBypass";
    private static final Executor DIRECT = Runnable::run;

    private static ConnectivityManager.NetworkCallback callback;
    private static String applied = "";

    private WebViewProxyBypass() {}

    /** Applies the override now and again on every default-network change. */
    static synchronized void start(Context context) {
        if (callback != null) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) return;
        Context app = context.getApplicationContext();
        ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        apply(cm);
        callback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                apply(cm);
            }

            @Override
            public void onLinkPropertiesChanged(Network network, LinkProperties properties) {
                apply(cm);
            }

            @Override
            public void onLost(Network network) {
                apply(cm);
            }
        };
        try {
            cm.registerDefaultNetworkCallback(callback);
        } catch (RuntimeException error) {
            Log.w(TAG, "Network callback unavailable", error);
            callback = null;
        }
    }

    static synchronized void stop(Context context) {
        if (callback == null) return;
        ConnectivityManager cm = context.getApplicationContext().getSystemService(ConnectivityManager.class);
        try {
            if (cm != null) cm.unregisterNetworkCallback(callback);
        } catch (RuntimeException ignored) {
            // Already gone.
        }
        callback = null;
    }

    private static synchronized void apply(ConnectivityManager cm) {
        try {
            ProxyInfo proxy = cm.getDefaultProxy();
            boolean copyable = proxy != null
                && proxy.getHost() != null
                && !proxy.getHost().isEmpty()
                && proxy.getPort() > 0
                && Uri.EMPTY.equals(proxy.getPacFileUrl());
            String key = copyable ? proxy.getHost() + ":" + proxy.getPort() + "|" + String.join(",", proxy.getExclusionList()) : "";
            if (key.equals(applied)) return;
            applied = key;
            ProxyController controller = ProxyController.getInstance();
            if (!copyable) {
                controller.clearProxyOverride(DIRECT, () -> {});
                Log.i(TAG, "WebView follows the system proxy settings");
                return;
            }
            ProxyConfig.Builder builder = new ProxyConfig.Builder().addProxyRule(proxy.getHost() + ":" + proxy.getPort());
            for (String rule : LocalHttp.PRIVATE_NETWORK_BYPASS_RULES) builder.addBypassRule(rule);
            for (String excluded : proxy.getExclusionList()) {
                if (excluded != null && !excluded.trim().isEmpty()) builder.addBypassRule(excluded.trim());
            }
            controller.setProxyOverride(builder.build(), DIRECT, () -> {});
            Log.i(TAG, "WebView proxy kept, home and VPN addresses direct");
        } catch (RuntimeException error) {
            // An invalid exclusion entry or an old WebView: keep the system behaviour.
            applied = "";
            Log.w(TAG, "Proxy override not applied", error);
        }
    }
}
