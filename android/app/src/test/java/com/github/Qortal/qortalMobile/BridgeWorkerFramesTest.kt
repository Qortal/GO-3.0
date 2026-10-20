package com.github.Qortal.qortalMobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeWorkerFramesTest {

    private fun event(name: String, body: String = "\"payload\":{}"): String =
        "{\"type\":\"event\",\"event\":\"$name\",$body}"

    @Test
    fun callMediaStaysOffTheWorkerSocket() {
        for (name in listOf(
            "group_audio_packet",
            "group_audio_queue_state",
            "group_audio_send_failed",
            "group_audio_fast_path_activity",
        )) {
            assertTrue(name, BridgeWorkerFrames.isCallMedia(event(name)))
        }
    }

    @Test
    fun chatAndCallControlStillGoToTheWorker() {
        // The worker's own events, and low-rate call control it may need later.
        for (name in listOf(
            "ready",
            "reticulum_chat_message",
            "reticulum_chat_resource",
            "reticulum_resource",
            "reticulum_resource_session",
            "qchat_file_transfer",
            "overlay_link_state",
            "bridge_stall_diagnostic",
            "call_message",
            "group_call_message",
            "group_audio_link_established",
            "group_audio_link_closed",
            "error",
        )) {
            assertFalse(name, BridgeWorkerFrames.isCallMedia(event(name)))
        }
        assertFalse(BridgeWorkerFrames.isCallMedia("{\"type\":\"resp\",\"id\":\"w-1\",\"ok\":true}"))
        assertFalse(BridgeWorkerFrames.isCallMedia("{\"type\":\"fsres\",\"id\":\"fs-1\"}"))
        assertFalse(BridgeWorkerFrames.isCallMedia("{\"type\":\"pong\"}"))
        assertFalse(BridgeWorkerFrames.isCallMedia(""))
    }

    @Test
    fun matchesWholeEventNamesOnly() {
        // A longer name that starts with a media name is not media.
        assertFalse(BridgeWorkerFrames.isCallMedia(event("group_audio_packet_v2")))
        assertFalse(BridgeWorkerFrames.isCallMedia(event("group_audio_packe")))
        // Truncated frame right after the name.
        assertFalse(BridgeWorkerFrames.isCallMedia("{\"type\":\"event\",\"event\":\"group_audio_packet"))
        // The name inside a payload does not count.
        assertFalse(
            BridgeWorkerFrames.isCallMedia(
                event("reticulum_chat_message", "\"payload\":{\"event\":\"group_audio_packet\"}"),
            ),
        )
    }

    @Test
    fun realHostAudioFrameIsMedia() {
        // Shape written by qortal_presence_host._emit_json_audio_chunk + the
        // bridge's stdout writer (compact JSON, stamps appended).
        val frame = "{\"type\":\"event\",\"event\":\"group_audio_packet\",\"payload\":{\"linkId\":\"ab\"," +
            "\"roomId\":\"dmv-1\",\"peerPresenceHash\":\"\",\"peerDestinationHash\":\"cd\"," +
            "\"receivedAtWallMs\":0,\"data\":\"UUFVRA==\"},\"_queuedAtMs\":1,\"_writeAtMs\":2}"
        assertTrue(BridgeWorkerFrames.isCallMedia(frame))
    }

    @Test
    fun forWorkerCountsWhatItKeepsOff() {
        val before = BridgeWorkerFrames.skippedCount()
        assertFalse(BridgeWorkerFrames.forWorker(event("group_audio_packet")))
        assertTrue(BridgeWorkerFrames.forWorker(event("reticulum_chat_message")))
        assertEquals(before + 1, BridgeWorkerFrames.skippedCount())
    }

    @Test
    fun usesTheSamePrefixAsTheHandover() {
        // Both read the event name off the frame start; a frame the handover
        // keeps is never call media.
        val chat = event("reticulum_chat_message")
        assertTrue(BridgeHandover.isHandoverFrame(chat))
        assertFalse(BridgeWorkerFrames.isCallMedia(chat))
        assertFalse(BridgeHandover.isHandoverFrame(event("group_audio_packet")))
    }
}
