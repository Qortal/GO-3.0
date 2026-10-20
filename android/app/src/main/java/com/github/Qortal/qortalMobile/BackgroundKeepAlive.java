package com.github.Qortal.qortalMobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.webkit.WebView;

import java.lang.ref.WeakReference;
import java.util.List;

/**
 * Keeps GO's chat engine running after GO leaves the screen.
 *
 * Chromium freezes a hidden WebView page 60 s after it becomes hidden, and
 * the engine runs in that page's Web Worker. Re-dispatching window visibility
 * VISIBLE to the WebView after Activity.onStop keeps the page visible to
 * Chromium (measured: no freeze, cost about that of GO idle on screen). The
 * rule for when to do so is {@link KeepAlivePolicy}; the page itself learns
 * the real foreground state from Capacitor's appStateChange, not from
 * document.visibilityState.
 *
 * With the screen off the CPU sleeps unless a partial wake lock is held, so
 * one is taken on the charger and during the short outbox window. Some
 * vendors (vivo, measured) freeze the whole process anyway; a late service
 * tick while the wake lock is held records that as a vendor freeze in a
 * short log ({@link VendorFreezeLog}). The page decides from that log whether
 * and when to point the user at the phone's battery settings.
 *
 * On Android 15+, after 6 h off screen on battery (mode charging or off), GO
 * pauses the status service and the hubs until it is opened
 * ({@link KeepAlivePolicy#shouldPauseOnBattery}, see {@link #checkBatteryPause}):
 * GO's own limit, since the service runs as remoteMessaging, which Android
 * does not limit.
 *
 * Process-wide singleton. State is guarded by {@code this}; the WebView and
 * the wake lock are only touched on the main thread (see {@link #evaluate}).
 */
public final class BackgroundKeepAlive {
    private static final String TAG = "QortalKeepAlive";
    private static final String PREFS = "qortal_background_sync";
    private static final String KEY_MODE = "mode";
    private static final String KEY_FREEZE_COUNT = "vendor_freeze_count";
    private static final String KEY_FREEZE_LAST_AT = "vendor_freeze_last_at";
    /**
     * Old builds set this on every freeze (it opened the modal notice). The
     * page owns the notice policy now: the stale value is removed at start
     * and State.vendorFreezeHintPending is always false.
     */
    private static final String KEY_FREEZE_HINT_PENDING = "vendor_freeze_hint_pending";
    /** Recent freezes, oldest first (see {@link VendorFreezeLog#trim} for which stay). */
    private static final String KEY_FREEZE_LOG = "vendor_freeze_log";
    /** Renewed from the 25 s status service tick; a safety net if that stops. */
    private static final long WAKE_LOCK_TIMEOUT_MS = 5L * 60_000L;
    /** The framework hides the window after onStop; re-show after it did (measured). */
    private static final long STOP_REAPPLY_DELAY_MS = 500L;
    /**
     * A battery pause a tick found due waits this long, so power broadcasts
     * queued behind that tick (after a vendor freeze) run first.
     */
    private static final long BATTERY_PAUSE_SETTLE_MS = 2_000L;

    /** Events for the Capacitor plugin (it forwards them to the page). */
    public interface Listener {
        void onRelayProfileChanged(String profile);

        /** {@code entry} is the freeze just appended to the log (entry.at = lastAt). */
        void onVendorFreezeDetected(int count, VendorFreezeLog.Entry entry, String manufacturer);
    }

    /** Snapshot for getBackgroundSyncState(). */
    public static final class State {
        public String mode;
        public boolean charging;
        public boolean unmetered;
        public String relayProfile;
        public boolean keepAliveActive;
        public int vendorFreezeCount;
        /** Wall-clock ms of the last vendor freeze, or null. */
        public Long vendorFreezeLastAt;
        /** Always false: kept for older pages, the page owns the notice policy. */
        public boolean vendorFreezeHintPending;
        public String manufacturer;
        /** Recent freezes, oldest first (at most {@link VendorFreezeLog#MAX_ENTRIES}). */
        public List<VendorFreezeLog.Entry> vendorFreezeRecent;
        /** GO is exempt from battery optimisations right now; null when unknown. */
        public Boolean ignoringBatteryOptimizations;
    }

