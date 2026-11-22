package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The background player in KeepAlivePolicy (see KeepAlivePolicyTest for everything else). */
public class KeepAlivePolicyMediaTest {
    private static final long MIN = 60_000L;
    private static final long HOUR = 60 * MIN;

    private static KeepAlivePolicy.Inputs offScreen(String mode) {
        KeepAlivePolicy.Inputs in = new KeepAlivePolicy.Inputs();
        in.mode = mode;
        in.activityStopped = true;
        in.stoppedAtMs = 24 * HOUR;
        in.nowMs = in.stoppedAtMs + 10 * MIN;
        in.sessionActive = true;
        in.pageAttached = true;
        in.sdkInt = 35;
        return in;
    }

    @Test
    public void playingMediaKeepsThePageInEveryMode() {
        for (String mode : new String[] {"off", "charging", "always"}) {
            KeepAlivePolicy.Inputs in = offScreen(mode);
            in.mediaPlaying = true;
            assertTrue(mode, KeepAlivePolicy.shouldKeepVisible(in));
            // Media takes its own wake lock (GoMediaHub); on battery this one stays off.
            assertFalse(mode, KeepAlivePolicy.shouldHoldWakeLock(in));
        }
    }

    @Test
    public void mediaPlaysOnThroughGosBatteryPauseAndWithoutASignedInSession() {
        KeepAlivePolicy.Inputs in = offScreen("off");
        in.suspended = true;
        in.sessionActive = false;
        in.mediaPlaying = true;
        assertTrue(KeepAlivePolicy.shouldKeepVisible(in));
    }

    @Test
    public void aPlayerButtonWakesAFrozenPageForAMoment() {
        KeepAlivePolicy.Inputs in = offScreen("off");
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        in.mediaWake = true;
        assertTrue(KeepAlivePolicy.shouldKeepVisible(in));
    }

    @Test
    public void noPageNoOverride() {
        KeepAlivePolicy.Inputs in = offScreen("always");
        in.pageAttached = false;
        in.sessionActive = false;
        in.mediaPlaying = true;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
    }

    @Test
    public void onScreenTheFrameworkOwnsVisibility() {
        KeepAlivePolicy.Inputs in = offScreen("off");
        in.activityStopped = false;
        in.mediaPlaying = true;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
    }
}
