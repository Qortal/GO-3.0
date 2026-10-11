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
 *       adjustResize, so the WebView is shrunk by the IME overlap instead.</li>
 *   <li>Side margins, landscape only: the navigation bar (3-button phones put
 *       it at a side) and a side camera cutout. The page then simply ends
 *       before them, so no part of the phone shell has to pad for a side it
 *       was never laid out for. Portrait, waterfall screens included, keeps
 *       margins 0 and passes the cutout to CSS as before.</li>
 *   <li>CSS variables: top is the status bar or cutout (the cutout still
 *       counts while immersive mode hides the status bar); bottom is the nav
 *       bar unless the keyboard is up (the WebView already ends above it);
 *       sides are 0 whenever margins cover them.</li>
 * </ul>
 *
 * MainActivity and SafeAreaPlugin both go through here, so the two writers of
 * the CSS variables can never disagree. The math takes plain ints so the JVM
 * tests can cover it.
 */
final class SafeAreaInsetsPolicy {
    /** Kill switch: false gives the old behaviour (no side margins). */
    static final boolean SIDE_MARGINS = true;

    private SafeAreaInsetsPolicy() {}

    static final class Result {
        /** Physical px. */
        final int marginLeft;
        final int marginRight;
        final int marginBottom;
        /** CSS px. */
        final int cssTop;
        final int cssBottom;
        final int cssLeft;
        final int cssRight;

        Result(int marginLeft, int marginRight, int marginBottom, int cssTop, int cssBottom, int cssLeft, int cssRight) {
            this.marginLeft = marginLeft;
            this.marginRight = marginRight;
            this.marginBottom = marginBottom;
            this.cssTop = cssTop;
            this.cssBottom = cssBottom;
            this.cssLeft = cssLeft;
            this.cssRight = cssRight;
        }
    }

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
            SIDE_MARGINS, statusTop, cutoutTop, cutoutLeft, cutoutRight,
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
        float d = density > 0 ? density : 1f;
        boolean sides = sideMargins && landscape;
        int mL = sides ? Math.max(0, Math.max(cutoutLeft, navLeft)) : 0;
        int mR = sides ? Math.max(0, Math.max(cutoutRight, navRight)) : 0;
        int ime = Math.max(0, imeBottom);
        return new Result(
            mL,
            mR,
            ime,
            Math.round(Math.max(statusTop, cutoutTop) / d),
            ime > 0 ? 0 : Math.round(navBottom / d),
            sides ? 0 : Math.round(cutoutLeft / d),
            sides ? 0 : Math.round(cutoutRight / d)
        );
    }

    static Result fromInsets(WindowInsetsCompat insets, boolean landscape, float density) {
        Insets status = insets.getInsets(WindowInsetsCompat.Type.statusBars());
        Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
        Insets nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        return compute(
            status.top, cutout.top, cutout.left, cutout.right,
            nav.left, nav.right, nav.bottom, ime.bottom, landscape, density
        );
    }

    /**
     * Window metrics for the page's layout store (src/layout/goLayout.ts),
     * all CSS px: the WebView width after side margins, the window content
     * height (the keyboard never changes it), the keyboard height, the side
     * margins and Configuration.smallestScreenWidthDp.
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
        if (width <= 0) return null;
        return new Metrics(
            Math.round(width / d),
            Math.round(parentHeightPx / d),
            Math.round(r.marginBottom / d),
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