    /** For the status notification: is the page still running off screen? */
    public static final class PageState {
        public boolean activityStopped;
        public boolean keepAliveActive;
        /**
         * elapsedRealtime when the page last became hidden to Chromium: GO
         * left the screen, or keep-alive ended off screen. Chromium freezes
         * the page 60 s after that.
         */
        public long hiddenSinceMs;
    }

    /**
     * Zero-size, GONE view in MainActivity's content. The framework's window
     * visibility dispatch reaches every child, so this sees each real change
     * (stop, screen off/on) while our own dispatches to the WebView do not
     * reach it. ViewTreeObserver's equivalent listener needs API 34.
     */
    public static final class WindowVisibilitySentinel extends View {
        public WindowVisibilitySentinel(Context context) {
            super(context);
            setVisibility(View.GONE);
            setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        }

        @Override
        protected void onWindowVisibilityChanged(int visibility) {
            super.onWindowVisibilityChanged(visibility);
            BackgroundKeepAlive.get(getContext()).onFrameworkWindowVisibilityChanged(visibility);
        }
    }

    private static volatile BackgroundKeepAlive instance;

    public static BackgroundKeepAlive get(Context context) {
        BackgroundKeepAlive local = instance;
        if (local != null) return local;
        synchronized (BackgroundKeepAlive.class) {
            if (instance == null) {
                instance = new BackgroundKeepAlive(context.getApplicationContext());
            }
            return instance;
        }
    }

    private final Context appContext;
    private final SharedPreferences prefs;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final KeepAlivePolicy.RelayProfileTracker relayTracker =
        new KeepAlivePolicy.RelayProfileTracker();
    private final KeepAlivePolicy.VendorFreezeDetector freezeDetector =
        new KeepAlivePolicy.VendorFreezeDetector();
    /** Serialises the read-modify-write of the freeze count and log. */
    private final Object freezeLogLock = new Object();
    private final Runnable evaluateRunnable = this::evaluate;
    private final Runnable deadlineRunnable = this::evaluate;
    private final DefaultNetworkSwitch defaultNetworkSwitch = new DefaultNetworkSwitch();
    private final NetworkRefreshPacer networkRefreshPacer = new NetworkRefreshPacer();
    private final Runnable networkRefreshRunnable = () -> ReticulumPlugin.refreshNetwork(
        "default_network_changed",
        networkRefreshPacer.onRun(SystemClock.elapsedRealtime())
    );
    private final Runnable batteryPauseCheckRunnable = this::checkBatteryPause;
    /**
     * The immediate evaluate after onStop runs before the framework's hide
     * traversal (the window is still visible then), so this late pass must
     * dispatch VISIBLE again on its own rather than rely on overrideVisible.
     */
    private final Runnable stopReapplyRunnable = () -> {
        evaluate();
        reapplyVisibleIfKept();
    };

    // Guarded by this.
    private String mode;
    /** Charger state and the last unplug, seen or inferred (GO's battery limit). */
    private final KeepAlivePolicy.BatteryStretchTracker battery;
    private boolean unmetered;
    private boolean activityStopped;
    private long stoppedAtMs;
    private boolean outboxPending;
    /** A call dials or runs / an incoming call rings (CallSession). */
    private boolean callActive;
    private boolean callRinging;
    private boolean sessionActive;
    private boolean suspended;
    private boolean serviceRunning;
    private boolean keepAliveActive;
    /** elapsedRealtime when keepAliveActive last went from true to false, or -1. */
    private long keepAliveEndedAtMs = -1L;
    /** activityStopped as of the last evaluate, to spot the edge for the status text. */
    private boolean evaluatedStopped;
    private WeakReference<WebView> webViewRef = new WeakReference<>(null);
    private Listener listener;
    private boolean evaluatePosted;
    /**
     * Charger and exemption at the last watched tick (or at arm): the state
     * when a freeze the next tick reveals began. GO cannot look while frozen,
     * and the tick that sees the freeze usually runs after screen-on, when
     * the phone may already be off the charger.
     */
    private boolean lastWatchedCharging;
    private boolean lastWatchedIgnoring;

