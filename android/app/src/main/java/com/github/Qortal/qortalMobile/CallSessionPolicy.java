package com.github.Qortal.qortalMobile;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Pure rules behind {@link CallSession}: native ringing, notification
 * actions, the call's foreground service type and the lock screen. No
 * Android types, so the JVM unit tests can check them.
 */
public final class CallSessionPolicy {
    private CallSessionPolicy() {}

    /** Hub's CALL_REQUEST_TTL_MS (electron/src/call.ts): a request rings at most this long. */
    public static final long RING_TIMEOUT_MS = 60_000L;
    /**
     * A ring native code started from a sniffed CALL_REQUEST must be taken up
     * by the page (showIncomingCall with the same callId) within this long
     * once a page is there; otherwise the page dropped the request (bad
     * signature, not a friend, busy) and the ring stops.
     */
    public static final long PAGE_CONFIRM_TIMEOUT_MS = 20_000L;
    /**
     * A sniffed request older than this (sender clock) is not rung. Same
     * window as the signature check the page (and Hub) runs on CALL_*
     * wires (electron/src/ed25519-verify-common.ts verifyCallSignedDetached:
     * at most 30 s old, 10 s ahead): a request the page will refuse must not
     * ring as a call nobody can answer.
     */
    public static final long REQUEST_MAX_AGE_MS = 30_000L;
    /** A sniffed request this far in the future (sender clock ahead) is not rung. */
    public static final long REQUEST_MAX_FUTURE_MS = 10_000L;
    /** One new native ring per caller at most this often. */
    public static final long SENDER_MIN_INTERVAL_MS = 15_000L;
    /** At most this many new native rings per {@link #GLOBAL_WINDOW_MS}. */
    public static final int GLOBAL_MAX_RINGS = 4;
    public static final long GLOBAL_WINDOW_MS = 60_000L;
    /** A notification action older than this is stale (the ring is over). */
    public static final long PENDING_ACTION_MAX_AGE_MS = RING_TIMEOUT_MS;

    // Overlay call wire codes (electron/src/call.ts, src/bridge/capacitorBridge.ts CALL_WIRE).
    public static final String WIRE_REQUEST = "CR";
    public static final String WIRE_ACCEPT = "CA";
    public static final String WIRE_REJECT = "CX";
    public static final String WIRE_HANGUP = "CH";

    // Actions delivered to the page (QortalCall 'callAction').
    public static final String ACTION_ACCEPT = "accept";
    public static final String ACTION_DECLINE = "decline";
    public static final String ACTION_HANGUP = "hangup";
    public static final String ACTION_MUTE = "mute";
    public static final String ACTION_UNMUTE = "unmute";
    public static final String ACTION_OPEN = "open";

    /** Known action name, or null. */
    public static String parseAction(String raw) {
        if (raw == null) return null;
        String action = raw.trim().toLowerCase(Locale.ROOT);
        switch (action) {
            case ACTION_ACCEPT:
            case ACTION_DECLINE:
            case ACTION_HANGUP:
            case ACTION_MUTE:
            case ACTION_UNMUTE:
            case ACTION_OPEN:
                return action;
            default:
                return null;
        }
    }

    /** Actions that end a ring (the notification goes away at once). */
    public static boolean endsRing(String action) {
        return ACTION_ACCEPT.equals(action) || ACTION_DECLINE.equals(action);
    }

    /** Accept and open must come up on screen (Activity PendingIntent); the rest stay in the tray. */
    public static boolean opensActivity(String action) {
        return ACTION_ACCEPT.equals(action) || ACTION_OPEN.equals(action);
    }

    /**
     * Distinct PendingIntent request codes per action (and kind of target),
     * so FLAG_UPDATE_CURRENT never makes one action's intent carry another's
     * extras.
     */
    public static int requestCode(String action) {
        if (ACTION_OPEN.equals(action)) return 0x6101;
        if (ACTION_ACCEPT.equals(action)) return 0x6102;
        if (ACTION_DECLINE.equals(action)) return 0x6103;
        if (ACTION_HANGUP.equals(action)) return 0x6104;
        if (ACTION_MUTE.equals(action)) return 0x6105;
        if (ACTION_UNMUTE.equals(action)) return 0x6106;
        return 0x6100;
    }

