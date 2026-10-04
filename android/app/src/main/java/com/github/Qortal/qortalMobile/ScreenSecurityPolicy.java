package com.github.Qortal.qortalMobile;

import java.util.EnumSet;

/**
 * GO-37 / GO-29: which screen protections GO's page currently asks for.
 *
 * Sensitive screens (seed phrase, private key, wallet backup, the lock screen,
 * payment and Q-App approvals) ask for protection while they are shown and give
 * it back when they close. They can overlap, for example a backup dialog that
 * is still open when the idle lock appears, so each protection is counted: it
 * stays on while at least one screen holds it.
 *
 * <ul>
 *   <li>{@link Kind#SECURE}: FLAG_SECURE on the activity window. Screenshots,
 *       screen recording, the recents thumbnail and assistant screen reading
 *       see a blank window.</li>
 *   <li>{@link Kind#TOUCH}: taps are dropped while another app's window covers
 *       the WebView, and other apps' overlays are hidden (Android 12+), so an
 *       overlay cannot trick the user into approving something.</li>
 * </ul>
 *
 * Each kind changes only its own window state: turning SECURE on or off never
 * touches the touch filter, and the reverse.
 *
 * Plain Java with no Android types so the JVM tests can cover it.
 */
final class ScreenSecurityPolicy {
    /** Window.setHideOverlayWindows exists from Android 12 (API 31). */
    static final int HIDE_OVERLAYS_MIN_SDK = 31;

    enum Kind {
        SECURE,
        TOUCH
    }

    private int secureHolds;
    private int touchHolds;
    /**
     * The WebView's own filterTouchesWhenObscured value from before GO's first
     * TOUCH hold, or null while TOUCH has not been applied. Another part of GO
     * may turn the filter on for good; the last release must give that back
     * instead of forcing it off.
     */
    private Boolean touchFilterBaseline;

    /**
     * Adds one hold ({@code on}) or gives one back ({@code !on}). Giving back
     * more than was held is ignored, so a stray release can never leave the
     * count below zero and swallow the next screen's hold.
     *
     * @return true when the protection turned on or off because of this call.
     */
    synchronized boolean hold(Kind kind, boolean on) {
        boolean before = isOn(kind);
        int holds = holdsOf(kind);
        if (on) {
            holds = holds == Integer.MAX_VALUE ? holds : holds + 1;
        } else if (holds > 0) {
            holds -= 1;
        }
        setHolds(kind, holds);
        return before != isOn(kind);
    }

    synchronized boolean isOn(Kind kind) {
        return holdsOf(kind) > 0;
    }

    synchronized int holds(Kind kind) {
        return holdsOf(kind);
    }

    /**
     * Drops every hold. GO calls this when its page starts loading again (a
     * reload or a crash recovery) and when the new page's script starts: the
     * screens that held protection are gone, and the new page asks again for
     * what it shows.
     *
     * @return the kinds that were on and are now off (empty if none).
     */
    synchronized EnumSet<Kind> reset() {
        EnumSet<Kind> turnedOff = EnumSet.noneOf(Kind.class);
        if (secureHolds > 0) {
            turnedOff.add(Kind.SECURE);
        }
        if (touchHolds > 0) {
            turnedOff.add(Kind.TOUCH);
        }
        secureHolds = 0;
        touchHolds = 0;
        return turnedOff;
    }

    /**
     * The filterTouchesWhenObscured value the WebView should have now, given
     * the value it has ({@code current}). While TOUCH is held it is true.
     * Once released it goes back to what the WebView had before GO's first
     * TOUCH hold, so a filter that another part of GO turned on stays on.
     * Call it on the UI thread, only when TOUCH changed.
     */
    synchronized boolean filterTouchesTarget(boolean current) {
        if (touchHolds > 0) {
            if (touchFilterBaseline == null) {
                touchFilterBaseline = current;
            }
            return true;
        }
        boolean target = touchFilterBaseline != null ? touchFilterBaseline : current;
        touchFilterBaseline = null;
        return target;
    }

    /** Whether this Android version can hide other apps' overlay windows. */
    static boolean canHideOverlays(int sdkInt) {
        return sdkInt >= HIDE_OVERLAYS_MIN_SDK;
    }

    /**
     * Whether a window whose flags are {@code currentFlags} needs {@code flag}
     * added ({@code wanted}) or cleared. Changing window flags re-lays out the
     * window, so GO skips the call when nothing would change.
     */
    static boolean flagNeedsChange(int currentFlags, int flag, boolean wanted) {
        boolean isSet = (currentFlags & flag) == flag;
        return isSet != wanted;
    }

    private int holdsOf(Kind kind) {
        return kind == Kind.SECURE ? secureHolds : touchHolds;
    }

    private void setHolds(Kind kind, int holds) {
        if (kind == Kind.SECURE) {
            secureHolds = holds;
        } else {
            touchHolds = holds;
        }
    }
}