    // Main thread only.
    /** Our last dispatch told Chromium VISIBLE while the Activity is stopped. */
    private boolean overrideVisible;
    /** We dispatched a hidden state ourselves; undo it when GO is back on screen. */
    private boolean hiddenByUs;
    private PowerManager.WakeLock wakeLock;

    private BackgroundKeepAlive(Context appContext) {
        this.appContext = appContext;
        this.prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.mode = KeepAlivePolicy.modeOrDefault(prefs.getString(KEY_MODE, null));
        dropStaleFreezeHint();
        BatteryReading reading = readBattery();
        this.battery = new KeepAlivePolicy.BatteryStretchTracker(
            reading != null && reading.plugged
        );
        this.unmetered = readUnmeteredNow();
        registerPowerReceiver();
        registerNetworkCallback();
    }

    // ── Inputs ──────────────────────────────────────────────────────────────

    /** MainActivity built a WebView (first start or after a renderer crash). */
    public void attachWebView(WebView webView) {
        synchronized (this) {
            webViewRef = new WeakReference<>(webView);
            // A new page starts signed out; login reports the session again.
            sessionActive = false;
            outboxPending = false;
        }
        mainHandler.post(() -> {
            overrideVisible = false;
            hiddenByUs = false;
        });
        requestEvaluate();
    }

    /** The WebView is being destroyed (Activity destroy or renderer death). */
    public void detachWebView(WebView webView) {
        synchronized (this) {
            WebView current = webViewRef.get();
            if (current != null && current != webView) return;
            webViewRef = new WeakReference<>(null);
            sessionActive = false;
            outboxPending = false;
        }
        requestEvaluate();
    }

    public void onActivityStart() {
        synchronized (this) {
            activityStopped = false;
            // Opening GO ends a pause (Android's dataSync time limit or GO's
            // own battery limit; the service resumes in onAppForeground).
            suspended = false;
        }
        mainHandler.removeCallbacks(stopReapplyRunnable);
        // On screen: no battery pause (checkBatteryPause would skip it anyway).
        mainHandler.removeCallbacks(batteryPauseCheckRunnable);
        requestEvaluate();
    }

    public void onActivityStop() {
        synchronized (this) {
            activityStopped = true;
            stoppedAtMs = SystemClock.elapsedRealtime();
        }
        requestEvaluate();
        // The framework hides the window a moment after onStop.
        mainHandler.removeCallbacks(stopReapplyRunnable);
        mainHandler.postDelayed(stopReapplyRunnable, STOP_REAPPLY_DELAY_MS);
    }

    /** A signed-in page runs (status service or presence bridge started). */
    public void setSessionActive(boolean active) {
        synchronized (this) {
            sessionActive = active;
            // Logged out: nothing of ours waits to leave any more.
            if (!active) outboxPending = false;
        }
        requestEvaluate();
    }

    /** A signed-in page has marked the session and not ended it since. */
    public synchronized boolean isSessionActive() {
        return sessionActive;
    }

    /** The status service entered or left the foreground. */
    public void setServiceRunning(boolean running) {
        synchronized (this) {
            if (serviceRunning == running) return;
            serviceRunning = running;
        }
        requestEvaluate();
    }

    /**
     * The status service paused until GO is opened: Android's time limit
     * (onTimeout) or GO's own battery limit (see {@link #checkBatteryPause}).
     */
    public void onForegroundServiceTimeout() {
        synchronized (this) {
            suspended = true;
        }
        requestEvaluate();
    }

    public void setMode(String rawMode) {
        String parsed = KeepAlivePolicy.modeOrDefault(rawMode);
        synchronized (this) {
            mode = parsed;
        }
        prefs.edit().putString(KEY_MODE, parsed).apply();
        requestEvaluate();
    }

    public void setOutboxPending(boolean pending) {
        synchronized (this) {
            if (outboxPending == pending) return;
            outboxPending = pending;
        }
        requestEvaluate();
    }

