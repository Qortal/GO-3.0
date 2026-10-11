package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SafeAreaInsetsPolicyTest {
    /** A 2.75x phone (1080x2400 @ 440 dpi). */
    private static final float D = 2.75f;

    private static SafeAreaInsetsPolicy.Result portrait(int cutoutLeft, int cutoutRight, int ime) {
        // statusTop 66, cutoutTop 80 (punch hole taller than the bar), gesture nav 66.
        return SafeAreaInsetsPolicy.compute(66, 80, cutoutLeft, cutoutRight, 0, 0, 66, ime, false, D);
    }

    @Test
    public void portraitHasNoMarginsAndPassesTheCutoutThrough() {
        SafeAreaInsetsPolicy.Result r = portrait(0, 0, 0);
        assertEquals(0, r.marginLeft);
        assertEquals(0, r.marginRight);
        assertEquals(0, r.marginBottom);
        assertEquals(29, r.cssTop); // max(66, 80) / 2.75
        assertEquals(24, r.cssBottom);
        assertEquals(0, r.cssLeft);
        assertEquals(0, r.cssRight);
    }

    @Test
    public void portraitWaterfallSidesStayInCss() {
        SafeAreaInsetsPolicy.Result r = portrait(55, 55, 0);
        assertEquals(0, r.marginLeft);
        assertEquals(0, r.marginRight);
        assertEquals(20, r.cssLeft);
        assertEquals(20, r.cssRight);
    }

    @Test
    public void portraitNavSidesNeverBecomeMargins() {
        // Even a (rare) side nav bar in portrait keeps today's behaviour.
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(66, 0, 0, 0, 132, 0, 0, 0, false, D);
        assertEquals(0, r.marginLeft);
        assertEquals(0, r.cssLeft);
    }

    @Test
    public void landscapeNavOnTheRightBecomesARightMargin() {
        // Rotation 1: 3-button nav on the right, punch hole on the left.
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(66, 0, 80, 0, 0, 132, 0, 0, true, D);
        assertEquals(80, r.marginLeft);
        assertEquals(132, r.marginRight);
        assertEquals(0, r.marginBottom);
        assertEquals(24, r.cssTop);
        assertEquals(0, r.cssBottom);
        // The margins cover the sides, so CSS must not pad them again.
        assertEquals(0, r.cssLeft);
        assertEquals(0, r.cssRight);
    }

    @Test
    public void landscapeNavOnTheLeftBecomesALeftMargin() {
        // Rotation 3: nav on the left, punch hole on the right.
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(66, 0, 0, 80, 132, 0, 0, 0, true, D);
        assertEquals(132, r.marginLeft);
        assertEquals(80, r.marginRight);
        assertEquals(0, r.cssLeft);
        assertEquals(0, r.cssRight);
    }

    @Test
    public void landscapeSideCutoutWiderThanNavWins() {
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(66, 0, 0, 150, 0, 120, 0, 0, true, D);
        assertEquals(150, r.marginRight);
        assertEquals(0, r.marginLeft);
    }

    @Test
    public void landscapeGestureNavKeepsTheBottomInset() {
        // Tablet in landscape: nav at the bottom, no side bars.
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(48, 0, 0, 0, 0, 0, 48, 0, true, 2f);
        assertEquals(0, r.marginLeft);
        assertEquals(0, r.marginRight);
        assertEquals(24, r.cssBottom);
    }

    @Test
    public void imeOpenShrinksTheWebViewAndDropsTheBottomInset() {
        SafeAreaInsetsPolicy.Result r = portrait(0, 0, 880);
        assertEquals(880, r.marginBottom);
        assertEquals(0, r.cssBottom);
        assertEquals(29, r.cssTop);
    }

    @Test
    public void imeOpenInLandscapeKeepsTheSideMargins() {
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(66, 0, 0, 0, 0, 132, 0, 600, true, D);
        assertEquals(600, r.marginBottom);
        assertEquals(132, r.marginRight);
        assertEquals(0, r.cssBottom);
    }

    @Test
    public void negativeImeIsClamped() {
        assertEquals(0, portrait(0, 0, -5).marginBottom);
    }

    @Test
    public void killSwitchOffGivesTheOldBehaviour() {
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(false, 66, 0, 80, 0, 0, 132, 0, 0, true, D);
        assertEquals(0, r.marginLeft);
        assertEquals(0, r.marginRight);
        assertEquals(29, r.cssLeft); // cutout passthrough, as before
        assertEquals(0, r.cssRight);
    }

    @Test
    public void killSwitchIsOn() {
        assertTrue(SafeAreaInsetsPolicy.SIDE_MARGINS);
    }

    @Test
    public void badDensityFallsBackToOne() {
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(24, 0, 0, 0, 0, 0, 16, 0, false, 0f);
        assertEquals(24, r.cssTop);
        assertEquals(16, r.cssBottom);
    }

    @Test
    public void metricsAreCssPxAfterSideMargins() {
        // 2400x1080 landscape phone, nav 132 px on the right.
        SafeAreaInsetsPolicy.Result r =
            SafeAreaInsetsPolicy.compute(66, 0, 0, 0, 0, 132, 0, 0, true, D);
        SafeAreaInsetsPolicy.Metrics m = SafeAreaInsetsPolicy.metrics(2400, 1080, r, D, 392);
        assertEquals(825, m.width); // (2400 - 132) / 2.75 = 824.7
        assertEquals(393, m.height);
        assertEquals(0, m.ime);
        assertEquals(0, m.insetLeft);
        assertEquals(48, m.insetRight);
        assertEquals(392, m.smallestWidthDp);
    }

    @Test
    public void metricsHeightIgnoresTheKeyboard() {
        SafeAreaInsetsPolicy.Result r = portrait(0, 0, 880);
        SafeAreaInsetsPolicy.Metrics m = SafeAreaInsetsPolicy.metrics(1080, 2400, r, D, 392);
        assertEquals(393, m.width);
        assertEquals(873, m.height);
        assertEquals(320, m.ime);
    }

    @Test
    public void metricsNeedALaidOutParent() {
        SafeAreaInsetsPolicy.Result r = portrait(0, 0, 0);
        assertNull(SafeAreaInsetsPolicy.metrics(0, 2400, r, D, 392));
        assertNull(SafeAreaInsetsPolicy.metrics(1080, 0, r, D, 392));
        assertNull(SafeAreaInsetsPolicy.metrics(1080, 2400, null, D, 392));
    }

    @Test
    public void metricsEqualityDrivesTheRepeatSkip() {
        SafeAreaInsetsPolicy.Result r = portrait(0, 0, 0);
        SafeAreaInsetsPolicy.Metrics a = SafeAreaInsetsPolicy.metrics(1080, 2400, r, D, 392);
        SafeAreaInsetsPolicy.Metrics b = SafeAreaInsetsPolicy.metrics(1080, 2400, r, D, 392);
        SafeAreaInsetsPolicy.Metrics c = SafeAreaInsetsPolicy.metrics(1080, 2400, portrait(0, 0, 880), D, 392);
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
        assertNotEquals(a, c);
    }

    @Test
    public void scriptFollowsTheGoLayoutContract() {
        SafeAreaInsetsPolicy.Metrics m = new SafeAreaInsetsPolicy.Metrics(825, 393, 0, 0, 48, 392);
        assertEquals(
            "{\"width\":825,\"height\":393,\"ime\":0,\"insetLeft\":0,\"insetRight\":48,\"smallestWidthDp\":392}",
            m.toJson()
        );
        String js = SafeAreaInsetsPolicy.metricsScript(m);
        assertTrue(js.contains("window.__goWindowMetrics=m"));
        assertTrue(js.contains("new CustomEvent('go:window-metrics',{detail:m})"));
    }

    @Test
    public void barBackgroundParsesOnlyRrggbb() {
        assertEquals(Integer.valueOf(0xffddd6ca), ImmersivePlugin.parseRgb("#DDD6CA"));
        assertEquals(Integer.valueOf(0xff0e0f14), ImmersivePlugin.parseRgb("#0e0f14"));
        assertNull(ImmersivePlugin.parseRgb(null));
        assertNull(ImmersivePlugin.parseRgb("#fff"));
        assertNull(ImmersivePlugin.parseRgb("0e0f14a"));
        assertNull(ImmersivePlugin.parseRgb("#zzzzzz"));
    }

    @Test
    public void darkBarIconsOnlyOverSeeThroughBars() {
        // Android 15+: edge to edge is enforced, whatever colour the theme names.
        assertTrue(ImmersivePlugin.barSeeThrough(35, 0xff000000));
        assertTrue(ImmersivePlugin.barSeeThrough(36, 0xff757575));
        // Android 8-14: the theme's opaque bars (black nav, black or grey status).
        assertFalse(ImmersivePlugin.barSeeThrough(26, 0xff000000));
        assertFalse(ImmersivePlugin.barSeeThrough(34, 0xff757575));
        // A bar something made transparent shows the page.
        assertTrue(ImmersivePlugin.barSeeThrough(30, 0x00000000));
    }
}