    // ServiceInfo.FOREGROUND_SERVICE_TYPE_* (checked against the platform in the unit test).
    public static final int FGS_TYPE_DATA_SYNC = 1;
    public static final int FGS_TYPE_MICROPHONE = 128;
    public static final int FGS_TYPE_REMOTE_MESSAGING = 512;
    /** Build.VERSION_CODES.R: the first release with the microphone service type. */
    public static final int MICROPHONE_TYPE_MIN_SDK = 30;

    /**
     * Foreground service type flags for the status service. During a call the
     * microphone type joins the base type (Android 11+ silences the mic of an
     * app off screen unless a microphone-typed service runs; Android 14+ also
     * needs FOREGROUND_SERVICE_MICROPHONE and RECORD_AUDIO granted). Outside a
     * call, or without the permission, the base type alone.
     */
    public static int foregroundTypeFlags(
        int baseFlags,
        boolean callActive,
        boolean recordAudioGranted,
        int sdkInt
    ) {
        if (!callActive || !recordAudioGranted || sdkInt < MICROPHONE_TYPE_MIN_SDK) return baseFlags;
        return baseFlags | FGS_TYPE_MICROPHONE;
    }

    /** True when {@code flags} include the microphone type. */
    public static boolean hasMicrophoneType(int flags) {
        return (flags & FGS_TYPE_MICROPHONE) != 0;
    }

    /**
     * Service types for an update of the call notification while the service
     * already holds {@code held} with it: the same types (the notification is
     * just re-posted) unless {@code wanted} adds one, e.g. the microphone
     * after Android refused it with GO off screen. Never fewer than held: a
     * refused re-start must not drop a microphone type the call already has.
     * Android 9 and older have no types.
     */
    public static int callForegroundUpdateTypes(int held, int wanted, int sdkInt) {
        if (sdkInt < 29) return held;
        return (wanted & ~held) != 0 ? (held | wanted) : held;
    }

    /** Show GO over the lock screen: only while a call rings or runs. */
    public static boolean showWhenLocked(boolean ringing, boolean callActive) {
        return ringing || callActive;
    }

    /** Turn the screen on for GO: only while a call rings (never during a call: the ear). */
    public static boolean turnScreenOn(boolean ringing) {
        return ringing;
    }

    /**
     * Post the ringing notification (ringtone, full-screen on the lock
     * screen) only when GO is not on screen in front of the user: off screen,
     * screen off, or behind the lock screen. On screen the page rings itself.
     */
    public static boolean shouldPostRingNotification(
        boolean activityStopped,
        boolean screenInteractive,
        boolean keyguardLocked
    ) {
        return activityStopped || !screenInteractive || keyguardLocked;
    }

    /** What to do with a sniffed call frame. */
    public static final String SNIFF_RING = "ring";
    public static final String SNIFF_CANCEL = "cancel";
    public static final String SNIFF_IGNORE_TYPE = "not-request";
    public static final String SNIFF_IGNORE_FIELDS = "missing-fields";
    public static final String SNIFF_IGNORE_TARGET = "not-for-us";
    public static final String SNIFF_IGNORE_SELF = "self";
    public static final String SNIFF_IGNORE_STALE = "stale";
    public static final String SNIFF_IGNORE_SIGNED_OUT = "signed-out";