    /**
     * A call dials or runs, or an incoming call rings (CallSession): keeps the
     * page running off screen in every mode, holds the CPU awake and skips
     * GO's battery pause (KeepAlivePolicy.callNeedsPage).
     */
    public void setCallState(boolean active, boolean ringing) {
        synchronized (this) {
            if (callActive == active && callRinging == ringing) return;
            callActive = active;
            callRinging = ringing;
        }
        Log.i(TAG, "Call state for keep-alive: active=" + active + " ringing=" + ringing);
        requestEvaluate();
    }

    /** Kept for older pages; harmless (the flag is never set any more). */
    public void acknowledgeVendorFreezeHint() {
        prefs.edit().remove(KEY_FREEZE_HINT_PENDING).apply();
    }

    public synchronized void setListener(Listener next) {
        listener = next;
    }

    public synchronized void clearListener(Listener current) {
        if (listener == current) listener = null;
    }

    public State getState() {
        State state = new State();
        synchronized (this) {
            state.mode = mode;
            state.charging = battery.charging();
            state.unmetered = unmetered;
            state.relayProfile = relayTracker.profile();
            state.keepAliveActive = keepAliveActive;
        }
        state.vendorFreezeCount = prefs.getInt(KEY_FREEZE_COUNT, 0);
        long lastAt = prefs.getLong(KEY_FREEZE_LAST_AT, 0L);
        state.vendorFreezeLastAt = lastAt > 0 ? lastAt : null;
        state.vendorFreezeHintPending = false;
        state.manufacturer = manufacturer();
        state.vendorFreezeRecent = VendorFreezeLog.decode(readFreezeLog());
        state.ignoringBatteryOptimizations = readIgnoringBatteryOptimizations();
        return state;
    }

    public synchronized PageState getPageState() {
        PageState state = new PageState();
        state.activityStopped = activityStopped;
        state.keepAliveActive = keepAliveActive;
        state.hiddenSinceMs = StatusHonesty.hiddenSince(stoppedAtMs, keepAliveEndedAtMs);
        return state;
    }

    /**
     * The status service's 25 s tick (main thread): renews the wake lock,
     * re-reads the charger and battery level, watches for vendor freezes and
     * schedules GO's own battery limit ({@link #checkBatteryPause}). A tick
     * that arrives late (CPU asleep, or a vendor freeze) just pauses late;
     * the stretch is measured in elapsedRealtime.
     */
    public void onServiceTick() {
        long now = SystemClock.elapsedRealtime();
        BatteryReading reading = readBattery();
        boolean held = wakeLock != null && wakeLock.isHeld();
        boolean watching;
        synchronized (this) {
            watching = keepAliveActive && held;
        }
        // A binder call: outside the lock, and only while watching.
        boolean ignoringNow = watching && isIgnoringBatteryOptimizations();
        long freezeGapMs;
        boolean chargingBefore;
        boolean ignoringBefore;
        boolean batteryPauseDue;
        synchronized (this) {
            noteBatteryLocked(reading, now);
            boolean chargingNow = battery.charging();
            chargingBefore = lastWatchedCharging;
            ignoringBefore = lastWatchedIgnoring;
            freezeGapMs = freezeDetector.onTickGap(now, watching);
            if (watching) {
                lastWatchedCharging = chargingNow;
                lastWatchedIgnoring = ignoringNow;
            }
            batteryPauseDue = serviceRunning
                && KeepAlivePolicy.shouldPauseOnBattery(batteryInputsLocked(now));
        }
        if (freezeGapMs >= 0) {
            // Exempt only if it was so on both sides of the freeze.
            recordVendorFreeze(freezeGapMs, ignoringBefore && ignoringNow, chargingBefore);
        }
        if (batteryPauseDue) {
            // Not in this message: after a vendor freeze, the power
            // broadcasts that arrived while GO was frozen are queued behind
            // this tick, and one may show a charge GO has not seen yet.
            mainHandler.removeCallbacks(batteryPauseCheckRunnable);
            mainHandler.postDelayed(batteryPauseCheckRunnable, BATTERY_PAUSE_SETTLE_MS);
        }
        evaluate();
        // A re-show is cheap and covers a framework hide the sentinel missed.
        reapplyVisibleIfKept();
    }

