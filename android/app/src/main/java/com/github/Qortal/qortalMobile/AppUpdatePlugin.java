package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
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
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
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
 *
 * The node names the build, so nothing it delivers is trusted: the download
 * only runs over HTTPS (or plain HTTP to a node on this phone), and before the
 * installer is started the file must be GO's own package, signed by the
 * installed GO's key, with a higher versionCode ({@link AppUpdatePolicy}).
 * This is the only place GO starts a package install.
 */
@CapacitorPlugin(name = "QortalAppUpdate")
public class AppUpdatePlugin extends Plugin {

  private static final String TAG = "QortalAppUpdate";
  private static final String UPDATE_DIR = "updates";
  private static final int BUFFER_BYTES = 64 * 1024;
  private static final int MAX_REDIRECTS = 5;
  /** Frequent enough to look live, rare enough not to flood the bridge. */
  private static final long PROGRESS_INTERVAL_MS = 250;

  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final AtomicBoolean cancelled = new AtomicBoolean(false);

  /** A refusal the JS side shows in the user's language, keyed by code. */
  private static final class UpdateRefused extends Exception {
    final String code;

    UpdateRefused(String code, String message) {
      super(message);
      this.code = code;
    }
  }

  @PluginMethod
  public void download(PluginCall call) {
    String url = call.getString("url");
    String filename = call.getString("filename");
    // Sent as a header, not in the URL: native HTTP is not subject to the
    // node's CORS rules, and a URL ends up in error text and logs.
    String apiKey = call.getString("apiKey");
    if (url == null || url.isEmpty()) {
      call.reject("url is required");
      return;
    }
    if (filename == null || filename.isEmpty()) {
      call.reject("filename is required");
      return;
    }
    AppUpdatePolicy.UrlVerdict urlVerdict = AppUpdatePolicy.checkDownloadUrl(url);
    if (urlVerdict != AppUpdatePolicy.UrlVerdict.OK) {
      call.reject(urlRefusalMessage(urlVerdict), urlVerdict.code);
      return;
    }
    final String safeName = AppUpdatePolicy.safeFileName(filename);
    cancelled.set(false);

    worker.execute(() -> {
      HttpURLConnection connection = null;
      File target = null;
      try {
        File directory = updateDirectory();
        clearDirectory(directory);
        if (!directory.exists() && !directory.mkdirs()) {
          call.reject("Could not create the update folder");
          return;
        }
        target = new File(directory, safeName);

        connection = openFollowingRedirects(url, apiKey);

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
              target.delete();
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

        // Refuse a build that is not GO's before anyone is asked to install it.
        verifyUpdateArchive(target);

        JSObject result = new JSObject();
        result.put("path", target.getAbsolutePath());
        result.put("bytes", written);
        call.resolve(result);
      } catch (UpdateRefused refused) {
        if (target != null && target.exists()) target.delete();
        Log.w(TAG, "update refused: " + refused.code);
        call.reject(refused.getMessage(), refused.code);
      } catch (Exception e) {
        if (target != null && target.exists()) target.delete();
        call.reject("Failed to download the update: " + SecretRedaction.redactText(e.getMessage()));
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
    // Parsing and signature-checking a large APK takes a moment; keep it off
    // the plugin thread.
    worker.execute(() -> {
      try {
        Context context = getContext();
        File file = new File(path).getCanonicalFile();
        File directory = updateDirectory().getCanonicalFile();
        // Only a file this plugin downloaded: never a saved or received APK.
        if (!AppUpdatePolicy.isInsideDirectory(file.getPath(), directory.getPath())) {
          call.reject("Only a downloaded update can be installed", "UPDATE_BAD_PATH");
          return;
        }
        if (!file.isFile()) {
          call.reject("The downloaded update is no longer there");
          return;
        }
        verifyUpdateArchive(file);

        Uri uri = FileProvider.getUriForFile(
          context,
          context.getPackageName() + ".fileprovider",
          file
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, PackageArchivePolicy.APK_MIME);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String installer = systemInstallerPackage(context, intent);
        if (installer != null) intent.setPackage(installer);
        context.startActivity(intent);
        call.resolve();
      } catch (UpdateRefused refused) {
        Log.w(TAG, "install refused: " + refused.code);
        call.reject(refused.getMessage(), refused.code);
      } catch (Exception e) {
        call.reject("Could not open the installer: " + SecretRedaction.redactText(e.getMessage()));
      }
    });
  }

  private File updateDirectory() {
    return new File(getContext().getCacheDir(), UPDATE_DIR);
  }

  /**
   * Redirects are followed by hand ({@link RedirectPolicy}) so each hop is
   * held to the same HTTPS rule and the API key only goes to the node it was
   * meant for.
   */
  private HttpURLConnection openFollowingRedirects(String startUrl, String apiKey)
    throws Exception {
    try {
      return RedirectPolicy.open(
        startUrl,
        apiKey,
        MAX_REDIRECTS,
        hopUrl -> {
          AppUpdatePolicy.UrlVerdict verdict = AppUpdatePolicy.checkDownloadUrl(hopUrl);
          if (verdict != AppUpdatePolicy.UrlVerdict.OK) {
            throw new UpdateRefused(verdict.code, urlRefusalMessage(verdict));
          }
        },
        httpTransport(apiKey)
      );
    } catch (RedirectPolicy.RedirectRefused refused) {
      throw new Exception("Download failed with status " + refused.status);
    }
  }

  /** One download hop over HttpURLConnection, never following redirects itself. */
  private static RedirectPolicy.Transport<HttpURLConnection> httpTransport(String apiKey) {
    return new RedirectPolicy.Transport<HttpURLConnection>() {
      @Override
      public HttpURLConnection open(String url, boolean withKey) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) LocalHttp.openConnection(new URL(url));
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(30_000);
        // The node can stall mid-stream while it serves a large file; a short
        // read timeout would abort an otherwise healthy download.
        connection.setReadTimeout(120_000);
        if (withKey) connection.setRequestProperty("X-API-KEY", apiKey);
        try {
          connection.connect();
        } catch (Exception e) {
          connection.disconnect();
          throw e;
        }
        return connection;
      }

      @Override
      public int status(HttpURLConnection connection) throws Exception {
        return connection.getResponseCode();
      }

      @Override
      public String location(HttpURLConnection connection) {
        return connection.getHeaderField("Location");
      }

      @Override
      public void close(HttpURLConnection connection) {
        connection.disconnect();
      }
    };
  }

  /** Throws {@link UpdateRefused} unless {@code apk} is a newer GO, same signer. */
  private void verifyUpdateArchive(File apk) throws UpdateRefused {
    Context context = getContext();
    AppUpdatePolicy.PackageFacts archive = readArchive(context, apk);
    AppUpdatePolicy.PackageFacts installed = readInstalled(context);
    AppUpdatePolicy.Verdict verdict = AppUpdatePolicy.checkArchive(archive, installed);
    if (verdict != AppUpdatePolicy.Verdict.OK) {
      throw new UpdateRefused(verdict.code, archiveRefusalMessage(verdict));
    }
  }

  @SuppressWarnings("deprecation")
  private static AppUpdatePolicy.PackageFacts readArchive(Context context, File apk) {
    try {
      PackageManager pm = context.getPackageManager();
      // Android 9 only reads an archive's certificates when GET_SIGNATURES is
      // set, even if GET_SIGNING_CERTIFICATES is asked for; pass both.
      int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
        ? PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES
        : PackageManager.GET_SIGNATURES;
      PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
      return info == null ? null : facts(info);
    } catch (Exception e) {
      return null;
    }
  }

  @SuppressWarnings("deprecation")
  private static AppUpdatePolicy.PackageFacts readInstalled(Context context) {
    try {
      PackageManager pm = context.getPackageManager();
      int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
        ? PackageManager.GET_SIGNING_CERTIFICATES
        : PackageManager.GET_SIGNATURES;
      return facts(pm.getPackageInfo(context.getPackageName(), flags));
    } catch (Exception e) {
      return null;
    }
  }

  @SuppressWarnings("deprecation")
  private static AppUpdatePolicy.PackageFacts facts(PackageInfo info) {
    List<String> current;
    List<String> history;
    long versionCode;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      versionCode = info.getLongVersionCode();
      SigningInfo signing = info.signingInfo;
      if (signing == null) {
        current = digests(info.signatures);
        history = Collections.emptyList();
      } else if (signing.hasMultipleSigners()) {
        current = digests(signing.getApkContentsSigners());
        history = current;
      } else {
        current = digests(signing.getApkContentsSigners());
        history = digests(signing.getSigningCertificateHistory());
      }
    } else {
      versionCode = info.versionCode;
      current = digests(info.signatures);
      history = current;
    }
    return new AppUpdatePolicy.PackageFacts(info.packageName, versionCode, current, history);
  }

