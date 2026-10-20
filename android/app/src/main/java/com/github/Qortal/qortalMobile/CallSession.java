package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Native side of a voice call (1:1 or group), process-wide.
 *
 * - Ringing: the incoming-call notification (ringtone, full screen on the
 *   lock screen), either from the page (QortalCall.showIncomingCall) or from
 *   a CALL_REQUEST the presence reader saw while the page was frozen
 *   ({@link #sniffPresenceFrame}). Rate limited, 60 s at most, and dropped
 *   when the page does not take it up.
 * - In a call (QortalCall.setCallActive): keeps the page running off screen
 *   and the CPU awake (BackgroundKeepAlive), makes the status service a
 *   microphone foreground service with the call notification
 *   (QortalForegroundService.syncCallForegroundOnMain), holds a Wi-Fi lock.
 * - Lock screen: GO shows over the lock screen only while a call rings or
 *   runs (and a moment after Accept, until the page starts the call); the
 *   page shows only the call screen then (isDeviceLocked / deviceLockChanged).
 * - Notification buttons reach the page as QortalCall 'callAction' events;
 *   a page without that listener still gets accept/decline through the old
 *   QortalBackground 'incomingCallAction'.
 *
 * All state lives on the main thread; public entry points post there.
 */
public final class CallSession {
    private static final String TAG = "QortalCallSession";
    /** After Accept, GO stays over the lock screen this long for the page to start the call. */
    private static final long ANSWER_GRACE_MS = 15_000L;
    /**
     * After the page ends its ring, GO stays over the lock screen this long:
     * an in-app Accept ends the ring a moment before the call starts, and the
     * window must not drop behind the lock screen in between (a Decline
     * returns to the lock screen this much later).
     */
    private static final long RING_END_GRACE_MS = 3_000L;

    public static final String SOURCE_NATIVE = "native";
    public static final String SOURCE_PAGE = "page";
    public static final String SOURCE_LEGACY = "legacy";

    /** The plugin that forwards to the page (QortalCallPlugin). */
    public interface Listener {
        void onCallAction(String action, String callId, String source, long atMs);

        void onRingStateChanged(RingSnapshot ring);

        void onDeviceLockChanged(boolean locked, boolean interactive);

        void onCallForegroundChanged(Boolean micForeground, int typeFlags, String callId);

        /** The page listens for 'callAction' (then the old event is not sent). */
        boolean hasCallActionListeners();
    }

    /** What the page learns about the ring. */
    public static final class RingSnapshot {
        public String callId;
        public String fromAddress;
        public String name;
        public String source;
        public boolean ringing;
        /** The tray notification (with the ringtone) is up; the page should not ring itself. */
        public boolean posted;
        public boolean silent;
        public boolean confirmed;
        /** Why it ended (ringing == false), or why it changed. */
        public String reason;
    }

    /** A notification action the page may not have seen yet (cold start). */
    public static final class PendingAction {
        public final String action;
        public final String callId;
        public final String source;
        public final long atMs;

        PendingAction(String action, String callId, String source, long atMs) {
            this.action = action;
            this.callId = callId;
            this.source = source;
            this.atMs = atMs;
        }
    }

    private static final class Ring {
        String callId;
        String fromAddress;
        String name;
        String avatarDataUrl;
        boolean group;
        String source;
        boolean confirmed;
        boolean posted;
        boolean silenced;
        /** Posted once more after a screen-off so the full-screen intent can fire. */
        boolean repostedForFullScreen;
    }

    private static volatile CallSession instance;

    public static CallSession get(Context context) {
        CallSession local = instance;
        if (local != null) return local;
        synchronized (CallSession.class) {
            if (instance == null) {
                instance = new CallSession(context.getApplicationContext());
            }
            return instance;
        }
    }

    /** The session if anything created it yet (the reader thread must not create it). */
    public static CallSession peek() {
        return instance;
    }

    /**
     * Presence reader thread: one python frame. Only call frames go on (a
     * plain substring check, so audio and chat frames cost next to nothing);
     * the main thread decides. Never throws.
     */
    public static void sniffPresenceFrame(String frame) {
        CallSession session = instance;
        if (session == null || frame == null) return;
        try {
            if (frame.indexOf("\"call_message\"") < 0) return;
            session.main.post(() -> session.onCallMessageFrame(frame));
        } catch (RuntimeException error) {
            Log.w(TAG, "Call frame sniff failed", error);
        }
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final CallSessionPolicy.RingRateLimiter limiter = new CallSessionPolicy.RingRateLimiter();
    private final Set<String> ringAddresses = new HashSet<>();
    /**
     * Rings that ended for good (answered, declined, timed out, cancelled by
     * the caller): a late showIncomingCall for one of them (the page has not
     * left its ringing state yet) must not ring again (elapsedRealtime).
     */
    private final CallSessionPolicy.FinishedRings finishedRings = new CallSessionPolicy.FinishedRings();
    private final Runnable ringTimeoutRunnable = () -> endRing("timeout");
    private final Runnable confirmTimeoutRunnable = this::onConfirmTimeout;
    private final Runnable answerGraceRunnable = this::applyWindowFlags;
    private final Runnable replayTickRunnable = this::replayTick;

    // Main thread only.
    private Ring ring;
    /**
     * Recent CALL_REQUESTs for the ring addresses (rung natively or by the
     * page), and the ringing (or accepted) call's request kept for a page
     * that started after the page that saw it. Accept is remembered there,
     * not read from pendingAction (the page clears that when it reads it).
     */
    private final CallSessionPolicy.RequestReplay replay = new CallSessionPolicy.RequestReplay();
    private CallNotifications.OngoingSpec active;
    private Listener listener;
    private WeakReference<Activity> activityRef = new WeakReference<>(null);
    private long answeringUntilMs = 0L;
    /** Show-over-lock only (no screen-on) until then; see RING_END_GRACE_MS. */
    private long ringEndGraceUntilMs = 0L;
    private PendingAction pendingAction;
    private Boolean micForeground;
    private int foregroundTypeFlags;
    private WifiManager.WifiLock wifiLock;
    private boolean appliedShowWhenLocked;
    private boolean appliedTurnScreenOn;
    private boolean appliedKeepScreenOn;
    private Boolean lastLocked;
    private Boolean lastInteractive;
    /** GO's activity is started (on screen); see screenOffSilencesRing. */
    private boolean activityOnScreen;
    /** elapsedRealtime when the activity last stopped, 0 = not since it started. */
    private long activityStoppedAtMs;

    private CallSession(Context app) {
        this.app = app;
        registerScreenReceiver();
    }

    private void onMain(Runnable task) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            task.run();
        } else {
            main.post(task);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    // ── Page and activity ───────────────────────────────────────────────────

    public void attachListener(Listener next) {
        onMain(() -> {
            listener = next;
            // A page is there again: a native ring it never takes up stops.
            scheduleConfirmTimeout();
        });
    }

    public void detachListener(Listener current) {
        onMain(() -> {
            if (listener == current) listener = null;
        });
    }

    /** MainActivity.onCreate: apply the lock-screen flags a ring or call needs right away. */
    public void attachActivity(Activity activity) {
        onMain(() -> {
            activityRef = new WeakReference<>(activity);
            appliedShowWhenLocked = false;
            appliedTurnScreenOn = false;
            appliedKeepScreenOn = false;
            applyWindowFlags();
        });
    }

    public void detachActivity(Activity activity) {
        onMain(() -> {
            if (activityRef.get() == activity) activityRef = new WeakReference<>(null);
        });
    }

    /** MainActivity.onStart / onStop: the ring moves between the page and the tray. */
    public void onActivityVisibility(boolean onScreen) {
        onMain(() -> {
            activityOnScreen = onScreen;
            activityStoppedAtMs = onScreen ? 0L : SystemClock.elapsedRealtime();
            if (!onScreen && ring != null && !isInteractive()) {
                // The ring screen went away because the screen went off:
                // the power key (the screen cannot time out on it). Silence
                // before the tray notification is posted, so it neither
                // rings on nor opens GO again with its full-screen intent.
                silenceRing();
            }
            presentRing(false, onScreen ? "activity-start" : "activity-stop");
            emitLockIfChanged();
        });
    }

    /** MainActivity.onNewIntent: Accept or a tap on a call notification. */
    public void onLaunchIntent(Intent intent) {
        onLaunchIntent(intent, false);
    }

    /**
     * MainActivity.onCreate / onNewIntent: Accept or a tap on a call
     * notification. {@code restoredActivity}: onCreate with saved state, so
     * the intent is the one the activity first started with (an old tap).
     */
    public void onLaunchIntent(Intent intent, boolean restoredActivity) {
        if (intent == null) return;
        String action;
        String callId;
        boolean usable;
        try {
            action = CallSessionPolicy.parseAction(
                intent.getStringExtra(QortalForegroundService.EXTRA_CALL_ACTION)
            );
            if (action == null) return;
            callId = intent.getStringExtra(QortalForegroundService.EXTRA_CALL_ID);
            long postedAt = intent.getLongExtra(CallNotifications.EXTRA_CALL_POSTED_AT, 0L);
            boolean fromHistory = (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
            usable = CallSessionPolicy.launchActionUsable(
                fromHistory,
                restoredActivity,
                action,
                postedAt,
                System.currentTimeMillis()
            );
            // Handled once: a recreated activity must not answer again.
            intent.removeExtra(QortalForegroundService.EXTRA_CALL_ACTION);
            intent.removeExtra(QortalForegroundService.EXTRA_CALL_ID);
            intent.removeExtra(CallNotifications.EXTRA_CALL_SOURCE);
            intent.removeExtra(CallNotifications.EXTRA_CALL_POSTED_AT);
        } catch (RuntimeException error) {
            Log.w(TAG, "Call launch intent not read", error);
            return;
        }
        if (!usable) {
            // Recents (after the process died) or a restored activity replays
            // the tap that first opened GO; that call is long over.
            Log.i(TAG, "Old call launch intent (" + action + ") ignored");
            return;
        }
        onAction(action, callId, "launch");
    }

    /** GO came on screen (plugin resume): retry the microphone service type if Android refused it off screen. */
    public void onAppForeground() {
        onMain(() -> {
            if (active != null && !Boolean.TRUE.equals(micForeground)) {
                applyCallForeground();
            }
            presentRing(false, "foreground");
            emitLockIfChanged();
        });
    }

    /**
     * The page that ran the call is gone (activity destroyed, page reloaded
     * or recreated after a renderer crash): its call is over. Native call
     * state ends with it (microphone service, call notification, keep-alive,
     * Wi-Fi lock, lock-screen flags) and the call audio is restored. A ring
     * stays: Accept reopens GO and its time limits still apply, and the
     * call's request goes to the next page once it signed in (replayTick).
     */
    public void onPageGone(String reason) {
        onMain(() -> {
            CallAudioRouter.get(app).endAll(reason);
            keepRingRequestForNextPage(reason);
            if (active == null) return;
            Log.i(TAG, "Call page gone (" + reason + "); call state ended");
            endActiveCall();
        });
    }

    /** Main thread: the active call ended (the page said so, or it is gone). */
    private void endActiveCall() {
        active = null;
        releaseWifiLock();
        applyCallStateToSystem();
        applyCallForeground();
        micForeground = null;
        foregroundTypeFlags = 0;
    }

    /** GO swiped from recents: the page and its call are gone. */
    public void onTaskRemoved() {
        onMain(() -> {
            clearReplay("task-removed");
            replay.forgetAll();
            endRing("task-removed");
            if (active != null) {
                active = null;
                micForeground = null;
                releaseWifiLock();
            }
            answeringUntilMs = 0L;
            ringEndGraceUntilMs = 0L;
            applyCallStateToSystem();
            CallNotifications.cancelOngoing(app);
            CallAudioRouter.get(app).endAll("task-removed");
        });
    }

    // ── Ring addresses (native ring) ────────────────────────────────────────

    /** The addresses the signed-in page answers calls for (window.call.setLocalAddresses). */
    public void setRingAddresses(Collection<String> addresses) {
        Set<String> next = new HashSet<>();
        if (addresses != null) {
            for (String address : addresses) {
                if (!isBlank(address)) next.add(address.trim());
            }
        }
        onMain(() -> {
            ringAddresses.clear();
            ringAddresses.addAll(next);
            // A page signed in: a kept request of a ringing call may go to it.
            if (replay.isKept()) replayTick();
        });
    }

    // ── A ringing call's request for the next page ──────────────────────────

    /**
     * Main thread: the page is gone while a call rings whose request it saw.
     * The caller sends the request once, so keep it for the next page;
     * Accept on the notification (which starts GO again) can then answer.
     * A request kept already (ringing, or accepted on the notification)
     * starts over for the next page: no copies before it signed in.
     */
    private void keepRingRequestForNextPage(String reason) {
        Ring r = ring;
        if (r != null && replay.keepForNextPage(r.callId)) {
            // The next page has to sign in before it can take the ring up: no
            // page-confirm timeout until the request reached it.
            r.confirmed = false;
            main.removeCallbacks(confirmTimeoutRunnable);
            Log.i(TAG, "Ringing call kept for the next page (" + reason + ")");
        } else if (replay.restartForNextPage()) {
            Log.i(TAG, "Kept call request starts over for the next page (" + reason
                + (replay.isAccepted() ? ", accepted" : "") + ")");
        } else {
            return;
        }
        // The ring addresses still name the gone page's account until the
        // next page sets its own (setRingAddresses ticks then): only the
        // expiry tick until then.
        scheduleReplayTick(replayExpiryDelayMs(replay.kept()));
    }

    private long replayExpiryDelayMs(CallSessionPolicy.SniffedRequest request) {
        long left = request.atMs + CallSessionPolicy.REQUEST_MAX_AGE_MS - System.currentTimeMillis();
        return Math.max(0L, left) + 100L;
    }

    private void scheduleReplayTick(long delayMs) {
        main.removeCallbacks(replayTickRunnable);
        main.postDelayed(replayTickRunnable, delayMs);
    }

    /**
     * Main thread: deliver the kept request to the page once it signed in
     * for its address, again every REPLAY_INTERVAL_MS until the page rings
     * or answers it (its listener may attach later; its call code drops
     * repeats of a callId). Wanted while the call rings or after Accept
     * ended its ring (RequestReplay remembers that; the page's pending
     * action does not count, the page clears it as soon as it read it).
     * Ends the ring when the request got too old for the page to accept
     * its signature.
     */
    private void replayTick() {
        main.removeCallbacks(replayTickRunnable);
        CallSessionPolicy.SniffedRequest request = replay.kept();
        if (request == null) return;
        Ring r = ring;
        String decision = replay.decide(r != null ? r.callId : null, ringAddresses, System.currentTimeMillis());
        if (CallSessionPolicy.REPLAY_NOW.equals(decision)) {
            // Only the first one may wait in Capacitor for a page with no
            // listener yet (no pile of copies for it).
            if (ReticulumPlugin.redeliverPresenceFrame(request.frame, replay.deliveries() == 0)) {
                int count = replay.onDelivered();
                Log.i(TAG, "Kept call request handed to the new page (" + count
                    + (replay.isAccepted() ? ", accepted" : "") + ")");
            }
            if (replay.deliveredEnough()) {
                // Delivered: from here the page has the usual time to ring it.
                clearReplay("delivered");
                scheduleConfirmTimeout();
            } else {
                scheduleReplayTick(CallSessionPolicy.REPLAY_INTERVAL_MS);
            }
        } else if (CallSessionPolicy.REPLAY_WAIT.equals(decision)) {
            // Not signed in for it yet: setRingAddresses ticks again; the
            // expiry tick ends the ring if no page can answer in time.
            scheduleReplayTick(replayExpiryDelayMs(request));
        } else if (CallSessionPolicy.REPLAY_EXPIRED.equals(decision)) {
            clearReplay("expired");
            if (r != null && request.callId.equals(r.callId)) {
                Log.i(TAG, "No page took the ringing call in time; it can no longer be answered");
                endRing("replay-expired");
            }
        } else {
            clearReplay("not-wanted");
        }
    }

    private void clearReplay(String reason) {
        if (!replay.clear()) return;
        onReplayDropped(reason);
    }

    /** After RequestReplay dropped the kept request. */
    private void onReplayDropped(String reason) {
        main.removeCallbacks(replayTickRunnable);
        Log.i(TAG, "Kept call request done (" + reason + ")");
    }

    private void onCallMessageFrame(String frame) {
        String type;
        String callId;
        String from;
        String target;
        long timestamp = 0L;
        boolean hasTimestamp = false;
        try {
            JSONObject root = new JSONObject(frame);
            if (!"call_message".equals(root.optString("event"))) return;
            JSONObject payload = root.optJSONObject("payload");
            JSONObject wire = payload != null ? payload.optJSONObject("wire") : null;
            if (wire == null) return;
            type = stringField(wire, "t");
            callId = stringField(wire, "c");
            from = stringField(wire, "a");
            target = stringField(wire, "U");
            Object m = wire.opt("m");
            if (m instanceof Number) {
                timestamp = ((Number) m).longValue();
                hasTimestamp = true;
            }
        } catch (Exception error) {
            return;
        }
        long now = System.currentTimeMillis();
        // The caller hung up (or another device of this account took or
        // declined it) after Accept ended the ring: the next page must not
        // get the request and answer a call that is over.
        if (replay.onRemoteWire(type, callId)) {
            onReplayDropped("remote-" + type);
            PendingAction p = pendingAction;
            if (p != null && callId.equals(p.callId)) pendingAction = null;
        }
        String verdict = CallSessionPolicy.classifyWire(
            type,
            callId,
            from,
            target,
            timestamp,
            hasTimestamp,
            ringAddresses,
            now,
            ring != null ? ring.callId : null
        );
        if (CallSessionPolicy.SNIFF_CANCEL.equals(verdict)) {
            Log.i(TAG, "Caller side ended the ringing call (" + type + ")");
            endRing("remote-" + type);
            return;
        }
        if (!CallSessionPolicy.SNIFF_RING.equals(verdict)) return;
        // Kept whether native rings it or the page does: if the page that
        // saw it goes away while it rings, the next page gets it again.
        // Per callId: another caller's request while one call rings does
        // not replace the ringing call's.
        replay.onRequest(
            new CallSessionPolicy.SniffedRequest(callId, target, timestamp, frame),
            ring != null ? ring.callId : null
        );
        // Busy (the page decides about call waiting), a ring already up,
        // signed out, or GO on screen and unlocked (the page rings itself).
        String blocker = CallSessionPolicy.nativeRingBlocker(
            active != null,
            ring != null,
            BackgroundKeepAlive.get(app).isSessionActive(),
            shouldPostNow()
        );
        if (blocker != null) return;
        if (!limiter.allow(from, callId, now)) {
            Log.i(TAG, "Native ring rate limited");
            return;
        }
        Log.i(TAG, "Incoming call request seen natively; ringing and waking the page");
        startRing(callId, from, null, null, false, SOURCE_NATIVE, false);
    }

    private static String stringField(JSONObject object, String key) {
        Object value = object.opt(key);
        return value instanceof String ? (String) value : null;
    }

    // ── Ringing ─────────────────────────────────────────────────────────────

    /** The page rings (or updates name / avatar). Confirms a native ring with the same callId. */
    public void showIncomingFromPage(
        String callId,
        String fromAddress,
        String name,
        String avatarDataUrl,
        boolean group,
        String source
    ) {
        if (isBlank(callId)) return;
        onMain(() -> {
            limiter.markSeen(callId, System.currentTimeMillis());
            // The page has the call's request (kept one or not).
            if (replay.dropFor(callId)) onReplayDropped("page-rang");
            Ring r = ring;
            String decision = CallSessionPolicy.pageRingDecision(
                callId,
                active != null ? active.callId : null,
                finishedRings.contains(callId, SystemClock.elapsedRealtime()),
                r != null ? r.callId : null
            );
            if (CallSessionPolicy.PAGE_RING_IGNORE_ACTIVE.equals(decision)
                || CallSessionPolicy.PAGE_RING_IGNORE_FINISHED.equals(decision)) {
                return;
            }
            if (CallSessionPolicy.PAGE_RING_UPDATE.equals(decision)) {
                boolean changed = false;
                if (!isBlank(name) && !name.equals(r.name)) {
                    r.name = name;
                    changed = true;
                }
                if (!isBlank(avatarDataUrl) && !avatarDataUrl.equals(r.avatarDataUrl)) {
                    r.avatarDataUrl = avatarDataUrl;
                    changed = true;
                }
                if (isBlank(r.fromAddress) && !isBlank(fromAddress)) {
                    r.fromAddress = fromAddress;
                    changed = true;
                }
                boolean newlyConfirmed = !r.confirmed;
                r.confirmed = true;
                r.group = r.group || group;
                main.removeCallbacks(confirmTimeoutRunnable);
                if (changed) {
                    presentRing(true, "updated");
                } else if (newlyConfirmed) {
                    emitRing(r, true, "confirmed");
                }
                return;
            }
            if (CallSessionPolicy.PAGE_RING_REPLACE.equals(decision)) endRing("replaced");
            startRing(callId, fromAddress, name, avatarDataUrl, group, source, true);
        });
    }

    /**
     * The page's ring ended (answered, declined, cancelled, timed out). With
     * no callId (old QortalBackground.dismissIncomingCallNotification) only a
     * ring the page itself confirmed stops: a native ring the page has not
     * seen yet must survive the page's idle-state cleanup.
     */
    public void cancelIncomingFromPage(String callId, String reason) {
        onMain(() -> {
            Ring r = ring;
            if (r == null || !CallSessionPolicy.pageCancelApplies(callId, r.callId, r.confirmed)) return;
            holdOverLockBriefly();
            endRing(reason != null ? reason : "page");
        });
    }

    /** Keep GO over the lock screen a moment longer (RING_END_GRACE_MS). */
    private void holdOverLockBriefly() {
        ringEndGraceUntilMs = SystemClock.elapsedRealtime() + RING_END_GRACE_MS;
        main.removeCallbacks(answerGraceRunnable);
        long untilAnswer = answeringUntilMs - SystemClock.elapsedRealtime();
        main.postDelayed(answerGraceRunnable, Math.max(RING_END_GRACE_MS, untilAnswer) + 50L);
    }

    private void startRing(
        String callId,
        String fromAddress,
        String name,
        String avatarDataUrl,
        boolean group,
        String source,
        boolean confirmed
    ) {
        Ring r = new Ring();
        r.callId = callId;
        r.fromAddress = fromAddress;
        r.name = name;
        r.avatarDataUrl = avatarDataUrl;
        r.group = group;
        r.source = source;
        r.confirmed = confirmed;
        ring = r;
        main.removeCallbacks(ringTimeoutRunnable);
        main.postDelayed(ringTimeoutRunnable, CallSessionPolicy.RING_TIMEOUT_MS);
        scheduleConfirmTimeout();
        applyCallStateToSystem();
        presentRing(true, "start");
    }

    private void onConfirmTimeout() {
        Ring r = ring;
        if (r != null && !r.confirmed) {
            Log.i(TAG, "The page did not take up the native ring; stopping it");
            endRing("page-dropped");
        }
    }

    private void scheduleConfirmTimeout() {
        main.removeCallbacks(confirmTimeoutRunnable);
        Ring r = ring;
        if (r == null || r.confirmed || listener == null) return;
        // Kept for a page that still signs in: replayTick starts this after delivery.
        if (replay.isKeptFor(r.callId)) return;
        main.postDelayed(confirmTimeoutRunnable, CallSessionPolicy.PAGE_CONFIRM_TIMEOUT_MS);
    }

    /** Ends a ring; see CallSessionPolicy.endIsFinal for the ends that are final for its callId. */
    private void endRing(String reason) {
        Ring r = ring;
        if (r == null) return;
        ring = null;
        if (CallSessionPolicy.endIsFinal(reason)) {
            finishedRings.add(r.callId, SystemClock.elapsedRealtime());
        }
        boolean keptForAccept = replay.isKeptFor(r.callId);
        if (replay.onRingEnded(r.callId, reason)) {
            onReplayDropped("ring-" + reason);
        } else if (keptForAccept) {
            // Accepted: the request still goes to the next page (and again)
            // until it rings or answers the call, whatever the page does
            // with the pending action.
            Log.i(TAG, "Kept call request accepted; still for the next page");
        }
        main.removeCallbacks(ringTimeoutRunnable);
        main.removeCallbacks(confirmTimeoutRunnable);
        CallNotifications.cancelIncoming(app);
        r.posted = false;
        applyCallStateToSystem();
        emitRing(r, false, reason);
        Log.i(TAG, "Ring ended (" + reason + ")");
    }

    /**
     * Tray notification or not, for the ring in progress: posted while GO is
     * off screen, the screen is off or the phone is locked; on screen the page
     * rings itself. {@code contentChanged}: re-post with the new name/avatar.
     */
    private void presentRing(boolean contentChanged, String reason) {
        Ring r = ring;
        if (r == null) return;
        boolean want = shouldPostNow();
        boolean stateChanged = false;
        if (want) {
            if (!r.posted || contentChanged) {
                boolean ok = CallNotifications.postIncoming(app, ringSpec(r, r.posted));
                stateChanged = ok != r.posted;
                r.posted = ok;
            }
        } else if (r.posted) {
            CallNotifications.cancelIncoming(app);
            r.posted = false;
            stateChanged = true;
        }
        if (stateChanged || "start".equals(reason)) emitRing(r, true, reason);
    }

    private CallNotifications.RingSpec ringSpec(Ring r, boolean update) {
        CallNotifications.RingSpec spec = new CallNotifications.RingSpec();
        spec.callId = r.callId;
        spec.fromAddress = r.fromAddress;
        spec.name = r.name;
        spec.avatarDataUrl = r.avatarDataUrl;
        spec.group = r.group;
        spec.silent = r.silenced;
        spec.update = update;
        return spec;
    }

    /**
     * The page silences the ring without declining (Android back on the ring
     * screen). With a callId only that ring; without, the ring in progress.
     */
    public void silenceRingFromPage(String callId) {
        onMain(() -> {
            Ring r = ring;
            if (r == null) return;
            if (!isBlank(callId) && !callId.equals(r.callId)) return;
            silenceRing();
        });
    }

    /**
     * The screen went off while a call rings. On GO's ring screen (it keeps
     * the screen on) that is the power key: silence. Over another app it may
     * be the display timing out: keep ringing, and post the ring once more
     * so its full-screen intent can bring GO's ring screen up on the dark
     * phone.
     */
    private void onScreenOffWhileRinging() {
        Ring r = ring;
        if (r == null) return;
        long sinceLeft = activityStoppedAtMs > 0L
            ? SystemClock.elapsedRealtime() - activityStoppedAtMs
            : -1L;
        if (CallSessionPolicy.screenOffSilencesRing(activityOnScreen && activityRef.get() != null, sinceLeft)) {
            silenceRing();
            return;
        }
        presentRing(false, "screen-off");
        if (CallSessionPolicy.repostRingForFullScreen(r.posted, r.silenced, r.repostedForFullScreen)) {
            r.repostedForFullScreen = true;
            CallNotifications.cancelIncoming(app);
            r.posted = CallNotifications.postIncoming(app, ringSpec(r, false));
            Log.i(TAG, "Ring posted again for the full-screen intent (screen off)");
        }
    }

    /** Power pressed while ringing: silence it (an insistent sound only stops with a cancel). */
    private void silenceRing() {
        Ring r = ring;
        if (r == null || r.silenced) return;
        r.silenced = true;
        if (r.posted) {
            CallNotifications.cancelIncoming(app);
            r.posted = CallNotifications.postIncoming(app, ringSpec(r, true));
            emitRing(r, true, "silenced");
        } else {
            presentRing(false, "silenced");
        }
    }

    private boolean shouldPostNow() {
        boolean stopped = activityRef.get() == null
            || BackgroundKeepAlive.get(app).getPageState().activityStopped;
        return CallSessionPolicy.shouldPostRingNotification(stopped, isInteractive(), isKeyguardLocked());
    }

    private void emitRing(Ring r, boolean ringing, String reason) {
        Listener l = listener;
        if (l == null) return;
        RingSnapshot snapshot = new RingSnapshot();
        snapshot.callId = r.callId;
        snapshot.fromAddress = r.fromAddress;
        snapshot.name = r.name;
        snapshot.source = r.source;
        snapshot.ringing = ringing;
        snapshot.posted = ringing && r.posted;
        snapshot.silent = r.silenced;
        snapshot.confirmed = r.confirmed;
        snapshot.reason = reason;
        try {
            l.onRingStateChanged(snapshot);
        } catch (RuntimeException error) {
            Log.w(TAG, "ringStateChanged listener failed", error);
        }
    }

    /** The ring in progress, or null (diagnostics / page start). */
    public void ringSnapshot(java.util.function.Consumer<RingSnapshot> out) {
        onMain(() -> {
            Ring r = ring;
            if (r == null) {
                out.accept(null);
                return;
            }
            RingSnapshot snapshot = new RingSnapshot();
            snapshot.callId = r.callId;
            snapshot.fromAddress = r.fromAddress;
            snapshot.name = r.name;
            snapshot.source = r.source;
            snapshot.ringing = true;
            snapshot.posted = r.posted;
            snapshot.silent = r.silenced;
            snapshot.confirmed = r.confirmed;
            snapshot.reason = "snapshot";
            out.accept(snapshot);
        });
    }

    // ── In a call ───────────────────────────────────────────────────────────

    /** Result of setCallActive for the page. */
    public interface ActiveResult {
        void done(boolean active, Boolean micForeground, int typeFlags);
    }

    /**
     * A call dials, connects or runs ({@code on}), or ended. The spec's
     * fields update the call notification (name, phase, mute, avatar).
     */
    public void setCallActive(boolean on, CallNotifications.OngoingSpec spec, ActiveResult result) {
        onMain(() -> {
            if (on) {
                boolean switched = active != null && CallSessionPolicy.isCallSwitch(active.callId, spec.callId);
                if (switched) {
                    // Call waiting answered: the new call's own notification
                    // (no old avatar or timer); service type and locks stay.
                    Log.i(TAG, "Another call took over the call session");
                }
                CallNotifications.OngoingSpec next = active != null && !switched
                    ? active
                    : new CallNotifications.OngoingSpec();
                if (!isBlank(spec.callId)) next.callId = spec.callId;
                if (spec.kind != null) next.kind = spec.kind;
                if (spec.phase != null) next.phase = spec.phase;
                if (spec.peerName != null) next.peerName = spec.peerName;
                if (spec.avatarDataUrl != null) next.avatarDataUrl = spec.avatarDataUrl;
                next.muted = spec.muted;
                if (spec.connectedAtMs > 0) {
                    next.connectedAtMs = spec.connectedAtMs;
                } else if ("connected".equals(next.phase) && next.connectedAtMs <= 0) {
                    next.connectedAtMs = System.currentTimeMillis();
                }
                boolean started = active == null;
                if (replay.dropFor(next.callId)) onReplayDropped("answered");
                // Active first, then the ring ends: GO never drops behind the
                // lock screen between the two.
                active = next;
                answeringUntilMs = 0L;
                ringEndGraceUntilMs = 0L;
                main.removeCallbacks(answerGraceRunnable);
                Ring r = ring;
                if (r != null && CallSessionPolicy.activeAnswersRing(spec.callId, r.callId)) {
                    endRing("answered");
                }
                limiter.markSeen(next.callId, System.currentTimeMillis());
                if (started) {
                    acquireWifiLock();
                    Log.i(TAG, "Call active (" + next.kind + ")");
                }
                applyCallStateToSystem();
                applyCallForeground();
            } else {
                if (active == null) {
                    if (result != null) result.done(false, null, 0);
                    return;
                }
                if (!CallSessionPolicy.endMatchesActive(active.callId, spec.callId)) {
                    // A late "ended" for an earlier call must not end this one.
                    if (result != null) result.done(true, micForeground, foregroundTypeFlags);
                    return;
                }
                endActiveCall();
                Log.i(TAG, "Call ended");
            }
            if (result != null) result.done(active != null, micForeground, foregroundTypeFlags);
        });
    }

    /** The call in progress for the service's notification, or null. Main thread. */
    public CallNotifications.OngoingSpec activeSnapshotOnMain() {
        CallNotifications.OngoingSpec a = active;
        if (a == null) return null;
        CallNotifications.OngoingSpec copy = new CallNotifications.OngoingSpec();
        copy.callId = a.callId;
        copy.kind = a.kind;
        copy.phase = a.phase;
        copy.peerName = a.peerName;
        copy.avatarDataUrl = a.avatarDataUrl;
        copy.muted = a.muted;
        copy.connectedAtMs = a.connectedAtMs;
        return copy;
    }

    /** Thread-safe enough for a quick check (volatile-free read of a main-thread field). */
    public boolean hasActiveCall() {
        return active != null;
    }

    private void applyCallForeground() {
        int used = QortalForegroundService.syncCallForegroundOnMain(app);
        if (used == QortalForegroundService.CALL_FOREGROUND_PENDING) return;
        onCallForegroundApplied(used);
    }

    /**
     * The service applied the call state: {@code usedFlags} >= 0 = foreground
     * with the call notification and those type flags; -1 = not in the
     * foreground (Android refused).
     */
    void onCallForegroundApplied(int usedFlags) {
        onMain(() -> {
            Boolean next;
            if (active == null) {
                next = null;
                foregroundTypeFlags = 0;
            } else if (usedFlags < 0) {
                next = false;
                foregroundTypeFlags = 0;
            } else {
                foregroundTypeFlags = usedFlags;
                next = Build.VERSION.SDK_INT < CallSessionPolicy.MICROPHONE_TYPE_MIN_SDK
                    || CallSessionPolicy.hasMicrophoneType(usedFlags);
            }
            boolean changed = next == null ? micForeground != null : !next.equals(micForeground);
            micForeground = next;
            if (changed) {
                Listener l = listener;
                if (l != null) {
                    try {
                        l.onCallForegroundChanged(next, foregroundTypeFlags, active != null ? active.callId : null);
                    } catch (RuntimeException error) {
                        Log.w(TAG, "callForegroundChanged listener failed", error);
                    }
                }
            }
        });
    }

    // ── Notification actions ────────────────────────────────────────────────

    /** Accept / decline / hang up / mute / open, from a notification or a launch intent. */
    public void onAction(String rawAction, String rawCallId, String source) {
        String action = CallSessionPolicy.parseAction(rawAction);
        if (action == null) return;
        onMain(() -> {
            long now = System.currentTimeMillis();
            Ring r = ring;
            String callId = !isBlank(rawCallId)
                ? rawCallId
                : (r != null ? r.callId : (active != null ? active.callId : ""));
            boolean accept = CallSessionPolicy.ACTION_ACCEPT.equals(action);
            if (accept) {
                // Stay over the lock screen until the page starts the call.
                answeringUntilMs = SystemClock.elapsedRealtime() + ANSWER_GRACE_MS;
                main.removeCallbacks(answerGraceRunnable);
                main.postDelayed(answerGraceRunnable, ANSWER_GRACE_MS + 50L);
            }
            if (CallSessionPolicy.endsRing(action)) {
                if (r != null && callId.equals(r.callId)) endRing(accept ? "accepted" : "declined");
                else if (accept) applyWindowFlags();
            } else if (CallSessionPolicy.ACTION_MUTE.equals(action)
                || CallSessionPolicy.ACTION_UNMUTE.equals(action)) {
                if (active != null) {
                    // Shown at once; the page confirms with its next update.
                    active.muted = CallSessionPolicy.ACTION_MUTE.equals(action);
                    applyCallForeground();
                }
            }
            if (!CallSessionPolicy.ACTION_MUTE.equals(action)
                && !CallSessionPolicy.ACTION_UNMUTE.equals(action)) {
                pendingAction = new PendingAction(action, callId, source, now);
            }
            dispatchAction(action, callId, source, now);
        });
    }

    private void dispatchAction(String action, String callId, String source, long atMs) {
        Listener l = listener;
        boolean modern = false;
        if (l != null) {
            try {
                modern = l.hasCallActionListeners();
                l.onCallAction(action, callId, source, atMs);
            } catch (RuntimeException error) {
                Log.w(TAG, "callAction listener failed", error);
            }
        }
        if (!modern
            && (CallSessionPolicy.ACTION_ACCEPT.equals(action)
                || CallSessionPolicy.ACTION_DECLINE.equals(action)
                || CallSessionPolicy.ACTION_OPEN.equals(action))) {
            // Pages that only know the old event (MobileIncomingCallBridge).
            Intent broadcast = new Intent(QortalForegroundService.BROADCAST_INCOMING_CALL_ACTION);
            broadcast.putExtra(QortalForegroundService.EXTRA_CALL_ID, callId);
            broadcast.putExtra(QortalForegroundService.EXTRA_CALL_ACTION, action);
            LocalBroadcastManager.getInstance(app).sendBroadcast(broadcast);
        }
    }

    /** The last accept/decline/open/hangup that is still fresh, or null. */
    public void pendingAction(java.util.function.Consumer<PendingAction> out) {
        onMain(() -> {
            PendingAction p = pendingAction;
            if (p != null && !CallSessionPolicy.pendingActionFresh(p.atMs, System.currentTimeMillis())) {
                pendingAction = null;
                p = null;
            }
            out.accept(p);
        });
    }

    public void clearPendingAction() {
        onMain(() -> pendingAction = null);
    }

    // ── System state ────────────────────────────────────────────────────────

    private void applyCallStateToSystem() {
        BackgroundKeepAlive.get(app).setCallState(active != null, ring != null);
        applyWindowFlags();
    }

    /**
     * Show GO over the lock screen (and turn the screen on) only while a call
     * rings, right after Accept, or runs; cleared the moment it ends, so GO
     * drops back behind the lock screen. Flags change only on edges (the vivo
     * biometric prompt stalls when they flip right before it, see
     * QortalBiometricPlugin.showBiometricOverlay).
     */
    private void applyWindowFlags() {
        Activity activity = activityRef.get();
        if (activity == null) return;
        boolean ringing = ring != null;
        long now = SystemClock.elapsedRealtime();
        boolean answering = now < answeringUntilMs;
        boolean ringJustEnded = now < ringEndGraceUntilMs;
        boolean show = CallSessionPolicy.showWhenLocked(ringing || answering || ringJustEnded, active != null);
        boolean turnOn = CallSessionPolicy.turnScreenOn(ringing || answering);
        boolean keepOn = ringing;
        if (show == appliedShowWhenLocked && turnOn == appliedTurnScreenOn && keepOn == appliedKeepScreenOn) {
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                if (show != appliedShowWhenLocked) activity.setShowWhenLocked(show);
                if (turnOn != appliedTurnScreenOn) activity.setTurnScreenOn(turnOn);
            } else {
                Window window = activity.getWindow();
                if (show != appliedShowWhenLocked) {
                    if (show) window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
                }
                if (turnOn != appliedTurnScreenOn) {
                    if (turnOn) window.addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
                }
            }
            if (keepOn != appliedKeepScreenOn) {
                // The ring screen does not time out (pressing power silences it).
                Window window = activity.getWindow();
                if (keepOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            appliedShowWhenLocked = show;
            appliedTurnScreenOn = turnOn;
            appliedKeepScreenOn = keepOn;
            Log.i(TAG, "Over lock screen: show=" + show + " turnOn=" + turnOn);
        } catch (RuntimeException error) {
            Log.w(TAG, "Lock screen flags not applied", error);
        }
    }

    public boolean isKeyguardLocked() {
        try {
            KeyguardManager km = app.getSystemService(KeyguardManager.class);
            return km != null && km.isKeyguardLocked();
        } catch (RuntimeException error) {
            return false;
        }
    }

    public boolean isDeviceSecure() {
        try {
            KeyguardManager km = app.getSystemService(KeyguardManager.class);
            return km != null && km.isDeviceSecure();
        } catch (RuntimeException error) {
            return false;
        }
    }

    public boolean isInteractive() {
        try {
            PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            return pm == null || pm.isInteractive();
        } catch (RuntimeException error) {
            return true;
        }
    }

    private void emitLockIfChanged() {
        boolean locked = isKeyguardLocked();
        boolean interactive = isInteractive();
        if (lastLocked != null && lastLocked == locked
            && lastInteractive != null && lastInteractive == interactive) {
            return;
        }
        lastLocked = locked;
        lastInteractive = interactive;
        Listener l = listener;
        if (l != null) {
            try {
                l.onDeviceLockChanged(locked, interactive);
            } catch (RuntimeException error) {
                Log.w(TAG, "deviceLockChanged listener failed", error);
            }
        }
    }

    private void registerScreenReceiver() {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent != null ? intent.getAction() : null;
                if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                    onScreenOffWhileRinging();
                } else {
                    presentRing(false, "screen");
                }
                emitLockIfChanged();
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                app.registerReceiver(receiver, filter, null, main, Context.RECEIVER_NOT_EXPORTED);
            } else {
                app.registerReceiver(receiver, filter, null, main);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Screen receiver not registered", error);
        }
    }

    private void acquireWifiLock() {
        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
                if (wm == null) return;
                @SuppressWarnings("deprecation")
                int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                wifiLock = wm.createWifiLock(mode, "QortalGo:call");
                wifiLock.setReferenceCounted(false);
            }
            if (!wifiLock.isHeld()) wifiLock.acquire();
        } catch (RuntimeException error) {
            Log.w(TAG, "Wi-Fi lock not taken", error);
        }
    }

    private void releaseWifiLock() {
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (RuntimeException error) {
            Log.w(TAG, "Wi-Fi lock not released", error);
        }
    }

    /** Copy diagnostics. */
    public void diagnostics(java.util.function.Consumer<Map<String, Object>> out) {
        onMain(() -> {
            Map<String, Object> d = new LinkedHashMap<>();
            Ring r = ring;
            d.put("ringing", r != null);
            if (r != null) {
                d.put("ringSource", r.source);
                d.put("ringPosted", r.posted);
                d.put("ringConfirmed", r.confirmed);
                d.put("ringSilenced", r.silenced);
            }
            d.put("callActive", active != null);
            if (active != null) {
                d.put("callKind", active.kind);
                d.put("callPhase", active.phase);
            }
            d.put("micForeground", micForeground);
            d.put("foregroundTypeFlags", foregroundTypeFlags);
            d.put("ringAddresses", ringAddresses.size());
            // A ringing call's request waiting for the next page (page gone mid-ring).
            d.put("requestKeptForPage", replay.isKept());
            d.put("requestKeptAccepted", replay.isAccepted());
            d.put("requestDeliveries", replay.deliveries());
            d.put("recentRequests", replay.recentCount());
            d.put("showWhenLocked", appliedShowWhenLocked);
            d.put("keyguardLocked", isKeyguardLocked());
            d.put("interactive", isInteractive());
            d.put("wifiLock", wifiLock != null && wifiLock.isHeld());
            out.accept(d);
        });
    }
}
