package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.widget.FrameLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.Arrays;

/**
 * Capacitor's BridgeWebChromeClient declines HTML5 fullscreen video (its
 * onShowCustomView immediately calls onCustomViewHidden), so videos play
 * letterboxed inside the page with the status bar still showing. This subclass
 * implements true fullscreen: the video's custom view fills the whole screen,
 * the system bars hide (immersive), and we rotate to landscape while playing.
 *
 * It also limits what pages may ask for (N-19): only GO's own page gets the
 * microphone and camera, and nobody gets location, DRM ids or MIDI.
 */
public class QortalWebChromeClient extends BridgeWebChromeClient {

    private static final String TAG = "QortalWebChrome";

    private final Bridge bridge;
    private View customView;
    private CustomViewCallback customViewCallback;
    private FrameLayout fullscreenContainer;
    private int originalOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;

    public QortalWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    /**
     * Capacitor grants every requested resource to every origin. Here only
     * GO's own page (http://localhost: calls and the QR scanner) may have the
     * microphone and camera. Q-Apps, QDN sites and anything else are denied,
     * and so is any request that includes DRM ids (PROTECTED_MEDIA_ID), MIDI
     * or another resource. An allowed request goes on to Capacitor, which
     * asks Android for RECORD_AUDIO/CAMERA as before.
     */
    @Override
    public void onPermissionRequest(final PermissionRequest request) {
        Uri origin = request.getOrigin();
        String localUrl = bridge.getLocalUrl();
        Uri app = localUrl == null ? null : Uri.parse(localUrl);
        boolean allowed = app != null && WebMediaPermissionPolicy.allow(
            origin == null ? null : origin.getScheme(),
            origin == null ? null : origin.getHost(),
            origin == null ? -1 : origin.getPort(),
            app.getScheme(),
            app.getHost(),
            app.getPort(),
            request.getResources()
        );
        if (!allowed) {
            Log.w(TAG, "Denied " + Arrays.toString(request.getResources()) + " to " + origin);
            request.deny();
            return;
        }
        super.onPermissionRequest(request);
    }

    /** GO never uses location (and declares no location permission). */
    @Override
    public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        callback.invoke(origin, false, false);
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
        Activity activity = bridge.getActivity();
        if (activity == null) {
            callback.onCustomViewHidden();
            return;
        }
        // A view is already shown — bail out per the WebView contract.
        if (customView != null) {
            callback.onCustomViewHidden();
            return;
        }

        customView = view;
        customViewCallback = callback;
        originalOrientation = activity.getRequestedOrientation();

        ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
        fullscreenContainer = new FrameLayout(activity);
        fullscreenContainer.setBackgroundColor(Color.BLACK);
        fullscreenContainer.addView(
            customView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        decor.addView(
            fullscreenContainer,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );

        // Hide the WebView behind the fullscreen video so it can't intercept
        // touches or repaint over the custom view.
        if (bridge.getWebView() != null) {
            bridge.getWebView().setVisibility(View.GONE);
        }

        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Video reads best landscape; let the sensor pick the side.
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        setSystemBarsVisible(activity, false);
    }

    @Override
    public void onHideCustomView() {
        Activity activity = bridge.getActivity();
        if (customView == null || activity == null) {
            return;
        }

        ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
        if (fullscreenContainer != null) {
            decor.removeView(fullscreenContainer);
            fullscreenContainer = null;
        }
        customView = null;

        if (bridge.getWebView() != null) {
            bridge.getWebView().setVisibility(View.VISIBLE);
        }

        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        activity.setRequestedOrientation(originalOrientation);
        setSystemBarsVisible(activity, true);

        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    private void setSystemBarsVisible(Activity activity, boolean visible) {
        View decorView = activity.getWindow().getDecorView();
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(activity.getWindow(), decorView);
        if (controller == null) {
            return;
        }
        if (visible) {
            controller.show(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.hide(WindowInsetsCompat.Type.systemBars());
        }
    }
}
