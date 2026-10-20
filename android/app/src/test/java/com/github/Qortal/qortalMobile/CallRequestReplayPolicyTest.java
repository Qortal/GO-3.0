package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

/** CallSessionPolicy rules for a ringing call's request kept for the next page. */
public class CallRequestReplayPolicyTest {
    private static final String ME = "QmeAddressxxxxxxxxxxxxxxxxxxxxxxxx";
    private static final String OTHER_ME = "QotherAccountzzzzzzzzzzzzzzzzzzzz";
    private static final String CALL = "call-1";
    private static final long NOW = 1_800_000_000_000L;

    private static Set<String> addresses(String... values) {
        Set<String> set = new HashSet<>();
        Collections.addAll(set, values);
        return set;
    }

    private static String decide(String ringCallId, String acceptedCallId, Set<String> page, long requestAt) {
        return CallSessionPolicy.replayDecision(CALL, ME, requestAt, ringCallId, acceptedCallId, page, NOW);
    }

    @Test
    public void keptOnlyForTheRingingCall() {
        assertTrue(CallSessionPolicy.keepRequestForNextPage(CALL, CALL));
        assertFalse(CallSessionPolicy.keepRequestForNextPage(CALL, "call-2"));
        assertFalse(CallSessionPolicy.keepRequestForNextPage(CALL, null));
        assertFalse(CallSessionPolicy.keepRequestForNextPage(null, null));
        assertFalse(CallSessionPolicy.keepRequestForNextPage(" ", " "));
    }

    @Test
    public void deliveredOnceThePageSignedInForTheTarget() {
        assertEquals(CallSessionPolicy.REPLAY_NOW, decide(CALL, null, addresses(ME), NOW - 5_000));
        // Accept on the notification ended the ring; the new page still has to answer it.
        assertEquals(CallSessionPolicy.REPLAY_NOW, decide(null, CALL, addresses(ME), NOW - 5_000));
    }

    @Test
    public void waitsWhileThePageIsSignedOutOrOnAnotherAccount() {
        assertEquals(CallSessionPolicy.REPLAY_WAIT, decide(CALL, null, addresses(), NOW - 5_000));
        assertEquals(CallSessionPolicy.REPLAY_WAIT, decide(CALL, null, null, NOW - 5_000));
        assertEquals(CallSessionPolicy.REPLAY_WAIT, decide(CALL, null, addresses(OTHER_ME), NOW - 5_000));
        assertEquals(
            CallSessionPolicy.REPLAY_WAIT,
            CallSessionPolicy.replayDecision(CALL, null, NOW, CALL, null, addresses(ME), NOW)
        );
    }

    @Test
    public void expiresWhenThePageCouldNoLongerAcceptTheSignature() {
        long tooOld = NOW - CallSessionPolicy.REQUEST_MAX_AGE_MS - 1;
        assertEquals(CallSessionPolicy.REPLAY_EXPIRED, decide(CALL, null, addresses(ME), tooOld));
        // Even before any page signed in: nobody can answer it any more.
        assertEquals(CallSessionPolicy.REPLAY_EXPIRED, decide(CALL, null, addresses(), tooOld));
        long tooNew = NOW + CallSessionPolicy.REQUEST_MAX_FUTURE_MS + 1;
        assertEquals(CallSessionPolicy.REPLAY_EXPIRED, decide(CALL, null, addresses(ME), tooNew));
        // Edge of the window still goes.
        assertEquals(
            CallSessionPolicy.REPLAY_NOW,
            decide(CALL, null, addresses(ME), NOW - CallSessionPolicy.REQUEST_MAX_AGE_MS)
        );
    }

    @Test
    public void droppedWhenNothingIsLeftToAnswer() {
        // Ring over (declined, cancelled, timed out) and no Accept waiting.
        assertEquals(CallSessionPolicy.REPLAY_DROP, decide(null, null, addresses(ME), NOW));
        // Another call rings / was accepted now.
        assertEquals(CallSessionPolicy.REPLAY_DROP, decide("call-2", "call-3", addresses(ME), NOW));
        assertEquals(
            CallSessionPolicy.REPLAY_DROP,
            CallSessionPolicy.replayDecision(null, ME, NOW, null, null, addresses(ME), NOW)
        );
        // Stale and unwanted: dropped, not "expired" (no ring to end).
        assertEquals(
            CallSessionPolicy.REPLAY_DROP,
            decide(null, null, addresses(ME), NOW - CallSessionPolicy.REQUEST_MAX_AGE_MS - 1)
        );
    }

