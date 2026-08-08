package com.github.Qortal.qortalMobile;

import com.github.Qortal.qortalMobile.QortalBiometricPlugin;
import com.getcapacitor.BridgeActivity;
import com.github.Qortal.qortalMobile.NativeBcrypt;
import com.github.Qortal.qortalMobile.NativePOW;
import com.github.Qortal.qortalMobile.FileWriter;
import com.github.Qortal.qortalMobile.EncryptedMediaServerPlugin;
import com.github.Qortal.qortalMobile.ChromecastPlugin;
import com.github.Qortal.qortalMobile.NetworkInfoPlugin;
import com.github.Qortal.qortalMobile.ProxyServerPlugin;
import com.github.Qortal.qortalMobile.ForegroundServicePlugin;
import com.github.Qortal.qortalMobile.ReticulumPlugin;
import com.github.Qortal.qortalMobile.AudioRoutingPlugin;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int CALL_PERMISSIONS_REQUEST_CODE = 0x5101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeBcrypt.class);
        registerPlugin(NativePOW.class);
        registerPlugin(FileWriter.class);
        registerPlugin(EncryptedMediaServerPlugin.class);
        registerPlugin(ChromecastPlugin.class);
        registerPlugin(NetworkInfoPlugin.class);
        registerPlugin(ProxyServerPlugin.class);
        registerPlugin(ForegroundServicePlugin.class);
        registerPlugin(QortalBackgroundPlugin.class);
        registerPlugin(ReticulumPlugin.class);
        registerPlugin(AudioRoutingPlugin.class);
        registerPlugin(QortalBiometricPlugin.class);
        registerPlugin(SafeAreaPlugin.class);
        registerPlugin(VideoCompressPlugin.class);
        registerPlugin(QortinoLlmPlugin.class);
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
        // "Share to Quitter": photos/videos shared from other apps (cold start).
        ShareReceiverPlugin.handleSendIntent(this, getIntent());
        // Edge-to-edge: WebView draws under system bars; CSS safe-area vars pad content.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Bank-app unlock: if fingerprint unlock is configured, show the system
        // prompt immediately so the scan runs while the WebView boots.
        if (savedInstanceState == null) {
            QortalBiometricPlugin.maybeShowEarlyPrompt(this);
        }

        // ✅ Enable mixed content mode for WebView
        if (this.bridge != null) {
            WebView webView = this.bridge.getWebView();
            if (webView != null) {
                WebSettings webSettings = webView.getSettings();
                webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                webSettings.setMediaPlaybackRequiresUserGesture(false);
                // Kill the overscroll gesture so pulling down at the top of a
                // scroll view can't refresh/reload the whole app.
                webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
                // Capacitor's default chrome client refuses HTML5 fullscreen
                // video; swap in ours so videos go truly fullscreen + immersive.
                webView.setWebChromeClient(new QortalWebChromeClient(this.bridge));
                // The WebView drops in-page downloads (anchor `download`, data
                // URLs, Content-Disposition: attachment) with no listener — catch
                // them and save to Documents/Qortal Go like the desktop Hub does.
                webView.setDownloadListener(new QortalDownloadListener(this.bridge));
                installSafeAreaInsetBridge(webView);
            }
        }

        // Request voice-call permissions up front so the WebView's getUserMedia()
        // is allowed during a call. Android grants the WebView mic access only when
        // the host app already holds RECORD_AUDIO at runtime.
        requestCallPermissions();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // "Share to Quitter" while the app is already running (singleTask).
        ShareReceiverPlugin.handleSendIntent(this, intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        // The WebView/Chromium compositor surface can stall after the screen
        // turns off/on or the app returns from background, leaving a blank
        // (dark base color) view until the user touches it. Force a repaint.
        forceWebViewRedraw();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Rotation keeps this activity alive (configChanges in the manifest), so
        // re-apply insets and force the WebView to re-measure for the new size.
        forceWebViewRedraw();
    }

    /**
     * Re-apply safe-area insets and force an invalidate + relayout so the
     * WebView content repaints immediately instead of showing the gray base
     * color after a resume or rotation.
     */
    private void forceWebViewRedraw() {
        if (this.bridge == null) {
            return;
        }
        final WebView webView = this.bridge.getWebView();
        if (webView == null) {
            return;
        }
        webView.post(() -> {
            webView.invalidate();
            webView.requestLayout();
            applySafeAreaInsets(webView);
        });
    }

    private void requestCallPermissions() {
        List<String> needed = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                needed.toArray(new String[0]),
                CALL_PERMISSIONS_REQUEST_CODE
            );
        }
    }

    /** Push status/navigation bar insets into CSS variables for the WebView. */
    private void installSafeAreaInsetBridge(WebView webView) {
        Runnable apply = () -> applySafeAreaInsets(webView);
        webView.post(apply);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            // Edge-to-edge windows ignore adjustResize, so the keyboard would
            // cover the page (e.g. the chat input). Shrink the WebView by the
            // IME overlap ourselves so the page resizes like adjustResize.
            // NOTE: must be a layout margin — WebView ignores padding for
            // content layout.
            int imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            int margin = Math.max(0, imeBottom);
            android.view.ViewGroup.LayoutParams rawParams = v.getLayoutParams();
            if (rawParams instanceof android.view.ViewGroup.MarginLayoutParams) {
                android.view.ViewGroup.MarginLayoutParams params =
                    (android.view.ViewGroup.MarginLayoutParams) rawParams;
                if (params.bottomMargin != margin) {
                    params.bottomMargin = margin;
                    v.setLayoutParams(params);
                }
            }
            applySafeAreaInsets(webView);
            return insets;
        });
    }

    private void applySafeAreaInsets(WebView webView) {
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
        if (insets == null) {
            return;
        }
        // WindowInsets are physical pixels; CSS needs density-independent px.
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        boolean imeVisible = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom > 0;
        int top = Math.round(insets.getInsets(WindowInsetsCompat.Type.statusBars()).top / density);
        // With the keyboard open the WebView already ends above it (IME
        // padding) — the nav bar sits below the keyboard, so no bottom inset.
        int bottom = imeVisible
            ? 0
            : Math.round(insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom / density);
        int left = Math.round(insets.getInsets(WindowInsetsCompat.Type.displayCutout()).left / density);
        int right = Math.round(insets.getInsets(WindowInsetsCompat.Type.displayCutout()).right / density);
        String js = String.format(
            "document.documentElement.style.setProperty('--safe-area-inset-top','%dpx');"
                + "document.documentElement.style.setProperty('--safe-area-inset-bottom','%dpx');"
                + "document.documentElement.style.setProperty('--safe-area-inset-left','%dpx');"
                + "document.documentElement.style.setProperty('--safe-area-inset-right','%dpx');",
            top, bottom, left, right
        );
        webView.evaluateJavascript(js, null);
    }
}
