package com.github.Qortal.qortalMobile;

import androidx.core.graphics.Insets;
import androidx.core.view.WindowInsetsCompat;
import java.util.Locale;

/**
 * Turns the window insets into what GO's WebView gets: layout margins (physical
 * px) and the --safe-area-inset-* CSS variables (CSS px).
 *
 * <ul>
 *   <li>Bottom margin: the keyboard. Edge-to-edge windows ignore
 *       adjustResize, so the WebView is shrunk by the IME overlap instead.
 *       With button navigation (3-button or 2-button) also the nav bar: its
 *       buttons take every touch, so a page under them could not be tapped
 *       at the bottom of a list. Gesture navigation keeps the page under its
 *       handle, as before; taps there still reach the page.</li>
 *   <li>Side margins, landscape only: the navigation bar (3-button phones put
 *       it at a side) and a side camera cutout. The page then simply ends
 *       before them, so no part of the phone shell has to pad for a side it
 *       was never laid out for. Portrait, waterfall screens included, keeps
 *       margins 0 and passes the cutout to CSS as before.</li>
 *   <li>CSS variables: top is the status bar or cutout (the cutout still
 *       counts while immersive mode hides the status bar); bottom is the nav
 *       bar unless the keyboard or a button nav bar is below the WebView (it
 *       already ends above them); sides are 0 whenever margins cover them.</li>
 * </ul>
 *
 * MainActivity and SafeAreaPlugin both go through here, so the two writers of
 * the CSS variables can never disagree. The math takes plain ints so the JVM
 * tests can cover it.
 */
final class SafeAreaInsetsPolicy {
    /** Kill switch: false gives the old behaviour (no side margins). */
    static final boolean SIDE_MARGINS = true;
    /** Kill switch: false keeps the WebView under a button nav bar, as before. */
    static final boolean NAV_BUTTON_MARGIN = true;

    /**
     * The last answer read with the keyboard down. Under gesture navigation
     * the keyboard brings buttons of its own (hide keyboard, switch keyboard),
     * which must not read as button navigation and move the page's resting
     * size, so while the keyboard is up the answer is kept.
     */
    private static volatile boolean navButtonsSeen = false;

    private SafeAreaInsetsPolicy() {}

    static final class Result {
        /** Physical px. */
        final int marginLeft;
        final int marginRight;
        final int marginBottom;
        /**
         * Physical px: the part of marginBottom that is a nav bar with
         * buttons, there with or without the keyboard. 0 with gestures.
         */
        final int navMarginBottom;
        /** CSS px. */
        final int cssTop;
        final int cssBottom;
        final int cssLeft;
        final int cssRight;

        Result(
            int marginLeft,
            int marginRight,
            int marginBottom,
            int navMarginBottom,
            int cssTop,
            int cssBottom,
            int cssLeft,
            int cssRight
        ) {
            this.marginLeft = marginLeft;
            this.marginRight = marginRight;
            this.marginBottom = marginBottom;
            this.navMarginBottom = navMarginBottom;
            this.cssTop = cssTop;
            this.cssBottom = cssBottom;
            this.cssLeft = cssLeft;
            this.cssRight = cssRight;
        }
    }

    /** Gesture navigation (no buttons at the bottom): the old maths. */
    static Result compute(
        int statusTop,
        int cutoutTop,
        int cutoutLeft,
        int cutoutRight,
        int navLeft,
        int navRight,
        int navBottom,
        int imeBottom,
        boolean landscape,
        float density
    ) {
        return compute(
            SIDE_MARGINS, false, statusTop, cutoutTop, cutoutLeft, cutoutRight,
            navLeft, navRight, navBottom, imeBottom, landscape, density
        );
    }

    static Result compute(
        boolean sideMargins,
        int statusTop,
        int cutoutTop,
        int cutoutLeft,
        int cutoutRight,
        int navLeft,
        int navRight,
        int navBottom,
        int imeBottom,
        boolean landscape,
        float density
    ) {
        return compute(
            sideMargins, false, statusTop, cutoutTop, cutoutLeft, cutoutRight,
            navLeft, navRight, navBottom, imeBottom, landscape, density
        );
    }

    /** navButtons: the bottom nav bar holds buttons (see navButtonsAtBottom). */
    static Result compute(
        boolean sideMargins,
        boolean navButtons,
        int statusTop,
        int cutoutTop,
        int cutoutLeft,
        int cutoutRight,
        int navLeft,
        int navRight,
        int navBottom,
        int imeBottom,
        boolean landscape,
        float density
    ) {
        float d = density > 0 ? density : 1f;
        boolean sides = sideMargins && landscape;
        int mL = sides ? Math.max(0, Math.max(cutoutLeft, navLeft)) : 0;
        int mR = sides ? Math.max(0, Math.max(cutoutRight, navRight)) : 0;
        int ime = Math.max(0, imeBottom);
        int navMargin = navButtons ? Math.max(0, navBottom) : 0;
        return new Result(
            mL,
            mR,
            // The keyboard's inset runs to the screen bottom, nav bar included.
            Math.max(ime, navMargin),
            navMargin,
            Math.round(Math.max(statusTop, cutoutTop) / d),
            ime > 0 || navMargin > 0 ? 0 : Math.round(navBottom / d),
            sides ? 0 : Math.round(cutoutLeft / d),
            sides ? 0 : Math.round(cutoutRight / d)
        );
    }

