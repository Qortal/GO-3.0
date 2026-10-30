package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
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
    public void runsAsRemoteMessagingFromAndroid14InEveryMode() {
        String dataSync = KeepAlivePolicy.SERVICE_TYPE_DATA_SYNC;
        String messaging = KeepAlivePolicy.SERVICE_TYPE_REMOTE_MESSAGING;
        // Android 14+: no dataSync daily limit to hit, whatever the mode or
        // charger (the type no longer depends on either).
        assertEquals(messaging, KeepAlivePolicy.foregroundServiceType(34));
        assertEquals(messaging, KeepAlivePolicy.foregroundServiceType(35));
        assertEquals(messaging, KeepAlivePolicy.foregroundServiceType(36));
        // Before Android 14 remoteMessaging does not exist (and dataSync has
        // no time limit there).
        assertEquals(dataSync, KeepAlivePolicy.foregroundServiceType(33));
        assertEquals(dataSync, KeepAlivePolicy.foregroundServiceType(29));
        assertEquals(dataSync, KeepAlivePolicy.foregroundServiceType(24));
    }

    private static final long HOUR = 60 * MIN;

    /** Off screen on battery since {@code sinceStopMs} ago, no unplug seen, Android 15. */
    private static KeepAlivePolicy.Inputs onBattery(String mode, long sinceStopMs) {
        KeepAlivePolicy.Inputs in = background(mode, sinceStopMs);
        // A day after boot, so earlier unplugs stay positive like real
        // elapsedRealtime values.
        in.stoppedAtMs = 24 * HOUR;
        in.nowMs = in.stoppedAtMs + sinceStopMs;
        in.charging = false;
        in.sdkInt = 35;
        return in;
    }

    @Test
    public void pausesOnBatteryOnlyFromAndroid15() {
        assertEquals(35, KeepAlivePolicy.DATA_SYNC_TIME_LIMIT_MIN_SDK);
        // Android 15+: GO gave up Android's dataSync limit, its own applies.
        for (int sdk : new int[] {35, 36}) {
            KeepAlivePolicy.Inputs in = onBattery("charging", 6 * HOUR);
            in.sdkInt = sdk;
            assertTrue(String.valueOf(sdk), KeepAlivePolicy.shouldPauseOnBattery(in));
            in.nowMs -= 1;
            assertFalse(String.valueOf(sdk), KeepAlivePolicy.shouldPauseOnBattery(in));
        }
        // Android 14 and older never had a limit: nothing changes there,
        // however long GO stays off screen on battery. 0 = unknown.
        for (int sdk : new int[] {34, 33, 29, 26, 0}) {
            KeepAlivePolicy.Inputs in = onBattery("charging", 24 * HOUR);
            in.sdkInt = sdk;
            assertFalse(String.valueOf(sdk), KeepAlivePolicy.shouldPauseOnBattery(in));
            in.mode = "off";
            assertFalse(String.valueOf(sdk), KeepAlivePolicy.shouldPauseOnBattery(in));
        }
    }

    @Test
    public void batteryPercentFromLevelAndScale() {
        assertEquals(50, KeepAlivePolicy.batteryPercent(50, 100));
        assertEquals(50, KeepAlivePolicy.batteryPercent(128, 255));
        assertEquals(100, KeepAlivePolicy.batteryPercent(100, 100));
        assertEquals(100, KeepAlivePolicy.batteryPercent(150, 100));
        assertEquals(0, KeepAlivePolicy.batteryPercent(0, 100));
        assertEquals(-1, KeepAlivePolicy.batteryPercent(-1, 100));
        assertEquals(-1, KeepAlivePolicy.batteryPercent(50, 0));
        assertEquals(-1, KeepAlivePolicy.batteryPercent(50, -1));
    }

    @Test
    public void trackerRecordsOnlyRealUnplugs() {
        // GO started on battery: no unplug seen, the stretch counts from
        // leaving the screen.
        KeepAlivePolicy.BatteryStretchTracker t = new KeepAlivePolicy.BatteryStretchTracker(false);
        assertFalse(t.charging());
        assertEquals(-1L, t.unpluggedAtMs());
        assertFalse(t.onCharging(false, 10 * MIN));
        assertEquals(-1L, t.unpluggedAtMs());

        // Plugged in: an edge, but not an unplug.
        assertTrue(t.onCharging(true, 20 * MIN));
        assertTrue(t.charging());
        assertEquals(-1L, t.unpluggedAtMs());
        assertFalse(t.onCharging(true, 21 * MIN));

        // Unplugged: the time of that first reading.
        assertTrue(t.onCharging(false, 30 * MIN));
        assertEquals(30 * MIN, t.unpluggedAtMs());
        // Every later tick reads "unplugged" again: the first time stays.
        assertFalse(t.onCharging(false, 31 * MIN));
        assertFalse(t.onCharging(false, 5 * HOUR));
        assertEquals(30 * MIN, t.unpluggedAtMs());

        // Plug in, unplug: the start moves to the new unplug.
        assertTrue(t.onCharging(true, 6 * HOUR));
        assertEquals(30 * MIN, t.unpluggedAtMs());
        assertTrue(t.onCharging(false, 7 * HOUR));
        assertEquals(7 * HOUR, t.unpluggedAtMs());
    }

    @Test
    public void disconnectWhileAlreadyOnBatteryCountsAsAnUnplugNow() {
        // GO was frozen through the plug-in; Android delivered only the
        // disconnect (or a tick read the unplug first).
        KeepAlivePolicy.BatteryStretchTracker t = new KeepAlivePolicy.BatteryStretchTracker(false);
        assertFalse(t.onPowerDisconnected(9 * HOUR));
        assertFalse(t.charging());
        assertEquals(9 * HOUR, t.unpluggedAtMs());
        // From charging it is an ordinary unplug (and an edge).
        assertTrue(t.onCharging(true, 10 * HOUR));
        assertTrue(t.onPowerDisconnected(11 * HOUR));
        assertFalse(t.charging());
        assertEquals(11 * HOUR, t.unpluggedAtMs());
    }

    @Test
    public void risingBatteryLevelShowsAChargeGoDidNotSee() {
        KeepAlivePolicy.BatteryStretchTracker t = new KeepAlivePolicy.BatteryStretchTracker(false);
        assertFalse(t.onLevel(50, 1 * MIN));
        assertFalse(t.onLevel(45, 2 * MIN));
        // One point up is gauge noise.
        assertFalse(t.onLevel(46, 3 * MIN));
        assertEquals(-1L, t.unpluggedAtMs());
        // Two points over the lowest (45): it charged; unplugged "now".
        assertTrue(t.onLevel(47, 4 * MIN));
        assertEquals(4 * MIN, t.unpluggedAtMs());
        // The new level is the new baseline.
        assertFalse(t.onLevel(47, 5 * MIN));
        assertFalse(t.onLevel(46, 6 * MIN));
        assertEquals(4 * MIN, t.unpluggedAtMs());
        // Unknown level: ignored.
        assertFalse(t.onLevel(-1, 7 * MIN));

        // While charging the level rises with nothing missed.
        assertTrue(t.onCharging(true, 8 * MIN));
        assertFalse(t.onLevel(60, 9 * MIN));
        assertFalse(t.onLevel(90, 10 * MIN));
        // After a seen unplug the baseline starts afresh at the next level.
        assertTrue(t.onCharging(false, 11 * MIN));
        assertFalse(t.onLevel(90, 12 * MIN));
        assertFalse(t.onLevel(89, 13 * MIN));
        assertEquals(11 * MIN, t.unpluggedAtMs());
        // A disconnect resets the baseline too.
        assertFalse(t.onPowerDisconnected(14 * MIN));
        assertFalse(t.onLevel(95, 15 * MIN));
        assertEquals(14 * MIN, t.unpluggedAtMs());
    }

    /**
     * The overnight case: off screen at 21:00 on battery,
     * plugged in at 23:00 and unplugged at 07:00 while vivo held GO frozen,
     * screen on at 07:30. The first tick after the thaw reads "unplugged"
     * (no edge) before any queued power broadcast runs; the level shows the
     * charge, so GO does not pause, and only 6 h after that does it.
     */
    @Test
    public void chargeMissedWhileFrozenDoesNotTriggerThePause() {
        long h21 = 21 * HOUR;
        KeepAlivePolicy.BatteryStretchTracker t = new KeepAlivePolicy.BatteryStretchTracker(false);
        assertFalse(t.onLevel(50, h21));
        long h0730 = h21 + 10 * HOUR + 30 * MIN;
        assertFalse(t.onCharging(false, h0730));
        assertTrue(t.onLevel(98, h0730));

        KeepAlivePolicy.Inputs in = onBattery("charging", 0);
        in.stoppedAtMs = h21;
        in.nowMs = h0730;
        in.unpluggedAtMs = t.unpluggedAtMs();
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        in.nowMs = h0730 + 6 * HOUR;
        assertTrue(KeepAlivePolicy.shouldPauseOnBattery(in));

        // Without the level sign (a brief top-up), the late disconnect does
        // the same once it runs (the pause check waits for it).
        t = new KeepAlivePolicy.BatteryStretchTracker(false);
        assertFalse(t.onLevel(50, h21));
        assertFalse(t.onCharging(false, h0730));
        assertFalse(t.onLevel(49, h0730));
        in.nowMs = h0730;
        in.unpluggedAtMs = t.unpluggedAtMs();
        assertTrue(KeepAlivePolicy.shouldPauseOnBattery(in));
        t.onPowerDisconnected(h0730 + 1);
        in.unpluggedAtMs = t.unpluggedAtMs();
        in.nowMs = h0730 + 2_000L;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
    }

    @Test
    public void pausesAfterSixHoursOffScreenOnBattery() {
        assertEquals(6 * HOUR, KeepAlivePolicy.PAUSE_ON_BATTERY_AFTER_MS);
        // Default mode and mode off alike.
        for (String mode : new String[] {"charging", "off", null, "bogus"}) {
            assertFalse(String.valueOf(mode),
                KeepAlivePolicy.shouldPauseOnBattery(onBattery(mode, 5 * HOUR)));
            assertFalse(String.valueOf(mode),
                KeepAlivePolicy.shouldPauseOnBattery(onBattery(mode, 6 * HOUR - 1)));
            // Exactly six hours is enough.
            assertTrue(String.valueOf(mode),
                KeepAlivePolicy.shouldPauseOnBattery(onBattery(mode, 6 * HOUR)));
            assertTrue(String.valueOf(mode),
                KeepAlivePolicy.shouldPauseOnBattery(onBattery(mode, 10 * HOUR)));
        }
        KeepAlivePolicy.Inputs in = onBattery("charging", 6 * HOUR);
        assertEquals(in.stoppedAtMs, KeepAlivePolicy.batteryStretchStartMs(in));
        // The session does not matter: the status service is what is capped.
        in.sessionActive = false;
        assertTrue(KeepAlivePolicy.shouldPauseOnBattery(in));
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(null));
    }

    @Test
    public void neverPausesOnScreenOnTheChargerOrInModeAlways() {
        // On screen.
        KeepAlivePolicy.Inputs in = onBattery("charging", 8 * HOUR);
        in.activityStopped = false;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        assertEquals(-1L, KeepAlivePolicy.batteryStretchStartMs(in));

        // Charging.
        in = onBattery("off", 8 * HOUR);
        in.charging = true;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        assertEquals(-1L, KeepAlivePolicy.batteryStretchStartMs(in));

        // Mode always: the user asked for it to keep running.
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(onBattery("always", 24 * HOUR)));
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(onBattery(" ALWAYS ", 24 * HOUR)));

        // Already paused: not again (once per stretch).
        in = onBattery("charging", 8 * HOUR);
        in.suspended = true;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
    }

    @Test
    public void batteryStretchStartsAtTheLaterOfLeavingTheScreenAndUnplugging() {
        // Left the screen 8 h ago on the charger, unplugged 5 h ago: 5 h on
        // battery so far.
        KeepAlivePolicy.Inputs in = onBattery("charging", 8 * HOUR);
        in.unpluggedAtMs = in.nowMs - 5 * HOUR;
        assertEquals(in.unpluggedAtMs, KeepAlivePolicy.batteryStretchStartMs(in));
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        // Six hours after the unplug.
        in.nowMs = in.unpluggedAtMs + 6 * HOUR;
        assertTrue(KeepAlivePolicy.shouldPauseOnBattery(in));

        // Unplugged before leaving the screen: measured from leaving it.
        in = onBattery("charging", 5 * HOUR);
        in.unpluggedAtMs = in.stoppedAtMs - 3 * HOUR;
        assertEquals(in.stoppedAtMs, KeepAlivePolicy.batteryStretchStartMs(in));
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
    }

    @Test
    public void pluggingInOrComingOnScreenStartsTheStretchAgain() {
        // 5 h off screen on battery, then plugged in for a while: no pause.
        KeepAlivePolicy.Inputs in = onBattery("charging", 5 * HOUR);
        in.charging = true;
        in.nowMs += 2 * HOUR;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        // Unplugged again: the six hours start from that unplug, not from
        // leaving the screen 7 h ago.
        in.charging = false;
        in.unpluggedAtMs = in.nowMs;
        in.nowMs += 5 * HOUR;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        in.nowMs = in.unpluggedAtMs + 6 * HOUR;
        assertTrue(KeepAlivePolicy.shouldPauseOnBattery(in));

        // 5 h off screen on battery, then GO on screen: no pause.
        in = onBattery("off", 5 * HOUR);
        in.activityStopped = false;
        in.nowMs += 2 * HOUR;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        // Off screen again: the six hours start from leaving the screen again.
        in.activityStopped = true;
        in.stoppedAtMs = in.nowMs;
        in.nowMs += 5 * HOUR;
        assertFalse(KeepAlivePolicy.shouldPauseOnBattery(in));
        in.nowMs = in.stoppedAtMs + 6 * HOUR;
        assertTrue(KeepAlivePolicy.shouldPauseOnBattery(in));
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

    @Test
    public void vendorFreezeGapIsReportedOnlyForAFreeze() {
        KeepAlivePolicy.VendorFreezeDetector detector = new KeepAlivePolicy.VendorFreezeDetector();
        long t = 7_000_000L;
        // Not watching, or nothing measured yet: no gap.
        assertEquals(-1L, detector.onTickGap(t, false));
        assertEquals(-1L, detector.onTickGap(t + 20 * MIN, true));

        // Regular tick: no gap.
        assertEquals(-1L, detector.onTickGap(t + 20 * MIN + 25_000L, true));
        // A 12-minute hole: the gap since the last watched tick.
        long late = t + 32 * MIN + 25_000L;
        assertEquals(12 * MIN, detector.onTickGap(late, true));
        // Measured again from the late tick.
        assertEquals(-1L, detector.onTickGap(late + 25_000L, true));

        // Exactly the limit is no freeze; one ms beyond reports that gap.
        detector.arm(0L);
        assertEquals(-1L, detector.onTickGap(KeepAlivePolicy.VENDOR_FREEZE_GAP_MS, true));
        assertEquals(
            KeepAlivePolicy.VENDOR_FREEZE_GAP_MS + 1,
            detector.onTickGap(2 * KeepAlivePolicy.VENDOR_FREEZE_GAP_MS + 1, true));

        // Disarmed (wake lock released): the hole across it is not a freeze.
        detector.disarm();
        assertEquals(-1L, detector.onTickGap(10 * KeepAlivePolicy.VENDOR_FREEZE_GAP_MS, true));

        // A tick while not watching drops the measurement.
        assertEquals(-1L, detector.onTickGap(10 * KeepAlivePolicy.VENDOR_FREEZE_GAP_MS + 1, false));
        assertEquals(-1L, detector.onTickGap(30 * KeepAlivePolicy.VENDOR_FREEZE_GAP_MS, true));
    }

    @Test
    public void plugTypeNamesForCopyDiagnostics() {
        assertEquals("none", KeepAlivePolicy.plugTypeName(0));
        assertEquals("ac", KeepAlivePolicy.plugTypeName(1));
        assertEquals("usb", KeepAlivePolicy.plugTypeName(2));
        assertEquals("wireless", KeepAlivePolicy.plugTypeName(4));
        assertEquals("dock", KeepAlivePolicy.plugTypeName(8));
        // A value a newer Android adds, or a vendor combination.
        assertEquals("other", KeepAlivePolicy.plugTypeName(16));
        assertEquals("other", KeepAlivePolicy.plugTypeName(3));
        // EXTRA_PLUGGED missing (getIntExtra default -1).
        assertEquals("unknown", KeepAlivePolicy.plugTypeName(-1));
    }

    @Test
    public void vendorBatteryPageOnlyForVivoAndIqoo() {
        for (String maker : new String[] {"vivo", "VIVO", " Vivo ", "iQOO", "iqoo"}) {
            KeepAlivePolicy.VendorBatteryIntentSpec spec =
                KeepAlivePolicy.vendorBatteryIntentSpec(maker);
            assertNotNull(maker, spec);
            assertEquals("com.iqoo.powersaving", spec.packageName);
            assertEquals("com.iqoo.powersaving.PowerManagerSettingsActivity.search", spec.action);
        }
        for (String maker : new String[] {
            null, "", "  ", "Xiaomi", "samsung", "OPPO", "OnePlus", "HUAWEI", "Google", "vivo2", "vivoo"
        }) {
            assertNull(String.valueOf(maker), KeepAlivePolicy.vendorBatteryIntentSpec(maker));
        }
    }
}
