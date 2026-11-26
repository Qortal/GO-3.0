package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DefaultNetworkSwitchTest {
    private static final long WIFI = 100L;
    private static final long MOBILE = 200L;

    @Test
    public void firstNetworkIsNotASwitch() {
        DefaultNetworkSwitch tracker = new DefaultNetworkSwitch();
        assertFalse(tracker.onAvailable(WIFI));
    }

    @Test
    public void repeatsOfTheCurrentNetworkAreIgnored() {
        DefaultNetworkSwitch tracker = new DefaultNetworkSwitch();
        tracker.onAvailable(WIFI);
        assertFalse(tracker.onAvailable(WIFI));
        // Losing some other network does not touch the default one.
        assertFalse(tracker.onLost(MOBILE));
        assertFalse(tracker.onAvailable(WIFI));
    }

    @Test
    public void wifiToMobileAndBackAreSwitches() {
        DefaultNetworkSwitch tracker = new DefaultNetworkSwitch();
        tracker.onAvailable(WIFI);
        // The new default often arrives before the old one is reported lost.
        assertTrue(tracker.onAvailable(MOBILE));
        assertFalse(tracker.onLost(WIFI));
        assertFalse(tracker.onAvailable(MOBILE));
        assertTrue(tracker.onAvailable(WIFI + 1));
    }

    @Test
    public void theFirstNetworkAfterStartingOfflineIsASwitch() {
        DefaultNetworkSwitch tracker = new DefaultNetworkSwitch();
        tracker.seedNoNetwork();
        assertTrue(tracker.onAvailable(WIFI));
        assertFalse(tracker.onAvailable(WIFI));
    }

    @Test
    public void seedingAfterANetworkWasSeenChangesNothing() {
        DefaultNetworkSwitch tracker = new DefaultNetworkSwitch();
        tracker.onAvailable(WIFI);
        tracker.seedNoNetwork();
        assertFalse(tracker.onAvailable(WIFI));
    }

    @Test
    public void theSameNetworkBackAfterItWasLostIsASwitch() {
        DefaultNetworkSwitch tracker = new DefaultNetworkSwitch();
        assertFalse(tracker.onLost(WIFI));
        tracker.onAvailable(WIFI);
        assertTrue(tracker.onLost(WIFI));
        assertTrue(tracker.onAvailable(WIFI));
        assertFalse(tracker.onAvailable(WIFI));
    }
}
