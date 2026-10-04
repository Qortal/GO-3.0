package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.os.Build;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * GO-37 / GO-29: screen protection for sensitive screens only.
 *
 * GO's page calls {@code setSecure({on: true})} when a seed phrase, private
 * key, wallet backup, approval dialog or the lock screen appears, and
 * {@code setSecure({on: false})} when it closes. Each "on" counts as one hold
 * (see {@link ScreenSecurityPolicy}), so overlapping screens work. Chats and
 * Q-Apps never ask, so they stay capturable.
 *
 * {@code setTouchProtection} works the same way for approval dialogs: taps are
 * dropped while another app's window covers the WebView, and on Android 12+
 * other apps' overlays are hidden while GO is in front.
 *
 * A new page (reload, crash recovery) drops every hold, because the screens
 * that held them are gone; the new page asks again for what it shows. Two
 * things do this, so FLAG_SECURE cannot stay stuck over chats and Q-Apps:
 * <ul>
 *   <li>MainActivity calls {@link #onPageStarted(Bridge)} from its own
 *       WebViewListener. A listener added in {@link #load()} would be lost:
 *       Capacitor 6 loads plugins inside the Bridge constructor, and
 *       Bridge.Builder.create() then replaces the whole listener list.</li>
 *   <li>The page's script calls {@code resetHolds()} once when it starts.
 *       Capacitor runs plugin calls in order on one thread, so this lands
 *       before the new page's first hold.</li>
 * </ul>
 */
@CapacitorPlugin(name = ScreenSecurityPlugin.NAME)
public class ScreenSecurityPlugin extends Plugin {
    static final String NAME = "QortalScreenSecurity";
    private static final String TAG = "QortalScreenSecurity";

    private final ScreenSecurityPolicy policy = new ScreenSecurityPolicy();

    /**
     * Drops every hold when GO's page starts loading. Called by MainActivity
     * on the UI thread.
     */
    static void onPageStarted(Bridge bridge) {
        if (bridge == null) {
            return;
        }
        PluginHandle handle = bridge.getPlugin(NAME);
        Plugin instance = handle != null ? handle.getInstance() : null;
        if (instance instanceof ScreenSecurityPlugin) {
            ((ScreenSecurityPlugin) instance).dropAllHolds();
        }
    }

    @PluginMethod
    public void setSecure(PluginCall call) {
        update(call, ScreenSecurityPolicy.Kind.SECURE);
    }

    @PluginMethod
    public void setTouchProtection(PluginCall call) {
        update(call, ScreenSecurityPolicy.Kind.TOUCH);
    }

    /** The page's script starts with no holds: forget the old page's. */
    @PluginMethod
    public void resetHolds(PluginCall call) {
        dropAllHolds();
        call.resolve();
    }

    private void dropAllHolds() {
        for (ScreenSecurityPolicy.Kind kind : policy.reset()) {
            applyToWindow(kind);
        }
    }

    private void update(PluginCall call, ScreenSecurityPolicy.Kind kind) {
        Boolean on = call.getBoolean("on");
        if (on == null) {
            call.reject("Missing 'on'");
            return;
        }
        if (policy.hold(kind, on)) {
            applyToWindow(kind);
        }
        JSObject result = new JSObject();
        result.put("on", policy.isOn(kind));
        call.resolve(result);
    }

    /**
     * Makes the window match the policy for one kind only, so a secure toggle
     * never touches the touch filter and the reverse. It reads the policy when
     * it runs on the UI thread, so quick on/off/on sequences settle on the
     * latest state.
     */
    private void applyToWindow(final ScreenSecurityPolicy.Kind kind) {
        final Activity activity = getActivity();
        if (activity == null) {
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                if (window == null) {
                    return;
                }
                if (kind == ScreenSecurityPolicy.Kind.SECURE) {
                    applySecure(window);
                } else {
                    applyTouch(window);
                }
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not update screen protection", error);
            }
        });
    }

    private void applySecure(Window window) {
        boolean secure = policy.isOn(ScreenSecurityPolicy.Kind.SECURE);
        int secureFlag = WindowManager.LayoutParams.FLAG_SECURE;
        if (!ScreenSecurityPolicy.flagNeedsChange(window.getAttributes().flags, secureFlag, secure)) {
            return;
        }
        if (secure) {
            window.addFlags(secureFlag);
        } else {
            window.clearFlags(secureFlag);
        }
    }

    private void applyTouch(Window window) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            boolean current = webView.getFilterTouchesWhenObscured();
            boolean target = policy.filterTouchesTarget(current);
            if (current != target) {
                webView.setFilterTouchesWhenObscured(target);
            }
        }
        if (ScreenSecurityPolicy.canHideOverlays(Build.VERSION.SDK_INT)) {
            applyHideOverlays(window, policy.isOn(ScreenSecurityPolicy.Kind.TOUCH));
        }
    }

    private static void applyHideOverlays(Window window, boolean hide) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return;
        }
        try {
            // Needs HIDE_OVERLAY_WINDOWS (a normal permission, see the manifest).
            window.setHideOverlayWindows(hide);
        } catch (SecurityException error) {
            Log.w(TAG, "Cannot hide overlay windows", error);
        }
    }
}
