package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.content.Context;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puts the soft keyboard back up for whatever the WebView has focused.
 *
 * Android drops the keyboard on the smallest focus wobble — a menu opening over
 * the composer, an attachment being removed, a file picker coming and going —
 * and re-focusing the editor from JavaScript does not bring it back, because to
 * the browser the element never stopped being focused. The IME only listens to
 * the platform, so the platform is what asks.
 */
@CapacitorPlugin(name = "QortalSoftKeyboard")
public class SoftKeyboardPlugin extends Plugin {

  @PluginMethod
  public void show(PluginCall call) {
    final Activity activity = getActivity();
    if (activity == null) {
      call.resolve();
      return;
    }
    activity.runOnUiThread(() -> {
      try {
        View view = getBridge() != null ? getBridge().getWebView() : null;
        if (view == null) return;
        if (!view.hasFocus()) view.requestFocus();
        InputMethodManager manager = (InputMethodManager) activity.getSystemService(
          Context.INPUT_METHOD_SERVICE
        );
        if (manager != null) {
          manager.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT);
        }
      } catch (Exception ignored) {
        /* nothing to type into */
      }
    });
    call.resolve();
  }
}
