package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import org.junit.Test;

public class MediaPlayerPolicyTest {

    // ── Settings ────────────────────────────────────────────────────────────

    @Test
    public void defaultsKeepAudioAndVideoPlayingOffScreen() {
        MediaPlayerPolicy.Settings s = new MediaPlayerPolicy.Settings();
        assertTrue(s.backgroundAudio);
        assertTrue(s.backgroundVideo);
        assertFalse(s.pauseOnScreenLock);
        assertTrue(s.resumeOnReturn);
        assertTrue(s.lockScreen);
        assertTrue(s.logoOnCover);
        assertTrue(s.pauseOnNoisy);
        assertEquals(10, s.seekStepSec);
        assertEquals(30, s.closePausedAfterMin);
        assertFalse(MediaPlayerPolicy.shouldPauseOnLeave(s, false, false));
        assertFalse(MediaPlayerPolicy.shouldPauseOnLeave(s, true, false));
        assertFalse(MediaPlayerPolicy.shouldPauseOnLeave(s, true, true));
    }

    @Test
    public void audioAndVideoFollowTheirOwnSwitch() {
        MediaPlayerPolicy.Settings s = new MediaPlayerPolicy.Settings();
        s.backgroundVideo = false;
        assertTrue(MediaPlayerPolicy.shouldPauseOnLeave(s, true, false));
        assertFalse(MediaPlayerPolicy.shouldPauseOnLeave(s, false, false));
        s.backgroundVideo = true;
        s.backgroundAudio = false;
        assertFalse(MediaPlayerPolicy.shouldPauseOnLeave(s, true, false));
        assertTrue(MediaPlayerPolicy.shouldPauseOnLeave(s, false, false));
    }

    @Test
    public void screenLockPausesEverythingWhenAskedTo() {
        MediaPlayerPolicy.Settings s = new MediaPlayerPolicy.Settings();
        s.pauseOnScreenLock = true;
        assertTrue(MediaPlayerPolicy.shouldPauseOnLeave(s, false, true));
        assertTrue(MediaPlayerPolicy.shouldPauseOnLeave(s, true, true));
        // Home or another app with the screen on: the switches decide.
        assertFalse(MediaPlayerPolicy.shouldPauseOnLeave(s, false, false));
    }

    @Test
    public void numbersSnapToAllowedValues() {
        assertEquals(5, MediaPlayerPolicy.normalizeSeekStep(4));
        assertEquals(10, MediaPlayerPolicy.normalizeSeekStep(12));
        assertEquals(30, MediaPlayerPolicy.normalizeSeekStep(25));
        assertEquals(10, MediaPlayerPolicy.normalizeSeekStep(0));
        assertEquals(30, MediaPlayerPolicy.normalizeClosePaused(7));
        assertEquals(0, MediaPlayerPolicy.normalizeClosePaused(0));
        assertEquals(60, MediaPlayerPolicy.normalizeClosePaused(60));
        assertEquals(MediaPlayerPolicy.SLEEP_END_OF_TRACK, MediaPlayerPolicy.normalizeSleep(-1));
        assertEquals(45, MediaPlayerPolicy.normalizeSleep(45));
        assertEquals(MediaPlayerPolicy.SLEEP_OFF, MediaPlayerPolicy.normalizeSleep(17));
    }

    // ── Which player ────────────────────────────────────────────────────────

    private static MediaPlayerPolicy.PlayerView view(String key, boolean eligible, boolean playing,
                                                     long since, long updated) {
        return new MediaPlayerPolicy.PlayerView(key, eligible, playing, since, updated);
    }

    @Test
    public void theLastPlayerToStartWins() {
        List<MediaPlayerPolicy.PlayerView> players = Arrays.asList(
            view("a", true, true, 100, 500),
            view("b", true, true, 300, 400));
        assertEquals("b", MediaPlayerPolicy.pickCurrent(players, null));
        assertEquals("b", MediaPlayerPolicy.pickCurrent(players, "a"));
    }

    @Test
    public void aPausedCurrentPlayerStaysUntilAnotherPlays() {
        List<MediaPlayerPolicy.PlayerView> paused = Arrays.asList(
            view("a", true, false, 100, 900),
            view("b", true, false, 300, 950));
        assertEquals("a", MediaPlayerPolicy.pickCurrent(paused, "a"));
        List<MediaPlayerPolicy.PlayerView> other = Arrays.asList(
            view("a", true, false, 100, 900),
            view("b", true, true, 50, 950));
        assertEquals("b", MediaPlayerPolicy.pickCurrent(other, "a"));
    }

