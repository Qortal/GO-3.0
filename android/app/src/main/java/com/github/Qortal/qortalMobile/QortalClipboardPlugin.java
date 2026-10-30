package com.github.Qortal.qortalMobile;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.webkit.MimeTypeMap;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Pictures on the Android clipboard, for the chat composer.
 *
 * The WebView cannot put a picture on the clipboard (navigator.clipboard
 * only writes text there) and does not reliably hand one to a page on paste,
 * so this does both natively: {@link #describe} says whether a picture is
 * there without reading it (reading would show Android's "pasted from your
 * clipboard" notice), {@link #readImage} reads it when the user pastes, and
 * {@link #writeImage} copies one, shared through the app's FileProvider so
 * other apps can paste it too. Keyboards that insert pictures (Gboard's
 * clipboard bar) reach the composer through {@link GoWebView}, which hands
 * them to {@link #deliverKeyboardImage}.
 */
@CapacitorPlugin(name = "QortalClipboard")
public class QortalClipboardPlugin extends Plugin {

  private static final String TAG = "QortalClipboard";
  /** Bigger than any picture the composer will take; it sizes them down. */
  private static final int MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  private static final String CLIP_DIR = "clipboard";

  static volatile QortalClipboardPlugin instance;
  /** True while a chat composer has focus: only it takes keyboard pictures. */
  static volatile boolean imageTargetActive = false;

  private final ExecutorService io = Executors.newSingleThreadExecutor();

  @Override
  public void load() {
    instance = this;
  }

  @Override
  protected void handleOnDestroy() {
    if (instance == this) instance = null;
    super.handleOnDestroy();
  }

  private ClipboardManager clipboard() {
    return (ClipboardManager) getContext().getSystemService(
      Context.CLIPBOARD_SERVICE
    );
  }

  @PluginMethod
  public void describe(PluginCall call) {
    JSObject result = new JSObject();
    result.put("hasImage", false);
    try {
      ClipboardManager manager = clipboard();
      ClipDescription description = manager != null
        ? manager.getPrimaryClipDescription()
        : null;
      if (description != null && description.hasMimeType("image/*")) {
        result.put("hasImage", true);
        result.put(
          "stamp",
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? description.getTimestamp()
            : 0
        );
      }
    } catch (Exception error) {
      Log.w(TAG, "describe failed", error);
    }
    call.resolve(result);
  }

  @PluginMethod
  public void readImage(PluginCall call) {
    io.execute(() -> {
      try {
        ClipboardManager manager = clipboard();
        ClipData clip = manager != null ? manager.getPrimaryClip() : null;
        Uri uri = null;
        if (clip != null) {
          for (int index = 0; index < clip.getItemCount(); index++) {
            Uri candidate = clip.getItemAt(index).getUri();
            if (candidate != null && isImage(candidate, clip.getDescription())) {
              uri = candidate;
              break;
            }
          }
        }
        if (uri == null) {
          call.resolve(new JSObject());
          return;
        }
        call.resolve(readUri(uri, null));
      } catch (Exception error) {
        Log.w(TAG, "readImage failed", error);
        call.reject("Could not read the picture on the clipboard");
      }
    });
  }

  @PluginMethod
  public void writeImage(PluginCall call) {
    String base64 = call.getString("base64");
    String mimeType = call.getString("mimeType", "image/png");
    if (base64 == null || base64.isEmpty()) {
      call.reject("No picture to copy");
      return;
    }
    io.execute(() -> {
      try {
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        File dir = new File(getContext().getCacheDir(), CLIP_DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException(
          "No clipboard folder"
        );
        // Only the latest copy is kept; the clipboard holds one thing.
        File[] old = dir.listFiles();
        if (old != null) for (File file : old) file.delete();
        String extension = MimeTypeMap.getSingleton()
          .getExtensionFromMimeType(mimeType);
        File file = new File(
          dir,
          "image-" +
          System.currentTimeMillis() +
          "." +
          (extension != null ? extension : "png")
        );
        try (FileOutputStream out = new FileOutputStream(file)) {
          out.write(bytes);
        }
        Uri uri = FileProvider.getUriForFile(
          getContext(),
          getContext().getPackageName() + ".fileprovider",
          file
        );
        new Handler(Looper.getMainLooper()).post(() -> {
          try {
            ClipData clip = ClipData.newUri(
              getContext().getContentResolver(),
              "image",
              uri
            );
            clipboard().setPrimaryClip(clip);
            Log.i(TAG, "copied " + mimeType + " " + bytes.length + " B");
            call.resolve();
          } catch (Exception error) {
            Log.w(TAG, "setPrimaryClip failed", error);
            call.reject("Could not copy the picture");
          }
        });
      } catch (Exception error) {
        Log.w(TAG, "writeImage failed", error);
        call.reject("Could not copy the picture");
      }
    });
  }

  /**
   * One line in the device log when a picture could not be pasted or copied
   * (the reason, type, size and first bytes, never the picture), so it can be
   * looked into on a release build, where the page's console is not logged.
   */
  @PluginMethod
  public void note(PluginCall call) {
    String message = call.getString("message", "");
    if (message != null && !message.isEmpty()) {
      Log.w(TAG, message.length() > 300 ? message.substring(0, 300) : message);
    }
    call.resolve();
  }

  @PluginMethod
  public void setImageInsertTarget(PluginCall call) {
    imageTargetActive = Boolean.TRUE.equals(call.getBoolean("active", false));
    call.resolve();
  }

  /**
   * A keyboard inserted a picture into the focused composer. Read on the
   * worker thread; `done` runs after, so the keyboard's read permission can
   * be released.
   */
  void deliverKeyboardImage(Uri uri, String mimeType, Runnable done) {
    io.execute(() -> {
      try {
        JSObject image = readUri(uri, mimeType);
        if (image.has("base64")) notifyListeners("keyboardImage", image);
      } catch (Exception error) {
        Log.w(TAG, "keyboard picture failed", error);
      } finally {
        if (done != null) done.run();
      }
    });
  }

  private boolean isImage(Uri uri, ClipDescription description) {
    String type = getContext().getContentResolver().getType(uri);
    if (type != null) return type.startsWith("image/");
    return description != null && description.hasMimeType("image/*");
  }

  private JSObject readUri(Uri uri, String knownMimeType) throws Exception {
    ContentResolver resolver = getContext().getContentResolver();
    String mimeType = resolver.getType(uri);
    if (mimeType == null) mimeType = knownMimeType;
    if (mimeType == null || !mimeType.startsWith("image/")) {
      return new JSObject();
    }
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try (InputStream in = resolver.openInputStream(uri)) {
      if (in == null) return new JSObject();
      byte[] buffer = new byte[64 * 1024];
      int read;
      int total = 0;
      while ((read = in.read(buffer)) != -1) {
        total += read;
        if (total > MAX_IMAGE_BYTES) throw new IllegalStateException(
          "Picture too large"
        );
        out.write(buffer, 0, read);
      }
    }
    Log.i(
      TAG,
      "read " + mimeType + " " + out.size() + " B from " + uri.getAuthority()
    );
    JSObject result = new JSObject();
    result.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
    result.put("mimeType", mimeType);
    result.put("fileName", displayName(resolver, uri, mimeType));
    return result;
  }

  private String displayName(ContentResolver resolver, Uri uri, String mime) {
    try (
      Cursor cursor = resolver.query(
        uri,
        new String[] { OpenableColumns.DISPLAY_NAME },
        null,
        null,
        null
      )
    ) {
      if (cursor != null && cursor.moveToFirst()) {
        String name = cursor.getString(0);
        if (name != null && !name.trim().isEmpty()) return name.trim();
      }
    } catch (Exception ignored) {
      /* some providers have no name */
    }
    String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
    return "pasted-image." + (extension != null ? extension : "png");
  }
}
