package com.github.Qortal.qortalMobile

import java.util.concurrent.atomic.AtomicLong

/**
 * Which Python frames go to the chat engine worker's loopback socket
 * ([BridgeSocketServer]). JS listeners on the main thread (notifyListeners
 * "presence": the call code in capacitorBridge / hubCall) still get every
 * frame; this only keeps call media off the worker's path.
 *
 * The worker handles `resp` / `fsres` and, of the events, only the ones in
 * PY_EVENTS_FOR_ENGINE and PY_DIAGNOSTIC_EVENTS
 * (src/reticulumChat/mobile/engineHost.ts handleSocketFrame); Land calls reach
 * the engine as chat wires inside `reticulum_chat_message`, not as
 * `call_message`. Every other event is parsed there and dropped. During a
 * call that was ~50 audio frames a second per peer plus a 20-30 KB queue
 * snapshot every 0.5 s, all through the same outbound queue (8192 frames,
 * drop-oldest) that carries chat wires: a slow or frozen worker could lose
 * chat to audio.
 *
 * Left out: the high-rate call media events only. Low-rate call control
 * (`call_message`, `group_call_message`, `group_audio_link_*`) still goes to
 * the worker as before. If the worker ever hosts the call managers, this
 * list has to shrink.
 */
internal object BridgeWorkerFrames {
    // Python writes compact JSON with `type` then `event` first
    // (presence_bridge.emit_event, qortal_presence_host._emit_json_audio_chunk),
    // the same prefix BridgeHandover reads.
    private const val EVENT_PREFIX = "{\"type\":\"event\",\"event\":\""

    /** Events the worker never reads that come many times a second during a call. */
    internal val CALL_MEDIA_EVENTS: List<String> = listOf(
        // One per 20 ms audio frame per peer (and link control frames).
        "group_audio_packet",
        // Scheduler snapshot every 0.5 s while an audio link exists, ~20-30 KB.
        "group_audio_queue_state",
        // Per failed send (coalesced per link and code, still up to one per frame).
        "group_audio_send_failed",
        // Forwarding activity, at most every 5 s per source.
        "group_audio_fast_path_activity",
    )

    private val skipped = AtomicLong(0)

    /** Frames kept off the worker socket since this process started (Copy diagnostics). */
    fun skippedCount(): Long = skipped.get()

    /** Whether [frame] goes to the worker socket. No parse, no allocation. */
    fun forWorker(frame: String): Boolean {
        if (!isCallMedia(frame)) return true
        skipped.incrementAndGet()
        return false
    }

    /** Pure check behind [forWorker] (no counter). */
    internal fun isCallMedia(frame: String): Boolean {
        if (!frame.startsWith(EVENT_PREFIX)) return false
        val start = EVENT_PREFIX.length
        for (name in CALL_MEDIA_EVENTS) {
            val end = start + name.length
            if (frame.length > end &&
                frame[end] == '"' &&
                frame.regionMatches(start, name, 0, name.length)
            ) {
                return true
            }
        }
        return false
    }
}
