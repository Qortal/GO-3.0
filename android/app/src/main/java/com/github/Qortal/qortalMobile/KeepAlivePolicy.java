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
    /**
     * GO pauses its background connection once it has been off screen and on
     * battery this long without a break (see {@link #shouldPauseOnBattery}).
     */
    public static final long PAUSE_ON_BATTERY_AFTER_MS = 6L * 60L * 60_000L;
    /**
     * Build.VERSION_CODES.VANILLA_ICE_CREAM: the first release that stops a
     * dataSync service after about 6 h a day. GO's own battery limit applies
     * only from here on, where it replaces that limit.
     */
    public static final int DATA_SYNC_TIME_LIMIT_MIN_SDK = 35;
    /**
     * On battery, a level this many points above the lowest one seen means
     * the phone charged while GO could not see it (see
     * {@link BatteryStretchTracker#onLevel}).
     */
    public static final int UNSEEN_CHARGE_RISE_PCT = 2;

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
        /**
         * elapsedRealtime when the phone was last unplugged, or -1 when no
         * unplug was seen (on battery since before GO started).
         */
        public long unpluggedAtMs = -1L;
        public boolean outboxPending;
        /** A page with a signed-in session exists (WebView attached, not logged out). */
        public boolean sessionActive;
        /**
         * The status service is paused (Android's time limit or GO's own
         * battery pause); wait for GO to be opened.
         */
        public boolean suspended;
        /** Build.VERSION.SDK_INT (0 = unknown: no battery pause). */
        public int sdkInt;
        /** A voice call (1:1 or group) is dialing or running (QortalCall.setCallActive). */
        public boolean callActive;
        /** An incoming call rings (native ring or the page's own). */
        public boolean callRinging;
        /**
         * Audio or video plays and the user lets it play off screen
         * (GoMediaHub, background player settings).
         */
        public boolean mediaPlaying;
        /**
         * A background player button was pressed a moment ago: the page,
         * maybe frozen while paused, must run to get it (GoMediaHub).
         */
        public boolean mediaWake;
        /** GO's WebView is attached (a page exists, signed in or not). */
        public boolean pageAttached;
    }

    /**
     * A call needs the page in every mode, even "off": its audio, signalling
     * and timers all run in the page, which Chromium freezes 60 s after GO
     * leaves the screen.
     */
    public static boolean callNeedsPage(Inputs in) {
        return in != null && (in.callActive || in.callRinging);
    }

    /**
     * Media playing off screen needs the page in every mode, even "off" and
     * during GO's battery pause: the user chose to keep it playing, and
     * Chromium would freeze the page (and its media) 60 s after GO leaves
     * the screen. A pressed player button wakes it for a moment too.
     */
    public static boolean mediaNeedsPage(Inputs in) {
        return in != null && in.pageAttached && (in.mediaPlaying || in.mediaWake);
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
     * within {@link #OUTBOX_WINDOW_MS} of leaving the screen (any mode but off),
     * or a call rings or runs (any mode, see {@link #callNeedsPage}), or
     * media plays off screen (any mode, see {@link #mediaNeedsPage}).
     */
    public static boolean shouldKeepVisible(Inputs in) {
        if (in == null || !in.activityStopped) return false;
        if (mediaNeedsPage(in)) return true;
        if (!in.sessionActive || in.suspended) return false;
        if (callNeedsPage(in)) return true;
        String mode = modeOrDefault(in.mode);
        if (MODE_ALWAYS.equals(mode)) return true;
        if (MODE_CHARGING.equals(mode) && in.charging) return true;
        return outboxWindowActive(in);
    }

    /**
     * Partial wake lock only while kept alive on the charger or during the
     * outbox window. "always" on battery holds none (the CPU may sleep).
     * A call holds it on screen too: the proximity sensor turns the screen off
     * at the ear without GO leaving the screen, and the CPU must not sleep
     * under the call's audio.
     */
    public static boolean shouldHoldWakeLock(Inputs in) {
        if (in != null && callNeedsPage(in) && in.sessionActive && !in.suspended) return true;
        if (!shouldKeepVisible(in)) return false;
        return in.charging || outboxWindowActive(in);
    }

    public static final String SERVICE_TYPE_DATA_SYNC = "dataSync";
    public static final String SERVICE_TYPE_REMOTE_MESSAGING = "remoteMessaging";
    /** Build.VERSION_CODES.UPSIDE_DOWN_CAKE: the first release with remoteMessaging. */
    public static final int REMOTE_MESSAGING_MIN_SDK = 34;

    /**
     * Foreground service type for the status service: remoteMessaging from
     * Android 14 on, in every mode and on battery or charger alike; dataSync
     * before (Android 13 and older have no dataSync time limit, and the type
     * is ignored before Android 10).
     *
     * Android 15+ stops a dataSync service after about 6 h a day and kills
     * the app if it cannot leave the foreground within seconds. A vendor
     * freezer (vivo, measured) can hold the whole process frozen through
     * that grace period, so the time-out handler never ran in time and GO
     * crashed on the next screen-on. remoteMessaging has no daily limit;
     * on Android 15+ GO's own {@link #shouldPauseOnBattery} rule replaces
     * the cap.
     */
    public static String foregroundServiceType(int sdkInt) {
        if (sdkInt < REMOTE_MESSAGING_MIN_SDK) return SERVICE_TYPE_DATA_SYNC;
        return SERVICE_TYPE_REMOTE_MESSAGING;
    }

    /**
     * Start of the current stretch with GO off screen AND on battery: the
     * later of leaving the screen and unplugging. -1 while GO is on screen
     * or charging (either one ends the stretch).
     */
    public static long batteryStretchStartMs(Inputs in) {
        if (in == null || !in.activityStopped || in.charging) return -1L;
        return Math.max(in.stoppedAtMs, in.unpluggedAtMs);
    }

    /**
     * GO's own cap on background running, in place of Android's dataSync
     * limit: pause the status service and the hubs once GO has been off
     * screen and on battery for {@link #PAUSE_ON_BATTERY_AFTER_MS} without a
     * break. Only from Android 15 on ({@link #DATA_SYNC_TIME_LIMIT_MIN_SDK}),
     * the releases where GO gave up Android's limit by switching to
     * remoteMessaging; older releases never had one and keep running as
     * before. Never in mode always (the user asked for it to run), not
     * again while already paused, and never during a call (the pause would
     * cut it).
     */
    public static boolean shouldPauseOnBattery(Inputs in) {
        if (in == null || in.suspended) return false;
        if (callNeedsPage(in)) return false;
        if (in.sdkInt < DATA_SYNC_TIME_LIMIT_MIN_SDK) return false;
        if (MODE_ALWAYS.equals(modeOrDefault(in.mode))) return false;
        long since = batteryStretchStartMs(in);
        if (since < 0) return false;
        return in.nowMs - since >= PAUSE_ON_BATTERY_AFTER_MS;
    }

    /**
     * Battery percent from ACTION_BATTERY_CHANGED's EXTRA_LEVEL and
     * EXTRA_SCALE, 0-100, or -1 when either is missing.
     */
    public static int batteryPercent(int level, int scale) {
        if (level < 0 || scale <= 0) return -1;
        return (int) Math.min(100L, level * 100L / scale);
    }

    /**
     * Copy diagnostics name for ACTION_BATTERY_CHANGED's EXTRA_PLUGGED
     * (BatteryManager.BATTERY_PLUGGED_*): "none", "ac", "usb", "wireless",
     * "dock", "other" for an unknown value, "unknown" when it is missing.
     */
    public static String plugTypeName(int plugged) {
        switch (plugged) {
            case 0:
                return "none";
            case 1:
                return "ac";
            case 2:
                return "usb";
            case 4:
                return "wireless";
            case 8:
                return "dock";
            default:
                return plugged < 0 ? "unknown" : "other";
        }
    }

    /**
     * Charger bookkeeping for {@link #shouldPauseOnBattery}: whether the
     * phone charges, and when it was last unplugged
     * ({@link Inputs#unpluggedAtMs}).
     *
     * A vendor freezer (vivo, measured) can hold GO frozen through a whole
     * charge. The power broadcasts sent meanwhile then run after GO's first
     * tick, or only the last one arrives (Android 14+ can keep only the most
     * recent of connected / disconnected for an app it holds back), and the
     * sticky battery state already says "unplugged" again. Two signs still
     * show such a charge, and either one counts as an unplug now: a
     * disconnect while GO believed it was on battery
     * ({@link #onPowerDisconnected}), and a battery level
     * {@link #UNSEEN_CHARGE_RISE_PCT} or more above the lowest seen on battery
     * ({@link #onLevel}). Counting it late only pauses later.
     *
     * Not thread-safe; the owner serialises calls.
     */
    public static final class BatteryStretchTracker {
        private boolean charging;
        /** elapsedRealtime of the last unplug, seen or inferred; -1 if none. */
        private long unpluggedAtMs = -1L;
        /** Lowest battery percent seen on battery since the last charge, or -1. */
        private int lowestLevelPct = -1;

        public BatteryStretchTracker(boolean charging) {
            this.charging = charging;
        }

        public boolean charging() {
            return charging;
        }

        /**
         * For {@link Inputs#unpluggedAtMs}: -1 while no unplug was seen (on
         * battery since GO started).
         */
        public long unpluggedAtMs() {
            return unpluggedAtMs;
        }

        /**
         * A charger reading: the sticky battery state at a tick, or
         * ACTION_POWER_CONNECTED. Only a change from charging to not charging
         * is an unplug, so repeated readings keep the first unplug time and a
         * plug-in leaves it alone. Returns whether the charger state changed.
         */
        public boolean onCharging(boolean next, long nowMs) {
            if (charging == next) return false;
            charging = next;
            lowestLevelPct = -1;
            if (!next) unpluggedAtMs = nowMs;
            return true;
        }

        /**
         * ACTION_POWER_DISCONNECTED: always an unplug, now, even when GO
         * already believed it was on battery (it missed the connect before
         * it). Returns whether the charger state changed.
         */
        public boolean onPowerDisconnected(long nowMs) {
            boolean changed = charging;
            charging = false;
            lowestLevelPct = -1;
            unpluggedAtMs = nowMs;
            return changed;
        }

        /**
         * Battery percent at a tick (-1 = unknown, ignored). On battery, a
         * level {@link #UNSEEN_CHARGE_RISE_PCT} or more above the lowest one
         * seen means a charge GO did not see: counted as an unplug now, and
         * true is returned. A 1-point rise is gauge noise.
         */
        public boolean onLevel(int levelPct, long nowMs) {
            if (levelPct < 0) return false;
            if (charging) {
                lowestLevelPct = -1;
                return false;
            }
            if (lowestLevelPct >= 0 && levelPct - lowestLevelPct >= UNSEEN_CHARGE_RISE_PCT) {
                unpluggedAtMs = nowMs;
                lowestLevelPct = levelPct;
                return true;
            }
            if (lowestLevelPct < 0 || levelPct < lowestLevelPct) lowestLevelPct = levelPct;
            return false;
        }
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
    /**
     * Drops the presence heartbeats the page signed in advance for its time
     * off screen (qortal_presence_host.py schedule_presence_heartbeats): sent
     * when that page is gone (reload, renderer death, Activity rebuild), so a
     * signed-out phone does not keep looking online for up to 2 h.
     */
    public static final String CANCEL_SIGNED_HEARTBEATS_FRAME =
        "{\"type\":\"cmd\",\"action\":\"cancel_presence_heartbeats\",\"payload\":{}}";

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
            return onTickGap(nowMs, watching) >= 0;
        }

        /**
         * Same as {@link #onTick}, but returns the gap in ms since the last
         * watched tick when this tick reveals a freeze (always more than
         * {@link #VENDOR_FREEZE_GAP_MS}), or -1 when it does not.
         */
        public long onTickGap(long nowMs, boolean watching) {
            long gap = -1L;
            if (watching && lastWatchedMs >= 0 && nowMs - lastWatchedMs > VENDOR_FREEZE_GAP_MS) {
                gap = nowMs - lastWatchedMs;
            }
            lastWatchedMs = watching ? nowMs : -1L;
            return gap;
        }
    }

    public static final String VIVO_POWER_PACKAGE = "com.iqoo.powersaving";
    /**
     * vivo's main Battery page, exported without a permission (OriginOS 6,
     * measured). Its "high background power" pages are signature|privileged
     * and must never be targeted.
     */
    public static final String VIVO_POWER_SETTINGS_ACTION =
        "com.iqoo.powersaving.PowerManagerSettingsActivity.search";

    /** An activity start by action, limited to one package. */
    public static final class VendorBatteryIntentSpec {
        public final String packageName;
        public final String action;

        public VendorBatteryIntentSpec(String packageName, String action) {
            this.packageName = packageName;
            this.action = action;
        }
    }

    /**
     * The phone maker's own battery page for "Open battery settings", or null
     * when GO knows none (the caller opens App info instead). Only vivo and
     * iQOO (Build.MANUFACTURER, any case) have one.
     */
    public static VendorBatteryIntentSpec vendorBatteryIntentSpec(String manufacturer) {
        if (manufacturer == null) return null;
        String maker = manufacturer.trim().toLowerCase(java.util.Locale.ROOT);
        if ("vivo".equals(maker) || "iqoo".equals(maker)) {
            return new VendorBatteryIntentSpec(VIVO_POWER_PACKAGE, VIVO_POWER_SETTINGS_ACTION);
        }
        return null;
    }
}