    /**
     * Decide on one inbound overlay call wire (payload.wire of a python
     * {@code call_message} event).
     *
     * A CALL_REQUEST ("CR") addressed (overlay target U) to one of the
     * addresses the page signed in with rings. A cancel (CH), reject (CX, the
     * call was declined on another device of this account) or accept (CA,
     * answered on another device) for the call that rings stops it. The
     * callId is random, so a match is this call. Signatures are not checked
     * here (the page checks them once it runs): this only wakes the page and
     * rings, rate limited, for at most {@link #RING_TIMEOUT_MS}.
     *
     * @param ringingCallId callId of the ring in progress, or null
     */
    public static String classifyWire(
        String type,
        String callId,
        String fromAddress,
        String targetAddress,
        long timestampMs,
        boolean hasTimestamp,
        Set<String> localAddresses,
        long nowMs,
        String ringingCallId
    ) {
        if (WIRE_HANGUP.equals(type) || WIRE_REJECT.equals(type) || WIRE_ACCEPT.equals(type)) {
            if (callId != null && !callId.isEmpty() && callId.equals(ringingCallId)) {
                return SNIFF_CANCEL;
            }
            return SNIFF_IGNORE_TYPE;
        }
        if (!WIRE_REQUEST.equals(type)) return SNIFF_IGNORE_TYPE;
        if (localAddresses == null || localAddresses.isEmpty()) return SNIFF_IGNORE_SIGNED_OUT;
        if (isBlank(callId) || isBlank(fromAddress) || isBlank(targetAddress) || !hasTimestamp) {
            return SNIFF_IGNORE_FIELDS;
        }
        if (!localAddresses.contains(targetAddress)) return SNIFF_IGNORE_TARGET;
        if (localAddresses.contains(fromAddress)) return SNIFF_IGNORE_SELF;
        if (timestampMs < nowMs - REQUEST_MAX_AGE_MS || timestampMs > nowMs + REQUEST_MAX_FUTURE_MS) {
            return SNIFF_IGNORE_STALE;
        }
        return SNIFF_RING;
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    /** "Qabc…wxyz" for a caller the page has not named yet. */
    public static String shortAddress(String address) {
        if (address == null) return "";
        String trimmed = address.trim();
        if (trimmed.length() <= 10) return trimmed;
        return trimmed.substring(0, 4) + "…" + trimmed.substring(trimmed.length() - 4);
    }

    /**
     * Rate limit for native rings from sniffed requests: the same callId
     * rings once (repeats and relays of one request are one ring), a caller
     * rings at most once per {@link #SENDER_MIN_INTERVAL_MS}, and at most
     * {@link #GLOBAL_MAX_RINGS} new rings per {@link #GLOBAL_WINDOW_MS}.
     * Not thread-safe; the owner serialises calls.
     */
    public static final class RingRateLimiter {
        private final Map<String, Long> seenCallIds = new HashMap<>();
        private final Map<String, Long> lastBySender = new HashMap<>();
        private final Deque<Long> recent = new ArrayDeque<>();

        public boolean allow(String sender, String callId, long nowMs) {
            prune(nowMs);
            if (callId == null || sender == null) return false;
            if (seenCallIds.containsKey(callId)) return false;
            Long last = lastBySender.get(sender);
            if (last != null && nowMs - last < SENDER_MIN_INTERVAL_MS) {
                // Still remember the callId: its repeats must not ring later.
                seenCallIds.put(callId, nowMs);
                return false;
            }
            if (recent.size() >= GLOBAL_MAX_RINGS) {
                seenCallIds.put(callId, nowMs);
                return false;
            }
            seenCallIds.put(callId, nowMs);
            lastBySender.put(sender, nowMs);
            recent.addLast(nowMs);
            return true;
        }

        /** A callId the page already rang or answered must not ring natively again. */
        public void markSeen(String callId, long nowMs) {
            if (callId == null || callId.isEmpty()) return;
            prune(nowMs);
            seenCallIds.put(callId, nowMs);
        }

        private void prune(long nowMs) {
            while (!recent.isEmpty() && nowMs - recent.peekFirst() >= GLOBAL_WINDOW_MS) {
                recent.removeFirst();
            }
            for (Iterator<Map.Entry<String, Long>> it = seenCallIds.entrySet().iterator(); it.hasNext(); ) {
                if (nowMs - it.next().getValue() >= 2 * RING_TIMEOUT_MS) it.remove();
            }
            for (Iterator<Map.Entry<String, Long>> it = lastBySender.entrySet().iterator(); it.hasNext(); ) {
                if (nowMs - it.next().getValue() >= SENDER_MIN_INTERVAL_MS) it.remove();
            }
        }

        public int trackedCallIds() {
            return seenCallIds.size();
        }
    }

    /**
     * Whether a stored notification action is still worth handing to a page
     * that starts late (cold start after Accept).
     */
    public static boolean pendingActionFresh(long actionAtMs, long nowMs) {
        return actionAtMs > 0 && nowMs >= actionAtMs && nowMs - actionAtMs <= PENDING_ACTION_MAX_AGE_MS;
    }

    // ── CallSession's state machine (the decisions; CallSession applies them) ──

    /** What a page's showIncomingCall does. */
    public static final String PAGE_RING_IGNORE_ACTIVE = "ignore-active";
    public static final String PAGE_RING_IGNORE_FINISHED = "ignore-finished";
    public static final String PAGE_RING_UPDATE = "update";
    public static final String PAGE_RING_REPLACE = "replace";
    public static final String PAGE_RING_START = "start";

    /**
     * The page rings {@code callId} (or updates its name / avatar): ignored
     * when that call already runs or its ring ended for good; the ring in
     * progress for the same call is updated (and confirmed); another call's
     * ring is replaced; else a new ring starts.
     */
    public static String pageRingDecision(
        String callId,
        String activeCallId,
        boolean finishedForGood,
        String ringingCallId
    ) {
        if (callId != null && callId.equals(activeCallId)) return PAGE_RING_IGNORE_ACTIVE;
        if (finishedForGood) return PAGE_RING_IGNORE_FINISHED;
        if (ringingCallId == null) return PAGE_RING_START;
        return ringingCallId.equals(callId) ? PAGE_RING_UPDATE : PAGE_RING_REPLACE;
    }

    /**
     * Ends the page itself reports ("page", "page-ring-ended",
     * "legacy-dismiss"), a native ring the page did not take up in time
     * ("page-dropped": a slow page may still confirm it) and a replaced ring
     * may show again; every other end (answered, accepted, declined,
     * timeout, the caller's cancel, the page gone) is final for that callId.
     */
    public static boolean endIsFinal(String reason) {
        if (reason == null) return true;
        return !reason.startsWith("page") && !"legacy-dismiss".equals(reason) && !"replaced".equals(reason);
    }

    /**
     * The page ended a ring: with a callId only that ring; without one (old
     * QortalBackground.dismissIncomingCallNotification) only a ring the page
     * confirmed, so a native ring the page has not seen yet survives the
     * page's idle-state cleanup.
     */
    public static boolean pageCancelApplies(String cancelCallId, String ringCallId, boolean ringConfirmed) {
        if (ringCallId == null) return false;
        if (!isBlank(cancelCallId)) return cancelCallId.equals(ringCallId);
        return ringConfirmed;
    }

    public static final String NATIVE_RING_OK = null;
    public static final String NATIVE_RING_BUSY = "busy";
    public static final String NATIVE_RING_ALREADY_RINGING = "already-ringing";
    public static final String NATIVE_RING_SIGNED_OUT = "signed-out";
    public static final String NATIVE_RING_PAGE_ON_SCREEN = "page-on-screen";

    /**
     * After {@link #classifyWire} said ring: null to ring natively, else why
     * not (a call runs: the page decides about call waiting; a ring is up;
     * the page is signed out; GO is on screen and unlocked, so the page
     * rings itself). The rate limiter comes last.
     */
    public static String nativeRingBlocker(
        boolean callActive,
        boolean ringInProgress,
        boolean sessionActive,
        boolean postRingNotificationNow
    ) {
        if (callActive) return NATIVE_RING_BUSY;
        if (ringInProgress) return NATIVE_RING_ALREADY_RINGING;
        if (!sessionActive) return NATIVE_RING_SIGNED_OUT;
        if (!postRingNotificationNow) return NATIVE_RING_PAGE_ON_SCREEN;
        return NATIVE_RING_OK;
    }

    /**
     * setCallActive(on) for another call than the active one (both ids
     * known): a call answered while another ran (call waiting) took the
     * session over. Its notification starts fresh (no old avatar or timer);
     * the microphone service and Wi-Fi lock stay.
     */
    public static boolean isCallSwitch(String activeCallId, String nextCallId) {
        return !isBlank(activeCallId) && !isBlank(nextCallId) && !activeCallId.equals(nextCallId);
    }

    /** setCallActive(off): ends the active call unless it names another one (a late "ended"). */
    public static boolean endMatchesActive(String activeCallId, String endedCallId) {
        return isBlank(endedCallId) || isBlank(activeCallId) || endedCallId.equals(activeCallId);
    }

    /** setCallActive(on) answers the ring of the same call (or of any call when no id is given). */
    public static boolean activeAnswersRing(String activeCallId, String ringCallId) {
        return ringCallId != null && (isBlank(activeCallId) || activeCallId.equals(ringCallId));
    }

    /**
     * After the ring screen left the front, a screen-off within this long
     * was still the power key pressed on it (the activity stops a moment
     * before or after the screen-off broadcast).
     */
    public static final long RING_SCREEN_LEFT_GRACE_MS = 2_000L;

    /**
     * The screen went off while ringing. With GO's ring screen in front the
     * screen cannot time out (FLAG_KEEP_SCREEN_ON), so that is the power key:
     * silence. With GO off screen (a heads-up over another app) it may just
     * be the display timeout: keep ringing.
     *
     * @param msSinceRingScreenLeft ms since the ring screen left the front, or
     *     a negative value when it never showed during this ring
     */
    public static boolean screenOffSilencesRing(boolean ringScreenInFront, long msSinceRingScreenLeft) {
        if (ringScreenInFront) return true;
        return msSinceRingScreenLeft >= 0 && msSinceRingScreenLeft <= RING_SCREEN_LEFT_GRACE_MS;
    }

    /**
     * After a screen-off that did not silence the ring, post it once more as
     * a new notification so its full-screen intent can open GO's ring screen
     * on the dark phone (an update never fires it). Once per ring.
     */
    public static boolean repostRingForFullScreen(boolean posted, boolean silenced, boolean alreadyReposted) {
        return posted && !silenced && !alreadyReposted;
    }

    /**
     * Call extras of an activity launch. Never usable when the launch replays
     * an old intent: from recents (the task's original intent after the
     * process died) or an activity restored from saved state. Otherwise an
     * Accept / Decline must come from a ring notification of the last two
     * ring timeouts, and anything else (open) from a notification of the
     * last {@link #LAUNCH_INTENT_MAX_AGE_MS}. {@code postedAtMs} 0 = unknown
     * (a notification from an older build): usable.
     */
    public static boolean launchActionUsable(
        boolean launchedFromHistory,
        boolean restoredActivity,
        String action,
        long postedAtMs,
        long nowMs
    ) {
        if (launchedFromHistory || restoredActivity) return false;
        if (postedAtMs <= 0) return true;
        if (nowMs < postedAtMs - 5_000L) return false;
        long maxAge = endsRing(action) ? 2 * RING_TIMEOUT_MS : LAUNCH_INTENT_MAX_AGE_MS;
        return nowMs - postedAtMs <= maxAge;
    }

    /** The ongoing call notification is rebuilt on every call update; older open intents are replays. */
    public static final long LAUNCH_INTENT_MAX_AGE_MS = 6 * 60 * 60 * 1000L;

    // ── A ringing call's request for the next page ─────────────────────────────

    /**
     * The page that saw a CALL_REQUEST is gone (activity recreated after a
     * renderer crash, destroyed while the process lives, page reloaded) while
     * that call still rings. The caller sends the request once, so the new
     * page would never learn of the call, and Accept on the notification
     * (which also starts GO and its sign-in) could not answer it. Keep the
     * request's python frame for the next page when it is the ringing call's.
     */
    public static boolean keepRequestForNextPage(String requestCallId, String ringCallId) {
        return !isBlank(requestCallId) && requestCallId.equals(ringCallId);
    }

    public static final String REPLAY_NOW = "replay";
    public static final String REPLAY_WAIT = "wait";
    public static final String REPLAY_EXPIRED = "expired";
    public static final String REPLAY_DROP = "drop";
    /**
     * Between deliveries of a kept request. It goes again until the page
     * rings or answers it (the page's call code drops repeats of a callId):
     * a page that reloaded still has the old page's listeners natively, so
     * a delivery before its own listener is attached is lost unseen.
     */
    public static final long REPLAY_INTERVAL_MS = 2_500L;
    /** Deliveries at most: the request's whole signature window, plus one. */
    public static final int REPLAY_MAX_DELIVERIES = (int) (REQUEST_MAX_AGE_MS / REPLAY_INTERVAL_MS) + 1;

    /**
     * What to do with a kept request now. Wanted while its call still rings
     * or was accepted on the notification (Accept ends the ring; the kept
     * request remembers it, see {@link RequestReplay}); dropped otherwise.
     * Delivered once the new page signed in for the request's target
     * address (setRingAddresses), and only while the page will still accept
     * the request's signature ({@link #REQUEST_MAX_AGE_MS}, sender clock);
     * after that it can no longer be answered: expired.
     *
     * @param ringCallId callId of the ring in progress, or null
     * @param acceptedCallId callId whose ring Accept ended while its request
     *     was kept ({@link RequestReplay}), or null. Never the page's pending
     *     action: the page clears that as soon as it read it, also when it
     *     only parks the Accept until the call is known.
     * @param pageAddresses addresses the running page signed in with
     */
    public static String replayDecision(
        String requestCallId,
        String requestTarget,
        long requestAtMs,
        String ringCallId,
        String acceptedCallId,
        Set<String> pageAddresses,
        long nowMs
    ) {
        if (isBlank(requestCallId)) return REPLAY_DROP;
        boolean wanted = requestCallId.equals(ringCallId) || requestCallId.equals(acceptedCallId);
        if (!wanted) return REPLAY_DROP;
        if (requestAtMs < nowMs - REQUEST_MAX_AGE_MS || requestAtMs > nowMs + REQUEST_MAX_FUTURE_MS) {
            return REPLAY_EXPIRED;
        }
        if (pageAddresses == null || isBlank(requestTarget) || !pageAddresses.contains(requestTarget)) {
            return REPLAY_WAIT;
        }
        return REPLAY_NOW;
    }

    /**
     * A ring ended: a request kept for the next page stays only when the
     * ring ended because the user accepted it (the new page still has to
     * answer it); any other end means there is nothing left to answer.
     */
    public static boolean replaySurvivesRingEnd(String reason) {
        return "accepted".equals(reason);
    }

    /**
     * A cancel (CH), reject (CX, declined on another device of this account)
     * or accept (CA, answered on another device) for the call whose request
     * is kept for the next page: nothing is left for that page to answer.
     * Needed besides {@link #classifyWire}, which only matches the ring in
     * progress, and Accept already ended that ring.
     */
    public static boolean cancelsKeptRequest(String type, String callId, String keptCallId) {
        if (!WIRE_HANGUP.equals(type) && !WIRE_REJECT.equals(type) && !WIRE_ACCEPT.equals(type)) {
            return false;
        }
        return !isBlank(callId) && callId.equals(keptCallId);
    }

    /** A CALL_REQUEST the presence reader saw for one of the ring addresses. */
    public static final class SniffedRequest {
        public final String callId;
        public final String target;
        /** The request's own time (sender clock, wire field m). */
        public final long atMs;
        /** The python frame as the reader got it. */
        public final String frame;

        public SniffedRequest(String callId, String target, long atMs, String frame) {
            this.callId = callId;
            this.target = target;
            this.atMs = atMs;
            this.frame = frame;
        }
    }

    /**
     * The state behind a ringing call's request kept for the next page
     * (CallSession applies the side effects: ticks, logs, ending the ring).
     *
     * - Recent requests per callId (a few; the ringing call's is never
     *   evicted), so a second caller's request while one call rings does not
     *   replace the ringing call's.
     * - One kept request: the ringing call's, when its page went away.
     * - Accept ending that ring marks it accepted here, so it keeps going to
     *   the next page whatever the page does with its pending action.
     *
     * Not thread-safe; the owner serialises calls (main thread).
     */
    public static final class RequestReplay {
        /** Requests remembered per callId (newest kept; the ringing call's never evicted). */
        public static final int MAX_RECENT_REQUESTS = 4;

        private final LinkedHashMap<String, SniffedRequest> recent = new LinkedHashMap<>();
        private SniffedRequest kept;
        private String acceptedCallId;
        private int deliveries;

        /** A request {@link #classifyWire} let through (rung natively or not). */
        public void onRequest(SniffedRequest request, String ringingCallId) {
            if (request == null || isBlank(request.callId)) return;
            // Re-insert: insertion order is the age order for eviction.
            recent.remove(request.callId);
            recent.put(request.callId, request);
            for (Iterator<String> it = recent.keySet().iterator();
                 recent.size() > MAX_RECENT_REQUESTS && it.hasNext(); ) {
                String callId = it.next();
                if (callId.equals(ringingCallId) || callId.equals(request.callId)) continue;
                it.remove();
            }
        }

        public SniffedRequest recentRequest(String callId) {
            return callId == null ? null : recent.get(callId);
        }

        /**
         * The page is gone while {@code ringCallId} rings: keep that call's
         * request. False when nothing is to keep, or a request is kept
         * already (see {@link #restartForNextPage}).
         */
        public boolean keepForNextPage(String ringCallId) {
            if (kept != null) return false;
            SniffedRequest request = recentRequest(ringCallId);
            if (request == null || !keepRequestForNextPage(request.callId, ringCallId)) return false;
            kept = request;
            acceptedCallId = null;
            deliveries = 0;
            return true;
        }

        /**
         * The page is gone while a request is kept (ringing or accepted):
         * the next page gets it from the first delivery again. False when
         * nothing is kept.
         */
        public boolean restartForNextPage() {
            if (kept == null) return false;
            deliveries = 0;
            return true;
        }

        /**
         * A ring ended. True when that drops the kept request: any end of the
         * kept call's ring but Accept ({@link #replaySurvivesRingEnd}). Accept
         * marks it accepted: it stays wanted without a ring.
         */
        public boolean onRingEnded(String ringCallId, String reason) {
            if (!isKeptFor(ringCallId)) return false;
            if (replaySurvivesRingEnd(reason)) {
                acceptedCallId = kept.callId;
                return false;
            }
            clear();
            return true;
        }

        /** A CH / CX / CA wire: true when it dropped the kept request. */
        public boolean onRemoteWire(String type, String callId) {
            if (kept == null || !cancelsKeptRequest(type, callId, kept.callId)) return false;
            clear();
            return true;
        }

        /** The page rang or answered {@code callId}: true when that dropped the kept request. */
        public boolean dropFor(String callId) {
            if (!isKeptFor(callId)) return false;
            clear();
            return true;
        }

        /** {@link #replayDecision} for the kept request; {@link #REPLAY_DROP} when none. */
        public String decide(String ringCallId, Set<String> pageAddresses, long nowMs) {
            if (kept == null) return REPLAY_DROP;
            return replayDecision(kept.callId, kept.target, kept.atMs, ringCallId, acceptedCallId, pageAddresses, nowMs);
        }

        /** One more copy went to the page; returns the count. */
        public int onDelivered() {
            return ++deliveries;
        }

        public boolean deliveredEnough() {
            return deliveries >= REPLAY_MAX_DELIVERIES;
        }

        /** True when a request was kept. */
        public boolean clear() {
            boolean had = kept != null;
            kept = null;
            acceptedCallId = null;
            deliveries = 0;
            return had;
        }

        /** GO swiped away: the kept request and the recent ones are gone. */
        public void forgetAll() {
            clear();
            recent.clear();
        }

        public SniffedRequest kept() {
            return kept;
        }

        public boolean isKept() {
            return kept != null;
        }

        public boolean isKeptFor(String callId) {
            return kept != null && !isBlank(callId) && kept.callId.equals(callId);
        }

        public boolean isAccepted() {
            return kept != null && acceptedCallId != null;
        }

        public int deliveries() {
            return deliveries;
        }

        public int recentCount() {
            return recent.size();
        }
    }

    /**
     * Rings that ended for good: a late showIncomingCall for one of them (the
     * page has not left its ringing state yet) must not ring again. Kept for
     * twice the ring timeout. Not thread-safe; the owner serialises calls.
     */
    public static final class FinishedRings {
        private final Map<String, Long> ended = new HashMap<>();

        public void add(String callId, long nowMs) {
            if (isBlank(callId)) return;
            prune(nowMs);
            ended.put(callId, nowMs);
        }

        public boolean contains(String callId, long nowMs) {
            prune(nowMs);
            return callId != null && ended.containsKey(callId);
        }

        public int size() {
            return ended.size();
        }

        private void prune(long nowMs) {
            for (Iterator<Map.Entry<String, Long>> it = ended.entrySet().iterator(); it.hasNext(); ) {
                if (nowMs - it.next().getValue() > 2 * RING_TIMEOUT_MS) it.remove();
            }
        }
    }
}
