package com.github.Qortal.qortalMobile;

import com.github.Qortal.qortalMobile.QortalBiometricPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.github.Qortal.qortalMobile.NativeBcrypt;
import com.github.Qortal.qortalMobile.NativePOW;
import com.github.Qortal.qortalMobile.FileWriter;
import com.github.Qortal.qortalMobile.NetworkInfoPlugin;
import com.github.Qortal.qortalMobile.ReticulumPlugin;
import com.github.Qortal.qortalMobile.AudioRoutingPlugin;
import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.RenderProcessGoneDetail;
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
    private static final String TAG = "QortalGo";
    private static final int CALL_PERMISSIONS_REQUEST_CODE = 0x5101;
    /** Ignore duplicate resume/focus redraw requests within this window. */
    private static final long WEBVIEW_REDRAW_DEBOUNCE_MS = 400L;
    private long lastWebViewRedrawAtMs = 0L;
    /** Set once a renderer death is being recovered from, to avoid re-entry. */
    private boolean recoveringRenderProcess = false;
    /** Last window metrics handed to the page; identical pushes are skipped. */
    private SafeAreaInsetsPolicy.Metrics lastWindowMetrics = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate, which builds the Bridge and reads it.
        clearPersistedServerBasePath();
        registerPlugin(NativeBcrypt.class);
        registerPlugin(NativePOW.class);
        registerPlugin(FileWriter.class);
        // EncryptedMediaServerPlugin is not registered: no JS calls it
        // (encrypted media playback is Electron-only), so it is only an
        // unused local HTTP server reachable from page script.
        registerPlugin(NetworkInfoPlugin.class);
        registerPlugin(QortalBackgroundPlugin.class);
        registerPlugin(ReticulumPlugin.class);
        registerPlugin(AudioRoutingPlugin.class);
        registerPlugin(QortalBiometricPlugin.class);
        registerPlugin(SafeAreaPlugin.class);
        // Immersive mode: status bar hiding + finger direction over frames.
        registerPlugin(ImmersivePlugin.class);
        registerPlugin(SectionSwipePlugin.class);
        registerPlugin(VideoCompressPlugin.class);
        registerPlugin(QortinoLlmPlugin.class);
        registerPlugin(ShareReceiverPlugin.class);
        registerPlugin(QortalClipboardPlugin.class);
        registerPlugin(SoftKeyboardPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        // Replaces Capacitor's own "WebView" plugin (N-18): see the class.
        registerPlugin(LockedWebViewPlugin.class);
        // FLAG_SECURE and overlay protection for sensitive screens (GO-37).
        registerPlugin(ScreenSecurityPlugin.class);
        // Small in-memory pictures of open Q-Apps for the tab cards.
        registerPlugin(TabSnapshotPlugin.class);
        // Private Q-Apps unpacked on the phone and served from memory (a
        // public node cannot build them, and should not see them decrypted).
        registerPlugin(PrivateQappPlugin.class);
        // Qortal Card (testing): APDUs to a contactless card, only while the
        // Qortal Card screen waits for a tap.
        registerPlugin(QortalNfcPlugin.class);
        // Voice calls: ringing, call notification buttons, lock screen.
        registerPlugin(QortalCallPlugin.class);
        super.onCreate(savedInstanceState);
        // Voice calls: show over the lock screen while a call rings or runs,
        // and Accept / a call notification tap that started GO (cold start).
        CallSession.get(this).attachActivity(this);
        CallSession.get(this).onLaunchIntent(getIntent(), savedInstanceState != null);
        // Home and VPN node addresses never go to a carrier or Wi-Fi proxy.
        WebViewProxyBypass.start(this);
        // "Share to Quitter": photos/videos shared from other apps (cold start).
        ShareReceiverPlugin.handleSendIntent(this, getIntent());
        // Edge-to-edge: WebView draws under system bars; CSS safe-area vars pad content.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Bank-app unlock: if fingerprint unlock is configured, show the system
        // prompt immediately so the scan runs while the WebView boots.
        if (savedInstanceState == null) {
            QortalBiometricPlugin.maybeShowEarlyPrompt(this);
        }

        if (this.bridge != null) {
            WebView webView = this.bridge.getWebView();
            if (webView != null) {
                WebSettings webSettings = webView.getSettings();
                // Mixed-content rules only apply to https pages: Q-Apps from an
                // https node or gateway. Like a browser, they may still show
                // http images and media, but no longer run http scripts or
                // fetch over http (N-19). GO's own page is http://localhost,
                // which this does not touch.
                webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
                webSettings.setMediaPlaybackRequiresUserGesture(false);
                // Seed phrases, keys and approval dialogs are WebView text.
                // Hide it from accessibility services that are not
                // accessibility tools (TalkBack, Switch Access and Voice
                // Access still work) (N-34).
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    webView.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES);
                }
                // Keep the wallet password away from Android Autofill and
                // password managers: they would offer to save it, and a saved
                // copy syncs to the provider's cloud (N-33). This hides every
                // field in the WebView from Autofill, Q-Apps included. Typing
                // and pasting are not affected. minSdk is 26 (Android 8), where
                // Autofill starts, so no version check is needed.
                webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
                // Kill the overscroll gesture so pulling down at the top of a
                // scroll view can't refresh/reload the whole app.
                webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
                // Opaque dark base — if the Chromium surface stalls after screen
                // wake, the user sees the app shell color instead of theme grey.
                int shellBg = ContextCompat.getColor(this, R.color.splashBackground);
                webView.setBackgroundColor(shellBg);
                getWindow().setBackgroundDrawableResource(R.color.splashBackground);
                // Capacitor's default chrome client refuses HTML5 fullscreen
                // video; swap in ours so videos go truly fullscreen + immersive.
                webView.setWebChromeClient(new QortalWebChromeClient(this.bridge));
                // The WebView drops in-page downloads (anchor `download`, data
                // URLs, Content-Disposition: attachment) with no listener — catch
                // them and save to Documents/Qortal Go like the desktop Hub does.
                webView.setDownloadListener(new QortalDownloadListener(this.bridge));
                // Outside content (Q-Apps, QDN sites, chat links) must never
                // get a page on GO's own origin (GO-01, CVE-2026-103922).
                this.bridge.setWebViewClient(new AppOriginGuardWebViewClient(this.bridge));
                installSafeAreaInsetBridge(webView);
                // Background sync: keeps this page awake off screen when the
                // user's mode asks for it (see BackgroundKeepAlive).
                BackgroundKeepAlive.get(this).attachWebView(webView);
                installWindowVisibilitySentinel();
            }
            // Android kills the WebView's renderer process under memory
            // pressure while we're backgrounded — likely here because the
            // embedded Python/RNS transport keeps the app heavy. Unhandled,
            // that leaves a permanently blank surface after screen wake and the
            // user has to force-close. Rebuild the activity instead.
            this.bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageStarted(WebView view) {
                    // A reload or navigation starts a signed-out page; login
                    // marks the session again (status service / presence).
                    BackgroundKeepAlive.get(MainActivity.this).setSessionActive(false);
                    // The screens that held FLAG_SECURE are gone with the old
                    // page; the new page asks again for what it shows (GO-37).
                    ScreenSecurityPlugin.onPageStarted(MainActivity.this.bridge);
                    // No card reading for a page that never asked for it.
                    QortalNfcPlugin.onPageStarted(MainActivity.this.bridge);
                    // A call ran in the old page (reload, crash fallback): it
                    // is over; its microphone service, call notification and
                    // call audio must not outlive it.
                    CallSession.get(MainActivity.this).onPageGone("page-started");
                    // The new document has no metrics yet; the next push must
                    // not be skipped as a repeat (SafeArea.getInsets also
                    // hands them over at boot).
                    lastWindowMetrics = null;
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        && detail != null
                        && detail.didCrash();
                    Log.w(TAG, "WebView render process gone (crashed=" + crashed + "); recovering");
                    // The next page's Copy diagnostics says why it restarted.
                    RendererGoneLog.record(MainActivity.this, crashed);
                    recoverFromRenderProcessGone(view);
                    return true;
                }
            });
        }

        // Notifications (Android 13+): incoming calls and messages ring through
        // them. The microphone is not asked here: the first call (or voice
        // message) asks for it when the page starts the microphone
        // (QortalWebChromeClient -> Capacitor), instead of a prompt on every
        // start while it is not granted.
        requestCallPermissions();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // "Share to Quitter" while the app is already running (singleTask).
        ShareReceiverPlugin.handleSendIntent(this, intent);
        // Accept / a call notification tap while GO runs.
        CallSession.get(this).onLaunchIntent(intent);
    }

    @Override
    public void onStart() {
        super.onStart();
        BackgroundKeepAlive.get(this).onActivityStart();
        // A ring moves from the tray to the page's own call screen.
        CallSession.get(this).onActivityVisibility(true);
    }

    @Override
    public void onStop() {
        super.onStop();
        BackgroundKeepAlive.get(this).onActivityStop();
        // A ring the page showed moves to the tray (ringtone, lock screen).
        CallSession.get(this).onActivityVisibility(false);
    }

    @Override
    public void onDestroy() {
        if (this.bridge != null) {
            BackgroundKeepAlive.get(this).detachWebView(this.bridge.getWebView());
        }
        CallSession.get(this).detachActivity(this);
        if (isFinishing()) WebViewProxyBypass.stop(this);
        super.onDestroy();
    }

    /** See BackgroundKeepAlive.WindowVisibilitySentinel. */
    private void installWindowVisibilitySentinel() {
        try {
            ViewGroup content = findViewById(android.R.id.content);
            if (content != null) {
                content.addView(
                    new BackgroundKeepAlive.WindowVisibilitySentinel(this),
                    new ViewGroup.LayoutParams(0, 0)
                );
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Window visibility sentinel not installed", error);
        }
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
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Returning from the lock screen or the recents switcher can regain
        // focus without another onResume, and that path blanks just as often.
        if (hasFocus) {
            forceWebViewRedraw();
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Rotation keeps this activity alive (configChanges in the manifest), so
        // re-apply insets and force the WebView to re-measure for the new size.
        // Insets first: side margins depend on the orientation, and the page's
        // layout store wants the new smallestScreenWidthDp right away.
        if (this.bridge != null && this.bridge.getWebView() != null && !recoveringRenderProcess) {
            final WebView webView = this.bridge.getWebView();
            webView.post(() -> {
                ViewCompat.requestApplyInsets(webView);
                pushWindowMetrics(webView, null);
            });
        }
        forceWebViewRedraw();
    }

    /**
     * Re-apply safe-area insets and nudge the WebView to produce a fresh frame
     * after resume/focus/rotation.
     *
     * Keep this light: a burst of body display:none toggles (from onResume +
     * onWindowFocusChanged + the JS bridge) was causing a multi-second flicker
     * after unlock. One soft invalidate plus a single compositor wake is enough
     * for the grey-screen stall without visibly glitching the UI.
     */
    private void forceWebViewRedraw() {
        if (this.bridge == null || recoveringRenderProcess) {
            return;
        }
        final WebView webView = this.bridge.getWebView();
        if (webView == null) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastWebViewRedrawAtMs < WEBVIEW_REDRAW_DEBOUNCE_MS) {
            return;
        }
        lastWebViewRedrawAtMs = now;
        webView.post(() -> nudgeWebViewCompositor(webView, true));
        // One soft follow-up for OEMs that restore the window a frame late —
        // no second display toggle.
        webView.postDelayed(() -> nudgeWebViewCompositor(webView, false), 250L);
    }

    private void nudgeWebViewCompositor(WebView webView, boolean wakeCompositor) {
        try {
            webView.onResume();
            webView.resumeTimers();
        } catch (RuntimeException ignored) {
            // Older WebView builds can throw if the view is detaching.
        }
        webView.invalidate();
        webView.requestLayout();
        if (wakeCompositor) {
            // Single Chromium wake: temporary opacity flicker is far less
            // disruptive than display:none, and still forces a new layer.
            webView.evaluateJavascript(
                "(function(){var r=document.documentElement;if(!r)return;"
                    + "void r.offsetHeight;"
                    + "var x=window.scrollX,y=window.scrollY;"
                    + "window.scrollTo(x,y===0?0:y);"
                    + "window.dispatchEvent(new Event('resize'));})();",
                null
            );
        }
        applySafeAreaInsets(webView, null);
    }

    /**
     * A WebView whose renderer died can never paint again, so the dead view has
     * to be detached and destroyed before a replacement can be built. Recreating
     * the activity gives Capacitor a fresh bridge + WebView; the foreground
     * service and Python transport survive it.
     */
    private void recoverFromRenderProcessGone(WebView deadWebView) {
        if (recoveringRenderProcess) {
            return;
        }
        recoveringRenderProcess = true;
        // Never dispatch to the dead view; the recreated Activity attaches anew.
        BackgroundKeepAlive.get(this).detachWebView(deadWebView);
        try {
            if (deadWebView != null) {
                ViewParent parent = deadWebView.getParent();
                if (parent instanceof ViewGroup) {
                    ((ViewGroup) parent).removeView(deadWebView);
                }
                deadWebView.destroy();
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Failed to tear down dead WebView", error);
        }
        new Handler(Looper.getMainLooper()).post(() -> {
            if (isFinishing() || isDestroyed()) {
                return;
            }
            recreate();
        });
    }

    /**
     * N-18: Capacitor's WebView plugin can save a folder to serve GO's page
     * from on every later start (serverBasePath in CapWebViewSettings), and
     * the Preferences plugin can write that file too. GO never uses it, so a
     * saved path can only come from injected script trying to stay after a
     * restart. res/xml/config.xml sets DisableDeploy so Capacitor ignores the
     * key; removing it as well keeps that true if config.xml is regenerated.
     */
    private void clearPersistedServerBasePath() {
        try {
            SharedPreferences prefs = getSharedPreferences(
                com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME,
                MODE_PRIVATE
            );
            String key = com.getcapacitor.plugin.WebView.CAP_SERVER_PATH;
            if (!prefs.contains(key)) {
                return;
            }
            Object saved = prefs.getAll().get(key);
            prefs.edit().remove(key).commit();
            // Capacitor itself saves "" here after every app update, so only
            // a real path (or a value of another type) is worth a warning.
            if (saved != null && !"".equals(saved)) {
                Log.w(TAG, "Removed a saved Capacitor server path");
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not check the saved Capacitor server path", error);
        }
    }

    /**
     * N-18: takes the place of Capacitor's core "WebView" plugin, which
     * registers first under the same name, so this one wins. The core plugin
     * lets page script point GO's local server at any folder or asset path
     * (setServerBasePath, setServerAssetPath). That holds for every later
     * reload, logout included, until the activity is rebuilt, so a one-off
     * script injection could serve a fake GO from a file it wrote. GO never
     * calls these, so they are refused; reading the current path still works.
     */
    @CapacitorPlugin(name = "WebView")
    public static class LockedWebViewPlugin extends Plugin {
        private static final String REFUSED = "Changing where GO is served from is not allowed";

        @PluginMethod
        public void setServerAssetPath(PluginCall call) {
            Log.w(TAG, "Refused WebView.setServerAssetPath");
            call.reject(REFUSED);
        }

        @PluginMethod
        public void setServerBasePath(PluginCall call) {
            Log.w(TAG, "Refused WebView.setServerBasePath");
            call.reject(REFUSED);
        }

        @PluginMethod
        public void persistServerBasePath(PluginCall call) {
            Log.w(TAG, "Refused WebView.persistServerBasePath");
            call.reject(REFUSED);
        }

        @PluginMethod
        public void getServerBasePath(PluginCall call) {
            JSObject ret = new JSObject();
            ret.put("path", getBridge().getServerBasePath());
            call.resolve(ret);
        }
    }

    private void requestCallPermissions() {
        List<String> needed = new ArrayList<>();
        // RECORD_AUDIO is asked in context, when a call (or voice message)
        // starts the microphone: Capacitor's onPermissionRequest asks Android
        // for it, after QortalWebChromeClient allowed GO's own page. A call
        // started off screen without it keeps the base service type
        // (QortalForegroundService.applyCallForeground) and gets the
        // microphone type once GO is back on screen with it granted
        // (CallSession.onAppForeground).
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

    /**
     * Push status/navigation bar insets into CSS variables for the WebView,
     * shrink it by the keyboard, by a nav bar with buttons (and, in
     * landscape, by side system bars), and hand the window metrics to the
     * page (see SafeAreaInsetsPolicy).
     */
    private void installSafeAreaInsetBridge(WebView webView) {
        Runnable apply = () -> applySafeAreaInsets(webView, null);
        webView.post(apply);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            // Edge-to-edge windows ignore adjustResize, so the keyboard would
            // cover the page (e.g. the chat input). Shrink the WebView by the
            // IME overlap ourselves so the page resizes like adjustResize.
            // A 3-button (or 2-button) nav bar takes every touch, so the
            // WebView ends above it too; the page colour (setBarAppearance)
            // shows behind the buttons. Gesture navigation is unchanged.
            // NOTE: must be a layout margin — WebView ignores padding for
            // content layout.
            SafeAreaInsetsPolicy.Result r =
                SafeAreaInsetsPolicy.fromInsets(insets, isLandscape(), density());
            android.view.ViewGroup.LayoutParams rawParams = v.getLayoutParams();
            if (rawParams instanceof android.view.ViewGroup.MarginLayoutParams) {
                android.view.ViewGroup.MarginLayoutParams params =
                    (android.view.ViewGroup.MarginLayoutParams) rawParams;
                if (params.bottomMargin != r.marginBottom
                        || params.leftMargin != r.marginLeft
                        || params.rightMargin != r.marginRight) {
                    params.bottomMargin = r.marginBottom;
                    params.leftMargin = r.marginLeft;
                    params.rightMargin = r.marginRight;
                    v.setLayoutParams(params);
                }
            }
            applySafeAreaInsets(webView, insets);
            pushWindowMetrics(webView, insets);
            return insets;
        });
        // Split screen, folds and freeform windows can change the size with
        // no insets change; the page's layout store still needs the height.
        ViewParent parent = webView.getParent();
        if (parent instanceof View) {
            ((View) parent).addOnLayoutChangeListener(
                (view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
                    if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) {
                        pushWindowMetrics(webView, null);
                    }
                }
            );
        }
    }

    private boolean isLandscape() {
        return getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
    }

    /** WindowInsets are physical pixels; CSS needs density-independent px. */
    private float density() {
        float density = getResources().getDisplayMetrics().density;
        return density > 0 ? density : 1f;
    }

    private void applySafeAreaInsets(WebView webView, WindowInsetsCompat given) {
        WindowInsetsCompat insets = given != null ? given : ViewCompat.getRootWindowInsets(webView);
        if (insets == null) {
            return;
        }
        // Immersive mode hides the status bar; the camera cutout still keeps
        // content clear of the punch hole. With the keyboard open, or a nav
        // bar with buttons, the WebView already ends above it, so no bottom
        // inset. In landscape the side margins cover the nav bar and cutout,
        // so the sides are 0.
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.fromInsets(insets, isLandscape(), density());
        // Redraw and focus callbacks can land before the WebView has a document,
        // so bail out rather than throwing on a null documentElement.
        String js = String.format(
            java.util.Locale.ROOT,
            "(function(){var r=document.documentElement;if(!r)return;"
                + "r.style.setProperty('--safe-area-inset-top','%dpx');"
                + "r.style.setProperty('--safe-area-inset-bottom','%dpx');"
                + "r.style.setProperty('--safe-area-inset-left','%dpx');"
                + "r.style.setProperty('--safe-area-inset-right','%dpx');})();",
            r.cssTop, r.cssBottom, r.cssLeft, r.cssRight
        );
        webView.evaluateJavascript(js, null);
    }

    /**
     * Hands the window size, keyboard height and side margins to the page's
     * layout store (src/layout/goLayout.ts) so its layout never mistakes the
     * keyboard for a smaller window. Skipped when nothing changed.
     */
    private void pushWindowMetrics(WebView webView, WindowInsetsCompat given) {
        if (recoveringRenderProcess) {
            return;
        }
        ViewParent rawParent = webView.getParent();
        if (!(rawParent instanceof View)) {
            return;
        }
        View parent = (View) rawParent;
        WindowInsetsCompat insets = given != null ? given : ViewCompat.getRootWindowInsets(webView);
        if (insets == null) {
            return;
        }
        float density = density();
        SafeAreaInsetsPolicy.Metrics m = SafeAreaInsetsPolicy.metrics(
            parent.getWidth(),
            parent.getHeight(),
            SafeAreaInsetsPolicy.fromInsets(insets, isLandscape(), density),
            density,
            getResources().getConfiguration().smallestScreenWidthDp
        );
        if (m == null || m.equals(lastWindowMetrics)) {
            return;
        }
        lastWindowMetrics = m;
        webView.evaluateJavascript(SafeAreaInsetsPolicy.metricsScript(m), null);
    }
}
