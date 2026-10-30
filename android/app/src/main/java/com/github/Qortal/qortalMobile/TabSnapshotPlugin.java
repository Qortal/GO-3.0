package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;

/**
 * Small pictures of open Q-Apps and websites for GO's tab cards, like a
 * browser's tab switcher.
 *
 * The page passes the frame's box in CSS pixels; this copies those pixels
 * from GO's own window with {@link PixelCopy}, which scales them straight
 * into a small bitmap, and returns a JPEG. Nothing is written to disk. The
 * page never asks while a protected screen (FLAG_SECURE) is up.
 */
@CapacitorPlugin(name = "QortalTabSnapshot")
public class TabSnapshotPlugin extends Plugin {

  private static final int MAX_TARGET_WIDTH = 720;

  private HandlerThread thread;
  private Handler handler;
  private boolean destroyed;

  /** The PixelCopy thread, started on the first tab picture. Null once the plugin is destroyed. */
  private synchronized Handler handler() {
    if (destroyed) {
      return null;
    }
    if (handler == null) {
      thread = new HandlerThread("QortalTabSnapshot");
      thread.start();
      handler = new Handler(thread.getLooper());
    }
    return handler;
  }

  @Override
  protected synchronized void handleOnDestroy() {
    destroyed = true;
    if (thread != null) {
      thread.quitSafely();
    }
  }

  @PluginMethod
  public void capture(PluginCall call) {
    final double x = call.getDouble("x", 0d);
    final double y = call.getDouble("y", 0d);
    final double width = call.getDouble("width", 0d);
    final double height = call.getDouble("height", 0d);
    final double dpr = Math.max(0.5d, call.getDouble("dpr", 1d));
    final int targetWidth =
        Math.max(64, Math.min(MAX_TARGET_WIDTH, call.getInt("targetWidth", 360)));
    final int quality = Math.max(30, Math.min(95, call.getInt("quality", 72)));
    final Activity activity = getActivity();
    if (activity == null || width <= 0 || height <= 0) {
      call.reject("nothing to capture");
      return;
    }
    final Handler h = handler();
    if (h == null) {
      call.reject("no window");
      return;
    }

    activity.runOnUiThread(
        () -> {
          try {
            Window window = activity.getWindow();
            View webView = getBridge().getWebView();
            if (window == null || webView == null || !webView.isAttachedToWindow()) {
              call.reject("no window");
              return;
            }
            int[] origin = new int[2];
            webView.getLocationInWindow(origin);
            Rect source =
                new Rect(
                    origin[0] + (int) Math.round(x * dpr),
                    origin[1] + (int) Math.round(y * dpr),
                    origin[0] + (int) Math.round((x + width) * dpr),
                    origin[1] + (int) Math.round((y + height) * dpr));
            View decor = window.getDecorView();
            source.intersect(0, 0, decor.getWidth(), decor.getHeight());
            if (source.width() < 16 || source.height() < 16) {
              call.reject("frame off screen");
              return;
            }
            int outWidth = Math.min(targetWidth, source.width());
            int outHeight =
                Math.max(1, Math.round(outWidth * (source.height() / (float) source.width())));
            Bitmap bitmap = Bitmap.createBitmap(outWidth, outHeight, Bitmap.Config.ARGB_8888);
            PixelCopy.request(
                window,
                source,
                bitmap,
                result -> {
                  if (result != PixelCopy.SUCCESS) {
                    bitmap.recycle();
                    call.reject("copy failed: " + result);
                    return;
                  }
                  ByteArrayOutputStream out = new ByteArrayOutputStream();
                  bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out);
                  bitmap.recycle();
                  JSObject ret = new JSObject();
                  ret.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                  ret.put("width", outWidth);
                  ret.put("height", outHeight);
                  call.resolve(ret);
                },
                h);
          } catch (Exception e) {
            call.reject("capture failed", e);
          }
        });
  }
}
