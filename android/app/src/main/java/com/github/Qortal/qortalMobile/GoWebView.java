package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import androidx.core.view.inputmethod.EditorInfoCompat;
import androidx.core.view.inputmethod.InputConnectionCompat;
import com.getcapacitor.CapacitorWebView;

/**
 * Capacitor's WebView, plus pictures from the keyboard.
 *
 * Keyboards insert pictures (Gboard's clipboard bar, GIFs, stickers) through
 * the input connection's commitContent, and only offer them to editors that
 * say which image types they take; the stock WebView says none. This one
 * declares image types and passes what a keyboard commits to
 * {@link QortalClipboardPlugin}, which hands it to the chat composer. Only a
 * focused chat composer accepts: anywhere else the keyboard is told no.
 * Every other call goes straight to the WebView's own input connection.
 *
 * Also shows every touch to {@link ImmersivePlugin} first (it only reads
 * them), so immersive mode can tell scrolling inside Q-App frames.
 *
 * Swapped in for Capacitor's through res/layout/bridge_layout_main.xml.
 */
public class GoWebView extends CapacitorWebView {

  private static final String[] IMAGE_TYPES = new String[] {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  };

  public GoWebView(Context context, AttributeSet attrs) {
    super(context, attrs);
  }

  @Override
  public boolean dispatchTouchEvent(MotionEvent event) {
    ImmersivePlugin.onWebViewTouch(this, event);
    return super.dispatchTouchEvent(event);
  }

  @Override
  public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
    InputConnection connection = super.onCreateInputConnection(outAttrs);
    if (connection == null) return null;
    try {
      EditorInfoCompat.setContentMimeTypes(outAttrs, IMAGE_TYPES);
      return InputConnectionCompat.createWrapper(
        connection,
        outAttrs,
        (info, flags, opts) -> {
          QortalClipboardPlugin plugin = QortalClipboardPlugin.instance;
          if (plugin == null || !QortalClipboardPlugin.imageTargetActive) {
            return false;
          }
          boolean needsPermission =
            (flags & InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0;
          if (needsPermission) {
            try {
              info.requestPermission();
            } catch (Exception error) {
              return false;
            }
          }
          String type = info.getDescription().getMimeTypeCount() > 0
            ? info.getDescription().getMimeType(0)
            : null;
          plugin.deliverKeyboardImage(info.getContentUri(), type, () -> {
            if (needsPermission) {
              try {
                info.releasePermission();
              } catch (Exception ignored) {
                /* already gone */
              }
            }
          });
          return true;
        }
      );
    } catch (Exception error) {
      // Never let this cost the keyboard: plain typing still works.
      return connection;
    }
  }
}
