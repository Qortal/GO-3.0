package com.github.Qortal.qortalMobile;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Receives ACTION_SEND / ACTION_SEND_MULTIPLE photo & video shares (the
 * "Quitter" share-sheet target) and hands them to the WebView.
 *
 * Flow:
 *  - MainActivity forwards share intents here (cold start + onNewIntent).
 *  - The content:// streams are copied into cacheDir/shared_media/ right away
 *    (URI read permission is only guaranteed while the intent is fresh).
 *  - The WebView calls getPendingShare() at boot, and listens for the
 *    "shareReceived" event when a share arrives while the app is running.
 *    Files are then read via Capacitor.convertFileSrc(path) + fetch().
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    private static final String TAG = "ShareReceiver";
    private static final String EXTRA_HANDLED = "qortalShareHandled";
    /** Same share re-delivered as a new Intent instance within this window. */
    private static final long DUPLICATE_WINDOW_MS = 4000;
    private static final Object LOCK = new Object();
    private static String lastSignature = "";
    private static long lastSignatureAt = 0;
    private static final List<JSObject> pendingItems = new ArrayList<>();
    private static ShareReceiverPlugin instance;

    @Override
    public void load() {
        synchronized (LOCK) {
            instance = this;
        }
    }

    /** Called by MainActivity for SEND / SEND_MULTIPLE intents. */
    public static void handleSendIntent(android.content.Context context, Intent intent) {
        if (intent == null) return;
        // A cold-start share reaches both onCreate and onNewIntent, which would
        // import the same photo twice and burn both composer image slots.
        if (intent.getBooleanExtra(EXTRA_HANDLED, false)) return;
        intent.putExtra(EXTRA_HANDLED, true);
        final String action = intent.getAction();
        final String type = intent.getType();
        if (type == null) return;
        final boolean single = Intent.ACTION_SEND.equals(action);
        final boolean multiple = Intent.ACTION_SEND_MULTIPLE.equals(action);
        if (!single && !multiple) return;
        if (!type.startsWith("image/") && !type.startsWith("video/") && !"*/*".equals(type)) {
            return;
        }

        final List<Uri> uris = new ArrayList<>();
        if (single) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else {
            List<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return;

        // Some launchers re-deliver the share as a fresh Intent, which the
        // handled-flag above cannot catch — fall back to comparing content.
        final String signature = action + "|" + type + "|" + uris;
        synchronized (LOCK) {
            long now = System.currentTimeMillis();
            if (signature.equals(lastSignature) && now - lastSignatureAt < DUPLICATE_WINDOW_MS) {
                return;
            }
            lastSignature = signature;
            lastSignatureAt = now;
        }

        // Copy off the main thread — shared videos can be large.
        final android.content.Context appContext = context.getApplicationContext();
        new Thread(() -> {
            for (Uri uri : uris) {
                JSObject item = copyToCache(appContext, uri, type);
                if (item != null) {
                    synchronized (LOCK) {
                        pendingItems.add(item);
                    }
                }
            }
            notifyWeb();
        }, "quitter-share-copy").start();
    }

    private static void notifyWeb() {
        ShareReceiverPlugin plugin;
        synchronized (LOCK) {
            plugin = instance;
        }
        if (plugin == null) return;
        boolean hasItems;
        synchronized (LOCK) {
            hasItems = !pendingItems.isEmpty();
        }
        if (hasItems) {
            JSObject data = new JSObject();
            data.put("pending", true);
            plugin.notifyListeners("shareReceived", data, true);
        }
    }

    private static JSObject copyToCache(android.content.Context context, Uri uri, String intentType) {
        try {
            ContentResolver resolver = context.getContentResolver();
            String mime = resolver.getType(uri);
            if (mime == null || mime.isEmpty()) mime = intentType;
            if (mime == null) mime = "application/octet-stream";
            if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
                // Only Quitter-supported media.
                return null;
            }

            String displayName = queryDisplayName(resolver, uri);
            if (displayName == null || displayName.isEmpty()) {
                String ext = mime.startsWith("video/") ? ".mp4" : ".jpg";
                displayName = "shared_" + System.currentTimeMillis() + ext;
            }
            displayName = displayName.replaceAll("[/\\\\?%*:|\"<>]", "_");

            File dir = new File(context.getCacheDir(), "shared_media");
            if (!dir.exists() && !dir.mkdirs()) {
                Log.w(TAG, "Could not create shared_media cache dir");
                return null;
            }
            File out = new File(dir, System.currentTimeMillis() + "_" + displayName);

            long total = 0;
            try (InputStream in = resolver.openInputStream(uri);
                 FileOutputStream os = new FileOutputStream(out)) {
                if (in == null) return null;
                byte[] buf = new byte[512 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    total += n;
                }
            }
            if (total <= 0) {
                //noinspection ResultOfMethodCallIgnored
                out.delete();
                return null;
            }

            JSObject item = new JSObject();
            item.put("path", out.getAbsolutePath());
            item.put("mimeType", mime);
            item.put("name", displayName);
            item.put("size", total);
            return item;
        } catch (Exception e) {
            Log.w(TAG, "Failed to import shared media: " + e.getMessage());
            return null;
        }
    }

    private static String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return cursor.getString(idx);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /** Returns queued shared media items (and clears the queue). */
    @PluginMethod
    public void getPendingShare(PluginCall call) {
        List<JSObject> items;
        synchronized (LOCK) {
            items = new ArrayList<>(pendingItems);
            pendingItems.clear();
        }
        JSObject ret = new JSObject();
        ret.put("items", new JSArray(items));
        call.resolve(ret);
    }

    /** Deletes an imported cache file once the WebView has consumed it. */
    @PluginMethod
    public void consumeSharedFile(PluginCall call) {
        String path = call.getString("path");
        if (path != null && path.contains("/shared_media/")) {
            try {
                //noinspection ResultOfMethodCallIgnored
                new File(path).delete();
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }
}
