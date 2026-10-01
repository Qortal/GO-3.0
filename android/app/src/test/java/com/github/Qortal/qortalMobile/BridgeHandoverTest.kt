package com.github.Qortal.qortalMobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeHandoverTest {

    private fun event(name: String, body: String = "\"payload\":{}"): String =
        "{\"type\":\"event\",\"event\":\"$name\",$body}"

    private fun held(frame: String, atMs: Long = 0L) = BridgeSocketServer.Held(frame, atMs)

    private fun drain(handover: BridgeHandover, nowMs: Long = 0L): Pair<List<String>, Pair<Int, Int>> {
        val out = ArrayList<String>()
        val counts = handover.drainTo(nowMs) { out.add(it.frame) }
        return Pair(out, counts)
    }

    @Test
    fun keepsOnlySafeEventsInOrder() {
        val handover = BridgeHandover()
        handover.keep(held(event("reticulum_chat_message", "\"n\":1")))
        handover.keep(held("{\"type\":\"resp\",\"id\":\"w-1\",\"ok\":true}"))
        handover.keep(held(event("resource_ready")))
        handover.keep(held(event("overlay_link_state", "\"n\":2")))
        handover.keep(held(event("ready")))
        handover.keep(held(event("reticulum_chat_message", "\"n\":3")))
        handover.keep(held("{\"type\":\"fsres\",\"id\":\"f-1\"}"))

        val (frames, counts) = drain(handover)
        assertEquals(
            listOf(
                event("reticulum_chat_message", "\"n\":1"),
                event("overlay_link_state", "\"n\":2"),
                event("ready"),
                event("reticulum_chat_message", "\"n\":3"),
            ),
            frames,
        )
        assertEquals(Pair(4, 0), counts)
        assertEquals(0, handover.size)
    }

    @Test
    fun dropsOldestOverFrameCap() {
        val handover = BridgeHandover()
        val total = BridgeHandover.HANDOVER_MAX_FRAMES + 10
        for (i in 0 until total) {
            handover.keep(held(event("reticulum_chat_message", "\"n\":$i")))
        }
        assertEquals(BridgeHandover.HANDOVER_MAX_FRAMES, handover.size)
        val (frames, _) = drain(handover)
        assertEquals(event("reticulum_chat_message", "\"n\":10"), frames.first())
        assertEquals(event("reticulum_chat_message", "\"n\":${total - 1}"), frames.last())
    }

    @Test
    fun dropsOldestOverCharCap() {
        val handover = BridgeHandover()
        val pad = "x".repeat(300 * 1024)
        for (i in 0 until 10) {
            handover.keep(held(event("reticulum_chat_message", "\"n\":$i,\"p\":\"$pad\"")))
        }
        val (frames, _) = drain(handover)
        val chars = frames.sumOf { it.length.toLong() }
        assertTrue(chars <= BridgeHandover.HANDOVER_MAX_CHARS)
        // Each frame is ~300 KiB, so six fit under 2 MiB and the newest stay.
        assertEquals(6, frames.size)
        assertTrue(frames.last().contains("\"n\":9,"))
        assertTrue(frames.first().contains("\"n\":4,"))
    }

    @Test
    fun keepsOneFrameLargerThanCharCap() {
        val handover = BridgeHandover(maxChars = 10)
        handover.keep(held(event("reticulum_chat_message")))
        assertEquals(1, handover.size)
    }

    @Test
    fun skipsFramesOlderThanAgeCapExceptClosedLinks() {
        val handover = BridgeHandover()
        val now = 1_000_000L
        val old = now - BridgeHandover.HANDOVER_MAX_AGE_MS - 1
        val edge = now - BridgeHandover.HANDOVER_MAX_AGE_MS
        val closed = event("overlay_link_state", "\"linkId\":\"a\",\"established\":false")
        val open = event("overlay_link_state", "\"linkId\":\"b\",\"established\":true")
        handover.keep(held(event("reticulum_chat_message", "\"n\":1"), old))
        handover.keep(held(closed, old))
        handover.keep(held(open, old))
        handover.keep(held(event("reticulum_chat_message", "\"n\":2"), edge))
        handover.keep(held(event("ready"), now))

        val (frames, counts) = drain(handover, now)
        assertEquals(
            listOf(closed, event("reticulum_chat_message", "\"n\":2"), event("ready")),
            frames,
        )
        assertEquals(Pair(3, 2), counts)
    }

    @Test
    fun countsOnlyAcceptedFramesAsHanded() {
        val handover = BridgeHandover()
        handover.keep(held(event("ready")))
        handover.keep(held(event("ready")))
        var calls = 0
        val counts = handover.drainTo(0L) { calls++ == 0 }
        assertEquals(Pair(1, 0), counts)
        assertEquals(0, handover.size)
    }

    @Test
    fun suspendDropsTheSessionUntilTheNextClient() {
        val handover = BridgeHandover()
        handover.keep(held(event("reticulum_chat_message", "\"n\":1")))
        handover.suspend()
        assertEquals(0, handover.size)

        // Logged out, no worker yet: the old session's frames are not kept,
        // except closed-link snapshots, which only delete a link.
        val closed = event("overlay_link_state", "\"linkId\":\"a\",\"established\":false")
        handover.keep(held(event("reticulum_chat_message", "\"n\":2")))
        handover.keep(held(event("overlay_link_state", "\"linkId\":\"b\",\"established\":true")))
        handover.keep(held(event("ready")))
        handover.keep(held(closed))
        // A clear (the delayed pause running) does not end the suspension.
        handover.clear()
        handover.keep(held(event("reticulum_chat_message", "\"n\":3")))
        handover.keep(held(closed))

        // The next worker connects: it gets only the closed link.
        val (frames, counts) = drain(handover)
        assertEquals(listOf(closed), frames)
        assertEquals(Pair(1, 0), counts)

        // Its own later gaps are covered again.
        handover.keep(held(event("reticulum_chat_message", "\"n\":4")))
        assertEquals(listOf(event("reticulum_chat_message", "\"n\":4")), drain(handover).first)
    }

    @Test
    fun suspendWithAClientConnectedOnlyClears() {
        val handover = BridgeHandover()
        handover.keep(held(event("reticulum_chat_message", "\"n\":1")))
        // Logout while the shared worker's socket is open: nothing to suspend.
        handover.suspend(clientConnected = true)
        assertEquals(0, handover.size)

        // Later, with no drainTo in between, that socket drops (page frozen):
        // the gap is still covered.
        handover.keep(held(event("reticulum_chat_message", "\"n\":2")))
        handover.keep(held(event("overlay_link_state", "\"linkId\":\"b\",\"established\":true")))
        val (frames, counts) = drain(handover)
        assertEquals(
            listOf(
                event("reticulum_chat_message", "\"n\":2"),
                event("overlay_link_state", "\"linkId\":\"b\",\"established\":true"),
            ),
            frames,
        )
        assertEquals(Pair(2, 0), counts)
    }

    @Test
    fun clearEmptiesTheBuffer() {
        val big = event("ready", "\"p\":\"" + "x".repeat(40) + "\"")
        val small = event("ready")
        // Room for big + small, not for two bigs.
        val handover = BridgeHandover(maxChars = (big.length + small.length).toLong())
        handover.keep(held(big))
        handover.clear()
        assertEquals(0, handover.size)
        // The char count restarts too, so both frames fit after the clear.
        handover.keep(held(big))
        handover.keep(held(small))
        assertEquals(2, handover.size)
    }

    @Test
    fun sentRingKeepsSafeFramesSinceCutoffInOrder() {
        val ring = BridgeSentRing()
        ring.record(held(event("reticulum_chat_message", "\"n\":1")), 1_000L)
        ring.record(held("{\"type\":\"pong\"}"), 2_000L)
        ring.record(held("{\"type\":\"resp\",\"id\":\"w-1\",\"ok\":true}"), 3_000L)
        ring.record(held(event("overlay_link_state", "\"n\":2")), 4_000L)
        ring.record(held(event("resource_ready")), 5_000L)
        ring.record(held(event("reticulum_chat_message", "\"n\":3")), 6_000L)
        assertEquals(3, ring.size)

        // Worker last alive before n:2 was sent: n:1 was read, the rest maybe not.
        val out = ArrayList<String>()
        assertEquals(2, ring.drainSince(4_000L) { out.add(it.frame) })
        assertEquals(
            listOf(
                event("overlay_link_state", "\"n\":2"),
                event("reticulum_chat_message", "\"n\":3"),
            ),
            out,
        )
        assertEquals(0, ring.size)
    }

    @Test
    fun sentRingIsBoundedByCountCharsAndAge() {
        val byCount = BridgeSentRing(maxFrames = 2)
        for (n in 1..3) byCount.record(held(event("ready", "\"n\":$n")), n.toLong())
        val counted = ArrayList<String>()
        byCount.drainSince(0L) { counted.add(it.frame) }
        assertEquals(listOf(event("ready", "\"n\":2"), event("ready", "\"n\":3")), counted)

        val one = event("ready", "\"n\":1")
        val byChars = BridgeSentRing(maxChars = one.length.toLong())
        byChars.record(held(one), 0L)
        byChars.record(held(event("ready", "\"n\":2")), 1L)
        assertEquals(1, byChars.size)

        val byAge = BridgeSentRing(maxAgeMs = 1_000L)
        byAge.record(held(event("ready", "\"n\":1")), 0L)
        byAge.record(held(event("ready", "\"n\":2")), 500L)
        byAge.record(held(event("ready", "\"n\":3")), 1_200L)
        val aged = ArrayList<String>()
        byAge.drainSince(0L) { aged.add(it.frame) }
        assertEquals(listOf(event("ready", "\"n\":2"), event("ready", "\"n\":3")), aged)
    }

    @Test
    fun sentFramesPrecedeQueuedOnesInTheHandover() {
        // What detach() does: ring since the cutoff, then the queue leftovers.
        val ring = BridgeSentRing()
        val handover = BridgeHandover()
        ring.record(held(event("overlay_link_state", "\"linkId\":\"a\",\"n\":1"), 100L), 100L)
        ring.record(held(event("overlay_link_state", "\"linkId\":\"a\",\"n\":2"), 200L), 200L)
        ring.drainSince(150L) { handover.keep(it) }
        handover.keep(held(event("overlay_link_state", "\"linkId\":\"a\",\"n\":3"), 300L))
        val (frames, _) = drain(handover, nowMs = 400L)
        assertEquals(
            listOf(
                event("overlay_link_state", "\"linkId\":\"a\",\"n\":2"),
                event("overlay_link_state", "\"linkId\":\"a\",\"n\":3"),
            ),
            frames,
        )
    }
}