    /**
     * GO's own battery limit (Android 15+): pause the status service and the
     * hubs until GO is opened, once GO has been off screen on battery for
     * 6 h ({@link KeepAlivePolicy#shouldPauseOnBattery}). Posted by a tick
     * that found the pause due, {@link #BATTERY_PAUSE_SETTLE_MS} later, and
     * checks everything again with a fresh charger reading. Main thread:
     * onActivityStart runs there too, so GO coming on screen cannot slip in
     * between this check and the pause. The pause sets suspended (only
     * opening GO clears it), so it happens once.
     */
    private void checkBatteryPause() {
        long now = SystemClock.elapsedRealtime();
        BatteryReading reading = readBattery();
        boolean chargerChanged;
        boolean due;
        long stretchMs = 0L;
        synchronized (this) {
            chargerChanged = noteBatteryLocked(reading, now);
            KeepAlivePolicy.Inputs in = batteryInputsLocked(now);
            due = serviceRunning && KeepAlivePolicy.shouldPauseOnBattery(in);
            if (due) stretchMs = now - KeepAlivePolicy.batteryStretchStartMs(in);
        }
        if (chargerChanged) requestEvaluate();
        if (!due) return;
        Log.i(TAG, "Off screen on battery for " + (stretchMs / 60_000L)
            + " min; pausing background sync until GO is opened");
        QortalForegroundService.pauseOnBattery();
    }

    /** Inputs for GO's battery limit. Caller holds {@code this}. */
    private KeepAlivePolicy.Inputs batteryInputsLocked(long now) {
        KeepAlivePolicy.Inputs in = new KeepAlivePolicy.Inputs();
        in.mode = mode;
        in.activityStopped = activityStopped;
        in.stoppedAtMs = stoppedAtMs;
        in.nowMs = now;
        in.charging = battery.charging();
        in.unpluggedAtMs = battery.unpluggedAtMs();
        in.suspended = suspended;
        in.sdkInt = Build.VERSION.SDK_INT;
        in.callActive = callActive;
        in.callRinging = callRinging;
        return in;
    }

