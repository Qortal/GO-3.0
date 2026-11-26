package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NetworkRefreshPacerTest {
    @Test
    public void theFirstRedialWaitsOnlyForTheNetworkToSettle() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        assertEquals(NetworkRefreshPacer.SETTLE_MS, pacer.onSwitch(10_000L, false));
        assertEquals(2_000L, pacer.onRun(12_000L));
    }

    @Test
    public void redialsStayThirtySecondsApart() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onSwitch(10_000L, false);
        pacer.onRun(12_000L);
        // A flaky network switching again 5 s later waits for the window.
        assertEquals(25_000L, pacer.onSwitch(17_000L, false));
        // And again just before the trailing redial: same end of window.
        assertEquals(5_000L, pacer.onSwitch(37_000L, false));
        assertEquals(5_000L, pacer.onRun(42_000L));
    }

    @Test
    public void aSwitchLongAfterTheLastRedialOnlySettles() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onSwitch(10_000L, false);
        pacer.onRun(12_000L);
        assertEquals(NetworkRefreshPacer.SETTLE_MS, pacer.onSwitch(100_000L, false));
    }

    @Test
    public void inACallTheRedialComesAfterHalfASecond() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        assertEquals(500L, pacer.onSwitch(10_000L, true));
        assertEquals(500L, pacer.onRun(10_500L));
    }

    @Test
    public void aSecondSwitchInsideTheSettleTimeIsRedialledToo() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onSwitch(10_000L, true);
        // The caller posts the redial anew, so it runs 0.5 s after this one.
        assertEquals(500L, pacer.onSwitch(10_300L, true));
        assertEquals(500L, pacer.onRun(10_800L));
        // Outside a call just the same, with the longer settle time.
        assertEquals(NetworkRefreshPacer.SETTLE_MS, pacer.onSwitch(100_000L, false));
        assertEquals(NetworkRefreshPacer.SETTLE_MS, pacer.onSwitch(101_500L, false));
        assertEquals(2_000L, pacer.onRun(103_500L));
    }

    @Test
    public void inACallRedialsStayTwoSecondsApart() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onSwitch(10_000L, true);
        pacer.onRun(10_500L);
        // Right after a redial: at the end of the 2 s.
        assertEquals(1_900L, pacer.onSwitch(10_600L, true));
        pacer.onRun(12_500L);
        // Later than that: only the settle time.
        assertEquals(500L, pacer.onSwitch(17_000L, true));
        // 30 s pacing is for the time outside calls.
        pacer.onRun(17_500L);
        assertEquals(25_000L, pacer.onSwitch(22_500L, false));
    }

    @Test
    public void aRedialOutsideACallDoesNotDelayTheOneInACall() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onSwitch(10_000L, false);
        pacer.onRun(12_000L);
        assertEquals(500L, pacer.onSwitch(20_000L, true));
    }

    @Test
    public void inACallTheTimeWithoutANetworkCountsAsSettling() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        // Wi-Fi goes, mobile data is there 0.3 s later.
        pacer.onLost(10_000L);
        assertEquals(200L, pacer.onSwitch(10_300L, true));
        // "How long ago" still counts from the new network.
        assertEquals(200L, pacer.onRun(10_500L));

        // Gone for longer than the settle time: the new network gets a moment.
        pacer.onLost(60_000L);
        assertEquals(100L, pacer.onSwitch(75_000L, true));
        pacer.onRun(75_100L);

        // A loss counts for the switch that follows it, not for later ones.
        assertEquals(500L, pacer.onSwitch(120_000L, true));
        pacer.onRun(120_500L);
        // A second switch while the first waits: half a second from its own.
        pacer.onLost(180_000L);
        assertEquals(300L, pacer.onSwitch(180_200L, true));
        assertEquals(500L, pacer.onSwitch(180_300L, true));
    }

    @Test
    public void outsideACallTheTimeWithoutANetworkDoesNotCount() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onLost(10_000L);
        assertEquals(NetworkRefreshPacer.SETTLE_MS, pacer.onSwitch(30_000L, false));
        // Unless a call begins meanwhile.
        assertEquals(0L, pacer.onCallStart(30_150L));
    }

    @Test
    public void aCallThatBeginsBringsAWaitingRedialForward() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        pacer.onSwitch(10_000L, false);
        pacer.onRun(12_000L);
        assertEquals(25_000L, pacer.onSwitch(17_000L, false));
        // The call begins 8 s later: settled long ago, so at once.
        assertEquals(0L, pacer.onCallStart(25_000L));
        assertEquals(8_000L, pacer.onRun(25_000L));
        // Nothing waits any more.
        assertEquals(-1L, pacer.onCallStart(25_100L));
    }

    @Test
    public void aCallThatBeginsInsideTheSettleTimeWaitsForItsOwn() {
        NetworkRefreshPacer pacer = new NetworkRefreshPacer();
        assertEquals(-1L, pacer.onCallStart(9_000L));
        pacer.onSwitch(10_000L, false);
        assertEquals(300L, pacer.onCallStart(10_200L));
        assertEquals(500L, pacer.onRun(10_500L));
        // A redial that has just run still keeps its 2 s.
        pacer.onSwitch(10_600L, false);
        assertEquals(1_200L, pacer.onCallStart(11_300L));
    }
}
