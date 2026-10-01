package com.github.Qortal.qortalMobile;

/**
 * Pure rules behind {@link BackgroundKeepAlive}: no Android types, so the JVM
 * unit tests can check them. Times are SystemClock.elapsedRealtime() values.
 *
 * Background: Chromium freezes a hidden WebView page 60 s after it becomes
 * hidden, which stops the chat engine (it runs in the page's Web Worker).
 * Keeping the WebView "visible" to Chromium while GO is off screen keeps the
 * engine running; these rules decide when that is worth it.
 */
public final class KeepAlivePolicy {
    private KeepAlivePolicy() {}

    public static final String MODE_OFF = "off";
    public static final String MODE_CHARGING = "charging";
    public static final String MODE_ALWAYS = "always";
    public static final String DEFAULT_MODE = MODE_CHARGING;

    public static final String PROFILE_LEAF = "leaf";
    public static final String PROFILE_FULL = "full";

    /** Own messages still waiting to leave the phone get this long after GO leaves the screen. */
    public static final long OUTBOX_WINDOW_MS = 3L * 60_000L;
    /** Charging AND unmetered must hold this long before the relay profile turns "full". */
    public static final long RELAY_FULL_STABLE_MS = 2L * 60_000L;
    /**
     * A 25 s service tick that arrives later than this while a wake lock is
     * held means something outside GO stopped the process (vendor freezer).
     */
    public static final long VENDOR_FREEZE_GAP_MS = 90_000L;

    /** Known mode, or null for anything else. */
    public static String parseMode(String raw) {
        if (raw == null) return null;
        String mode = raw.trim().toLowerCase(java.util.Locale.ROOT);
        if (MODE_OFF.equals(mode) || MODE_CHARGING.equals(mode) || MODE_ALWAYS.equals(mode)) {
            return mode;
        }
        return null;
    }

    /** Stored mode, falling back to the default for missing or unknown values. */
    public static String modeOrDefault(String raw) {
        String mode = parseMode(raw);
        return mode != null ? mode : DEFAULT_MODE;
    }

    /** Everything the keep-alive rule looks at, captured at one instant. */
    public static final class Inputs {
        public String mode = DEFAULT_MODE;
        /** GO's Activity is stopped (not on screen). */
        public boolean activityStopped;
        /** elapsedRealtime when GO last left the screen. */
        public long stoppedAtMs;
        public long nowMs;
        public boolean charging;
        public boolean outboxPending;
        /** A page with a signed-in session exists (WebView attached, not logged out). */
        public boolean sessionActive;
        /** Android stopped the status service at its time limit; wait for GO to be opened. */
        public boolean suspended;
    }

    /** Within the 3-minute window for own messages that still wait to leave. */
    public static boolean outboxWindowActive(Inputs in) {
        if (in == null || !in.activityStopped || !in.outboxPending) return false;
        if (MODE_OFF.equals(modeOrDefault(in.mode))) return false;
        long since = in.nowMs - in.stoppedAtMs;
        return since >= 0 && since < OUTBOX_WINDOW_MS;
    }

    /**
     * Keep the WebView visible to Chromium while GO is off screen:
     * mode always, or mode charging while charging, or own messages pending
     * within {@link #OUTBOX_WINDOW_MS} of leaving the screen (any mode but off).
     */
    public static boolean shouldKeepVisible(Inputs in) {
        if (in == null || !in.activityStopped || !in.sessionActive || in.suspended) return false;
        String mode = modeOrDefault(in.mode);
        if (MODE_ALWAYS.equals(mode)) return true;
        if (MODE_CHARGING.equals(mode) && in.charging) return true;
        return outboxWindowActive(in);
    }

    /**
     * Partial wake lock only while kept alive on the charger or during the
     * outbox window. "always" on battery holds none (the CPU may sleep).
     */
    public static boolean shouldHoldWakeLock(Inputs in) {
        if (!shouldKeepVisible(in)) return false;
        return in.charging || outboxWindowActive(in);
    }

    public static final String SERVICE_TYPE_DATA_SYNC = "dataSync";
    public static final String SERVICE_TYPE_REMOTE_MESSAGING = "remoteMessaging";
    /** Build.VERSION_CODES.UPSIDE_DOWN_CAKE: the first release with remoteMessaging. */
    public static final int REMOTE_MESSAGING_MIN_SDK = 34;

