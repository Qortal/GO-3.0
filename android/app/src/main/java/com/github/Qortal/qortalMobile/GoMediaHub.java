package com.github.Qortal.qortalMobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * GO's background player. Every frame in GO's WebView (Q-Apps, websites,
 * GO's own page) runs res/raw/go_media_watch.js, which reports its audio and
 * video here over a WebMessageListener channel. This class picks the player
 * the notification shows (whatever started playing last), runs one
 * MediaSession for it (notification, lock screen, headset and Bluetooth
 * buttons, Android 13+ media controls) and sends Play / Pause / seek / Next
 * back to that frame.
 *
 * When GO leaves the screen, audio and video keep playing unless the user
 * set otherwise ({@link MediaPlayerPolicy#shouldPauseOnLeave}); while
 * something plays off screen the page is kept visible to Chromium
 * ({@link BackgroundKeepAlive#setMediaPlaying}), a partial wake lock keeps
 * the CPU up with the screen off, and {@link QortalMediaService} holds the
 * mediaPlayback foreground service with the notification.
 *
 * Main thread only, except the cover decoding (one worker).
 */
public final class GoMediaHub {
    private static final String TAG = "QortalMedia";

    static final String CHANNEL_OBJECT = "goMediaWatch";
    public static final String CHANNEL_ID = "qortal_media_playback";
    public static final int NOTIFICATION_ID = 2010;

    public static final String ACTION_OPEN = "com.github.Qortal.qortalMobile.MEDIA_OPEN";
    public static final String ACTION_SETTINGS = "com.github.Qortal.qortalMobile.MEDIA_SETTINGS";
    public static final String EXTRA_FRAME = "go_media_frame";

    static final String PREFS = "qortal_media_player";
    private static final String PREFS_STRINGS = "qortal_media_strings";

    /** Keys the page may translate (QortalMedia.setStrings); else the app's resources. */
    public static final String[] STRING_KEYS = {
        "media_action_play",
        "media_action_pause",
        "media_action_previous",
        "media_action_next",
        "media_action_back",
        "media_action_forward",
        "media_action_settings",
        "media_title_audio",
        "media_title_video",
        "media_settings_hint",
    };

    private static final long UPDATE_DEBOUNCE_MS = 120L;
    /** A paused page off screen is frozen after 60 s; a command thaws it this long. */
    private static final long PAGE_WAKE_MS = 15_000L;
    private static final long WAKE_LOCK_TIMEOUT_MS = 30L * 60_000L;
    private static final int MAX_ID_CHARS = 48;

    /** Events for the page (QortalMediaPlugin). */
    public interface Listener {
        void onPlayerChanged(JSONObject state);

        void onOpenSettings();

        /** The notification was tapped; {@code frameId} is the frame's own id (go_media_watch.js). */
        void onOpenSource(String frameId, boolean goPage);
    }

    private static final class Frame {
        final int seq;
        final JavaScriptReplyProxy proxy;
        final MediaPlayerPolicy.RateWindow rate = new MediaPlayerPolicy.RateWindow();
        String fid = "";
        String origin = "";
        boolean goPage;

        Frame(int seq, JavaScriptReplyProxy proxy) {
            this.seq = seq;
            this.proxy = proxy;
        }
    }

    private static final class Player {
        String key;
        Frame frame;
        String id;
        String state = "paused";
        String kind = "audio";
        boolean eligible;
        String title = "";
        String artist = "";
        String album = "";
        String docTitle = "";
        MediaPlayerPolicy.Source source = new MediaPlayerPolicy.Source();
        double durationSec = -1;
        double positionSec;
        double rate = 1;
        long reportedAtMs;
        long playingSinceMs;
        long updatedAtMs;
        boolean canNext;
        boolean canPrev;
        boolean seekable;
        /** Cover the frame says is current, and the one decoded here. */
        String artKey = "";
        String decodedArtKey = "";
        Bitmap art;
        boolean pausedByLeave;

        boolean playing() {
            return "playing".equals(state) || "buffering".equals(state);
        }

        boolean video() {
            return "video".equals(kind);
        }
    }

    private static volatile GoMediaHub instance;

    public static GoMediaHub get(Context context) {
        GoMediaHub local = instance;
        if (local != null) return local;
        synchronized (GoMediaHub.class) {
            if (instance == null) instance = new GoMediaHub(context.getApplicationContext());
            return instance;
        }
    }

    private final Context appContext;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService artWorker = Executors.newSingleThreadExecutor();
    private final Map<JavaScriptReplyProxy, Frame> frames = new IdentityHashMap<>();
    private final Map<String, Player> players = new LinkedHashMap<>();
    private final Map<String, String> pageStrings = new HashMap<>();
    private int frameSeq;
    private MediaPlayerPolicy.Settings settings;
    private String currentKey;
    private MediaSession session;
    private boolean dismissed;
    private boolean activityStopped;
    private long pausedSinceMs;
    private boolean updatePosted;
    private String script;
    private WeakReference<WebView> attachedWebView = new WeakReference<>(null);
    private ScriptHandler scriptHandler;
    private Listener listener;
    private PowerManager.WakeLock wakeLock;
    private boolean noisyRegistered;
    private boolean screenOffRegistered;
    /** Composed cover for the notification, and what it was composed from. */
    private Bitmap composedArt;
    private Object composedFrom;
    private boolean composedWithLogo;
    /** Sleep timer: SLEEP_OFF, SLEEP_END_OF_TRACK or minutes; minutes end at sleepAtMs. */
    private int sleepMode = MediaPlayerPolicy.SLEEP_OFF;
    private long sleepAtMs;
    /** Wall clock of sleepAtMs, for the page. */
    private long sleepAtWallMs;
    private String lastPageState = "";
    /** A session and notification are up (teardown has something to take down). */
    private boolean sessionShown;
    private String lastMetadataSig = "";
    private String lastExtrasSig = "";
    private String lastNotificationSig = "";
    /** Bumped when the page sends new texts, so the notification is rebuilt. */
    private int stringsVersion;
    /** The session activity is the settings intent (gear tapped off screen). */
    private boolean sessionActivityIsSettings;

    private final Runnable updateRunnable = () -> {
        updatePosted = false;
        applySession();
    };
    private final Runnable closePausedRunnable = this::closePausedPlayer;
    private final Runnable sleepRunnable = this::onSleepTimer;


    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) return;
            if (!settings().pauseOnNoisy) return;
            Log.i(TAG, "Headphones disconnected: pausing");
            pauseAllPlaying(false);
        }
    };

    private final BroadcastReceiver screenOffReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) return;
            if (!settings().pauseOnScreenLock) return;
            Log.i(TAG, "Screen off: pausing (pause when the screen locks)");
            pauseAllPlaying(true);
        }
    };

    private final MediaSession.Callback sessionCallback = new MediaSession.Callback() {
        @Override
        public void onPlay() {
            userPlay();
        }

        @Override
        public void onPause() {
            userPause();
        }

        @Override
        public void onStop() {
            userPause();
        }

        @Override
        public void onSeekTo(long pos) {
            seekTo(pos / 1000.0);
        }

        @Override
        public void onSkipToNext() {
            command(current(), "next", null);
        }

        @Override
        public void onSkipToPrevious() {
            command(current(), "prev", null);
        }

        @Override
        public void onFastForward() {
            skip(settings().seekStepSec);
        }

        @Override
        public void onRewind() {
            skip(-settings().seekStepSec);
        }

        @Override
        public void onCustomAction(String action, Bundle extras) {
            onButton(action);
        }
    };

    private GoMediaHub(Context context) {
        appContext = context;
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        settings = readSettings(prefs);
        SharedPreferences strings = context.getSharedPreferences(PREFS_STRINGS, Context.MODE_PRIVATE);
        for (String key : STRING_KEYS) {
            String value = strings.getString(key, null);
            if (value != null) pageStrings.put(key, value);
        }
    }

    // ── Installing into the WebView ─────────────────────────────────────────

    /**
     * The channel and the watcher script for every frame this WebView loads
     * from now on. Called from QortalMediaPlugin.load(), before GO's page
     * loads. A recreated activity brings a new WebView: installed again.
     */
    public void attach(WebView webView) {
        if (webView == null) return;
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post(() -> attach(webView));
            return;
        }
        if (attachedWebView.get() == webView) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w(TAG, "This WebView cannot run the media watcher; no background player");
            return;
        }
        String source = script();
        if (source == null) return;
        try {
            WebViewCompat.addWebMessageListener(
                webView,
                CHANNEL_OBJECT,
                Collections.singleton("*"),
                (view, message, sourceOrigin, isMainFrame, replyProxy) ->
                    onMessage(message, sourceOrigin != null ? sourceOrigin.toString() : "", isMainFrame, replyProxy)
            );
            scriptHandler = WebViewCompat.addDocumentStartJavaScript(
                webView, source, Collections.singleton("*"));
            attachedWebView = new WeakReference<>(webView);
        } catch (Exception e) {
            Log.w(TAG, "Media watcher not installed", e);
        }
    }

    private String script() {
        if (script != null) return script;
        try (InputStream in = appContext.getResources().openRawResource(R.raw.go_media_watch)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            script = new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.w(TAG, "Media watcher script missing", e);
        }
        return script;
    }

    public synchronized void setListener(Listener next) {
        listener = next;
    }

    public synchronized void clearListener(Listener current) {
        if (listener == current) listener = null;
    }

    private synchronized Listener listener() {
        return listener;
    }

    // ── Messages from frames ────────────────────────────────────────────────

    private void onMessage(WebMessageCompat message, String origin, boolean isMainFrame,
                           JavaScriptReplyProxy proxy) {
        if (message == null || proxy == null) return;
        String data;
        try {
            data = message.getData();
        } catch (RuntimeException e) {
            return;
        }
        if (data == null || data.length() > MediaPlayerPolicy.MAX_ART_MESSAGE_CHARS) return;
        Frame frame = frames.get(proxy);
        if (frame == null) {
            if (frames.size() >= MediaPlayerPolicy.MAX_FRAMES) dropOldestFrame();
            frame = new Frame(++frameSeq, proxy);
            frames.put(proxy, frame);
        }
        long now = SystemClock.elapsedRealtime();
        if (!frame.rate.allow(now)) return;
        JSONObject msg;
        try {
            msg = new JSONObject(data);
        } catch (Exception e) {
            return;
        }
        if (msg.optInt("v", 0) != 1) return;
        String type = msg.optString("t", "");
        if (!"a".equals(type) && data.length() > MediaPlayerPolicy.MAX_STATE_MESSAGE_CHARS) return;
        String fid = clip(msg.optString("f", ""));
        if (!fid.equals(frame.fid)) {
            // A new document in this frame: its old players are gone.
            if (!frame.fid.isEmpty()) removeFramePlayers(frame);
            frame.fid = fid;
        }
        frame.origin = origin;
        frame.goPage = isMainFrame && isGoOrigin(origin);
        switch (type) {
            case "p":
                onPlayerState(frame, msg, now);
                break;
            case "a":
                onPlayerArt(frame, msg);
                break;
            case "g":
                removePlayer(keyOf(frame, msg.optString("id", "")));
                break;
            case "u":
                removeFramePlayers(frame);
                frames.remove(proxy);
                break;
            default:
                break;
        }
    }

    private static String clip(String raw) {
        if (raw == null) return "";
        return raw.length() > MAX_ID_CHARS ? raw.substring(0, MAX_ID_CHARS) : raw;
    }

    private static String keyOf(Frame frame, String id) {
        return frame.seq + ":" + clip(id);
    }

    private boolean isGoOrigin(String origin) {
        String normalized = MediaPlayerPolicy.normalizeOrigin(origin);
        return "http://localhost".equals(normalized) || "https://localhost".equals(normalized);
    }

    private void onPlayerState(Frame frame, JSONObject msg, long now) {
        String id = msg.optString("id", "");
        if (id.isEmpty()) return;
        String key = keyOf(frame, id);
        Player p = players.get(key);
        if (p == null) {
            if (countPlayers(frame) >= MediaPlayerPolicy.MAX_PLAYERS_PER_FRAME) return;
            p = new Player();
            p.key = key;
            p.frame = frame;
            p.id = clip(id);
            players.put(key, p);
        }
        boolean wasPlaying = p.playing() && p.eligible;
        String state = msg.optString("st", "paused");
        if (!"playing".equals(state) && !"buffering".equals(state) && !"ended".equals(state)) {
            state = "paused";
        }
        p.state = state;
        p.kind = "video".equals(msg.optString("k", "audio")) ? "video" : "audio";
        p.eligible = msg.optBoolean("ok", false);
        p.title = MediaPlayerPolicy.cleanText(msg.optString("ti", ""), MediaPlayerPolicy.MAX_TITLE_CHARS);
        p.artist = MediaPlayerPolicy.cleanText(msg.optString("ar", ""), MediaPlayerPolicy.MAX_ARTIST_CHARS);
        p.album = MediaPlayerPolicy.cleanText(msg.optString("al", ""), MediaPlayerPolicy.MAX_ARTIST_CHARS);
        p.docTitle = MediaPlayerPolicy.cleanText(msg.optString("dt", ""), MediaPlayerPolicy.MAX_TITLE_CHARS);
        p.source = MediaPlayerPolicy.sourceOf(msg.optString("href", ""), frame.origin, frame.goPage);
        p.durationSec = finiteOr(msg.optDouble("d", -1), -1);
        if (msg.optDouble("d", -1) == -2) p.durationSec = Double.POSITIVE_INFINITY;
        p.positionSec = Math.max(0, finiteOr(msg.optDouble("p", 0), 0));
        double rate = finiteOr(msg.optDouble("r", 1), 1);
        p.rate = rate > 0 && rate <= 16 ? rate : 1;
        p.reportedAtMs = now;
        p.updatedAtMs = now;
        p.canNext = msg.optBoolean("nx", false);
        p.canPrev = msg.optBoolean("pv", false);
        p.seekable = msg.optBoolean("sk", false) && p.durationSec > 0 && !Double.isInfinite(p.durationSec);
        p.artKey = clipArtKey(msg.optString("ak", ""));
        boolean nowPlaying = p.playing() && p.eligible;
        if (nowPlaying && !wasPlaying) {
            p.playingSinceMs = now;
            // Playing again: no longer waiting to be resumed.
            p.pausedByLeave = false;
            // Started while GO is off screen (next track, a timer in the
            // page) with a pause-on-leave setting: pause it again.
            if (activityStopped && MediaPlayerPolicy.shouldPauseOnLeave(settings(), p.video(), !isInteractive())) {
                p.pausedByLeave = true;
                command(p, "pause", null);
            }
        }
        if (nowPlaying) dismissed = false;
        requestUpdate();
    }

    private static String clipArtKey(String raw) {
        if (raw == null) return "";
        return raw.length() > 512 ? raw.substring(0, 512) : raw;
    }

    private static double finiteOr(double v, double fallback) {
        return Double.isNaN(v) || Double.isInfinite(v) ? fallback : v;
    }

    private int countPlayers(Frame frame) {
        int n = 0;
        for (Player p : players.values()) if (p.frame == frame) n++;
        return n;
    }

    private void onPlayerArt(Frame frame, JSONObject msg) {
        String key = keyOf(frame, msg.optString("id", ""));
        Player p = players.get(key);
        if (p == null) return;
        String artKey = clipArtKey(msg.optString("ak", ""));
        String data = msg.optString("img", "");
        if (artKey.isEmpty() || data.isEmpty()) return;
        artWorker.execute(() -> {
            Bitmap bitmap = MediaArtwork.decodeDataUrl(data);
            if (bitmap == null) return;
            main.post(() -> {
                Player still = players.get(key);
                if (still == null) {
                    bitmap.recycle();
                    return;
                }
                still.art = bitmap;
                still.decodedArtKey = artKey;
                requestUpdate();
            });
        });
    }

    private void removePlayer(String key) {
        if (players.remove(key) != null) requestUpdate();
    }

    private void removeFramePlayers(Frame frame) {
        boolean changed = false;
        for (Iterator<Player> it = players.values().iterator(); it.hasNext(); ) {
            if (it.next().frame == frame) {
                it.remove();
                changed = true;
            }
        }
        if (changed) requestUpdate();
    }

    private void dropOldestFrame() {
        Iterator<Map.Entry<JavaScriptReplyProxy, Frame>> it = frames.entrySet().iterator();
        // The frame with the lowest seq that has no player, else the lowest.
        Frame victim = null;
        for (Frame f : frames.values()) {
            if (countPlayers(f) == 0 && (victim == null || f.seq < victim.seq)) victim = f;
        }
        if (victim == null) {
            for (Frame f : frames.values()) if (victim == null || f.seq < victim.seq) victim = f;
        }
        if (victim == null) return;
        removeFramePlayers(victim);
        while (it.hasNext()) {
            if (it.next().getValue() == victim) {
                it.remove();
                break;
            }
        }
    }

    // ── Commands to frames ──────────────────────────────────────────────────

    private void command(Player p, String c, JSONObject extra) {
        if (p == null) return;
        JSONObject msg = extra != null ? extra : new JSONObject();
        try {
            msg.put("c", c);
            msg.put("id", p.id);
        } catch (Exception ignored) {
            return;
        }
        // Off screen and paused for a minute, the page is frozen: let it run
        // so the frame gets the command.
        if (activityStopped) BackgroundKeepAlive.get(appContext).wakePageForMedia(PAGE_WAKE_MS);
        String json = msg.toString();
        Runnable post = () -> {
            try {
                p.frame.proxy.postMessage(json);
            } catch (Exception e) {
                Log.w(TAG, "Command not delivered (" + c + ")", e);
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) post.run();
        else main.post(post);
    }

    private Player current() {
        return currentKey != null ? players.get(currentKey) : null;
    }

    private void userPlay() {
        Player p = current();
        if (p == null) return;
        p.pausedByLeave = false;
        dismissed = false;
        // The system just let GO start a foreground service for this button
        // (media session callback): take it now, before the page answers.
        promoteService();
        command(p, "play", null);
    }

    private void userPause() {
        Player p = current();
        if (p == null) return;
        p.pausedByLeave = false;
        command(p, "pause", null);
    }

    private void togglePlay() {
        Player p = current();
        if (p == null) return;
        if (p.playing()) userPause();
        else userPlay();
    }

    private void seekTo(double sec) {
        Player p = current();
        if (p == null || !p.seekable) return;
        JSONObject extra = new JSONObject();
        try {
            extra.put("to", MediaPlayerPolicy.seekTarget(sec, 0, p.durationSec));
        } catch (Exception ignored) {
            return;
        }
        command(p, "seek", extra);
    }

    private void skip(int deltaSec) {
        Player p = current();
        if (p == null) return;
        JSONObject extra = new JSONObject();
        try {
            extra.put("by", deltaSec);
        } catch (Exception ignored) {
            return;
        }
        command(p, "skip", extra);
    }

    /** Pause everything that plays; {@code byLeave} marks it to play again when GO is back. */
    private void pauseAllPlaying(boolean byLeave) {
        for (Player p : players.values()) {
            if (!p.eligible || !p.playing()) continue;
            p.pausedByLeave = byLeave;
            command(p, "pause", null);
        }
    }

    /** Buttons from the notification (receiver) and the media session's custom actions. */
    void onButton(String action) {
        if (action == null) return;
        switch (action) {
            case MediaPlayerPolicy.CUSTOM_BACK:
                skip(-settings().seekStepSec);
                break;
            case MediaPlayerPolicy.CUSTOM_FORWARD:
                skip(settings().seekStepSec);
                break;
            case MediaPlayerPolicy.CUSTOM_SETTINGS:
                openSettingsFromNotification();
                break;
            case QortalMediaActionReceiver.ACTION_PLAY:
                userPlay();
                break;
            case QortalMediaActionReceiver.ACTION_PAUSE:
                userPause();
                break;
            case QortalMediaActionReceiver.ACTION_TOGGLE:
                togglePlay();
                break;
            case QortalMediaActionReceiver.ACTION_NEXT:
                command(current(), "next", null);
                break;
            case QortalMediaActionReceiver.ACTION_PREVIOUS:
                command(current(), "prev", null);
                break;
            case QortalMediaActionReceiver.ACTION_DISMISS:
                onNotificationDismissed();
                break;
            default:
                break;
        }
    }

    /** From GO's own settings window ("Now playing"). */
    public void control(String action) {
        main.post(() -> {
            switch (action == null ? "" : action) {
                case "play":
                    userPlay();
                    break;
                case "pause":
                    userPause();
                    break;
                case "toggle":
                    togglePlay();
                    break;
                case "next":
                    command(current(), "next", null);
                    break;
                case "previous":
                    command(current(), "prev", null);
                    break;
                case "back":
                    skip(-settings().seekStepSec);
                    break;
                case "forward":
                    skip(settings().seekStepSec);
                    break;
                default:
                    break;
            }
        });
    }

    /** How long a gear tap off screen turns the player's own tap into "open the settings". */
    private static final long SETTINGS_TAP_WINDOW_MS = 30_000L;
    /** elapsedRealtime until which a tap on the player opens the settings, or 0. */
    private long settingsTapUntilMs;
    private final Runnable settingsTapExpired = () -> {
        settingsTapUntilMs = 0L;
        applySession();
    };

    private boolean settingsTapActive() {
        return settingsTapUntilMs > SystemClock.elapsedRealtime();
    }

    /**
     * The gear. On screen (the shade pulled over GO) GO opens the settings
     * itself. Off screen Android 10+ never lets an app open a screen on its
     * own, and Android 13+ sends this gear as a media session action, with
     * no PendingIntent to carry the user's tap (measured: BAL_BLOCK). A tap
     * on the player is a notification tap, which may open GO: for the next
     * 30 s it opens GO on the player settings, and its second line says so.
     */
    private void openSettingsFromNotification() {
        if (!activityStopped || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            try {
                appContext.startActivity(settingsIntent());
                return;
            } catch (Exception e) {
                Log.w(TAG, "Player settings could not open from the notification", e);
            }
        }
        settingsTapUntilMs = SystemClock.elapsedRealtime() + SETTINGS_TAP_WINDOW_MS;
        main.removeCallbacks(settingsTapExpired);
        main.postDelayed(settingsTapExpired, SETTINGS_TAP_WINDOW_MS);
        // The hint goes on the player's own second line: a toast would show
        // under the open notification shade.
        applySession();
    }

    private Intent settingsIntent() {
        Intent intent = new Intent(appContext, MainActivity.class);
        intent.setAction(ACTION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return intent;
    }

    private Intent openIntent() {
        Intent intent = new Intent(appContext, MainActivity.class);
        intent.setAction(ACTION_OPEN);
        Player p = current();
        if (p != null) intent.putExtra(EXTRA_FRAME, p.frame.fid);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return intent;
    }

    /** MainActivity got an intent: a notification tap or the settings gear. */
    public void handleLaunchIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Listener l = listener();
        if (ACTION_SETTINGS.equals(action)) {
            if (settingsTapUntilMs != 0L) {
                // Used: the player's tap opens what it plays again.
                settingsTapUntilMs = 0L;
                main.removeCallbacks(settingsTapExpired);
                requestUpdate();
            }
            if (l != null) l.onOpenSettings();
            else pendingOpenSettings = true;
        } else if (ACTION_OPEN.equals(action)) {
            String fid = intent.getStringExtra(EXTRA_FRAME);
            boolean goPage = false;
            for (Frame f : frames.values()) {
                if (f.fid.equals(fid)) goPage = f.goPage;
            }
            if (l != null) l.onOpenSource(fid != null ? fid : "", goPage);
        }
    }

    private boolean pendingOpenSettings;

    /** The page subscribed: hand over a settings tap from a cold start. */
    public boolean takePendingOpenSettings() {
        boolean pending = pendingOpenSettings;
        pendingOpenSettings = false;
        return pending;
    }

    private void onNotificationDismissed() {
        Player p = current();
        if (p != null && p.playing()) return;
        dismissed = true;
        requestUpdate();
    }

    // ── Activity and page ───────────────────────────────────────────────────

    /** MainActivity.onStop: GO left the screen (home, another app, screen off). */
    public void onActivityStop() {
        activityStopped = true;
        boolean screenOff = !isInteractive();
        MediaPlayerPolicy.Settings s = settings();
        for (Player p : players.values()) {
            if (!p.eligible || !p.playing()) continue;
            if (MediaPlayerPolicy.shouldPauseOnLeave(s, p.video(), screenOff)) {
                p.pausedByLeave = true;
                command(p, "pause", null);
            }
        }
        applySession();
    }

    /** MainActivity.onStart: GO is on screen again. */
    public void onActivityStart() {
        activityStopped = false;
        boolean resume = settings().resumeOnReturn;
        for (Player p : players.values()) {
            if (p.pausedByLeave && resume && p.eligible && !p.playing()) {
                command(p, "play", null);
            }
            p.pausedByLeave = false;
        }
        applySession();
    }

    /** GO's page (re)loads or its activity is gone: every frame went with it. */
    public void onPageGone() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post(this::onPageGone);
            return;
        }
        frames.clear();
        players.clear();
        currentKey = null;
        applySession();
    }

    /**
     * Is a player keeping GO's page awake off screen right now? GoWebView
     * keeps Chromium from seeing GO's window hide while it is (so pages that
     * pause on visibilitychange keep playing).
     */
    public boolean holdsPageVisible() {
        for (Player p : players.values()) {
            if (p.eligible && p.playing() && !p.pausedByLeave) return true;
        }
        return false;
    }

    private boolean isInteractive() {
        PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isInteractive();
    }

    // ── Settings ────────────────────────────────────────────────────────────

    public synchronized MediaPlayerPolicy.Settings settings() {
        return settings;
    }

    public void saveSettings(MediaPlayerPolicy.Settings next) {
        MediaPlayerPolicy.Settings s = next.normalized();
        synchronized (this) {
            settings = s;
        }
        prefs.edit()
            .putBoolean("background_audio", s.backgroundAudio)
            .putBoolean("background_video", s.backgroundVideo)
            .putBoolean("pause_on_screen_lock", s.pauseOnScreenLock)
            .putBoolean("resume_on_return", s.resumeOnReturn)
            .putBoolean("lock_screen", s.lockScreen)
            .putBoolean("logo_on_cover", s.logoOnCover)
            .putBoolean("pause_on_noisy", s.pauseOnNoisy)
            .putInt("seek_step_sec", s.seekStepSec)
            .putInt("close_paused_after_min", s.closePausedAfterMin)
            .apply();
        main.post(() -> {
            composedFrom = null;
            applySession();
        });
    }

    static MediaPlayerPolicy.Settings readSettings(SharedPreferences prefs) {
        MediaPlayerPolicy.Settings s = new MediaPlayerPolicy.Settings();
        s.backgroundAudio = prefs.getBoolean("background_audio", s.backgroundAudio);
        s.backgroundVideo = prefs.getBoolean("background_video", s.backgroundVideo);
        s.pauseOnScreenLock = prefs.getBoolean("pause_on_screen_lock", s.pauseOnScreenLock);
        s.resumeOnReturn = prefs.getBoolean("resume_on_return", s.resumeOnReturn);
        s.lockScreen = prefs.getBoolean("lock_screen", s.lockScreen);
        s.logoOnCover = prefs.getBoolean("logo_on_cover", s.logoOnCover);
        s.pauseOnNoisy = prefs.getBoolean("pause_on_noisy", s.pauseOnNoisy);
        s.seekStepSec = prefs.getInt("seek_step_sec", s.seekStepSec);
        s.closePausedAfterMin = prefs.getInt("close_paused_after_min", s.closePausedAfterMin);
        return s.normalized();
    }

    public void setStrings(Map<String, String> strings) {
        SharedPreferences.Editor editor =
            appContext.getSharedPreferences(PREFS_STRINGS, Context.MODE_PRIVATE).edit();
        synchronized (pageStrings) {
            for (String key : STRING_KEYS) {
                String value = strings.get(key);
                if (value == null || value.trim().isEmpty() || value.length() > 80) continue;
                pageStrings.put(key, value);
                editor.putString(key, value);
            }
        }
        editor.apply();
        main.post(() -> {
            stringsVersion++;
            requestUpdate();
        });
    }

    private String text(String key, int resId) {
        synchronized (pageStrings) {
            String value = pageStrings.get(key);
            if (value != null) return value;
        }
        return appContext.getString(resId);
    }

    private String stepText(String key, int resId, int seconds) {
        String pattern = text(key, resId);
        // Page strings use {{n}} (i18next); resources use %1$d.
        if (pattern.contains("{{n}}")) return pattern.replace("{{n}}", String.valueOf(seconds));
        try {
            return String.format(pattern, seconds);
        } catch (RuntimeException e) {
            return pattern;
        }
    }

    // ── Sleep timer ─────────────────────────────────────────────────────────

    /** {@link MediaPlayerPolicy#SLEEP_OFF}, END_OF_TRACK, or minutes from now. */
    public void setSleepTimer(int minutes) {
        int mode = MediaPlayerPolicy.normalizeSleep(minutes);
        main.post(() -> {
            sleepMode = mode;
            if (mode > 0) {
                sleepAtMs = SystemClock.elapsedRealtime() + mode * 60_000L;
                sleepAtWallMs = System.currentTimeMillis() + mode * 60_000L;
            } else {
                sleepAtMs = 0L;
                sleepAtWallMs = 0L;
            }
            scheduleSleep();
            pushPageState(true);
        });
    }

    private void scheduleSleep() {
        main.removeCallbacks(sleepRunnable);
        if (sleepMode > 0) {
            main.postDelayed(sleepRunnable, Math.max(0L, sleepAtMs - SystemClock.elapsedRealtime()));
        } else if (sleepMode == MediaPlayerPolicy.SLEEP_END_OF_TRACK) {
            Player p = current();
            if (p == null) return;
            long now = SystemClock.elapsedRealtime();
            double pos = MediaPlayerPolicy.positionNow(
                p.positionSec, p.reportedAtMs, now, p.playing(), p.rate, p.durationSec);
            long ms = MediaPlayerPolicy.msUntilTrackEnds(pos, p.durationSec, p.playing(), p.rate);
            if (ms < 0) return;
            sleepAtMs = now + ms;
            sleepAtWallMs = System.currentTimeMillis() + ms;
            // Just before the end, so the next track never starts.
            main.postDelayed(sleepRunnable, Math.max(0L, ms - 400L));
        }
    }

    private void onSleepTimer() {
        Log.i(TAG, "Sleep timer: pausing");
        sleepMode = MediaPlayerPolicy.SLEEP_OFF;
        sleepAtMs = 0L;
        sleepAtWallMs = 0L;
        pauseAllPlaying(false);
        pushPageState(true);
    }

    // ── Session, notification, service ──────────────────────────────────────

    private void requestUpdate() {
        if (updatePosted) return;
        updatePosted = true;
        main.postDelayed(updateRunnable, UPDATE_DEBOUNCE_MS);
    }

    private void applySession() {
        main.removeCallbacks(updateRunnable);
        updatePosted = false;
        List<MediaPlayerPolicy.PlayerView> views = new ArrayList<>(players.size());
        for (Player p : players.values()) {
            views.add(new MediaPlayerPolicy.PlayerView(
                p.key, p.eligible, p.playing(), p.playingSinceMs, p.updatedAtMs));
        }
        currentKey = MediaPlayerPolicy.pickCurrent(views, currentKey);
        Player p = current();
        boolean anyPlaying = holdsPageVisible();

        BackgroundKeepAlive.get(appContext).setMediaPlaying(anyPlaying);
        applyWakeLock(anyPlaying && activityStopped);
        applyReceivers(anyPlaying);

        if (p == null || dismissed) {
            teardown();
            pushPageState(false);
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (p.playing()) {
            pausedSinceMs = 0L;
            main.removeCallbacks(closePausedRunnable);
        } else {
            if (pausedSinceMs == 0L) pausedSinceMs = now;
            long due = MediaPlayerPolicy.msUntilClosePaused(
                pausedSinceMs, now, settings().closePausedAfterMin);
            main.removeCallbacks(closePausedRunnable);
            if (due >= 0) main.postDelayed(closePausedRunnable, due);
        }
        if (sleepMode == MediaPlayerPolicy.SLEEP_END_OF_TRACK) scheduleSleep();

        MediaSession s = ensureSession();
        if (s == null) return;
        sessionShown = true;
        // The metadata (with its cover) and the notification only go to
        // Android when something in them changed; the 15 s position syncs
        // only move the playback state.
        boolean hide = lockPrivacy();
        Bitmap cover = hide ? neutralCover() : coverOf(p);
        String metaTitle = hide ? kindTitle(p) : titleOf(p);
        String metaArtist = hide ? appContext.getString(R.string.app_name) : artistOf(p);
        String metaAlbum = hide ? "" : p.album;
        String metaSig = metaTitle + "\u0001" + metaArtist + "\u0001" + metaAlbum + "\u0001"
            + MediaPlayerPolicy.durationMs(p.durationSec) + "\u0001" + System.identityHashCode(cover);
        if (!metaSig.equals(lastMetadataSig)) {
            s.setMetadata(metadata(metaTitle, metaArtist, metaAlbum, p.durationSec, cover));
            lastMetadataSig = metaSig;
        }
        applyLockReceiver(!settings().lockScreen);
        MediaPlayerPolicy.ButtonLayout layout =
            MediaPlayerPolicy.buttonLayout(p.canPrev, p.canNext, p.seekable);
        String extrasSig = layout.reservePrev + "/" + layout.reserveNext;
        if (!extrasSig.equals(lastExtrasSig)) {
            Bundle extras = new Bundle();
            extras.putBoolean("android.media.playback.ALWAYS_RESERVE_SPACE_FOR.ACTION_SKIP_TO_PREVIOUS", layout.reservePrev);
            extras.putBoolean("android.media.playback.ALWAYS_RESERVE_SPACE_FOR.ACTION_SKIP_TO_NEXT", layout.reserveNext);
            s.setExtras(extras);
            lastExtrasSig = extrasSig;
        }
        s.setPlaybackState(playbackState(p, layout, now));
        boolean settingsTap = settingsTapActive();
        if (settingsTap != sessionActivityIsSettings) {
            s.setSessionActivity(openPendingIntent());
            sessionActivityIsSettings = settingsTap;
        }
        if (!s.isActive()) s.setActive(true);

        MediaPlayerPolicy.Settings set = settings();
        String notifSig = metaSig + "\u0001" + p.playing() + p.canPrev + p.canNext + p.seekable
            + "\u0001" + set.lockScreen + "\u0001" + set.seekStepSec + "\u0001" + p.source.label
            + "\u0001" + p.frame.fid + "\u0001" + stringsVersion + "\u0001" + settingsTapActive() + "\u0001" + hide;
        boolean changed = !notifSig.equals(lastNotificationSig);
        if (p.playing()) {
            if (changed || !QortalMediaService.isForeground()) {
                postNotification(buildNotification(p, s, layout));
                lastNotificationSig = notifSig;
            }
            promoteService();
        } else {
            QortalMediaService.detach();
            if (changed) {
                postNotification(buildNotification(p, s, layout));
                lastNotificationSig = notifSig;
            }
        }
        pushPageState(false);
    }

    private void closePausedPlayer() {
        Player p = current();
        if (p == null || p.playing()) return;
        Log.i(TAG, "Paused player closed after " + settings().closePausedAfterMin + " min");
        dismissed = true;
        applySession();
    }

    private MediaSession ensureSession() {
        if (session != null) return session;
        try {
            session = new MediaSession(appContext, "GO");
            session.setCallback(sessionCallback, main);
            session.setSessionActivity(openPendingIntent());
        } catch (RuntimeException e) {
            Log.w(TAG, "Media session unavailable", e);
            session = null;
        }
        return session;
    }

    private void teardown() {
        main.removeCallbacks(closePausedRunnable);
        pausedSinceMs = 0L;
        if (!sessionShown && session == null) return;
        sessionShown = false;
        applyLockReceiver(false);
        lastMetadataSig = "";
        lastNotificationSig = "";
        lastExtrasSig = "";
        lastNotification = null;
        QortalMediaService.stop(appContext);
        NotificationManager nm = appContext.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
        sessionActivityIsSettings = false;
        if (session != null) {
            try {
                session.setActive(false);
                session.release();
            } catch (RuntimeException ignored) {
                /* already gone */
            }
            session = null;
        }
        composedArt = null;
        composedFrom = null;
    }

    private String titleOf(Player p) {
        if (!p.title.isEmpty()) return p.title;
        String label = p.source.label;
        // A page title that is just the app's name ("Ear Bump" for Ear-Bump)
        // says nothing the second line does not.
        if (!p.frame.goPage && !p.docTitle.isEmpty()
            && !MediaPlayerPolicy.sameName(p.docTitle, label)) {
            return p.docTitle;
        }
        return kindTitle(p);
    }

    private String kindTitle(Player p) {
        return p.video()
            ? text("media_title_video", R.string.media_title_video)
            : text("media_title_audio", R.string.media_title_audio);
    }

    /**
     * The second line: the artist, else the Q-App or site, else GO. Right
     * after the gear was tapped off screen: "Tap the player to open its
     * settings" (see openSettingsFromNotification).
     */
    private String artistOf(Player p) {
        if (settingsTapActive()) return text("media_settings_hint", R.string.media_settings_hint);
        return realArtistOf(p);
    }

    private String realArtistOf(Player p) {
        if (!p.artist.isEmpty()) return p.artist;
        if (!p.source.label.isEmpty()) return p.source.label;
        return appContext.getString(R.string.app_name);
    }

    private Bitmap coverOf(Player p) {
        boolean withLogo = settings().logoOnCover;
        Bitmap source = p.art != null && p.decodedArtKey.equals(p.artKey) && !p.artKey.isEmpty() ? p.art : null;
        Object from = source != null ? source : "default";
        if (composedArt != null && composedFrom == from && composedWithLogo == withLogo) return composedArt;
        composedArt = MediaArtwork.compose(appContext, source, withLogo);
        composedFrom = from;
        composedWithLogo = withLogo;
        return composedArt;
    }

    private MediaMetadata metadata(String title, String artist, String album, double durationSec,
                                   Bitmap cover) {
        MediaMetadata.Builder b = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
        if (!album.isEmpty()) b.putString(MediaMetadata.METADATA_KEY_ALBUM, album);
        long dur = MediaPlayerPolicy.durationMs(durationSec);
        if (dur > 0) b.putLong(MediaMetadata.METADATA_KEY_DURATION, dur);
        if (cover != null) {
            b.putBitmap(MediaMetadata.METADATA_KEY_ART, cover);
            b.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, cover);
        }
        return b.build();
    }

    private PlaybackState playbackState(Player p, MediaPlayerPolicy.ButtonLayout layout, long now) {
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
        if (p.seekable) {
            actions |= PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_FAST_FORWARD
                | PlaybackState.ACTION_REWIND;
        }
        if (p.canNext) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
        if (p.canPrev) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        int state;
        if ("buffering".equals(p.state)) state = PlaybackState.STATE_BUFFERING;
        else if (p.playing()) state = PlaybackState.STATE_PLAYING;
        else state = PlaybackState.STATE_PAUSED;
        double pos = MediaPlayerPolicy.positionNow(
            p.positionSec, p.reportedAtMs, now, p.playing(), p.rate, p.durationSec);
        PlaybackState.Builder b = new PlaybackState.Builder()
            .setActions(actions)
            .setState(state, Math.round(pos * 1000.0),
                state == PlaybackState.STATE_PLAYING ? (float) p.rate : 0f, now);
        int step = settings().seekStepSec;
        for (String id : layout.custom) {
            b.addCustomAction(new PlaybackState.CustomAction.Builder(
                id, customLabel(id, step), customIcon(id, step)).build());
        }
        return b.build();
    }

    private String customLabel(String id, int step) {
        switch (id) {
            case MediaPlayerPolicy.CUSTOM_BACK:
                return stepText("media_action_back", R.string.media_action_back, step);
            case MediaPlayerPolicy.CUSTOM_FORWARD:
                return stepText("media_action_forward", R.string.media_action_forward, step);
            default:
                return text("media_action_settings", R.string.media_action_settings);
        }
    }

    private static int customIcon(String id, int step) {
        switch (id) {
            case MediaPlayerPolicy.CUSTOM_BACK:
                return step <= 5 ? R.drawable.ic_media_back_5
                    : step >= 30 ? R.drawable.ic_media_back_30 : R.drawable.ic_media_back_10;
            case MediaPlayerPolicy.CUSTOM_FORWARD:
                return step <= 5 ? R.drawable.ic_media_forward_5
                    : step >= 30 ? R.drawable.ic_media_forward_30 : R.drawable.ic_media_forward_10;
            default:
                return R.drawable.ic_media_settings;
        }
    }

    private void ensureChannel() {
        NotificationManager nm = appContext.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            appContext.getString(R.string.media_channel_name),
            NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(appContext.getString(R.string.media_channel_description));
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }

    private Notification lastNotification;

    /** The notification QortalMediaService starts with (always something, see there). */
    Notification serviceNotification() {
        if (lastNotification != null) return lastNotification;
        ensureChannel();
        return new Notification.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_qortal)
            .setContentTitle(appContext.getString(R.string.app_name))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build();
    }

    /** The service took the foreground: it may stop again if nothing plays any more. */
    boolean shouldStayForeground() {
        Player p = current();
        return p != null && !dismissed && p.playing() && p.eligible;
    }

    private Notification buildNotification(Player p, MediaSession s, MediaPlayerPolicy.ButtonLayout layout) {
        ensureChannel();
        Notification.Builder b = notificationBuilder(p, s, false);
        if (settings().lockScreen) {
            b.setVisibility(Notification.VISIBILITY_PUBLIC);
        } else {
            // Secure lock screens (Android 12 and older) show this version:
            // the buttons, but not what plays. 13+ reads the media session,
            // which goes neutral while the phone is locked (lockPrivacy).
            b.setVisibility(Notification.VISIBILITY_PRIVATE);
            b.setPublicVersion(notificationBuilder(p, s, true).build());
        }
        Notification n = b.build();
        lastNotification = n;
        return n;
    }

    /** {@code neutral}: "Audio" / "Video" and GO, no title, artist or cover (lock screen privacy). */
    private Notification.Builder notificationBuilder(Player p, MediaSession s, boolean neutral) {
        MediaPlayerPolicy.Settings set = settings();
        String title = neutral ? kindTitle(p) : titleOf(p);
        String artist = neutral ? appContext.getString(R.string.app_name) : artistOf(p);
        String label = neutral ? "" : p.source.label;
        Notification.Builder b = new Notification.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_qortal)
            .setContentTitle(title)
            .setContentText(artist)
            .setLargeIcon(neutral ? MediaArtwork.defaultCover(appContext) : coverOf(p))
            .setContentIntent(openPendingIntent())
            .setDeleteIntent(actionPendingIntent(QortalMediaActionReceiver.ACTION_DISMISS))
            .setOngoing(p.playing())
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setColorized(true);
        // The app on the header line, when the second line is the artist.
        if (!label.isEmpty() && !label.equals(artist)) b.setSubText(label);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        // Android 12 and older draw these buttons; 13+ takes them from the
        // media session (and the custom actions in its playback state).
        List<int[]> compact = new ArrayList<>();
        int index = 0;
        int step = set.seekStepSec;
        if (p.canPrev) {
            b.addAction(action(R.drawable.ic_media_prev,
                text("media_action_previous", R.string.media_action_previous),
                QortalMediaActionReceiver.ACTION_PREVIOUS));
            compact.add(new int[] {index++});
        } else if (p.seekable) {
            b.addAction(action(customIcon(MediaPlayerPolicy.CUSTOM_BACK, step),
                customLabel(MediaPlayerPolicy.CUSTOM_BACK, step), MediaPlayerPolicy.CUSTOM_BACK));
            compact.add(new int[] {index++});
        }
        b.addAction(p.playing()
            ? action(R.drawable.ic_media_pause, text("media_action_pause", R.string.media_action_pause),
                QortalMediaActionReceiver.ACTION_PAUSE)
            : action(R.drawable.ic_media_play, text("media_action_play", R.string.media_action_play),
                QortalMediaActionReceiver.ACTION_PLAY));
        compact.add(new int[] {index++});
        if (p.canNext) {
            b.addAction(action(R.drawable.ic_media_next,
                text("media_action_next", R.string.media_action_next),
                QortalMediaActionReceiver.ACTION_NEXT));
            compact.add(new int[] {index++});
        } else if (p.seekable) {
            b.addAction(action(customIcon(MediaPlayerPolicy.CUSTOM_FORWARD, step),
                customLabel(MediaPlayerPolicy.CUSTOM_FORWARD, step), MediaPlayerPolicy.CUSTOM_FORWARD));
            compact.add(new int[] {index++});
        }
        b.addAction(new Notification.Action.Builder(
            android.graphics.drawable.Icon.createWithResource(appContext, R.drawable.ic_media_settings),
            text("media_action_settings", R.string.media_action_settings),
            settingsPendingIntent()).build());
        int[] compactIdx = new int[compact.size()];
        for (int i = 0; i < compact.size(); i++) compactIdx[i] = compact.get(i)[0];
        b.setStyle(new Notification.MediaStyle()
            .setMediaSession(s.getSessionToken())
            .setShowActionsInCompactView(compactIdx));
        return b;
    }

    private Notification.Action action(int icon, String label, String receiverAction) {
        return new Notification.Action.Builder(
            android.graphics.drawable.Icon.createWithResource(appContext, icon),
            label,
            actionPendingIntent(receiverAction)).build();
    }

    private PendingIntent actionPendingIntent(String receiverAction) {
        Intent intent = new Intent(appContext, QortalMediaActionReceiver.class);
        intent.setAction(receiverAction);
        return PendingIntent.getBroadcast(appContext, receiverAction.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A tap on the player: what plays, or the settings right after the gear (see there). */
    private PendingIntent openPendingIntent() {
        if (settingsTapActive()) return settingsPendingIntent();
        return PendingIntent.getActivity(appContext, 0x6d01, openIntent(),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent settingsPendingIntent() {
        return PendingIntent.getActivity(appContext, 0x6d02, settingsIntent(),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void postNotification(Notification n) {
        NotificationManager nm = appContext.getSystemService(NotificationManager.class);
        if (nm == null) return;
        try {
            nm.notify(NOTIFICATION_ID, n);
        } catch (RuntimeException e) {
            Log.w(TAG, "Player notification not posted", e);
        }
    }

    private void promoteService() {
        if (QortalMediaService.isForeground()) return;
        try {
            ContextCompat.startForegroundService(appContext, new Intent(appContext, QortalMediaService.class));
        } catch (RuntimeException e) {
            // Android 12+ refuses a foreground service start from the
            // background outside its exemptions; the notification stays as
            // a plain one and the status service keeps GO alive.
            Log.w(TAG, "Media foreground service not started: " + e);
        }
    }

    // ── Wake lock, receivers ────────────────────────────────────────────────
    // No audio focus here: Chromium's AudioFocusDelegate already holds it for
    // the WebView's media (it pauses for calls and other apps, plays again
    // after short interruptions, ducks). A request of GO's own took the focus
    // from Chromium, which then paused the media it had just started.

    private void applyWakeLock(boolean hold) {
        if (hold) {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
                if (pm == null) return;
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "QortalGo:media");
                wakeLock.setReferenceCounted(false);
            }
            try {
                // Renewed on every update while it plays.
                wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
            } catch (RuntimeException e) {
                Log.w(TAG, "Media wake lock not taken", e);
            }
        } else if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (RuntimeException ignored) {
                /* released already */
            }
        }
    }

    // ── Lock screen privacy ─────────────────────────────────────────────────

    /** The screen went off since the last unlock (the lock follows soon after). */
    private boolean lockedSinceScreenOff;
    private boolean lockReceiverRegistered;
    private Bitmap neutralCover;

    private final BroadcastReceiver lockReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                lockedSinceScreenOff = true;
            } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
                lockedSinceScreenOff = false;
            } else if (Intent.ACTION_SCREEN_ON.equals(action) && !keyguardLocked()) {
                // No lock (none set, or a trusted place / device).
                lockedSinceScreenOff = false;
            }
            applySession();
        }
    };

    private boolean keyguardLocked() {
        android.app.KeyguardManager km = appContext.getSystemService(android.app.KeyguardManager.class);
        return km != null && km.isKeyguardLocked();
    }

    /**
     * "Show what plays on the lock screen" is off and the phone is locked:
     * the player (Android 13+ draws the lock screen one from the media
     * session) shows only "Audio" / "Video" and GO, with its buttons.
     */
    private boolean lockPrivacy() {
        if (settings().lockScreen) return false;
        return lockedSinceScreenOff || keyguardLocked();
    }

    private Bitmap neutralCover() {
        if (neutralCover == null) neutralCover = MediaArtwork.defaultCover(appContext);
        return neutralCover;
    }

    private void applyLockReceiver(boolean want) {
        if (want == lockReceiverRegistered) return;
        if (want) {
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_SCREEN_OFF);
            filter.addAction(Intent.ACTION_SCREEN_ON);
            filter.addAction(Intent.ACTION_USER_PRESENT);
            ContextCompat.registerReceiver(appContext, lockReceiver, filter,
                ContextCompat.RECEIVER_NOT_EXPORTED);
            lockedSinceScreenOff = keyguardLocked();
        } else {
            safeUnregister(lockReceiver);
        }
        lockReceiverRegistered = want;
    }

    private void applyReceivers(boolean playing) {
        MediaPlayerPolicy.Settings s = settings();
        boolean wantNoisy = playing && s.pauseOnNoisy;
        if (wantNoisy != noisyRegistered) {
            if (wantNoisy) {
                ContextCompat.registerReceiver(appContext, noisyReceiver,
                    new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                    ContextCompat.RECEIVER_NOT_EXPORTED);
            } else {
                safeUnregister(noisyReceiver);
            }
            noisyRegistered = wantNoisy;
        }
        boolean wantScreenOff = playing && s.pauseOnScreenLock;
        if (wantScreenOff != screenOffRegistered) {
            if (wantScreenOff) {
                ContextCompat.registerReceiver(appContext, screenOffReceiver,
                    new IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED);
            } else {
                safeUnregister(screenOffReceiver);
            }
            screenOffRegistered = wantScreenOff;
        }
    }

    private void safeUnregister(BroadcastReceiver receiver) {
        try {
            appContext.unregisterReceiver(receiver);
        } catch (RuntimeException ignored) {
            /* not registered */
        }
    }

    // ── The page's view ─────────────────────────────────────────────────────

    /** What GO's settings window shows under "Now playing". */
    public JSONObject pageState() {
        JSONObject out = new JSONObject();
        try {
            Player p = dismissed ? null : current();
            out.put("active", p != null);
            if (p != null) {
                long now = SystemClock.elapsedRealtime();
                out.put("title", titleOf(p));
                // Only a real artist: the window adds the app and the kind itself.
                out.put("artist", p.artist);
                out.put("source", p.source.label);
                out.put("service", p.source.service);
                out.put("kind", p.kind);
                out.put("playing", p.playing());
                out.put("canNext", p.canNext);
                out.put("canPrevious", p.canPrev);
                out.put("seekable", p.seekable);
                out.put("durationSec", p.durationSec > 0 && !Double.isInfinite(p.durationSec) ? p.durationSec : -1);
                out.put("positionSec", MediaPlayerPolicy.positionNow(
                    p.positionSec, p.reportedAtMs, now, p.playing(), p.rate, p.durationSec));
            }
            out.put("sleepMode", sleepMode);
            out.put("sleepEndsAt", sleepAtWallMs > 0 ? sleepAtWallMs : 0);
        } catch (Exception ignored) {
            /* best effort */
        }
        return out;
    }

    private void pushPageState(boolean force) {
        Listener l = listener();
        if (l == null) return;
        JSONObject state = pageState();
        // Positions move every time; the page only needs other changes.
        JSONObject shape = new JSONObject();
        try {
            for (Iterator<String> it = state.keys(); it.hasNext(); ) {
                String k = it.next();
                if (!"positionSec".equals(k)) shape.put(k, state.get(k));
            }
        } catch (Exception ignored) {
            /* best effort */
        }
        String s = shape.toString();
        if (!force && s.equals(lastPageState)) return;
        lastPageState = s;
        l.onPlayerChanged(state);
    }

    /** For QortalMediaService.onStartCommand / its stop path. */
    Context context() {
        return appContext;
    }
}
