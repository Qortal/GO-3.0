package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Downloads a new build of the app and hands it to Android's installer.
 *
 * The file goes to the app's own cache rather than Documents: an update is not
 * something the user asked to keep, and the private directory is what the
 * FileProvider can grant the package installer read access to without any
 * storage permission. Whatever was downloaded before is cleared on the way in,
 * so a failed or superseded update cannot sit there taking up space.
 */
@CapacitorPlugin(name = "QortalAppUpdate")
public class AppUpdatePlugin extends Plugin {

  private static final String UPDATE_DIR = "updates";
  private static final int BUFFER_BYTES = 64 * 1024;
  /** Frequent enough to look live, rare enough not to flood the bridge. */
  private static final long PROGRESS_INTERVAL_MS = 250;

  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final AtomicBoolean cancelled = new AtomicBoolean(false);

  @PluginMethod
  public void download(PluginCall call) {
    String url = call.getString("url");
    String filename = call.getString("filename");
    if (url == null || url.isEmpty()) {
      call.reject("url is required");
      return;
    }
    if (filename == null || filename.isEmpty()) {
      call.reject("filename is required");
      return;
    }
    final String safeName = filename.replaceAll("[^A-Za-z0-9._-]", "_");
    cancelled.set(false);

    worker.execute(() -> {
      HttpURLConnection connection = null;
      File target = null;
      try {
        File directory = new File(getContext().getCacheDir(), UPDATE_DIR);
        clearDirectory(directory);
        if (!directory.exists() && !directory.mkdirs()) {
          call.reject("Could not create the update folder");
          return;
        }
        target = new File(directory, safeName);

        connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(30_000);
        // The node can stall mid-stream while it serves a large file; a short
        // read timeout would abort an otherwise healthy download.
        connection.setReadTimeout(120_000);
        connection.connect();

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
          call.reject("Download failed with status " + status);
          return;
        }
        long total = connection.getContentLengthLong();

        long written = 0;
        long lastReport = 0;
        byte[] buffer = new byte[BUFFER_BYTES];
        try (
          InputStream in = new BufferedInputStream(connection.getInputStream(), BUFFER_BYTES);
          OutputStream out = new FileOutputStream(target)
        ) {
          int read;
          while ((read = in.read(buffer)) != -1) {
            if (cancelled.get()) {
              call.reject("cancelled");
              return;
            }
            out.write(buffer, 0, read);
            written += read;
            long now = System.currentTimeMillis();
            if (now - lastReport >= PROGRESS_INTERVAL_MS) {
              lastReport = now;
              notifyProgress(written, total);
            }
          }
          out.flush();
        }
        notifyProgress(written, total);

        JSObject result = new JSObject();
        result.put("path", target.getAbsolutePath());
        result.put("bytes", written);
        call.resolve(result);
      } catch (Exception e) {
        if (target != null && target.exists()) target.delete();
        call.reject("Failed to download the update: " + e.getMessage());
      } finally {
        if (connection != null) connection.disconnect();
      }
    });
  }

  @PluginMethod
  public void cancel(PluginCall call) {
    cancelled.set(true);
    call.resolve();
  }

  /** Whether Android will let this app ask to install a package at all. */
  @PluginMethod
  public void canInstall(PluginCall call) {
    JSObject result = new JSObject();
    boolean allowed = true;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      allowed = getContext().getPackageManager().canRequestPackageInstalls();
    }
    result.put("allowed", allowed);
    call.resolve(result);
  }

  /** Sends the user to the system screen where that permission is granted. */
  @PluginMethod
  public void requestInstallPermission(PluginCall call) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      call.resolve();
      return;
    }
    try {
      Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
      intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("Could not open the install-permission screen: " + e.getMessage());
    }
  }

  @PluginMethod
  public void install(PluginCall call) {
    String path = call.getString("path");
    if (path == null || path.isEmpty()) {
      call.reject("path is required");
      return;
    }
    try {
      File file = new File(path);
      if (!file.isFile()) {
        call.reject("The downloaded update is no longer there");
        return;
      }
      Context context = getContext();
      Uri uri = FileProvider.getUriForFile(
        context,
        context.getPackageName() + ".fileprovider",
        file
      );
      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri, "application/vnd.android.package-archive");
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("Could not open the installer: " + e.getMessage());
    }
  }

  private void notifyProgress(long written, long total) {
    JSObject payload = new JSObject();
    payload.put("bytes", written);
    payload.put("total", total > 0 ? total : 0);
    payload.put(
      "percent",
      total > 0 ? Math.min(100, (int) ((written * 100) / total)) : -1
    );
    notifyListeners("downloadProgress", payload);
  }

  private void clearDirectory(File directory) {
    File[] files = directory.listFiles();
    if (files == null) return;
    for (File file : files) {
      file.delete();
    }
  }
}
