package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.pm.ServiceInfo;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

public class CallSessionPolicyTest {
    private static final String ME = "QmeAddressxxxxxxxxxxxxxxxxxxxxxxxx";
    private static final String CALLER = "QcallerAddressyyyyyyyyyyyyyyyyyyy";
    private static final long NOW = 1_800_000_000_000L;

    private static Set<String> mine() {
        Set<String> set = new HashSet<>();
        set.add(ME);
        return set;
    }

    private static String classify(String type, String callId, String from, String target, long ts) {
        return CallSessionPolicy.classifyWire(type, callId, from, target, ts, true, mine(), NOW, null);
    }

    @Test
    public void serviceTypeConstantsMatchAndroid() {
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC, CallSessionPolicy.FGS_TYPE_DATA_SYNC);
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE, CallSessionPolicy.FGS_TYPE_MICROPHONE);
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING,
            CallSessionPolicy.FGS_TYPE_REMOTE_MESSAGING
        );
    }

    @Test
    public void microphoneTypeOnlyDuringACallWithThePermission() {
        int messaging = CallSessionPolicy.FGS_TYPE_REMOTE_MESSAGING;
        int mic = CallSessionPolicy.FGS_TYPE_MICROPHONE;
        assertEquals(messaging | mic, CallSessionPolicy.foregroundTypeFlags(messaging, true, true, 34));
        assertEquals(messaging, CallSessionPolicy.foregroundTypeFlags(messaging, false, true, 34));
        // Without RECORD_AUDIO Android 14+ refuses the type outright.
        assertEquals(messaging, CallSessionPolicy.foregroundTypeFlags(messaging, true, false, 34));
        // Android 11-13: dataSync base plus microphone.
        int dataSync = CallSessionPolicy.FGS_TYPE_DATA_SYNC;
        assertEquals(dataSync | mic, CallSessionPolicy.foregroundTypeFlags(dataSync, true, true, 30));
        // Android 10 has no microphone type (and no while-in-use mic rule).
        assertEquals(dataSync, CallSessionPolicy.foregroundTypeFlags(dataSync, true, true, 29));
        assertTrue(CallSessionPolicy.hasMicrophoneType(messaging | mic));
        assertFalse(CallSessionPolicy.hasMicrophoneType(messaging));
    }

    @Test
    public void overTheLockScreenOnlyForACall() {
        assertTrue(CallSessionPolicy.showWhenLocked(true, false));
        assertTrue(CallSessionPolicy.showWhenLocked(false, true));
        assertFalse(CallSessionPolicy.showWhenLocked(false, false));
        // The screen is turned on for a ring, never during a call (at the ear).
        assertTrue(CallSessionPolicy.turnScreenOn(true));
        assertFalse(CallSessionPolicy.turnScreenOn(false));
    }

    @Test
    public void ringNotificationOnlyWhenGoIsNotInFrontOfTheUser() {
        // On screen, screen on, unlocked: the page rings itself.
        assertFalse(CallSessionPolicy.shouldPostRingNotification(false, true, false));
        assertTrue(CallSessionPolicy.shouldPostRingNotification(true, true, false));
        assertTrue(CallSessionPolicy.shouldPostRingNotification(false, false, false));
        // Over the lock screen the tray ring (with its sound) stays.
        assertTrue(CallSessionPolicy.shouldPostRingNotification(false, true, true));
    }

    @Test
    public void ringsForARequestAddressedToMe() {
        assertEquals(CallSessionPolicy.SNIFF_RING, classify("CR", "call-1", CALLER, ME, NOW - 2_000L));
    }

    @Test
    public void ignoresRequestsNotForMeOrBroken() {
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_TARGET, classify("CR", "call-1", CALLER, "Qsomeone", NOW));
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_FIELDS, classify("CR", "", CALLER, ME, NOW));
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_FIELDS, classify("CR", "call-1", null, ME, NOW));
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_FIELDS, classify("CR", "call-1", CALLER, null, NOW));
        assertEquals(
            CallSessionPolicy.SNIFF_IGNORE_FIELDS,
            CallSessionPolicy.classifyWire("CR", "call-1", CALLER, ME, 0L, false, mine(), NOW, null)
        );
        // My own other device calling me: no ring.
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_SELF, classify("CR", "call-1", ME, ME, NOW));
        // Group call wires and chat are not call requests.
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_TYPE, classify("GJ", "call-1", CALLER, ME, NOW));
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_TYPE, classify(null, "call-1", CALLER, ME, NOW));
    }

    @Test
    public void noRingWhenSignedOut() {
        assertEquals(
            CallSessionPolicy.SNIFF_IGNORE_SIGNED_OUT,
            CallSessionPolicy.classifyWire("CR", "c", CALLER, ME, NOW, true, Collections.emptySet(), NOW, null)
        );
        assertEquals(
            CallSessionPolicy.SNIFF_IGNORE_SIGNED_OUT,
            CallSessionPolicy.classifyWire("CR", "c", CALLER, ME, NOW, true, null, NOW, null)
        );
    }

    @Test
    public void staleOrFutureRequestsDoNotRing() {
        // The window of the page's (and Hub's) signature check: at most 30 s
        // old, 10 s ahead. A request outside it would ring as a call nobody
        // can answer.
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_STALE, classify("CR", "c", CALLER, ME, NOW - 31_000L));
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_STALE, classify("CR", "c", CALLER, ME, NOW - 59_000L));
        assertEquals(CallSessionPolicy.SNIFF_RING, classify("CR", "c", CALLER, ME, NOW - 29_000L));
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_STALE, classify("CR", "c", CALLER, ME, NOW + 11_000L));
        assertEquals(CallSessionPolicy.SNIFF_IGNORE_STALE, classify("CR", "c", CALLER, ME, NOW + 20_000L));
        assertEquals(CallSessionPolicy.SNIFF_RING, classify("CR", "c", CALLER, ME, NOW + 9_000L));
    }

    @Test
    public void cancelRejectOrAcceptElsewhereStopTheRingingCall() {
        for (String type : new String[] {"CH", "CX", "CA"}) {
            assertEquals(
                CallSessionPolicy.SNIFF_CANCEL,
                CallSessionPolicy.classifyWire(type, "call-1", null, null, 0L, false, mine(), NOW, "call-1")
            );
            // Another call's control frame does nothing.
            assertEquals(
                CallSessionPolicy.SNIFF_IGNORE_TYPE,
                CallSessionPolicy.classifyWire(type, "call-2", null, null, 0L, false, mine(), NOW, "call-1")
            );
            assertEquals(
                CallSessionPolicy.SNIFF_IGNORE_TYPE,
                CallSessionPolicy.classifyWire(type, "call-1", null, null, 0L, false, mine(), NOW, null)
            );
        }
    }

    @Test
    public void rateLimiterRingsEachCallOnce() {
        CallSessionPolicy.RingRateLimiter limiter = new CallSessionPolicy.RingRateLimiter();
        assertTrue(limiter.allow(CALLER, "call-1", NOW));
        // Repeats and relays of the same request.
        assertFalse(limiter.allow(CALLER, "call-1", NOW + 1_000L));
        assertFalse(limiter.allow("Qother", "call-1", NOW + 1_000L));
    }

    @Test
    public void rateLimiterSpacesOutOneCaller() {
        CallSessionPolicy.RingRateLimiter limiter = new CallSessionPolicy.RingRateLimiter();
        assertTrue(limiter.allow(CALLER, "call-1", NOW));
        assertFalse(limiter.allow(CALLER, "call-2", NOW + 5_000L));
        // call-2 was seen: it never rings later either.
        assertFalse(limiter.allow(CALLER, "call-2", NOW + 20_000L));
        assertTrue(limiter.allow(CALLER, "call-3", NOW + CallSessionPolicy.SENDER_MIN_INTERVAL_MS));
        // Another caller is not held back.
        assertTrue(limiter.allow("Qother", "call-4", NOW + 1_000L));
    }

    @Test
    public void rateLimiterCapsRingsPerMinute() {
        CallSessionPolicy.RingRateLimiter limiter = new CallSessionPolicy.RingRateLimiter();
        for (int i = 0; i < CallSessionPolicy.GLOBAL_MAX_RINGS; i++) {
            assertTrue(limiter.allow("Qcaller" + i, "call-" + i, NOW + i));
        }
        assertFalse(limiter.allow("Qflood", "call-x", NOW + 10L));
        // A minute later there is room again.
        assertTrue(limiter.allow("Qlater", "call-y", NOW + CallSessionPolicy.GLOBAL_WINDOW_MS + 10L));
    }

    @Test
    public void callsThePageAlreadyHandledNeverRingNatively() {
        CallSessionPolicy.RingRateLimiter limiter = new CallSessionPolicy.RingRateLimiter();
        limiter.markSeen("call-1", NOW);
        assertFalse(limiter.allow(CALLER, "call-1", NOW + 100L));
        assertTrue(limiter.allow(CALLER, "call-2", NOW + 100L));
    }

    @Test
    public void rateLimiterForgetsOldCalls() {
        CallSessionPolicy.RingRateLimiter limiter = new CallSessionPolicy.RingRateLimiter();
        for (int i = 0; i < 50; i++) limiter.markSeen("call-" + i, NOW);
        limiter.markSeen("fresh", NOW + 3 * CallSessionPolicy.RING_TIMEOUT_MS);
        assertEquals(1, limiter.trackedCallIds());
        assertFalse(limiter.allow(null, "c", NOW));
        assertFalse(limiter.allow(CALLER, null, NOW));
    }

    @Test
    public void actionsAndTheirIntents() {
        assertEquals(CallSessionPolicy.ACTION_ACCEPT, CallSessionPolicy.parseAction(" Accept "));
        assertEquals(CallSessionPolicy.ACTION_HANGUP, CallSessionPolicy.parseAction("hangup"));
        assertNull(CallSessionPolicy.parseAction("transfer"));
        assertNull(CallSessionPolicy.parseAction(null));
        assertTrue(CallSessionPolicy.endsRing(CallSessionPolicy.ACTION_ACCEPT));
        assertTrue(CallSessionPolicy.endsRing(CallSessionPolicy.ACTION_DECLINE));
        assertFalse(CallSessionPolicy.endsRing(CallSessionPolicy.ACTION_MUTE));
        // Only accept and open bring GO up (Activity PendingIntents).
        assertTrue(CallSessionPolicy.opensActivity(CallSessionPolicy.ACTION_ACCEPT));
        assertTrue(CallSessionPolicy.opensActivity(CallSessionPolicy.ACTION_OPEN));
        assertFalse(CallSessionPolicy.opensActivity(CallSessionPolicy.ACTION_DECLINE));
        assertFalse(CallSessionPolicy.opensActivity(CallSessionPolicy.ACTION_HANGUP));
        // Every action has its own request code (FLAG_UPDATE_CURRENT must not mix extras).
        Set<Integer> codes = new HashSet<>();
        for (String action : new String[] {
            CallSessionPolicy.ACTION_ACCEPT,
            CallSessionPolicy.ACTION_DECLINE,
            CallSessionPolicy.ACTION_HANGUP,
            CallSessionPolicy.ACTION_MUTE,
            CallSessionPolicy.ACTION_UNMUTE,
            CallSessionPolicy.ACTION_OPEN,
        }) {
            assertTrue(codes.add(CallSessionPolicy.requestCode(action)));
        }
        // Clear of the other request codes GO uses (alerts: ids, status: 2001-2003, 1-3).
        for (int code : codes) {
            assertTrue(code > 0x6000);
            assertNotEquals(QortalForegroundService.NOTIFICATION_ID_STATUS, code);
        }
    }

    @Test
    public void pendingActionsExpireWithTheRing() {
        assertTrue(CallSessionPolicy.pendingActionFresh(NOW, NOW + 30_000L));
        assertFalse(CallSessionPolicy.pendingActionFresh(NOW, NOW + 61_000L));
        assertFalse(CallSessionPolicy.pendingActionFresh(0L, NOW));
        assertFalse(CallSessionPolicy.pendingActionFresh(NOW + 5L, NOW));
    }

    @Test
    public void shortAddressForAnUnnamedCaller() {
        assertEquals("Qcal…yyyy", CallSessionPolicy.shortAddress(CALLER));
        assertEquals("Qshort", CallSessionPolicy.shortAddress(" Qshort "));
        assertEquals("", CallSessionPolicy.shortAddress(null));
    }

    // ── CallSession's state machine ─────────────────────────────────────────

    @Test
    public void pageRingsOnlyCallsThatAreNotRunningOrOver() {
        // A new ring.
        assertEquals(CallSessionPolicy.PAGE_RING_START, CallSessionPolicy.pageRingDecision("c1", null, false, null));
        // The same call again (name / avatar / confirming a native ring).
        assertEquals(CallSessionPolicy.PAGE_RING_UPDATE, CallSessionPolicy.pageRingDecision("c1", null, false, "c1"));
        // Another call rings now: it replaces the old ring.
        assertEquals(CallSessionPolicy.PAGE_RING_REPLACE, CallSessionPolicy.pageRingDecision("c2", null, false, "c1"));
        // A late ring for the call that already runs, or one that ended for good.
        assertEquals(
            CallSessionPolicy.PAGE_RING_IGNORE_ACTIVE,
            CallSessionPolicy.pageRingDecision("c1", "c1", false, null)
        );
        assertEquals(
            CallSessionPolicy.PAGE_RING_IGNORE_FINISHED,
            CallSessionPolicy.pageRingDecision("c1", null, true, null)
        );
        // Call waiting: a 1:1 call rings while a group call runs.
        assertEquals(CallSessionPolicy.PAGE_RING_START, CallSessionPolicy.pageRingDecision("d1", "g1", false, null));
    }

    @Test
    public void onlyRealEndsAreFinalForACall() {
        for (String end : new String[] {"answered", "accepted", "declined", "timeout", "remote-CH", "task-removed", null}) {
            assertTrue(String.valueOf(end), CallSessionPolicy.endIsFinal(end));
        }
        // The page's own cleanup, a native ring not taken up yet, a replaced ring.
        for (String end : new String[] {"page", "page-ring-ended", "page-dropped", "legacy-dismiss", "replaced"}) {
            assertFalse(end, CallSessionPolicy.endIsFinal(end));
        }
    }

    @Test
    public void pageCancelsOnlyItsOwnRing() {
        assertTrue(CallSessionPolicy.pageCancelApplies("c1", "c1", false));
        assertFalse(CallSessionPolicy.pageCancelApplies("c2", "c1", true));
        // No callId (old API): only a ring the page itself confirmed, so a
        // native ring the page has not seen yet survives its idle cleanup.
        assertTrue(CallSessionPolicy.pageCancelApplies(null, "c1", true));
        assertFalse(CallSessionPolicy.pageCancelApplies("", "c1", false));
        assertFalse(CallSessionPolicy.pageCancelApplies("c1", null, true));
    }

    @Test
    public void nativeRingOnlyWhenNothingElseDecides() {
        assertNull(CallSessionPolicy.nativeRingBlocker(false, false, true, true));
        assertEquals(CallSessionPolicy.NATIVE_RING_BUSY, CallSessionPolicy.nativeRingBlocker(true, false, true, true));
        assertEquals(
            CallSessionPolicy.NATIVE_RING_ALREADY_RINGING,
            CallSessionPolicy.nativeRingBlocker(false, true, true, true)
        );
        assertEquals(
            CallSessionPolicy.NATIVE_RING_SIGNED_OUT,
            CallSessionPolicy.nativeRingBlocker(false, false, false, true)
        );
        assertEquals(
            CallSessionPolicy.NATIVE_RING_PAGE_ON_SCREEN,
            CallSessionPolicy.nativeRingBlocker(false, false, true, false)
        );
    }

    @Test
    public void anotherCallTakesTheSessionOverOnlyWithBothIdsKnown() {
        assertTrue(CallSessionPolicy.isCallSwitch("g1", "direct:QA:QB"));
        assertFalse(CallSessionPolicy.isCallSwitch("g1", "g1"));
        // The DM's id may arrive after dialing started: not a switch.
        assertFalse(CallSessionPolicy.isCallSwitch("", "c1"));
        assertFalse(CallSessionPolicy.isCallSwitch(null, "c1"));
        assertFalse(CallSessionPolicy.isCallSwitch("c1", null));
    }

    @Test
    public void aLateEndForAnEarlierCallDoesNotEndThisOne() {
        assertTrue(CallSessionPolicy.endMatchesActive("c1", "c1"));
        assertTrue(CallSessionPolicy.endMatchesActive("c1", null));
        assertTrue(CallSessionPolicy.endMatchesActive("", "c1"));
        assertFalse(CallSessionPolicy.endMatchesActive("c2", "c1"));
    }

    @Test
    public void aRunningCallAnswersOnlyItsOwnRing() {
        assertTrue(CallSessionPolicy.activeAnswersRing("c1", "c1"));
        assertTrue(CallSessionPolicy.activeAnswersRing(null, "c1"));
        // Call waiting: the group call's updates leave the 1:1 ring alone.
        assertFalse(CallSessionPolicy.activeAnswersRing("g1", "d1"));
        assertFalse(CallSessionPolicy.activeAnswersRing("c1", null));
    }

    @Test
    public void screenOffSilencesOnlyOnGosRingScreen() {
        // On GO's ring screen the screen cannot time out: the power key.
        assertTrue(CallSessionPolicy.screenOffSilencesRing(true, -1L));
        // The ring screen stopped a moment before the broadcast.
        assertTrue(CallSessionPolicy.screenOffSilencesRing(false, 500L));
        // A heads-up over another app and the display timing out: keep ringing.
        assertFalse(CallSessionPolicy.screenOffSilencesRing(false, -1L));
        assertFalse(CallSessionPolicy.screenOffSilencesRing(false, 30_000L));
        // Then post once more for the full-screen intent, once per ring.
        assertTrue(CallSessionPolicy.repostRingForFullScreen(true, false, false));
        assertFalse(CallSessionPolicy.repostRingForFullScreen(true, false, true));
        assertFalse(CallSessionPolicy.repostRingForFullScreen(true, true, false));
        assertFalse(CallSessionPolicy.repostRingForFullScreen(false, false, false));
    }

    @Test
    public void oldLaunchIntentsDoNotAnswerOrOpenAgain() {
        String accept = CallSessionPolicy.ACTION_ACCEPT;
        String open = CallSessionPolicy.ACTION_OPEN;
        assertTrue(CallSessionPolicy.launchActionUsable(false, false, accept, NOW - 5_000L, NOW));
        // Reopened from recents after the process died, or a restored activity.
        assertFalse(CallSessionPolicy.launchActionUsable(true, false, accept, NOW - 5_000L, NOW));
        assertFalse(CallSessionPolicy.launchActionUsable(false, true, open, NOW - 5_000L, NOW));
        // An Accept from a ring that is long over.
        assertFalse(CallSessionPolicy.launchActionUsable(false, false, accept, NOW - 3 * 60_000L, NOW));
        // The ongoing call notification may be old in a long call.
        assertTrue(CallSessionPolicy.launchActionUsable(false, false, open, NOW - 60 * 60_000L, NOW));
        assertFalse(
            CallSessionPolicy.launchActionUsable(
                false,
                false,
                open,
                NOW - CallSessionPolicy.LAUNCH_INTENT_MAX_AGE_MS - 1L,
                NOW
            )
        );
        // Notifications from an older build carry no time.
        assertTrue(CallSessionPolicy.launchActionUsable(false, false, accept, 0L, NOW));
        assertFalse(CallSessionPolicy.launchActionUsable(false, false, accept, NOW + 60_000L, NOW));
    }

    @Test
    public void finishedRingsAreRememberedForTwoRingTimeouts() {
        CallSessionPolicy.FinishedRings finished = new CallSessionPolicy.FinishedRings();
        finished.add("c1", 1_000L);
        finished.add("", 1_000L);
        finished.add(null, 1_000L);
        assertEquals(1, finished.size());
        assertTrue(finished.contains("c1", 1_000L + 2 * CallSessionPolicy.RING_TIMEOUT_MS));
        assertFalse(finished.contains("c2", 2_000L));
        assertFalse(finished.contains(null, 2_000L));
        assertFalse(finished.contains("c1", 1_001L + 2 * CallSessionPolicy.RING_TIMEOUT_MS));
        assertEquals(0, finished.size());
    }

    @Test
    public void callNotificationUpdatesNeverDropTheMicrophoneType() {
        int base = CallSessionPolicy.FGS_TYPE_REMOTE_MESSAGING;
        int mic = CallSessionPolicy.FGS_TYPE_MICROPHONE;
        // Mute, name, phase: same types, the notification is just re-posted.
        assertEquals(base | mic, CallSessionPolicy.callForegroundUpdateTypes(base | mic, base | mic, 34));
        // Wanted shrank (should not happen mid-call): still the held types.
        assertEquals(base | mic, CallSessionPolicy.callForegroundUpdateTypes(base | mic, base, 34));
        // Android refused the microphone off screen; on screen it is added.
        assertEquals(base | mic, CallSessionPolicy.callForegroundUpdateTypes(base, base | mic, 34));
        // Android 9 and older: no types.
        assertEquals(0, CallSessionPolicy.callForegroundUpdateTypes(0, base | mic, 28));
    }
}
