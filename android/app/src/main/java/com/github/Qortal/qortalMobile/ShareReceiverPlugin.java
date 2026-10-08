package com.github.Qortal.qortalMobile;

import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;

import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Receives ACTION_SEND / ACTION_SEND_MULTIPLE shares and hands them to the
 * WebView. Kinds, kept apart:
 *  - "composer": photos and videos for the Home composer (the "Quitter" or
 *    "Torq" share-sheet entry), drained with getPendingShare().
 *  - "rev": one photo or video for Torq's Rev editor ("Torq Rev").
 *  - chat: text, links and one file for a chat (the "GO Groups", "GO DMs"
 *    and "GO Self-DM" entries), drained with getPendingChatShare().
 *
 * Flow:
 *  - ShareTrampolineActivity names the target (EXTRA_SHARE_TARGET) and
 *    MainActivity forwards the intent here (cold start + onNewIntent).
 *  - The content:// streams are copied into cacheDir/shared_media/ right away
 *    (URI read permission is only guaranteed while the intent is fresh).
 *  - The WebView drains the queue at boot, and listens for the
 *    "shareReceived" event when a share arrives while the app is running.
 *    Files are then read via Capacitor.convertFileSrc(path) + fetch().
 *
 * No single chats are offered in the share sheet or the launcher; the recent
 * chat shortcuts a test build once published are removed at start.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    private static final String TAG = "ShareReceiver";
    private static final String EXTRA_HANDLED = "qortalShareHandled";
    /** Set by ShareTrampolineActivity: where the share goes. */
    public static final String EXTRA_SHARE_TARGET = "qortalShareTarget";
    public static final String TARGET_COMPOSER = "composer";
    /** "Torq Rev": one photo or video for Torq's Rev editor. */
    public static final String TARGET_REV = "rev";
    /** "GO Groups": the Groups list opens with the share; a tap picks the group. */
    public static final String TARGET_CHATS_GROUPS = "chats:groups";
    /** "GO DMs": the same with the DM list. */
    public static final String TARGET_CHATS_DIRECTS = "chats:directs";
    /** "GO Self-DM": straight into Saved Messages. */
    public static final String TARGET_CHATS_SELF = "chats:self";
    /**
     * Largest file shared into a chat. Phones read an attachment into the
     * page to send it, so a much larger one would only crash the WebView.
     */
    public static final long CHAT_MAX_FILE_BYTES = 100L * 1024 * 1024;
    /** Same share re-delivered as a new Intent instance within this window. */
    private static final long DUPLICATE_WINDOW_MS = 4000;
    private static final Object LOCK = new Object();
    private static String lastSignature = "";
    private static long lastSignatureAt = 0;
    private static final List<JSObject> pendingItems = new ArrayList<>();
    /** Only the newest chat share waits; an older one is dropped. */
    private static JSObject pendingChatShare;
    /** The photo or video waiting for Torq's Rev editor (newest only). */
    private static JSObject pendingRevItem;
    /** Torq takes Rev videos up to 100 MB (REV_MAX_VIDEO_BYTES). */
    public static final long REV_MAX_FILE_BYTES = 100L * 1024 * 1024;

    /** Shares into a group or a DM, as opposed to the composer or a Rev. */
    public static boolean isChatTarget(String target) {
        return !TARGET_COMPOSER.equals(target) && !TARGET_REV.equals(target);
    }
    private static ShareReceiverPlugin instance;

    @Override
    public void load() {
        synchronized (LOCK) {
            instance = this;
        }
        final android.content.Context appContext = getContext().getApplicationContext();
        new Thread(() -> removeChatShortcuts(appContext), "chat-shortcuts-cleanup").start();
    }

    /**
     * A test build published recent groups and DMs as dynamic shortcuts (the
     * share sheet's Direct Share row, the launcher's long-press menu). GO
     * offers no single chats there now, so any left are removed. GO has no
     * other shortcuts of its own.
     */
    private static void removeChatShortcuts(android.content.Context context) {
        try {
            List<String> ids = new ArrayList<>();
            for (ShortcutInfoCompat old : ShortcutManagerCompat.getShortcuts(
                context,
                ShortcutManagerCompat.FLAG_MATCH_DYNAMIC | ShortcutManagerCompat.FLAG_MATCH_CACHED
            )) {
                ids.add(old.getId());
            }
            if (ids.isEmpty()) return;
            ShortcutManagerCompat.removeLongLivedShortcuts(context, ids);
            ShortcutManagerCompat.removeAllDynamicShortcuts(context);
        } catch (Exception e) {
            Log.w(TAG, "Could not remove old chat shortcuts: " + e.getMessage());
        }
    }

    /** Called by MainActivity for every intent it starts or resumes with. */
    public static void handleSendIntent(android.content.Context context, Intent intent) {
        if (intent == null) return;
        // A cold-start share reaches both onCreate and onNewIntent, which would
        // import the same photo twice and burn both composer image slots.
        if (intent.getBooleanExtra(EXTRA_HANDLED, false)) return;
        final String action = intent.getAction();
        final boolean single = Intent.ACTION_SEND.equals(action);
        final boolean multiple = Intent.ACTION_SEND_MULTIPLE.equals(action);
        if (!single && !multiple) return;
        intent.putExtra(EXTRA_HANDLED, true);
        String targetExtra = intent.getStringExtra(EXTRA_SHARE_TARGET);
        final String target = targetExtra == null ? TARGET_COMPOSER : targetExtra;
        final boolean chat = isChatTarget(target);
        final String type = intent.getType();
        if (type == null) return;
        if (!chat
            && !type.startsWith("image/")
            && !type.startsWith("video/")
            && !"*/*".equals(type)) {
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
        final String text = chat ? intent.getStringExtra(Intent.EXTRA_TEXT) : null;
        final String subject = chat ? intent.getStringExtra(Intent.EXTRA_SUBJECT) : null;
        if (uris.isEmpty() && text == null && subject == null) return;

        // Some launchers re-deliver the share as a fresh Intent, which the
        // handled-flag above cannot catch — fall back to comparing content.
        final String signature = action + "|" + type + "|" + target + "|" + uris
            + "|" + (text == null ? 0 : text.hashCode());
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
        if (chat) {
            new Thread(
                () -> importChatShare(appContext, target, type, uris, text, subject),
                "chat-share-copy"
            ).start();
            return;
        }
        if (TARGET_REV.equals(target)) {
            new Thread(() -> importRevShare(appContext, type, uris), "rev-share-copy").start();
            return;
        }
        new Thread(() -> {
            for (Uri uri : uris) {
                CopyResult copied = copyToCache(appContext, uri, type, true, 0);
                if (copied.item != null) {
                    synchronized (LOCK) {
                        pendingItems.add(copied.item);
                    }
                }
            }
            notifyWeb(TARGET_COMPOSER);
        }, "quitter-share-copy").start();
    }

    /**
     * A chat message carries one file: the first that can be read goes in,
     * the rest are counted so the page can say so.
     */
    private static void importChatShare(
        android.content.Context context,
        String target,
        String intentType,
        List<Uri> uris,
        String text,
        String subject
    ) {
        JSArray items = new JSArray();
        int extra = 0;
        int tooLarge = 0;
        int unreadable = 0;
        boolean attached = false;
        for (Uri uri : uris) {
            if (attached) {
                extra++;
                continue;
            }
            CopyResult copied = copyToCache(context, uri, intentType, false, CHAT_MAX_FILE_BYTES);
            if (copied.item != null) {
                items.put(copied.item);
                attached = true;
            } else if (copied.tooLarge) {
                tooLarge++;
            } else {
                unreadable++;
            }
        }
        JSObject share = new JSObject();
        share.put("target", target);
        share.put("items", items);
        if (text != null) share.put("text", text);
        if (subject != null) share.put("subject", subject);
        share.put("extraCount", extra);
        share.put("tooLargeCount", tooLarge);
        share.put("unreadableCount", unreadable);
        share.put("maxFileBytes", CHAT_MAX_FILE_BYTES);
        queueChatShare(share);
    }

    /** A Rev has one photo or video: the first that can be read. */
    private static void importRevShare(
        android.content.Context context,
        String intentType,
        List<Uri> uris
    ) {
        JSObject item = null;
        boolean tooLarge = false;
        for (Uri uri : uris) {
            CopyResult copied = copyToCache(context, uri, intentType, true, REV_MAX_FILE_BYTES);
            if (copied.item != null) {
                item = copied.item;
                break;
            }
            tooLarge = tooLarge || copied.tooLarge;
        }
        JSObject share = new JSObject();
        if (item != null) share.put("item", item);
        share.put("tooLarge", item == null && tooLarge);
        share.put("maxFileBytes", REV_MAX_FILE_BYTES);
        JSObject replaced;
        synchronized (LOCK) {
            replaced = pendingRevItem;
            pendingRevItem = share;
        }
        if (replaced != null) deleteRevItemFile(replaced);
        notifyWeb(TARGET_REV);
    }

    private static void deleteRevItemFile(JSObject share) {
        try {
            JSONObject item = share.optJSONObject("item");
            String path = item != null ? item.optString("path", "") : "";
            if (path.contains("/shared_media/")) {
                //noinspection ResultOfMethodCallIgnored
                new File(path).delete();
            }
        } catch (Exception ignored) {
        }
    }

    private static void queueChatShare(JSObject share) {
        JSObject replaced;
        synchronized (LOCK) {
            replaced = pendingChatShare;
            pendingChatShare = share;
        }
        // An older share nobody picked a chat for yet: its copies go.
        if (replaced != null) deleteItemFiles(replaced);
        notifyWeb("chat");
    }

    private static void deleteItemFiles(JSObject share) {
        try {
            JSONArray items = share.getJSONArray("items");
            for (int i = 0; i < items.length(); i++) {
                String path = items.getJSONObject(i).optString("path", "");
                if (path.contains("/shared_media/")) {
                    //noinspection ResultOfMethodCallIgnored
                    new File(path).delete();
                }
            }
        } catch (Exception ignored) {
        }
    }

    private static void notifyWeb(String kind) {
        ShareReceiverPlugin plugin;
        boolean hasItems;
        synchronized (LOCK) {
            plugin = instance;
            if (TARGET_COMPOSER.equals(kind)) hasItems = !pendingItems.isEmpty();
            else if (TARGET_REV.equals(kind)) hasItems = pendingRevItem != null;
            else hasItems = pendingChatShare != null;
        }
        if (plugin == null || !hasItems) return;
        JSObject data = new JSObject();
        data.put("pending", true);
        data.put("kind", kind);
        plugin.notifyListeners("shareReceived", data, true);
    }

    private static final class CopyResult {
        final JSObject item;
        final boolean tooLarge;

        CopyResult(JSObject item, boolean tooLarge) {
            this.item = item;
            this.tooLarge = tooLarge;
        }
    }

    private static final CopyResult NOT_COPIED = new CopyResult(null, false);
    private static final CopyResult TOO_LARGE = new CopyResult(null, true);

    /**
     * Only content:// streams from other apps. A file:// path, or a
     * content:// URI served by GO's own FileProvider (which covers GO's files
     * and cache), would make GO read its own private files on another app's
     * say-so and put them in a post or a chat message.
     */
    private static boolean isOtherAppContent(android.content.Context context, Uri uri) {
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            return false;
        }
        String authority = uri.getAuthority();
        if (authority == null || authority.isEmpty()) return false;
        // "10@authority" names another Android user's provider.
        int at = authority.lastIndexOf('@');
        if (at >= 0) authority = authority.substring(at + 1);
        try {
            ProviderInfo provider =
                context.getPackageManager().resolveContentProvider(authority, 0);
            if (provider != null && context.getPackageName().equals(provider.packageName)) {
                return false;
            }
        } catch (Exception ignored) {
        }
        return !authority.startsWith(context.getPackageName());
    }

    /**
     * mediaOnly: photos and videos only (the Home composer). maxBytes > 0:
     * bigger files are not copied (TOO_LARGE).
     */
    private static CopyResult copyToCache(
        android.content.Context context,
        Uri uri,
        String intentType,
        boolean mediaOnly,
        long maxBytes
    ) {
        File out = null;
        try {
            if (!isOtherAppContent(context, uri)) {
                Log.w(TAG, "Refused a shared stream that is not another app's content");
                return NOT_COPIED;
            }
            ContentResolver resolver = context.getContentResolver();
            String mime = resolver.getType(uri);
            if (mime == null || mime.isEmpty() || "*/*".equals(mime)) mime = intentType;
            if (mime == null || mime.isEmpty() || mime.contains("*")) {
                mime = "application/octet-stream";
            }
            if (mediaOnly && !mime.startsWith("image/") && !mime.startsWith("video/")) {
                // Only Quitter-supported media.
                return NOT_COPIED;
            }
            if (maxBytes > 0) {
                long declared = querySize(resolver, uri);
                if (declared > maxBytes) return TOO_LARGE;
            }

            String displayName = queryDisplayName(resolver, uri);
            if (displayName == null || displayName.isEmpty()) {
                String ext = mime.startsWith("video/")
                    ? ".mp4"
                    : mime.startsWith("image/") ? ".jpg" : mime.startsWith("text/") ? ".txt" : ".bin";
                displayName = "shared_" + System.currentTimeMillis() + ext;
            }
            displayName = displayName.replaceAll("[/\\\\?%*:|\"<>]", "_");

            File dir = new File(context.getCacheDir(), "shared_media");
            if (!dir.exists() && !dir.mkdirs()) {
                Log.w(TAG, "Could not create shared_media cache dir");
                return NOT_COPIED;
            }
            out = new File(dir, System.currentTimeMillis() + "_" + displayName);

            long total = 0;
            boolean overLimit = false;
            try (InputStream in = resolver.openInputStream(uri);
                 FileOutputStream os = new FileOutputStream(out)) {
                if (in == null) return deleteAndReturn(out, NOT_COPIED);
                byte[] buf = new byte[512 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (maxBytes > 0 && total > maxBytes) {
                        overLimit = true;
                        break;
                    }
                    os.write(buf, 0, n);
                }
            }
            if (overLimit) return deleteAndReturn(out, TOO_LARGE);
            if (total <= 0) return deleteAndReturn(out, NOT_COPIED);

            JSObject item = new JSObject();
            item.put("path", out.getAbsolutePath());
            item.put("mimeType", mime);
            item.put("name", displayName);
            item.put("size", total);
            return new CopyResult(item, false);
        } catch (Exception e) {
            Log.w(TAG, "Failed to import shared media: " + e.getMessage());
            if (out != null) deleteAndReturn(out, NOT_COPIED);
            return NOT_COPIED;
        }
    }

    private static CopyResult deleteAndReturn(File file, CopyResult result) {
        //noinspection ResultOfMethodCallIgnored
        file.delete();
        return result;
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

    /** The size the sending app gives, or -1 when it gives none. */
    private static long querySize(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (idx >= 0 && !cursor.isNull(idx)) return cursor.getLong(idx);
            }
        } catch (Exception ignored) {
        }
        return -1;
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

    /**
     * Returns the waiting "Torq Rev" share, if any (and clears it):
     * { share: { item?: {path, mimeType, name, size}, tooLarge, maxFileBytes } | null }.
     */
    @PluginMethod
    public void getPendingRevShare(PluginCall call) {
        JSObject share;
        synchronized (LOCK) {
            share = pendingRevItem;
            pendingRevItem = null;
        }
        JSObject ret = new JSObject();
        ret.put("share", share == null ? JSONObject.NULL : share);
        call.resolve(ret);
    }

    /** Returns the waiting chat share, if any (and clears it). */
    @PluginMethod
    public void getPendingChatShare(PluginCall call) {
        JSObject share;
        synchronized (LOCK) {
            share = pendingChatShare;
            pendingChatShare = null;
        }
        JSObject ret = new JSObject();
        ret.put("share", share == null ? JSONObject.NULL : share);
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

    /**
     * Shows "Torq" and "Torq Rev", or "Quitter", in the share sheet, after
     * the app the Home composer posts to. Each is its own activity-alias.
     */
    @PluginMethod
    public void setShareTarget(PluginCall call) {
        boolean torq = "torq".equals(call.getString("target"));
        try {
            setAliasEnabled(".TorqShareActivity", torq);
            setAliasEnabled(".TorqRevShareActivity", torq);
            setAliasEnabled(".QuitterShareActivity", !torq);
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "Could not switch the share target: " + e.getMessage());
            call.reject("share target not changed");
        }
    }

    private void setAliasEnabled(String alias, boolean enabled) {
        PackageManager pm = getContext().getPackageManager();
        // Aliases are named after the Java namespace (com.github.Qortal.qortalMobile),
        // which differs from the application id.
        ComponentName component = new ComponentName(
            getContext(), MainActivity.class.getPackage().getName() + alias);
        int state = enabled
            ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        if (pm.getComponentEnabledSetting(component) == state) return;
        pm.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP);
    }
}