    @Test
    public void mutedOrShortMediaNeverShows() {
        List<MediaPlayerPolicy.PlayerView> players = Arrays.asList(
            view("muted", false, true, 900, 900));
        assertNull(MediaPlayerPolicy.pickCurrent(players, null));
        assertNull(MediaPlayerPolicy.pickCurrent(Collections.emptyList(), "x"));
        // The current one became ineligible: the other paused one takes over.
        List<MediaPlayerPolicy.PlayerView> fallback = Arrays.asList(
            view("a", false, true, 900, 900),
            view("b", true, false, 100, 200));
        assertEquals("b", MediaPlayerPolicy.pickCurrent(fallback, "a"));
    }

    // ── Buttons ─────────────────────────────────────────────────────────────

    @Test
    public void withoutAPlaylistBackAndForwardSitBesidePlay() {
        MediaPlayerPolicy.ButtonLayout l = MediaPlayerPolicy.buttonLayout(false, false, true);
        assertEquals(Arrays.asList(MediaPlayerPolicy.CUSTOM_BACK, MediaPlayerPolicy.CUSTOM_FORWARD,
            MediaPlayerPolicy.CUSTOM_SETTINGS), l.custom);
        assertFalse(l.reservePrev);
        assertFalse(l.reserveNext);
    }

    @Test
    public void aPlaylistKeepsPreviousAndNextAndTheGearComesLast() {
        MediaPlayerPolicy.ButtonLayout l = MediaPlayerPolicy.buttonLayout(true, true, true);
        assertEquals(Collections.singletonList(MediaPlayerPolicy.CUSTOM_SETTINGS), l.custom);
        MediaPlayerPolicy.ButtonLayout nextOnly = MediaPlayerPolicy.buttonLayout(false, true, true);
        assertEquals(Arrays.asList(MediaPlayerPolicy.CUSTOM_BACK, MediaPlayerPolicy.CUSTOM_SETTINGS),
            nextOnly.custom);
    }

    @Test
    public void aLiveStreamKeepsTheGearAwayFromPlay() {
        MediaPlayerPolicy.ButtonLayout l = MediaPlayerPolicy.buttonLayout(false, false, false);
        assertEquals(Collections.singletonList(MediaPlayerPolicy.CUSTOM_SETTINGS), l.custom);
        assertTrue(l.reservePrev);
        assertTrue(l.reserveNext);
    }

    // ── Seeking and timers ──────────────────────────────────────────────────

    @Test
    public void seeksStayInsideTheTrack() {
        assertEquals(0.0, MediaPlayerPolicy.seekTarget(4, -10, 100), 1e-9);
        assertEquals(99.75, MediaPlayerPolicy.seekTarget(95, 10, 100), 1e-9);
        assertEquals(40.0, MediaPlayerPolicy.seekTarget(30, 10, -1), 1e-9);
        assertEquals(40.0, MediaPlayerPolicy.seekTarget(30, 10, Double.POSITIVE_INFINITY), 1e-9);
    }

    @Test
    public void positionMovesOnWhilePlaying() {
        assertEquals(12.0, MediaPlayerPolicy.positionNow(10, 1000, 3000, true, 1, 100), 1e-9);
        assertEquals(14.0, MediaPlayerPolicy.positionNow(10, 1000, 3000, true, 2, 100), 1e-9);
        assertEquals(10.0, MediaPlayerPolicy.positionNow(10, 1000, 3000, false, 1, 100), 1e-9);
        assertEquals(100.0, MediaPlayerPolicy.positionNow(99, 0, 60_000, true, 1, 100), 1e-9);
        assertEquals(-1L, MediaPlayerPolicy.durationMs(Double.POSITIVE_INFINITY));
        assertEquals(-1L, MediaPlayerPolicy.durationMs(0));
        assertEquals(61_500L, MediaPlayerPolicy.durationMs(61.5));
    }

    @Test
    public void pausedPlayersCloseAfterTheChosenTime() {
        assertEquals(30 * 60_000L - 1_000L, MediaPlayerPolicy.msUntilClosePaused(10_000, 11_000, 30));
        assertEquals(0L, MediaPlayerPolicy.msUntilClosePaused(10_000, 10_000 + 31 * 60_000L, 30));
        assertEquals(-1L, MediaPlayerPolicy.msUntilClosePaused(10_000, 11_000, 0));
    }

    @Test
    public void endOfTrackTimerFollowsTheRate() {
        assertEquals(30_000L, MediaPlayerPolicy.msUntilTrackEnds(70, 100, true, 1));
        assertEquals(15_000L, MediaPlayerPolicy.msUntilTrackEnds(70, 100, true, 2));
        assertEquals(-1L, MediaPlayerPolicy.msUntilTrackEnds(70, 100, false, 1));
        assertEquals(-1L, MediaPlayerPolicy.msUntilTrackEnds(70, Double.POSITIVE_INFINITY, true, 1));
    }