    @Test
    public void onlyAcceptKeepsTheRequestAfterTheRingEnds() {
        assertTrue(CallSessionPolicy.replaySurvivesRingEnd("accepted"));
        for (String reason : new String[] {
            "declined", "timeout", "remote-CH", "remote-CX", "remote-CA", "answered",
            "page", "page-ring-ended", "page-dropped", "replaced", "task-removed", "replay-expired", null,
        }) {
            assertFalse(String.valueOf(reason), CallSessionPolicy.replaySurvivesRingEnd(reason));
        }
    }

    @Test
    public void expiryEndsTheRingForGood() {
        // A ring ended because its request expired never rings again for that callId.
        assertTrue(CallSessionPolicy.endIsFinal("replay-expired"));
    }

    // ── RequestReplay: the state CallSession drives, played as whole sequences ──

    private static CallSessionPolicy.SniffedRequest request(String callId, long atMs) {
        return new CallSessionPolicy.SniffedRequest(callId, ME, atMs, "{\"event\":\"call_message\",\"c\":\"" + callId + "\"}");
    }

    /** CR seen while the page lived, the call rings, the page goes away: kept. */
    private static CallSessionPolicy.RequestReplay keptRinging(long requestAt) {
        CallSessionPolicy.RequestReplay replay = new CallSessionPolicy.RequestReplay();
        replay.onRequest(request(CALL, requestAt), null);
        assertTrue(replay.keepForNextPage(CALL));
        return replay;
    }

    @Test
    public void acceptKeepsDeliveringAfterThePageClearedItsPendingAction() {
        long requestAt = NOW - 2_000;
        CallSessionPolicy.RequestReplay replay = keptRinging(requestAt);
        // Accept on the notification ends the ring: the request stays, as accepted.
        assertFalse(replay.onRingEnded(CALL, "accepted"));
        assertTrue(replay.isAccepted());
        // The new page mounts its call UI and clears QortalCall's pending
        // action at once (it only parks the Accept): nothing here reads it.
        // userInfo is not there yet: ring addresses [] -> wait.
        assertEquals(CallSessionPolicy.REPLAY_WAIT, replay.decide(null, addresses(), NOW));
        // userInfo arrives: delivered, and again every interval (the page's
        // listener may attach after the first copy).
        long t = NOW + 500;
        assertEquals(CallSessionPolicy.REPLAY_NOW, replay.decide(null, addresses(ME), t));
        assertEquals(1, replay.onDelivered());
        int repeats = 0;
        for (t += CallSessionPolicy.REPLAY_INTERVAL_MS;
             t <= requestAt + CallSessionPolicy.REQUEST_MAX_AGE_MS && !replay.deliveredEnough();
             t += CallSessionPolicy.REPLAY_INTERVAL_MS) {
            assertEquals(CallSessionPolicy.REPLAY_NOW, replay.decide(null, addresses(ME), t));
            replay.onDelivered();
            repeats++;
        }
        assertTrue("repeats: " + repeats, repeats >= 5);
        // The page rang it: done (the parked Accept answers it there).
        assertTrue(replay.dropFor(CALL));
        assertEquals(CallSessionPolicy.REPLAY_DROP, replay.decide(null, addresses(ME), t));
    }

    @Test
    public void acceptedRequestStillExpiresWithItsSignatureWindow() {
        long requestAt = NOW - 2_000;
        CallSessionPolicy.RequestReplay replay = keptRinging(requestAt);
        replay.onRingEnded(CALL, "accepted");
        long late = requestAt + CallSessionPolicy.REQUEST_MAX_AGE_MS + 1;
        assertEquals(CallSessionPolicy.REPLAY_EXPIRED, replay.decide(null, addresses(ME), late));
    }

    @Test
    public void otherRingEndsDropTheKeptRequest() {
        CallSessionPolicy.RequestReplay replay = keptRinging(NOW);
        // Another call's ring ending does not touch it.
        assertFalse(replay.onRingEnded("call-2", "declined"));
        assertTrue(replay.isKept());
        assertTrue(replay.onRingEnded(CALL, "declined"));
        assertFalse(replay.isKept());
        assertFalse(replay.isAccepted());
        assertEquals(CallSessionPolicy.REPLAY_DROP, replay.decide(null, addresses(ME), NOW));
    }

    @Test
    public void callerHangupAfterAcceptDropsTheKeptRequest() {
        for (String type : new String[] {"CH", "CX", "CA"}) {
            CallSessionPolicy.RequestReplay replay = keptRinging(NOW);
            replay.onRingEnded(CALL, "accepted");
            // Not this call, or not an ending wire: no change.
            assertFalse(replay.onRemoteWire(type, "call-2"));
            assertFalse(replay.onRemoteWire("CR", CALL));
            assertFalse(replay.onRemoteWire(type, null));
            assertTrue(replay.isKept());
            assertTrue(type, replay.onRemoteWire(type, CALL));
            assertFalse(replay.isKept());
            assertEquals(CallSessionPolicy.REPLAY_DROP, replay.decide(null, addresses(ME), NOW));
        }
        assertTrue(CallSessionPolicy.cancelsKeptRequest("CH", CALL, CALL));
        assertFalse(CallSessionPolicy.cancelsKeptRequest("CH", CALL, null));
        assertFalse(CallSessionPolicy.cancelsKeptRequest("CH", " ", " "));
        assertFalse(CallSessionPolicy.cancelsKeptRequest("XX", CALL, CALL));
    }

