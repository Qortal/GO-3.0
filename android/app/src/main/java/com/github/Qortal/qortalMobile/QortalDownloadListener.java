package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.widget.Toast;

import com.getcapacitor.Bridge;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Saves files when the WebView would otherwise drop a download.
 *
 * Q-Apps and published websites (Q-Share, QWB Folders, etc.) trigger saves with
 * `<a download>` / blob / data URLs or `Content-Disposition: attachment`. On
 * desktop the browser shows a save dialog; inside the Android WebView nothing
 * happens unless a DownloadListener is registered. This one streams the bytes
 * into Documents/Qortal Go (same place as `qortalRequest SAVE_FILE`).
 *
 * The page picks the name and type and there is no prompt, so names lose
 * bidi/control characters and web pages, SVG and XML are saved as ".txt"
 * plain text ({@link SavedFilePolicy}).
 */
public class QortalDownloadListener implements DownloadListener {

    private static final String TAG = "QortalDownload";
    private static final String FOLDER = "Qortal Go";

    private final Bridge bridge;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    public QortalDownloadListener(Bridge bridge) {
        this.bridge = bridge;
    }

    @Override
    public void onDownloadStart(
        String url,
        String userAgent,
        String contentDisposition,
        String mimetype,
        long contentLength
    ) {
        if (url == null || url.isEmpty()) {
            return;
        }

        // The name the file is saved under, so the toast names the real file:
        // cleaned, and ".txt" added to web pages, SVG and XML (GO-01). The
        // name does not depend on the type, so the save below keeps it.
        final String filename = SavedFilePolicy.forSave(
            resolveFilename(url, contentDisposition, mimetype),
            mimetype,
            DocumentSaver.EXTENSION_TYPES
        ).name;
        final String mime = mimetype;

        if (url.startsWith("data:")) {
            toast("Saving " + filename + "…");
            io.execute(() -> saveDataUri(url, filename, mime));
        } else if (url.startsWith("http://") || url.startsWith("https://")) {
            toast("Saving " + filename + "…");
            io.execute(() -> saveHttp(url, userAgent, filename, mime));
        } else if (url.startsWith("blob:")) {
            // Blob URLs live inside the (often cross-origin) frame's JS heap and
            // can't be read from native. Apps should route saves through
            // qortalRequest SAVE_FILE or an /arbitrary/…?attachment=true URL on
            // mobile instead.
            Log.w(TAG, "Unsupported blob download: " + SecretRedaction.stripQuery(url));
            toast("Couldn't save this file on mobile");
        } else {
            Log.w(TAG, "Unsupported download scheme: " + SecretRedaction.stripQuery(url));
            toast("Couldn't save this file");
        }
    }

    private void saveHttp(String url, String userAgent, String filename, String mimeHint) {
        HttpURLConnection conn = null;
        try {
            // Redirects are followed hop by hop, each routed by LocalHttp
            // (direct for the phone's own addresses), so a web link that
            // redirects to the node reaches it, as in the WebView.
            conn = LocalHttp.openFollowingRedirects(new URL(url), LocalHttp.MAX_REDIRECTS, (hop, hopUrl) -> {
                hop.setConnectTimeout(30_000);
                hop.setReadTimeout(60_000);
                if (userAgent != null && !userAgent.isEmpty()) {
                    hop.setRequestProperty("User-Agent", userAgent);
                }
                // Each hop gets its own address's cookies, never the first one's.
                String cookie = CookieManager.getInstance().getCookie(hopUrl);
                if (cookie != null && !cookie.isEmpty()) {
                    hop.setRequestProperty("Cookie", cookie);
                }
            });

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                Log.w(TAG, "Download HTTP " + code + " for " + SecretRedaction.stripQuery(url));
                toast("Download failed (" + code + ")");
                return;
            }

            String mime = !TextUtils.isEmpty(mimeHint) ? mimeHint : conn.getContentType();
            // Web pages, SVG and XML are saved as plain text (GO-01).
            SavedFilePolicy.Target target =
                SavedFilePolicy.forSave(filename, mime, DocumentSaver.EXTENSION_TYPES);
            String folder = SaveCategory.folderFor(FOLDER, target.name, target.mime);
            try (InputStream in = conn.getInputStream()) {
                DocumentSaver.saveStream(getContext(), folder, target.name, target.mime, in);
            }
            toast("Saved to Documents/" + folder);
        } catch (Exception e) {
            // The URL's query (and an exception that repeats it) can carry
            // the node API key: logcat and the toast get neither.
            Log.e(TAG, "Failed HTTP download " + SecretRedaction.stripQuery(url)
                + ": " + SecretRedaction.redactText(String.valueOf(e)));
            toast("Couldn't save file: " + SecretRedaction.redactText(e.getMessage()));
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void saveDataUri(String url, String filename, String mimeHint) {
        try {
            int comma = url.indexOf(',');
            if (comma < 0) {
                toast("Couldn't save file");
                return;
            }
            String meta = url.substring(5, comma); // strip "data:"
            String data = url.substring(comma + 1);
            boolean base64 = meta.contains(";base64");
            String mime = meta.split(";")[0];
            if (TextUtils.isEmpty(mime)) {
                mime = mimeHint;
            }

            byte[] bytes;
            if (base64) {
                bytes = Base64.decode(data, Base64.DEFAULT);
            } else {
                bytes = Uri.decode(data).getBytes("UTF-8");
            }
            // Web pages, SVG and XML are saved as plain text (GO-01).
            SavedFilePolicy.Target target =
                SavedFilePolicy.forSave(filename, mime, DocumentSaver.EXTENSION_TYPES);
            String folder = SaveCategory.folderFor(FOLDER, target.name, target.mime);
            try (InputStream in = new ByteArrayInputStream(bytes)) {
                DocumentSaver.saveStream(getContext(), folder, target.name, target.mime, in);
            }
            toast("Saved to Documents/" + folder);
        } catch (Exception e) {
            Log.e(TAG, "Failed data: download", e);
            toast("Couldn't save file: " + e.getMessage());
        }
    }

    /** Prefer an explicit attachmentFilename query param, then Content-Disposition, then the URL. */
    private String resolveFilename(String url, String contentDisposition, String mimetype) {
        try {
            Uri uri = Uri.parse(url);
            String q = uri.getQueryParameter("attachmentFilename");
            if (!TextUtils.isEmpty(q)) {
                return q;
            }
            q = uri.getQueryParameter("filename");
            if (!TextUtils.isEmpty(q)) {
                return q;
            }
        } catch (Exception ignored) {
            /* fall back to URLUtil */
        }
        return URLUtil.guessFileName(url, contentDisposition, mimetype);
    }

    private Context getContext() {
        return bridge.getActivity().getApplicationContext();
    }

    private void toast(String message) {
        main.post(() -> {
            Context ctx = bridge.getActivity();
            if (ctx != null) {
                Toast.makeText(ctx, message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
