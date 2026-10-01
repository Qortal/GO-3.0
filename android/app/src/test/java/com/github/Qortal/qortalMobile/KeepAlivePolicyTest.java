package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class KeepAlivePolicyTest {
    private static final long MIN = 60_000L;

    private static KeepAlivePolicy.Inputs background(String mode, long sinceStopMs) {
        KeepAlivePolicy.Inputs in = new KeepAlivePolicy.Inputs();
        in.mode = mode;
        in.activityStopped = true;
        in.stoppedAtMs = 1_000_000L;
        in.nowMs = in.stoppedAtMs + sinceStopMs;
        in.sessionActive = true;
        return in;
    }

    @Test
    public void usesTheUncappedServiceTypeOnlyWhileSyncRunsContinuously() {
        String dataSync = KeepAlivePolicy.SERVICE_TYPE_DATA_SYNC;
        String messaging = KeepAlivePolicy.SERVICE_TYPE_REMOTE_MESSAGING;
        // Android 14+: always, or charging while charging.
        assertEquals(messaging, KeepAlivePolicy.foregroundServiceType("always", false, 34));
        assertEquals(messaging, KeepAlivePolicy.foregroundServiceType("always", true, 36));
        assertEquals(messaging, KeepAlivePolicy.foregroundServiceType("charging", true, 35));
        // Default mode (unset) is charging.
        assertEquals(messaging, KeepAlivePolicy.foregroundServiceType(null, true, 35));
        // On battery the daily limit stays as a safety net.
        assertEquals(dataSync, KeepAlivePolicy.foregroundServiceType("charging", false, 35));
        assertEquals(dataSync, KeepAlivePolicy.foregroundServiceType("off", true, 35));
        assertEquals(dataSync, KeepAlivePolicy.foregroundServiceType("off", false, 36));
        // Before Android 14 remoteMessaging does not exist.
        assertEquals(dataSync, KeepAlivePolicy.foregroundServiceType("always", true, 33));
        assertEquals(dataSync, KeepAlivePolicy.foregroundServiceType("charging", true, 29));
    }

    @Test
    public void parsesModesAndDefaultsToCharging() {
        assertEquals("off", KeepAlivePolicy.parseMode(" OFF "));
        assertEquals("always", KeepAlivePolicy.parseMode("always"));
        assertNull(KeepAlivePolicy.parseMode("sometimes"));
        assertNull(KeepAlivePolicy.parseMode(null));
        assertEquals("charging", KeepAlivePolicy.modeOrDefault(null));
        assertEquals("charging", KeepAlivePolicy.modeOrDefault("bogus"));
        assertEquals("off", KeepAlivePolicy.modeOrDefault("off"));
    }

    @Test
    public void neverKeepsAliveOnScreenOrSignedOutOrSuspended() {
        KeepAlivePolicy.Inputs in = background("always", 0);
        in.activityStopped = false;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));

        in = background("always", 0);
        in.sessionActive = false;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));

        in = background("always", 0);
        in.suspended = true;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(in));
    }

    @Test
    public void chargingModeKeepsAliveOnlyOnTheCharger() {
        KeepAlivePolicy.Inputs in = background("charging", 30 * MIN);
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        in.charging = true;
        assertTrue(KeepAlivePolicy.shouldKeepVisible(in));
        assertTrue(KeepAlivePolicy.shouldHoldWakeLock(in));
    }

    @Test
    public void alwaysModeOnBatteryHoldsNoWakeLock() {
        KeepAlivePolicy.Inputs in = background("always", 30 * MIN);
        assertTrue(KeepAlivePolicy.shouldKeepVisible(in));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(in));
        in.charging = true;
        assertTrue(KeepAlivePolicy.shouldHoldWakeLock(in));
    }

    @Test
    public void offModeNeverKeepsAliveEvenWithPendingOutbox() {
        KeepAlivePolicy.Inputs in = background("off", 10_000L);
        in.charging = true;
        in.outboxPending = true;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(in));
        assertFalse(KeepAlivePolicy.outboxWindowActive(in));
    }

    @Test
    public void outboxWindowLastsThreeMinutesAfterLeavingTheScreen() {
        KeepAlivePolicy.Inputs in = background("charging", 2 * MIN);
        in.outboxPending = true;
        assertTrue(KeepAlivePolicy.shouldKeepVisible(in));
        assertTrue(KeepAlivePolicy.shouldHoldWakeLock(in));
        assertEquals(MIN, KeepAlivePolicy.msUntilOutboxWindowEnds(in));

        in.nowMs = in.stoppedAtMs + 3 * MIN;
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(in));
        assertEquals(-1L, KeepAlivePolicy.msUntilOutboxWindowEnds(in));

        // Nothing pending: no window at all.
        in = background("charging", 10_000L);
        assertFalse(KeepAlivePolicy.shouldKeepVisible(in));
        assertEquals(-1L, KeepAlivePolicy.msUntilOutboxWindowEnds(in));
    }

    @Test
    public void outboxWindowAppliesInAlwaysModeOnBattery() {
        KeepAlivePolicy.Inputs in = background("always", 10_000L);
        in.outboxPending = true;
        assertTrue(KeepAlivePolicy.shouldHoldWakeLock(in));
        in.nowMs = in.stoppedAtMs + 4 * MIN;
        assertTrue(KeepAlivePolicy.shouldKeepVisible(in));
        assertFalse(KeepAlivePolicy.shouldHoldWakeLock(in));
    }

    @Test
    public void relayProfileNeedsTwoStableMinutesAndDropsAtOnce() {
        KeepAlivePolicy.RelayProfileTracker tracker = new KeepAlivePolicy.RelayProfileTracker();
        assertEquals("leaf", tracker.profile());
        assertNull(tracker.update(true, false, 0L));
        assertEquals(-1L, tracker.msUntilFull(0L));

        assertNull(tracker.update(true, true, 1_000L));
        assertEquals(2 * MIN, tracker.msUntilFull(1_000L));
        assertNull(tracker.update(true, true, 1_000L + 2 * MIN - 1));
        assertEquals("full", tracker.update(true, true, 1_000L + 2 * MIN));
        assertEquals("full", tracker.profile());
        assertNull(tracker.update(true, true, 1_000L + 5 * MIN));
        assertEquals(-1L, tracker.msUntilFull(1_000L + 5 * MIN));

        // Unplugged: leaf immediately.
        assertEquals("leaf", tracker.update(false, true, 1_000L + 6 * MIN));
        assertNull(tracker.update(false, true, 1_000L + 7 * MIN));

        // A metered blip restarts the two minutes.
        long t = 20 * MIN;
        assertNull(tracker.update(true, true, t));
        assertNull(tracker.update(true, false, t + MIN));
        assertNull(tracker.update(true, true, t + MIN + 1));
        assertNull(tracker.update(true, true, t + 2 * MIN + 10));
        assertEquals("full", tracker.update(true, true, t + 3 * MIN + 1));
        assertEquals("leaf", tracker.update(true, false, t + 3 * MIN + 2));
    }

    @Test
    public void statusUpdateFromSignedOutPageIsRefused() {
        // A start marks the session itself; an update needs one.
        assertTrue(KeepAlivePolicy.acceptsStatusPush(true, false));
        assertTrue(KeepAlivePolicy.acceptsStatusPush(true, true));
        assertTrue(KeepAlivePolicy.acceptsStatusPush(false, true));
        // A throttled update landing after logout must not restart the service.
        assertFalse(KeepAlivePolicy.acceptsStatusPush(false, false));
    }

    @Test
    public void onlyLeafIsAppliedNatively() {
        assertEquals(
            "{\"type\":\"cmd\",\"action\":\"configure_overlay_profile\","
                + "\"payload\":{\"profile\":\"leaf\"}}",
            KeepAlivePolicy.nativeOverlayProfileFrame("leaf"));
        assertNull(KeepAlivePolicy.nativeOverlayProfileFrame("full"));
        assertNull(KeepAlivePolicy.nativeOverlayProfileFrame(null));
    }

    @Test
    public void vendorFreezeCountsOnlyGapsWhileWatching() {
        KeepAlivePolicy.VendorFreezeDetector detector = new KeepAlivePolicy.VendorFreezeDetector();
        long t = 5_000_000L;
        // Not watching: long gaps are normal CPU sleep.
        assertFalse(detector.onTick(t, false));
        assertFalse(detector.onTick(t + 10 * MIN, false));

        // Wake lock taken, then regular 25 s ticks.
        detector.arm(t + 10 * MIN);
        assertFalse(detector.onTick(t + 10 * MIN + 25_000L, true));
        assertFalse(detector.onTick(t + 10 * MIN + 50_000L, true));
        // A 5-minute hole while watching is a freeze.
        assertTrue(detector.onTick(t + 15 * MIN + 50_000L, true));
        // Next regular tick measures from the late one.
        assertFalse(detector.onTick(t + 15 * MIN + 75_000L, true));

        // Released: the gap across the release is not counted.
        detector.disarm();
        assertFalse(detector.onTick(t + 30 * MIN, true));
        // Watching resumed on that tick; a regular tick next.
        assertFalse(detector.onTick(t + 30 * MIN + 25_000L, true));

        // A tick seen while not watching stops the measurement.
        assertFalse(detector.onTick(t + 31 * MIN, false));
        assertFalse(detector.onTick(t + 40 * MIN, true));

        // Exactly the limit is not a freeze; one ms beyond is.
        detector.arm(0L);
        assertFalse(detector.onTick(KeepAlivePolicy.VENDOR_FREEZE_GAP_MS, true));
        assertTrue(detector.onTick(2 * KeepAlivePolicy.VENDOR_FREEZE_GAP_MS + 1, true));
    }
}