  private static List<String> digests(Signature[] signatures) {
    List<String> out = new ArrayList<>();
    if (signatures == null) return out;
    try {
      for (Signature signature : signatures) {
        if (signature == null) continue;
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        out.add(AppUpdatePolicy.hex(sha256.digest(signature.toByteArray())));
      }
    } catch (Exception e) {
      return new ArrayList<>();
    }
    return out;
  }

  /**
   * The phone's own package installer, so no other app that claims APKs can
   * stand in for it. Null (fall back to the plain intent) when Android does
   * not show it to GO or more than one system app claims the job.
   */
  private static String systemInstallerPackage(Context context, Intent intent) {
    try {
      List<ResolveInfo> matches = context
        .getPackageManager()
        .queryIntentActivities(intent, PackageManager.MATCH_SYSTEM_ONLY);
      Set<String> packages = new LinkedHashSet<>();
      for (ResolveInfo match : matches) {
        ActivityInfo activity = match.activityInfo;
        if (activity == null || activity.applicationInfo == null) continue;
        if ((activity.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) == 0) continue;
        packages.add(activity.packageName);
      }
      return packages.size() == 1 ? packages.iterator().next() : null;
    } catch (Exception e) {
      return null;
    }
  }

  private static String urlRefusalMessage(AppUpdatePolicy.UrlVerdict verdict) {
    if (verdict == AppUpdatePolicy.UrlVerdict.INSECURE) {
      return "Updates are only downloaded over HTTPS or from a node on this phone";
    }
    return "The update address is not a web address";
  }

  private static String archiveRefusalMessage(AppUpdatePolicy.Verdict verdict) {
    switch (verdict) {
      case WRONG_PACKAGE:
        return "The downloaded file is not a Qortal GO build";
      case WRONG_SIGNER:
        return "The downloaded build is not signed with the installed app's key";
      case NOT_NEWER:
        return "The downloaded build is not newer than the installed app";
      default:
        return "The downloaded file is not a readable app package";
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
