package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Calls in KeepAlivePolicy (see KeepAlivePolicyTest for everything else). */
public class KeepAlivePolicyCallTest {
    private static final long MIN = 60_000L;
    private static final long HOUR = 60 * MIN;

    private static KeepAlivePolicy.Inputs offScreen(String mode, long sinceStopMs) {
        KeepAlivePolicy.Inputs in = new KeepAlivePolicy.Inputs();
        in.mode = mode;
        in.activityStopped = true;
        in.stoppedAtMs = 24 * HOUR;
        in.nowMs = in.stoppedAtMs + sinceStopMs;
        in.sessionActive = true;
        in.charging = false;
        in.sdkInt = 35;
        return in;
    }

    @Test
    public void aCallKeepsThePageInEveryModeOnBattery() {
        for (String mode : new String[] {"off", "charging", "always"}) {
            KeepAlivePolicy.Inputs in = offScreen(mode, 10 * MIN);
            if (!"always".equals(mode)) {
                // Without the call, off / charging on battery let the page freeze.
                assertFalse(mode, KeepAlivePolicy.shouldKeepVisible(in));
            }
            // "always" on battery holds no wake lock without a call.
            assertFalse(mode, KeepAlivePolicy.shouldHoldWakeLock(in));
            in.callActive = true;
            assertTrue(mode, KeepAlivePolicy.shouldKeepVisible(in));
            assertTrue(mode, KeepAlivePolicy.shouldHoldWakeLock(in));
        }
    }

    @Test
    public void aRingWakesAFrozenPage() {
        KeepAlivePolicy.Inputs in = offScreen("off", 30 * MIN);
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        in.callRinging = true;
        assertTrue(KeepAlivePolicy.shouldKeepVisible(in));
        assertTrue(KeepAlivePolicy.shouldHoldWakeLock(in));
    }

    @Test
    public void onScreenACallHoldsTheCpuButNeedsNoVisibilityOverride() {
        KeepAlivePolicy.Inputs in = offScreen("charging", 0);
        in.activityStopped = false;
        in.callActive = true;
        // The framework shows the page; the proximity sensor may still turn
        // the screen off at the ear.
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        assertTrue(KeepAlivePolicy.shouldHoldWakeLock(in));
    }

    @Test
    public void signedOutOrPausedPagesAreNotKeptForACall() {
        KeepAlivePolicy.Inputs in = offScreen("charging", MIN);
        in.callActive = true;
        in.sessionActive = false;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(in));
        in.sessionActive = true;
        in.suspended = true;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(in));
    }

    @Test
    public void noBatteryPauseDuringACall() {
        KeepAlivePolicy.Inputs in = offScreen("charging", 7 * HOUR);
        assertTrue(KeepAlivePolicy.shouldPauseOnBattery(in));
        in.callActive = true;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        in.callActive = false;
        in.callRinging = true;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
    }

    @Test
    public void withoutACallNothingChanges() {
        KeepAlivePolicy.Inputs in = offScreen("off", 10 * MIN);
        assertFalse(KeepAlivePolicy.callNeedsPage(in));
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(in));
        assertFalse(KeepAlivePolicy.callNeedsPage(null));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(null));
    }
}
