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
 * tick while the wake lock is held records that as a vendor freeze so the
 * page can point the user at the phone's battery settings.
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
    private static final String KEY_FREEZE_HINT_PENDING = "vendor_freeze_hint_pending";
    /** Renewed from the 25 s status service tick; a safety net if that stops. */
    private static final long WAKE_LOCK_TIMEOUT_MS = 5L * 60_000L;
    /** The framework hides the window after onStop; re-show after it did (measured). */
    private static final long STOP_REAPPLY_DELAY_MS = 500L;

    /** Events for the Capacitor plugin (it forwards them to the page). */
    public interface Listener {
        void onRelayProfileChanged(String profile);

        void onVendorFreezeDetected(int count, long lastAt, String manufacturer);
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
        public boolean vendorFreezeHintPending;
        public String manufacturer;
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
    private final Runnable evaluateRunnable = this::evaluate;
    private final Runnable deadlineRunnable = this::evaluate;
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
    private boolean charging;
    private boolean unmetered;
    private boolean activityStopped;
    private long stoppedAtMs;
    private boolean outboxPending;
    private boolean sessionActive;
    private boolean suspended;
    private boolean serviceRunning;
    private boolean keepAliveActive;
    /** elapsedRealtime when keepAliveActive last went from true to false, or -1. */
    private long keepAliveEndedAtMs = -1L;
    /** activityStopped as of the last evaluate, to spot the edge for the status text. */
    private boolean evaluatedStopped;
    /** Service type the last evaluate() saw; an edge re-types the running service. */
    private String evaluatedServiceType = KeepAlivePolicy.SERVICE_TYPE_DATA_SYNC;
    private WeakReference<WebView> webViewRef = new WeakReference<>(null);
    private Listener listener;
    private boolean evaluatePosted;

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
        this.charging = readChargingSticky();
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
            // Opening GO resets the dataSync time limit (see the service).
            suspended = false;
        }
        mainHandler.removeCallbacks(stopReapplyRunnable);
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

    /** Foreground service type the status service should run as now. */
    public synchronized String foregroundServiceType() {
        return KeepAlivePolicy.foregroundServiceType(mode, charging, Build.VERSION.SDK_INT);
    }

    /** The status service entered or left the foreground. */
    public void setServiceRunning(boolean running) {
        synchronized (this) {
            if (serviceRunning == running) return;
            serviceRunning = running;
        }
        requestEvaluate();
    }

    /** Android stopped the status service at its time limit; resume when GO is opened. */
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

    public void acknowledgeVendorFreezeHint() {
        prefs.edit().putBoolean(KEY_FREEZE_HINT_PENDING, false).apply();
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
            state.charging = charging;
            state.unmetered = unmetered;
            state.relayProfile = relayTracker.profile();
            state.keepAliveActive = keepAliveActive;
        }
        state.vendorFreezeCount = prefs.getInt(KEY_FREEZE_COUNT, 0);
        long lastAt = prefs.getLong(KEY_FREEZE_LAST_AT, 0L);
        state.vendorFreezeLastAt = lastAt > 0 ? lastAt : null;
        state.vendorFreezeHintPending = prefs.getBoolean(KEY_FREEZE_HINT_PENDING, false);
        state.manufacturer = manufacturer();
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
     * re-reads the charger and watches for vendor freezes.
     */
    public void onServiceTick() {
        long now = SystemClock.elapsedRealtime();
        boolean chargingNow = readChargingSticky();
        boolean held = wakeLock != null && wakeLock.isHeld();
        boolean frozen;
        synchronized (this) {
            charging = chargingNow;
            frozen = freezeDetector.onTick(now, keepAliveActive && held);
        }
        if (frozen) recordVendorFreeze();
        evaluate();
        // A re-show is cheap and covers a framework hide the sentinel missed.
        reapplyVisibleIfKept();
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
        boolean serviceTypeEdge;
        synchronized (this) {
            evaluatePosted = false;
            webView = webViewRef.get();
            KeepAlivePolicy.Inputs in = new KeepAlivePolicy.Inputs();
            in.mode = mode;
            in.activityStopped = activityStopped;
            in.stoppedAtMs = stoppedAtMs;
            in.nowMs = now;
            in.charging = charging;
            in.outboxPending = outboxPending;
            in.sessionActive = sessionActive && webView != null;
            in.suspended = suspended;
            keep = KeepAlivePolicy.shouldKeepVisible(in);
            holdLock = serviceRunning && KeepAlivePolicy.shouldHoldWakeLock(in);
            stopped = activityStopped;
            keepAliveEndedAtMs =
                StatusHonesty.keepAliveEndedAt(keepAliveActive, keep, keepAliveEndedAtMs, now);
            statusEdge = keepAliveActive != keep || evaluatedStopped != stopped;
            keepAliveActive = keep;
            evaluatedStopped = stopped;
            profileChange = relayTracker.update(charging, unmetered, now);
            String serviceType =
                KeepAlivePolicy.foregroundServiceType(mode, charging, Build.VERSION.SDK_INT);
            serviceTypeEdge = !serviceType.equals(evaluatedServiceType);
            evaluatedServiceType = serviceType;
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
        if (serviceTypeEdge) {
            // Plugged in / unplugged or the mode changed: switch between the
            // capped (dataSync) and uncapped (remoteMessaging) type.
            QortalForegroundService.refreshForegroundType();
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
                synchronized (this) {
                    freezeDetector.arm(now);
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

    private void recordVendorFreeze() {
        int count = prefs.getInt(KEY_FREEZE_COUNT, 0) + 1;
        long lastAt = System.currentTimeMillis();
        prefs.edit()
            .putInt(KEY_FREEZE_COUNT, count)
            .putLong(KEY_FREEZE_LAST_AT, lastAt)
            .putBoolean(KEY_FREEZE_HINT_PENDING, true)
            .apply();
        Log.w(TAG, "Vendor freeze detected (" + count + ") on " + manufacturer());
        Listener currentListener;
        synchronized (this) {
            currentListener = listener;
        }
        if (currentListener != null) {
            try {
                currentListener.onVendorFreezeDetected(count, lastAt, manufacturer());
            } catch (RuntimeException error) {
                Log.w(TAG, "vendorFreezeDetected listener failed", error);
            }
        }
    }

    private static String manufacturer() {
        return Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
    }

    // ── Charger and network ─────────────────────────────────────────────────

    private boolean readChargingSticky() {
        try {
            Intent battery = appContext.registerReceiver(
                null,
                new IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            );
            if (battery == null) return charging;
            return battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        } catch (RuntimeException error) {
            return charging;
        }
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
                synchronized (BackgroundKeepAlive.this) {
                    if (charging == plugged) return;
                    charging = plugged;
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
            public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                setUnmetered(isUnmetered(caps));
            }

            @Override
            public void onLost(Network network) {
                // The next default network reports its own capabilities.
                setUnmetered(false);
            }
        };
        try {
            cm.registerDefaultNetworkCallback(callback);
        } catch (RuntimeException error) {
            Log.w(TAG, "Network callback not registered", error);
        }
    }
}