    /**
     * The framework changed GO's window visibility (seen by the sentinel view
     * in MainActivity's content, which our own WebView dispatches never reach).
     */
    public void onFrameworkWindowVisibilityChanged(int visibility) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> onFrameworkWindowVisibilityChanged(visibility));
            return;
        }
        if (visibility == View.VISIBLE) {
            overrideVisible = false;
            hiddenByUs = false;
            return;
        }
        // Chromium just got the hidden state along with this dispatch.
        overrideVisible = false;
        requestEvaluate();
    }

    // ── Evaluation ──────────────────────────────────────────────────────────

    private void requestEvaluate() {
        synchronized (this) {
            if (evaluatePosted) return;
            evaluatePosted = true;
        }
        mainHandler.post(evaluateRunnable);
    }

    /** Apply the rule. Main thread only. */
    private void evaluate() {
        long now = SystemClock.elapsedRealtime();
        boolean keep;
        boolean holdLock;
        boolean stopped;
        String profileChange;
        long nextDeadline = -1L;
        WebView webView;
        Listener currentListener;
        boolean statusEdge;
        synchronized (this) {
            evaluatePosted = false;
            webView = webViewRef.get();
            KeepAlivePolicy.Inputs in = new KeepAlivePolicy.Inputs();
            in.mode = mode;
            in.activityStopped = activityStopped;
            in.stoppedAtMs = stoppedAtMs;
            in.nowMs = now;
            in.charging = battery.charging();
            in.outboxPending = outboxPending;
            in.sessionActive = sessionActive && webView != null;
            in.suspended = suspended;
            in.callActive = callActive;
            in.callRinging = callRinging;
            keep = KeepAlivePolicy.shouldKeepVisible(in);
            holdLock = serviceRunning && KeepAlivePolicy.shouldHoldWakeLock(in);
            stopped = activityStopped;
            keepAliveEndedAtMs =
                StatusHonesty.keepAliveEndedAt(keepAliveActive, keep, keepAliveEndedAtMs, now);
            statusEdge = keepAliveActive != keep || evaluatedStopped != stopped;
            keepAliveActive = keep;
            evaluatedStopped = stopped;
            profileChange = relayTracker.update(in.charging, unmetered, now);
            long outboxEnd = KeepAlivePolicy.msUntilOutboxWindowEnds(in);
            long relayDue = relayTracker.msUntilFull(now);
            nextDeadline = minPositive(outboxEnd, relayDue);
            currentListener = listener;
        }

        mainHandler.removeCallbacks(deadlineRunnable);
        if (nextDeadline >= 0) {
            mainHandler.postDelayed(deadlineRunnable, nextDeadline + 50L);
        }

        applyVisibility(webView, stopped, keep);
        applyWakeLock(holdLock, now);
        if (statusEdge) {
            // On screen / off screen / kept awake changed what the status
            // notification should say; it redraws only if its text changed.
            QortalForegroundService.refreshHonestStatus();
        }

        if (profileChange != null) {
            Log.i(TAG, "Relay profile " + profileChange);
            // The page may be frozen (no keep-alive) and unable to pass a
            // "leaf" change on to Python; apply that one here too.
            String frame = KeepAlivePolicy.nativeOverlayProfileFrame(profileChange);
            if (frame != null) ReticulumPlugin.feedPresenceFrame(frame, "relay profile");
            if (currentListener != null) {
                try {
                    currentListener.onRelayProfileChanged(profileChange);
                } catch (RuntimeException error) {
                    Log.w(TAG, "relayProfileChanged listener failed", error);
                }
            }
        }
    }

    private static long minPositive(long a, long b) {
        if (a < 0) return b;
        if (b < 0) return a;
        return Math.min(a, b);
    }

    private void applyVisibility(WebView webView, boolean stopped, boolean keep) {
        if (webView == null) {
            overrideVisible = false;
            hiddenByUs = false;
            return;
        }
        if (!stopped) {
            // On screen: the framework owns visibility again. Only undo a
            // hidden state we dispatched ourselves if the window is shown.
            overrideVisible = false;
            if (hiddenByUs && webView.getWindowVisibility() == View.VISIBLE) {
                dispatchWindowVisibility(webView, View.VISIBLE);
            }
            hiddenByUs = false;
            return;
        }
        if (keep) {
            if (!overrideVisible) {
                dispatchWindowVisibility(webView, View.VISIBLE);
                overrideVisible = true;
                hiddenByUs = false;
                Log.i(TAG, "Keeping the page awake in the background");
            }
            return;
        }
        if (overrideVisible) {
            // Keep-alive ended off screen: let Chromium see the real (hidden)
            // window so it freezes the page after 60 s as before.
            int real = webView.getWindowVisibility();
            dispatchWindowVisibility(webView, real != View.VISIBLE ? real : View.GONE);
            overrideVisible = false;
            hiddenByUs = true;
            Log.i(TAG, "Background keep-alive ended");
        }
    }

    private void reapplyVisibleIfKept() {
        WebView webView;
        boolean keep;
        boolean stopped;
        synchronized (this) {
            webView = webViewRef.get();
            keep = keepAliveActive;
            stopped = activityStopped;
        }
        if (webView != null && stopped && keep) {
            dispatchWindowVisibility(webView, View.VISIBLE);
            overrideVisible = true;
        }
    }

    private static void dispatchWindowVisibility(WebView webView, int visibility) {
        try {
            webView.dispatchWindowVisibilityChanged(visibility);
        } catch (RuntimeException error) {
            // A WebView torn down under us (renderer death) may throw.
            Log.w(TAG, "Window visibility dispatch failed", error);
        }
    }

    private void applyWakeLock(boolean hold, long now) {
        if (hold) {
            PowerManager.WakeLock lock = ensureWakeLock();
            if (lock == null) return;
            boolean wasHeld = lock.isHeld();
            try {
                // Not reference counted: a repeat acquire renews the timeout.
                lock.acquire(WAKE_LOCK_TIMEOUT_MS);
            } catch (RuntimeException error) {
                Log.w(TAG, "Wake lock acquire failed", error);
                return;
            }
            if (!wasHeld) {
                boolean ignoringNow = isIgnoringBatteryOptimizations();
                synchronized (this) {
                    freezeDetector.arm(now);
                    lastWatchedCharging = battery.charging();
                    lastWatchedIgnoring = ignoringNow;
                }
                Log.i(TAG, "Wake lock held for background sync");
            }
            return;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (RuntimeException error) {
                Log.w(TAG, "Wake lock release failed", error);
            }
            Log.i(TAG, "Wake lock released");
        }
        synchronized (this) {
            freezeDetector.disarm();
        }
    }

    private PowerManager.WakeLock ensureWakeLock() {
        if (wakeLock != null) return wakeLock;
        PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
        if (pm == null) return null;
        try {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "QortalGo:backgroundSync");
            wakeLock.setReferenceCounted(false);
        } catch (RuntimeException error) {
            Log.w(TAG, "Wake lock unavailable", error);
            wakeLock = null;
        }
        return wakeLock;
    }

    /**
     * Appends the freeze to the log and tells the page. No hint flag is set:
     * the page owns the notice policy (significant gaps, episodes, cooldown,
     * "Don't show again"), so a single freeze never forces a notice.
     * {@code ignoring} and {@code charging} describe the freeze itself (see
     * {@link VendorFreezeLog.Entry}), not the moment it was noticed.
     */
    private void recordVendorFreeze(long gapMs, boolean ignoring, boolean charging) {
        VendorFreezeLog.Entry entry = new VendorFreezeLog.Entry(
            System.currentTimeMillis(),
            gapMs,
            ignoring,
            charging
        );
        int count;
        synchronized (freezeLogLock) {
            count = prefs.getInt(KEY_FREEZE_COUNT, 0) + 1;
            prefs.edit()
                .putInt(KEY_FREEZE_COUNT, count)
                .putLong(KEY_FREEZE_LAST_AT, entry.at)
                .putString(KEY_FREEZE_LOG, VendorFreezeLog.append(readFreezeLog(), entry))
                .apply();
        }
        Log.w(TAG, "Vendor freeze detected (" + count + ", gap " + gapMs + " ms, exempt "
            + entry.ignoring + ", charging " + entry.charging + ") on " + manufacturer());
        Listener currentListener;
        synchronized (this) {
            currentListener = listener;
        }
        if (currentListener != null) {
            try {
                currentListener.onVendorFreezeDetected(count, entry, manufacturer());
            } catch (RuntimeException error) {
                Log.w(TAG, "vendorFreezeDetected listener failed", error);
            }
        }
    }

    private String readFreezeLog() {
        try {
            return prefs.getString(KEY_FREEZE_LOG, null);
        } catch (ClassCastException error) {
            // Not a string (never written so): start a fresh log.
            return null;
        }
    }

    /** Old builds left this true after any freeze; nothing reads it now. */
    private void dropStaleFreezeHint() {
        try {
            if (prefs.contains(KEY_FREEZE_HINT_PENDING)) {
                prefs.edit().remove(KEY_FREEZE_HINT_PENDING).apply();
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Stale freeze hint not removed", error);
        }
    }

    /**
     * GO is on the system's "unrestricted" battery list (deviceidle
     * whitelist); null when the system cannot say.
     */
    public Boolean readIgnoringBatteryOptimizations() {
        try {
            PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return null;
            return pm.isIgnoringBatteryOptimizations(appContext.getPackageName());
        } catch (RuntimeException error) {
            // Not logged: the 25 s tick asks while watching.
            return null;
        }
    }

    /** {@link #readIgnoringBatteryOptimizations}, unknown read as not exempt. */
    public boolean isIgnoringBatteryOptimizations() {
        return Boolean.TRUE.equals(readIgnoringBatteryOptimizations());
    }

    private static String manufacturer() {
        return Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
    }

    // ── Charger and network ─────────────────────────────────────────────────

    /** Charger and battery level from one sticky ACTION_BATTERY_CHANGED read. */
    private static final class BatteryReading {
        final boolean plugged;
        /** 0-100, or -1 when unknown. */
        final int levelPct;

        BatteryReading(boolean plugged, int levelPct) {
            this.plugged = plugged;
            this.levelPct = levelPct;
        }
    }

    /** The current battery state, or null when the system gives none. */
    private BatteryReading readBattery() {
        try {
            Intent battery = appContext.registerReceiver(
                null,
                new IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            );
            if (battery == null) return null;
            return new BatteryReading(
                battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0,
                KeepAlivePolicy.batteryPercent(
                    battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
                    battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                )
            );
        } catch (RuntimeException error) {
            return null;
        }
    }

    /**
     * Feeds a battery reading to the tracker (an unplug, or a level that
     * shows a charge GO did not see, restarts GO's on-battery count). Caller
     * holds {@code this}. Returns whether the charger state changed.
     */
    private boolean noteBatteryLocked(BatteryReading reading, long nowMs) {
        if (reading == null) return false;
        boolean changed = battery.onCharging(reading.plugged, nowMs);
        if (battery.onLevel(reading.levelPct, nowMs)) {
            Log.i(TAG, "Battery at " + reading.levelPct
                + "% shows a charge GO did not see; on-battery count starts again");
        }
        return changed;
    }

    private void registerPowerReceiver() {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent != null ? intent.getAction() : null;
                boolean plugged;
                if (Intent.ACTION_POWER_CONNECTED.equals(action)) {
                    plugged = true;
                } else if (Intent.ACTION_POWER_DISCONNECTED.equals(action)) {
                    plugged = false;
                } else {
                    return;
                }
                long now = SystemClock.elapsedRealtime();
                synchronized (BackgroundKeepAlive.this) {
                    if (plugged) {
                        if (!battery.onCharging(true, now)) return;
                    } else if (!battery.onPowerDisconnected(now)) {
                        // Already on battery as far as GO knew (the plug-in
                        // came while GO was frozen, or a tick saw the
                        // unplug first): the count starts from now.
                        Log.i(TAG, "Power disconnected while on battery for GO;"
                            + " on-battery count starts again");
                        return;
                    }
                }
                requestEvaluate();
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_POWER_CONNECTED);
        filter.addAction(Intent.ACTION_POWER_DISCONNECTED);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                appContext.registerReceiver(receiver, filter);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Power receiver not registered", error);
        }
    }

    private boolean readUnmeteredNow() {
        try {
            ConnectivityManager cm = appContext.getSystemService(ConnectivityManager.class);
            if (cm == null) return false;
            Network network = cm.getActiveNetwork();
            if (network == null) return false;
            return isUnmetered(cm.getNetworkCapabilities(network));
        } catch (RuntimeException error) {
            return false;
        }
    }

    private static boolean isUnmetered(NetworkCapabilities caps) {
        if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            return false;
        }
        if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) return true;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED);
    }

    private void setUnmetered(boolean next) {
        synchronized (this) {
            if (unmetered == next) return;
            unmetered = next;
        }
        requestEvaluate();
    }

    private void registerNetworkCallback() {
        ConnectivityManager cm = appContext.getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                // A Wi-Fi <-> mobile switch keeps the phone "online", so
                // nothing else notices that the hub sockets sit on the old
                // network: redial them on the new one.
                if (defaultNetworkSwitch.onAvailable(network.getNetworkHandle())) {
                    long wait = networkRefreshPacer.onSwitch(SystemClock.elapsedRealtime());
                    mainHandler.removeCallbacks(networkRefreshRunnable);
                    mainHandler.postDelayed(networkRefreshRunnable, wait);
                }
            }

            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                setUnmetered(isUnmetered(caps));
            }

            @Override
            public void onLost(Network network) {
                // The next default network reports its own capabilities.
                setUnmetered(false);
                defaultNetworkSwitch.onLost(network.getNetworkHandle());
            }
        };
        try {
            if (cm.getActiveNetwork() == null) defaultNetworkSwitch.seedNoNetwork();
        } catch (RuntimeException error) {
            Log.w(TAG, "Active network not readable", error);
        }
        try {
            cm.registerDefaultNetworkCallback(callback);
        } catch (RuntimeException error) {
            Log.w(TAG, "Network callback not registered", error);
        }
    }
}