    // ── Text and source ─────────────────────────────────────────────────────

    @Test
    public void textLosesControlAndDirectionCharacters() {
        assertEquals("Song A", MediaPlayerPolicy.cleanText("  Song\n\t A \u0000", 50));
        // A right-to-left override could make "gpj.exe" read differently.
        assertEquals("abc", MediaPlayerPolicy.cleanText("a‮b⁦c‏", 50));
        // Emoji joiners stay.
        assertEquals("👩‍💻", MediaPlayerPolicy.cleanText("👩‍💻", 50));
        assertEquals("", MediaPlayerPolicy.cleanText(null, 10));
        assertEquals("", MediaPlayerPolicy.cleanText("   ", 10));
    }

    @Test
    public void longTextIsCutWithAnEllipsis() {
        assertEquals("abcd…", MediaPlayerPolicy.cleanText("abcdefgh", 5));
        assertEquals("abcde", MediaPlayerPolicy.cleanText("abcde", 5));
        // Code points, not chars: an emoji is not split.
        String emoji = "🎵";
        assertEquals(emoji + emoji + "…", MediaPlayerPolicy.cleanText(emoji + emoji + emoji + emoji, 3));
        StringBuilder huge = new StringBuilder();
        for (int i = 0; i < 100_000; i++) huge.append('x');
        assertEquals(120, MediaPlayerPolicy.cleanText(huge.toString(), 120).codePointCount(0, 120));
    }

    @Test
    public void qAppAndWebsiteNamesComeFromTheFrameUrl() {
        MediaPlayerPolicy.Source app = MediaPlayerPolicy.sourceOf(
            "http://127.0.0.1:12391/render/APP/Q-Tube/video?id=1", "http://127.0.0.1:12391", false);
        assertEquals("Q-Tube", app.label);
        assertEquals("APP", app.service);
        MediaPlayerPolicy.Source site = MediaPlayerPolicy.sourceOf(
            "https://ext-node.qortal.link/render/WEBSITE/My%20Radio/", "https://ext-node.qortal.link", false);
        assertEquals("My Radio", site.label);
        assertEquals("WEBSITE", site.service);
        MediaPlayerPolicy.Source gateway = MediaPlayerPolicy.sourceOf(
            "https://qortal.link/APP/Ear-Bump", "https://qortal.link:443", false);
        assertEquals("Ear-Bump", gateway.label);
    }

    @Test
    public void pageTitlesThatAreJustTheAppNameAreSpotted() {
        assertTrue(MediaPlayerPolicy.sameName("Ear Bump", "Ear-Bump"));
        assertTrue(MediaPlayerPolicy.sameName("Q-Tube", "q tube"));
        assertFalse(MediaPlayerPolicy.sameName("Q-Tube | Big Buck Bunny", "Q-Tube"));
        assertFalse(MediaPlayerPolicy.sameName("", ""));
        assertFalse(MediaPlayerPolicy.sameName(null, "x"));
    }

    @Test
    public void aFrameCannotClaimAnotherOrigin() {
        MediaPlayerPolicy.Source s = MediaPlayerPolicy.sourceOf(
            "https://ext-node.qortal.link/render/APP/Q-Wallets", "https://evil.example", false);
        assertEquals("evil.example", s.label);
        assertEquals("", s.service);
    }

    @Test
    public void otherSitesShowTheirHostAndGoShowsNothing() {
        assertEquals("radio.example.org", MediaPlayerPolicy.sourceOf(
            "https://radio.example.org/live", "https://radio.example.org", false).label);
        assertEquals("", MediaPlayerPolicy.sourceOf(
            "http://localhost/index.html", "http://localhost", true).label);
        assertEquals("", MediaPlayerPolicy.sourceOf("javascript:alert(1)", "null", false).label);
    }

    @Test
    public void framesAreRateLimited() {
        MediaPlayerPolicy.RateWindow w = new MediaPlayerPolicy.RateWindow();
        int allowed = 0;
        for (int i = 0; i < 100; i++) if (w.allow(5_000)) allowed++;
        assertEquals(MediaPlayerPolicy.MAX_MESSAGES_PER_SECOND, allowed);
        assertTrue(w.allow(6_001));
    }

    @Test
    public void theLogoSitsBottomRight() {
        assertArrayEquals(new int[] {512 - 23 - 123, 512 - 23 - 123, 123},
            MediaPlayerPolicy.logoBadgeRect(512, 512));
        int[] wide = MediaPlayerPolicy.logoBadgeRect(512, 288);
        assertEquals(69, wide[2]);
        assertEquals(512 - 13 - 69, wide[0]);
        assertEquals(288 - 13 - 69, wide[1]);
    }
}
