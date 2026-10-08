package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NetworkRefreshPacerTest {
    @Test
    public void theFirstRedialWaitsOnlyForTheNetworkToSettle() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        assertEquals(NetworkRefreshPacer.SETTLE_MS, pacer.onSwitch(10_000L));
        assertEquals(2_000L, pacer.onRun(12_000L));
    }

    @Test
    public void redialsStayThirtySecondsApart() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onSwitch(10_000L);
        pacer.onRun(12_000L);
        // A flaky network switching again 5 s later waits for the window.
        assertEquals(25_000L, pacer.onSwitch(17_000L));
        // And again just before the trailing redial: same end of window.
        assertEquals(5_000L, pacer.onSwitch(37_000L));
        assertEquals(5_000L, pacer.onRun(42_000L));
    }

    @Test
    public void aSwitchLongAfterTheLastRedialOnlySettles() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onSwitch(10_000L);
        pacer.onRun(12_000L);
        assertEquals(NetworkRefreshPacer.SETTLE_MS, pacer.onSwitch(100_000L));
    }
}
