package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.content.res.Configuration;
import android.view.View;
import android.view.ViewParent;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reports system bar/cutout insets to the WebView in CSS pixels.
 *
 * MainActivity also pushes --safe-area-inset-* vars via evaluateJavascript,
 * but that races the page load (vars injected into the splash document are
 * lost when the app document replaces it, and the inset listener only fires
 * on changes). The JS queries this plugin at boot so the values are
 * deterministic. It also returns the window metrics MainActivity pushes
 * (windowWidth, windowHeight, ime, insetLeft, insetRight, smallestWidthDp).
 */
@CapacitorPlugin(name = "SafeArea")
public class SafeAreaPlugin extends Plugin {

  @PluginMethod
  public void getInsets(PluginCall call) {
    Activity activity = getActivity();
    if (activity == null) {
      call.reject("No activity");
      return;
    }
    activity.runOnUiThread(() -> {
      try {
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(
          bridge.getWebView()
        );
        float density = activity.getResources().getDisplayMetrics().density;
        JSObject ret = new JSObject();
        if (insets == null || density <= 0) {
          ret.put("top", 0);
          ret.put("bottom", 0);
          ret.put("left", 0);
          ret.put("right", 0);
          call.resolve(ret);
          return;
        }
        // Same math as MainActivity, which writes the same CSS vars:
        // immersive mode still counts the cutout, the keyboard drops the
        // bottom inset, and landscape side margins zero the sides.
        boolean landscape =
          activity.getResources().getConfiguration().orientation ==
          Configuration.ORIENTATION_LANDSCAPE;
        SafeAreaInsetsPolicy.Result r = SafeAreaInsetsPolicy.fromInsets(
          insets,
          landscape,
          density
        );
        ret.put("top", r.cssTop);
        ret.put("bottom", r.cssBottom);
        ret.put("left", r.cssLeft);
        ret.put("right", r.cssRight);
        // Window metrics for the page's layout store, so a reloaded page
        // has them before the next native push.
        ViewParent parent = bridge.getWebView().getParent();
        if (parent instanceof View) {
          SafeAreaInsetsPolicy.Metrics m = SafeAreaInsetsPolicy.metrics(
            ((View) parent).getWidth(),
            ((View) parent).getHeight(),
            r,
            density,
            activity.getResources().getConfiguration().smallestScreenWidthDp
          );
          if (m != null) {
            ret.put("windowWidth", m.width);
            ret.put("windowHeight", m.height);
            ret.put("ime", m.ime);
            ret.put("insetLeft", m.insetLeft);
            ret.put("insetRight", m.insetRight);
            ret.put("smallestWidthDp", m.smallestWidthDp);
          }
        }
        call.resolve(ret);
      } catch (Exception e) {
        call.reject("Failed to read insets: " + e.getMessage());
      }
    });
  }
}