    /**
     * Whether the nav bar at the bottom holds buttons (3-button or 2-button
     * navigation; Android 9 and older always do) rather than a gesture
     * handle. Buttons are tappable elements, and button navigation has no
     * back-swipe zones at the sides. A tablet taskbar under gesture
     * navigation is tappable too but keeps those zones, so it stays as it was.
     */
    static boolean hasNavButtonsAtBottom(
        int navBottom,
        int tappableBottom,
        int gestureLeft,
        int gestureRight
    ) {
        return navBottom > 0 && tappableBottom > 0 && gestureLeft <= 0 && gestureRight <= 0;
    }

    /** hasNavButtonsAtBottom, read only while the keyboard is down (navButtonsSeen). */
    static boolean navButtonsAtBottom(
        boolean imeUp,
        int navBottom,
        int tappableBottom,
        int gestureLeft,
        int gestureRight
    ) {
        if (imeUp) return navButtonsSeen;
        boolean buttons = hasNavButtonsAtBottom(navBottom, tappableBottom, gestureLeft, gestureRight);
        navButtonsSeen = buttons;
        return buttons;
    }

    /** Tests only. */
    static void resetNavButtonsSeenForTests() {
        navButtonsSeen = false;
    }

    static Result fromInsets(WindowInsetsCompat insets, boolean landscape, float density) {
        Insets status = insets.getInsets(WindowInsetsCompat.Type.statusBars());
        Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
        Insets nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        Insets tappable = insets.getInsets(WindowInsetsCompat.Type.tappableElement());
        Insets gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures());
        boolean navButtons = NAV_BUTTON_MARGIN && navButtonsAtBottom(
            ime.bottom > 0, nav.bottom, tappable.bottom, gestures.left, gestures.right
        );
        return compute(
            SIDE_MARGINS, navButtons, status.top, cutout.top, cutout.left, cutout.right,
            nav.left, nav.right, nav.bottom, ime.bottom, landscape, density
        );
    }

    /**
     * Window metrics for the page's layout store (src/layout/goLayout.ts),
     * all CSS px: the WebView width after side margins, the window content
     * height above a button nav bar (the keyboard never changes it), the
     * keyboard's overlap of that height, the side margins and
     * Configuration.smallestScreenWidthDp.
     */
    static final class Metrics {
        final int width;
        final int height;
        final int ime;
        final int insetLeft;
        final int insetRight;
        final int smallestWidthDp;

        Metrics(int width, int height, int ime, int insetLeft, int insetRight, int smallestWidthDp) {
            this.width = width;
            this.height = height;
            this.ime = ime;
            this.insetLeft = insetLeft;
            this.insetRight = insetRight;
            this.smallestWidthDp = smallestWidthDp;
        }

        /** A JS object literal; only ints, so nothing needs escaping. */
        String toJson() {
            return String.format(
                Locale.ROOT,
                "{\"width\":%d,\"height\":%d,\"ime\":%d,\"insetLeft\":%d,\"insetRight\":%d,\"smallestWidthDp\":%d}",
                width, height, ime, insetLeft, insetRight, smallestWidthDp
            );
        }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof Metrics)) return false;
            Metrics m = (Metrics) o;
            return width == m.width && height == m.height && ime == m.ime
                && insetLeft == m.insetLeft && insetRight == m.insetRight
                && smallestWidthDp == m.smallestWidthDp;
        }

        @Override
        public int hashCode() {
            return toJson().hashCode();
        }
    }

    /** Null while the parent has no size yet (before the first layout). */
    static Metrics metrics(int parentWidthPx, int parentHeightPx, Result r, float density, int smallestWidthDp) {
        if (parentWidthPx <= 0 || parentHeightPx <= 0 || r == null) return null;
        float d = density > 0 ? density : 1f;
        int width = Math.max(0, parentWidthPx - r.marginLeft - r.marginRight);
        int height = Math.max(0, parentHeightPx - r.navMarginBottom);
        if (width <= 0 || height <= 0) return null;
        return new Metrics(
            Math.round(width / d),
            Math.round(height / d),
            Math.round(Math.max(0, r.marginBottom - r.navMarginBottom) / d),
            Math.round(r.marginLeft / d),
            Math.round(r.marginRight / d),
            Math.max(0, smallestWidthDp)
        );
    }

    /** The script that hands metrics to the page (contract in goLayout.ts). */
    static String metricsScript(Metrics m) {
        return "(function(){var m=" + m.toJson() + ";window.__goWindowMetrics=m;"
            + "window.dispatchEvent(new CustomEvent('go:window-metrics',{detail:m}));})();";
    }
}