    /**
     * Foreground service type for the status service. Android 15+ stops a
     * dataSync service after about 6 h a day; remoteMessaging (Android 14+)
     * has no such limit. The uncapped type is used only while background sync
     * is meant to run continuously (mode always, or mode charging while
     * charging), so on battery the daily limit stays a safety net.
     */
    public static String foregroundServiceType(String mode, boolean charging, int sdkInt) {
        if (sdkInt < REMOTE_MESSAGING_MIN_SDK) return SERVICE_TYPE_DATA_SYNC;
        String m = modeOrDefault(mode);
        if (MODE_ALWAYS.equals(m)) return SERVICE_TYPE_REMOTE_MESSAGING;
        if (MODE_CHARGING.equals(m) && charging) return SERVICE_TYPE_REMOTE_MESSAGING;
        return SERVICE_TYPE_DATA_SYNC;
    }

    /**
     * Milliseconds until the outbox window closes (the rule must be evaluated
     * again then), or -1 when no such deadline applies.
     */
    public static long msUntilOutboxWindowEnds(Inputs in) {
        if (!outboxWindowActive(in)) return -1L;
        return Math.max(0L, in.stoppedAtMs + OUTBOX_WINDOW_MS - in.nowMs);
    }

    /**
     * Whether a status push may start or update the status service. A start
     * comes from a page that just signed in. An update from a signed-out page
     * (a throttled one landing after logout) must not restart the service,
     * which would also redial the hubs the logout is closing.
     */
    public static boolean acceptsStatusPush(boolean isStart, boolean sessionActive) {
        return isStart || sessionActive;
    }

    /**
     * The command frame native feeds the Python bridge itself when the relay
     * profile changes, or null when the page alone applies it. Only "leaf" is
     * applied natively: a frozen page cannot pass that change on, and the
     * desktop-sized caps would keep running on battery. "full" stays with the
     * page, as before. No id, so the bridge sends no reply.
     */
    public static String nativeOverlayProfileFrame(String profileChange) {
        if (!PROFILE_LEAF.equals(profileChange)) return null;
        return "{\"type\":\"cmd\",\"action\":\"configure_overlay_profile\","
            + "\"payload\":{\"profile\":\"" + PROFILE_LEAF + "\"}}";
    }

    /**
     * Relay profile with hysteresis: "full" once charging AND unmetered have
     * held for {@link #RELAY_FULL_STABLE_MS}; back to "leaf" at once when
     * either ends. Not thread-safe; the owner serialises calls.
     */
    public static final class RelayProfileTracker {
        private String profile = PROFILE_LEAF;
        private long eligibleSinceMs = -1L;

        public String profile() {
            return profile;
        }

        /** Returns the new profile when it changed, otherwise null. */
        public String update(boolean charging, boolean unmetered, long nowMs) {
            boolean eligible = charging && unmetered;
            if (!eligible) {
                eligibleSinceMs = -1L;
                if (PROFILE_FULL.equals(profile)) {
                    profile = PROFILE_LEAF;
                    return profile;
                }
                return null;
            }
            if (eligibleSinceMs < 0 || nowMs < eligibleSinceMs) {
                eligibleSinceMs = nowMs;
            }
            if (PROFILE_LEAF.equals(profile) && nowMs - eligibleSinceMs >= RELAY_FULL_STABLE_MS) {
                profile = PROFILE_FULL;
                return profile;
            }
            return null;
        }

        /** Milliseconds until "full" becomes due, or -1 when nothing is pending. */
        public long msUntilFull(long nowMs) {
            if (!PROFILE_LEAF.equals(profile) || eligibleSinceMs < 0) return -1L;
            return Math.max(0L, eligibleSinceMs + RELAY_FULL_STABLE_MS - nowMs);
        }
    }

    /**
     * Counts a vendor freeze when two consecutive service ticks, both seen
     * while kept alive with a wake lock held, are more than
     * {@link #VENDOR_FREEZE_GAP_MS} apart. Without a wake lock the CPU may
     * sleep normally, so nothing is measured then. Not thread-safe.
     */
    public static final class VendorFreezeDetector {
        private long lastWatchedMs = -1L;

        /** The wake lock was just taken: measure the next gap from now. */
        public void arm(long nowMs) {
            lastWatchedMs = nowMs;
        }

        /** The wake lock was released: stop measuring. */
        public void disarm() {
            lastWatchedMs = -1L;
        }

        /**
         * One service tick. {@code watching} = kept alive and the wake lock is
         * held right now. Returns true when this tick reveals a freeze.
         */
        public boolean onTick(long nowMs, boolean watching) {
            boolean frozen = watching
                && lastWatchedMs >= 0
                && nowMs - lastWatchedMs > VENDOR_FREEZE_GAP_MS;
            lastWatchedMs = watching ? nowMs : -1L;
            return frozen;
        }
    }
}
