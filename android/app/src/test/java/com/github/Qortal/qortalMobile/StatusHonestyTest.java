package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class StatusHonestyTest {
    private static final long HIDDEN_AT = 1_000_000L;

    @Test
    public void onScreenIsLive() {
        assertEquals(
            StatusHonesty.LIVE,
            StatusHonesty.resolve(false, false, false, HIDDEN_AT, HIDDEN_AT + 10 * 60_000L)
        );
    }

    @Test
    public void pageGoneIsPausedAtOnceEvenOnScreen() {
        assertEquals(
            StatusHonesty.PAUSED,
            StatusHonesty.resolve(true, false, false, HIDDEN_AT, HIDDEN_AT)
        );
        assertEquals(
            StatusHonesty.PAUSED,
            StatusHonesty.resolve(true, true, true, HIDDEN_AT, HIDDEN_AT)
        );
    }

    @Test
    public void hiddenStaysLiveUntilChromiumHasFrozenThePage() {
        assertEquals(
            StatusHonesty.LIVE,
            StatusHonesty.resolve(false, true, false, HIDDEN_AT, HIDDEN_AT + 60_000L)
        );
        assertEquals(
            StatusHonesty.LIVE,
            StatusHonesty.resolve(false, true, false, HIDDEN_AT, HIDDEN_AT + 65_000L)
        );
        assertEquals(
            StatusHonesty.PAUSED,
            StatusHonesty.resolve(false, true, false, HIDDEN_AT, HIDDEN_AT + 65_001L)
        );
    }

    @Test
    public void keptAwakeOffScreenIsBackgroundNotPaused() {
        assertEquals(
            StatusHonesty.BACKGROUND,
            StatusHonesty.resolve(false, true, true, HIDDEN_AT, HIDDEN_AT + 60 * 60_000L)
        );
    }

    @Test
    public void unknownHiddenTimeNeverPausesEarly() {
        assertEquals(
            StatusHonesty.LIVE,
            StatusHonesty.resolve(false, true, false, -1L, HIDDEN_AT)
        );
    }

    @Test
    public void waitingCountOnlyOffScreen() {
        assertFalse(StatusHonesty.showWaiting(false, false, 3));
        assertTrue(StatusHonesty.showWaiting(false, true, 3));
        assertTrue(StatusHonesty.showWaiting(true, false, 1));
        assertFalse(StatusHonesty.showWaiting(true, true, 0));
    }

    @Test
    public void clampsCounts() {
        assertEquals(0, StatusHonesty.clampCount(-4));
        assertEquals(7, StatusHonesty.clampCount(7));
        assertEquals(StatusHonesty.MAX_COUNT, StatusHonesty.clampCount(Integer.MAX_VALUE));
    }

    @Test
    public void fillsCountPlaceholders() {
        assertEquals(
            "3 messages waiting to send",
            StatusHonesty.fillCount("{{count}} messages waiting to send", 3)
        );
        assertEquals("Warten: 2 (2)", StatusHonesty.fillCount("Warten: {{ count }} ({{count}})", 2));
        assertEquals("No placeholder", StatusHonesty.fillCount("No placeholder", 5));
        assertEquals("", StatusHonesty.fillCount(null, 5));
    }

    @Test
    public void sanitizesLocalizedValues() {
        assertNull(StatusHonesty.sanitize(null));
        assertNull(StatusHonesty.sanitize("   "));
        assertEquals("Chat paused", StatusHonesty.sanitize("  Chat paused "));
        StringBuilder longValue = new StringBuilder();
        for (int i = 0; i < 500; i++) longValue.append('x');
        assertEquals(
            StatusHonesty.MAX_STRING_LENGTH,
            StatusHonesty.sanitize(longValue.toString()).length()
        );
    }

    @Test
    public void acceptsOnlyContractKeys() {
        assertTrue(StatusHonesty.isLocalizedKey("status_paused_title"));
        assertTrue(StatusHonesty.isLocalizedKey("status_paused_text"));
        assertTrue(StatusHonesty.isLocalizedKey("status_waiting_text"));
        assertTrue(StatusHonesty.isLocalizedKey("fgs_timeout_title"));
        assertTrue(StatusHonesty.isLocalizedKey("fgs_timeout_text"));
        assertTrue(StatusHonesty.isLocalizedKey("status_syncing_background"));
        assertFalse(StatusHonesty.isLocalizedKey("app_name"));
        assertFalse(StatusHonesty.isLocalizedKey(null));
    }

    @Test
    public void joinsOptionalSecondLine() {
        assertEquals("a", StatusHonesty.joinLines("a", null));
        assertEquals("a\nb", StatusHonesty.joinLines("a", "b"));
        assertEquals("b", StatusHonesty.joinLines("", "b"));
    }

    /**
     * Mirrors BackgroundKeepAlive: stoppedAtMs, keepAliveEndedAtMs and the
     * keep-alive rule evaluated at given instants, then the status resolved.
     */
    private static final class PageClock {
        final KeepAlivePolicy.Inputs in = new KeepAlivePolicy.Inputs();
        boolean keepAliveActive;
        long keepAliveEndedAtMs = -1L;

        PageClock(String mode) {
            in.mode = mode;
            in.sessionActive = true;
        }

        void stop(long now) {
            in.activityStopped = true;
            in.stoppedAtMs = now;
            evaluate(now);
        }

        void evaluate(long now) {
            in.nowMs = now;
            boolean keep = KeepAlivePolicy.shouldKeepVisible(in);
            keepAliveEndedAtMs =
                StatusHonesty.keepAliveEndedAt(keepAliveActive, keep, keepAliveEndedAtMs, now);
            keepAliveActive = keep;
        }

        String status(long now) {
            return StatusHonesty.resolve(
                false,
                in.activityStopped,
                keepAliveActive,
                StatusHonesty.hiddenSince(in.stoppedAtMs, keepAliveEndedAtMs),
                now
            );
        }
    }

    @Test
    public void hiddenSinceIsTheLaterOfStopAndKeepAliveEnd() {
        assertEquals(500L, StatusHonesty.hiddenSince(500L, -1L));
        assertEquals(900L, StatusHonesty.hiddenSince(500L, 900L));
        assertEquals(500L, StatusHonesty.hiddenSince(500L, 100L));
    }

    @Test
    public void keepAliveEndIsRecordedOnlyOnTheOnToOffEdge() {
        assertEquals(700L, StatusHonesty.keepAliveEndedAt(true, false, -1L, 700L));
        assertEquals(-1L, StatusHonesty.keepAliveEndedAt(false, false, -1L, 700L));
        assertEquals(300L, StatusHonesty.keepAliveEndedAt(true, true, 300L, 700L));
        assertEquals(300L, StatusHonesty.keepAliveEndedAt(false, true, 300L, 700L));
    }

    @Test
    public void outboxWindowEndDelaysPausedBy65Seconds() {
        PageClock clock = new PageClock(KeepAlivePolicy.MODE_CHARGING);
        clock.in.outboxPending = true;
        clock.stop(HIDDEN_AT);
        assertEquals(StatusHonesty.BACKGROUND, clock.status(HIDDEN_AT + 100_000L));
        // The deadline evaluation right when the 3-minute window closes.
        long windowEnd = HIDDEN_AT + KeepAlivePolicy.OUTBOX_WINDOW_MS;
        clock.evaluate(windowEnd);
        assertFalse(clock.keepAliveActive);
        assertEquals(StatusHonesty.LIVE, clock.status(windowEnd + 1L));
        assertEquals(StatusHonesty.LIVE, clock.status(HIDDEN_AT + 245_000L));
        assertEquals(StatusHonesty.PAUSED, clock.status(HIDDEN_AT + 245_001L));
    }

    @Test
    public void unplugAfterChargerKeepAlivePausesOnly65SecondsLater() {
        PageClock clock = new PageClock(KeepAlivePolicy.MODE_CHARGING);
        clock.stop(HIDDEN_AT);
        assertEquals(StatusHonesty.PAUSED, clock.status(HIDDEN_AT + 65_001L));
        // Charger plugged in after Chromium froze the page: kept awake again.
        clock.in.charging = true;
        clock.evaluate(HIDDEN_AT + 100_000L);
        assertEquals(StatusHonesty.BACKGROUND, clock.status(HIDDEN_AT + 100_000L));
        long unplug = HIDDEN_AT + 400_000L;
        clock.in.charging = false;
        clock.evaluate(unplug);
        assertEquals(StatusHonesty.LIVE, clock.status(unplug + 1L));
        assertEquals(StatusHonesty.LIVE, clock.status(unplug + 65_000L));
        assertEquals(StatusHonesty.PAUSED, clock.status(unplug + 65_001L));
    }

    @Test
    public void stopWithoutKeepAlivePausesAfter65Seconds() {
        PageClock clock = new PageClock(KeepAlivePolicy.MODE_OFF);
        clock.in.outboxPending = true;
        clock.stop(HIDDEN_AT);
        assertFalse(clock.keepAliveActive);
        assertEquals(StatusHonesty.LIVE, clock.status(HIDDEN_AT + 65_000L));
        assertEquals(StatusHonesty.PAUSED, clock.status(HIDDEN_AT + 65_001L));
    }

    @Test
    public void earlierKeepAliveEndOnScreenDoesNotMoveTheNextStop() {
        PageClock clock = new PageClock(KeepAlivePolicy.MODE_ALWAYS);
        clock.stop(HIDDEN_AT);
        assertTrue(clock.keepAliveActive);
        // Back on screen: keep-alive ends while visible.
        clock.in.activityStopped = false;
        clock.evaluate(HIDDEN_AT + 10_000L);
        // Mode changed to off, then GO leaves the screen again later.
        clock.in.mode = KeepAlivePolicy.MODE_OFF;
        long secondStop = HIDDEN_AT + 50_000L;
        clock.stop(secondStop);
        assertEquals(StatusHonesty.LIVE, clock.status(secondStop + 65_000L));
        assertEquals(StatusHonesty.PAUSED, clock.status(secondStop + 65_001L));
    }
}