    @Test
    public void secondCallersRequestDoesNotReplaceTheRingingCalls() {
        CallSessionPolicy.RequestReplay replay = new CallSessionPolicy.RequestReplay();
        replay.onRequest(request(CALL, NOW - 3_000), null);
        // call-1 rings; call-2's request arrives (native: already ringing).
        replay.onRequest(request("call-2", NOW - 1_000), CALL);
        assertTrue(replay.keepForNextPage(CALL));
        assertEquals(CALL, replay.kept().callId);
        assertEquals(NOW - 3_000, replay.kept().atMs);
    }

    @Test
    public void aRingThePageReplacedKeepsItsOwnRequest() {
        CallSessionPolicy.RequestReplay replay = new CallSessionPolicy.RequestReplay();
        replay.onRequest(request(CALL, NOW - 3_000), null);
        replay.onRequest(request("call-2", NOW - 1_000), CALL);
        // The page rang call-2 instead (replaced call-1's ring), then went away.
        assertTrue(replay.keepForNextPage("call-2"));
        assertEquals("call-2", replay.kept().callId);
        // Nothing known for a call whose request was never seen.
        CallSessionPolicy.RequestReplay empty = new CallSessionPolicy.RequestReplay();
        assertFalse(empty.keepForNextPage(CALL));
        assertFalse(empty.keepForNextPage(null));
    }

    @Test
    public void recentRequestsAreBoundedButKeepTheRingingCalls() {
        CallSessionPolicy.RequestReplay replay = new CallSessionPolicy.RequestReplay();
        replay.onRequest(request(CALL, NOW), null);
        for (int i = 0; i < 20; i++) {
            replay.onRequest(request("spam-" + i, NOW), CALL);
        }
        assertEquals(CallSessionPolicy.RequestReplay.MAX_RECENT_REQUESTS, replay.recentCount());
        assertTrue(replay.recentRequest(CALL) != null);
        assertTrue(replay.recentRequest("spam-19") != null);
        assertTrue(replay.recentRequest("spam-0") == null);
        // A repeat of a callId keeps one entry, the newest copy.
        replay.onRequest(request("spam-19", NOW + 1), CALL);
        assertEquals(CallSessionPolicy.RequestReplay.MAX_RECENT_REQUESTS, replay.recentCount());
        assertEquals(NOW + 1, replay.recentRequest("spam-19").atMs);
        replay.forgetAll();
        assertEquals(0, replay.recentCount());
    }

    @Test
    public void anotherPageGoneStartsTheKeptRequestOver() {
        CallSessionPolicy.RequestReplay replay = keptRinging(NOW);
        replay.onDelivered();
        replay.onDelivered();
        // Already kept: not kept again, but the next page gets it from the first copy.
        assertFalse(replay.keepForNextPage(CALL));
        assertTrue(replay.restartForNextPage());
        assertEquals(0, replay.deliveries());
        assertTrue(replay.isKept());
        // The accepted mark survives a second page going away.
        replay.onRingEnded(CALL, "accepted");
        assertTrue(replay.restartForNextPage());
        assertTrue(replay.isAccepted());
        assertTrue(replay.clear());
        assertFalse(replay.restartForNextPage());
        assertFalse(replay.clear());
    }

    @Test
    public void pageRangOrAnsweredDropsOnlyThatCall() {
        CallSessionPolicy.RequestReplay replay = keptRinging(NOW);
        assertFalse(replay.dropFor("call-2"));
        assertFalse(replay.dropFor(null));
        assertTrue(replay.isKeptFor(CALL));
        assertTrue(replay.dropFor(CALL));
        assertFalse(replay.isKeptFor(CALL));
    }

    @Test
    public void deliveriesCoverTheSignatureWindowAndAreBounded() {
        // Repeats until the page takes it, for as long as the page could still accept it ...
        assertTrue(
            (long) CallSessionPolicy.REPLAY_MAX_DELIVERIES * CallSessionPolicy.REPLAY_INTERVAL_MS
                >= CallSessionPolicy.REQUEST_MAX_AGE_MS
        );
        // ... and never more than a handful a minute.
        assertTrue(CallSessionPolicy.REPLAY_MAX_DELIVERIES <= 20);
        assertTrue(CallSessionPolicy.REPLAY_INTERVAL_MS >= 1_000L);
    }
}
