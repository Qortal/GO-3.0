package com.github.Qortal.qortalMobile;

import android.app.Activity;
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
 * deterministic.
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
        // Hidden status bar (immersive mode): the cutout still counts.
        int top = Math.max(
          insets.getInsets(WindowInsetsCompat.Type.statusBars()).top,
          insets.getInsets(WindowInsetsCompat.Type.displayCutout()).top
        );
        // Keyboard open: the WebView is already shrunk above the IME and the
        // nav bar sits below the keyboard — no bottom inset (must match
        // MainActivity.applySafeAreaInsets, which writes the same CSS vars).
        boolean imeVisible =
          insets.getInsets(WindowInsetsCompat.Type.ime()).bottom > 0;
        int bottom = imeVisible
          ? 0
          : insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
        int left = insets.getInsets(
          WindowInsetsCompat.Type.displayCutout()
        ).left;
        int right = insets.getInsets(
          WindowInsetsCompat.Type.displayCutout()
        ).right;
        ret.put("top", Math.round(top / density));
        ret.put("bottom", Math.round(bottom / density));
        ret.put("left", Math.round(left / density));
        ret.put("right", Math.round(right / density));
        call.resolve(ret);
      } catch (Exception e) {
        call.reject("Failed to read insets: " + e.getMessage());
      }
    });
  }
}
