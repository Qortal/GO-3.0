package com.github.Qortal.qortalMobile;

/**
 * Pure rules behind the status notification's honest text: no Android
 * types, so the JVM unit tests can check them. Times are
 * SystemClock.elapsedRealtime() values.
 *
 * The notification text is whatever the page last pushed, and the page stops
 * pushing once Chromium freezes it (60 s after it becomes hidden) or once the
 * WebView is gone. These rules decide when native code must say so itself.
 */
public final class StatusHonesty {
    private StatusHonesty() {}

    /** The page runs and its own status text is true. */
    public static final String LIVE = "live";
    /** GO is off screen and the keep-alive controller keeps the engine running. */
    public static final String BACKGROUND = "background";
    /** The engine is not running (frozen page or no WebView): open GO to sync. */
    public static final String PAUSED = "paused";

    /**
     * Chromium freezes a hidden page 60 s after it becomes hidden (measured);
     * a few seconds more so "paused" is never shown early.
     */
    public static final long FREEZE_AFTER_HIDDEN_MS = 65_000L;

    /** Upper bound for a waiting count shown in the notification. */
    public static final int MAX_COUNT = 9999;

    /** Upper bound for one localized string (they are short labels). */
    public static final int MAX_STRING_LENGTH = 200;

    /** Keys the page may set through QortalBackground.setLocalizedStrings. */
    public static final String KEY_PAUSED_TITLE = "status_paused_title";
    public static final String KEY_PAUSED_TEXT = "status_paused_text";
    public static final String KEY_WAITING_TEXT = "status_waiting_text";
    /** Optional singular form of {@link #KEY_WAITING_TEXT}, used for a count of 1. */
    public static final String KEY_WAITING_TEXT_ONE = "status_waiting_text_one";
    /** Short form ("4 unsent") for the one-line collapsed notification. */
    public static final String KEY_WAITING_SHORT = "status_waiting_short";
    public static final String KEY_FGS_TIMEOUT_TITLE = "fgs_timeout_title";
    public static final String KEY_FGS_TIMEOUT_TEXT = "fgs_timeout_text";
    /** The "GO paused" text when GO's own battery limit paused it (title stays fgs_timeout_title). */
    public static final String KEY_BATTERY_PAUSE_TEXT = "battery_pause_text";
    public static final String KEY_SYNCING_BACKGROUND = "status_syncing_background";

    public static final String[] LOCALIZED_KEYS = {
        KEY_PAUSED_TITLE,
        KEY_PAUSED_TEXT,
        KEY_WAITING_TEXT,
        KEY_WAITING_TEXT_ONE,
        KEY_WAITING_SHORT,
        KEY_FGS_TIMEOUT_TITLE,
        KEY_FGS_TIMEOUT_TEXT,
        KEY_BATTERY_PAUSE_TEXT,
        KEY_SYNCING_BACKGROUND,
    };

    public static boolean isLocalizedKey(String key) {
        if (key == null) return false;
        for (String known : LOCALIZED_KEYS) {
            if (known.equals(key)) return true;
        }
        return false;
    }

    /**
     * Which text the status notification shows.
     *
     * @param pageGone the WebView was destroyed and no new page has loaded
     * @param activityStopped GO is not on screen
     * @param keepAliveActive the keep-alive controller keeps the page visible to Chromium
     * @param hiddenSinceMs when the page last became hidden to Chromium (left the
     *     screen, or keep-alive ended off screen), or a negative value if unknown
     */
    public static String resolve(
        boolean pageGone,
        boolean activityStopped,
        boolean keepAliveActive,
        long hiddenSinceMs,
        long nowMs
    ) {
        if (pageGone) return PAUSED;
        if (!activityStopped) return LIVE;
        if (keepAliveActive) return BACKGROUND;
        if (hiddenSinceMs >= 0 && nowMs - hiddenSinceMs > FREEZE_AFTER_HIDDEN_MS) {
            return PAUSED;
        }
        // Hidden, but Chromium has not frozen the page yet: it still pushes.
        return LIVE;
    }

    /**
     * When the page last became hidden to Chromium: GO left the screen, or
     * keep-alive (which keeps the page visible off screen) ended later.
     * Chromium freezes the page {@link #FREEZE_AFTER_HIDDEN_MS} after that.
     *
     * @param stoppedAtMs when GO last left the screen
     * @param keepAliveEndedAtMs when keep-alive last ended, or a negative value if never
     */
    public static long hiddenSince(long stoppedAtMs, long keepAliveEndedAtMs) {
        return Math.max(stoppedAtMs, keepAliveEndedAtMs);
    }

    /**
     * The new "keep-alive ended at" after one keep-alive evaluation: the
     * evaluation time when keep-alive was on and is now off, else unchanged.
     */
    public static long keepAliveEndedAt(
        boolean keptBefore,
        boolean keepNow,
        long previousEndedAtMs,
        long nowMs
    ) {
        return keptBefore && !keepNow ? nowMs : previousEndedAtMs;
    }

    /** The waiting count is shown only while GO is off screen (or its page is gone). */
    public static boolean showWaiting(boolean pageGone, boolean activityStopped, int count) {
        return count > 0 && (pageGone || activityStopped);
    }

    public static int clampCount(int count) {
        if (count < 0) return 0;
        return Math.min(count, MAX_COUNT);
    }

    /** Replaces every {{count}} (spaces inside the braces allowed) with the number. */
    public static String fillCount(String template, int count) {
        if (template == null) return "";
        return template.replaceAll("\\{\\{\\s*count\\s*\\}\\}", Integer.toString(count));
    }

    /** Trimmed, bounded value, or null when it is empty. */
    public static String sanitize(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return null;
        if (trimmed.length() > MAX_STRING_LENGTH) {
            trimmed = trimmed.substring(0, MAX_STRING_LENGTH);
        }
        return trimmed;
    }

    /** First line plus an optional second one. */
    public static String joinLines(String first, String second) {
        if (second == null || second.isEmpty()) return first;
        if (first == null || first.isEmpty()) return second;
        return first + "\n" + second;
    }

    /** Text after the status on the collapsed line ("· 4 unsent"), or null. */
    public static String inlineSuffix(String second) {
        if (second == null || second.isEmpty()) return null;
        return "\u00b7 " + second;
    }
}
