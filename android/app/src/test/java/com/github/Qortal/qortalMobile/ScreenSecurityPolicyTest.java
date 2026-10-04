package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.github.Qortal.qortalMobile.ScreenSecurityPolicy.Kind;
import java.util.EnumSet;
import org.junit.Test;

public class ScreenSecurityPolicyTest {
    /** android.view.WindowManager.LayoutParams.FLAG_SECURE */
    private static final int FLAG_SECURE = 0x00002000;
    private static final int FLAG_KEEP_SCREEN_ON = 0x00000080;

    @Test
    public void startsWithNothingProtected() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        assertFalse(policy.isOn(Kind.SECURE));
        assertFalse(policy.isOn(Kind.TOUCH));
    }

    @Test
    public void staysSecureUntilTheLastOverlappingScreenCloses() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        // Seed screen opens: the window turns secure.
        assertTrue(policy.hold(Kind.SECURE, true));
        // The lock screen appears over it: already secure, nothing to change.
        assertFalse(policy.hold(Kind.SECURE, true));
        assertEquals(2, policy.holds(Kind.SECURE));
        // The lock screen goes: the seed is still on screen.
        assertFalse(policy.hold(Kind.SECURE, false));
        assertTrue(policy.isOn(Kind.SECURE));
        // The seed screen closes: capture works again.
        assertTrue(policy.hold(Kind.SECURE, false));
        assertFalse(policy.isOn(Kind.SECURE));
    }

    @Test
    public void aStrayReleaseCannotSwallowTheNextHold() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        assertFalse(policy.hold(Kind.SECURE, false));
        assertFalse(policy.hold(Kind.SECURE, false));
        assertEquals(0, policy.holds(Kind.SECURE));
        // A screen that opens afterwards is still protected.
        assertTrue(policy.hold(Kind.SECURE, true));
        assertTrue(policy.isOn(Kind.SECURE));
    }

    @Test
    public void countsSecureAndTouchProtectionSeparately() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        assertTrue(policy.hold(Kind.TOUCH, true));
        assertFalse(policy.isOn(Kind.SECURE));
        assertTrue(policy.hold(Kind.SECURE, true));
        assertTrue(policy.hold(Kind.TOUCH, false));
        assertTrue(policy.isOn(Kind.SECURE));
        assertFalse(policy.isOn(Kind.TOUCH));
    }

    @Test
    public void aNewPageStartsUnprotected() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        assertTrue("nothing to undo", policy.reset().isEmpty());
        policy.hold(Kind.SECURE, true);
        policy.hold(Kind.SECURE, true);
        policy.hold(Kind.TOUCH, true);
        assertEquals(EnumSet.of(Kind.SECURE, Kind.TOUCH), policy.reset());
        assertFalse(policy.isOn(Kind.SECURE));
        assertFalse(policy.isOn(Kind.TOUCH));
        // A late release from the old page, before the new page holds
        // anything, is ignored.
        policy.hold(Kind.SECURE, false);
        assertTrue(policy.hold(Kind.SECURE, true));
        assertTrue(policy.isOn(Kind.SECURE));
    }

    @Test
    public void aResetOnlyReportsTheKindsThatWereOn() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        policy.hold(Kind.SECURE, true);
        // Only the window's secure flag needs undoing: the touch filter is
        // left alone.
        assertEquals(EnumSet.of(Kind.SECURE), policy.reset());
        // The page reset and the script reset both run on a reload: the
        // second one has nothing left to undo.
        assertTrue(policy.reset().isEmpty());
    }

    @Test
    public void aSecureToggleDoesNotChangeTheTouchFilter() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        policy.hold(Kind.SECURE, true);
        policy.hold(Kind.SECURE, false);
        // No TOUCH hold: whatever the WebView has stays as it is, so a filter
        // another part of GO turned on for good is not switched off.
        assertTrue(policy.filterTouchesTarget(true));
        assertFalse(policy.filterTouchesTarget(false));
    }

    @Test
    public void theLastTouchReleaseRestoresTheWebViewsOwnFilter() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        // The filter was already on before the approval dialog held it.
        policy.hold(Kind.TOUCH, true);
        assertTrue(policy.filterTouchesTarget(true));
        policy.hold(Kind.TOUCH, false);
        assertTrue("stays on", policy.filterTouchesTarget(true));

        // The filter was off: on while held, off again after.
        policy.hold(Kind.TOUCH, true);
        assertTrue(policy.filterTouchesTarget(false));
        // Quick on/off/on: the UI thread may apply the same state twice.
        assertTrue(policy.filterTouchesTarget(true));
        policy.hold(Kind.TOUCH, false);
        assertFalse(policy.filterTouchesTarget(true));
    }

    @Test
    public void aResetAlsoRestoresTheTouchFilter() {
        ScreenSecurityPolicy policy = new ScreenSecurityPolicy();
        policy.hold(Kind.TOUCH, true);
        assertTrue(policy.filterTouchesTarget(false));
        assertEquals(EnumSet.of(Kind.TOUCH), policy.reset());
        assertFalse(policy.filterTouchesTarget(true));
    }

    @Test
    public void hidesOverlaysOnlyFromAndroid12() {
        assertFalse(ScreenSecurityPolicy.canHideOverlays(26));
        assertFalse(ScreenSecurityPolicy.canHideOverlays(30));
        assertTrue(ScreenSecurityPolicy.canHideOverlays(31));
        assertTrue(ScreenSecurityPolicy.canHideOverlays(36));
    }

    @Test
    public void changesWindowFlagsOnlyWhenNeeded() {
        assertTrue(ScreenSecurityPolicy.flagNeedsChange(0, FLAG_SECURE, true));
        assertFalse(ScreenSecurityPolicy.flagNeedsChange(FLAG_SECURE, FLAG_SECURE, true));
        assertTrue(ScreenSecurityPolicy.flagNeedsChange(
            FLAG_SECURE | FLAG_KEEP_SCREEN_ON, FLAG_SECURE, false));
        assertFalse(ScreenSecurityPolicy.flagNeedsChange(FLAG_KEEP_SCREEN_ON, FLAG_SECURE, false));
    }
}
