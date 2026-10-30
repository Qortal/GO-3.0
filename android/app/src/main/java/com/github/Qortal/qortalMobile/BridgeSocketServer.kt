package com.github.Qortal.qortalMobile

import android.os.SystemClock
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import fi.iki.elonen.NanoWSD.WebSocket
import fi.iki.elonen.NanoWSD.WebSocketFrame
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger

/**
 * Loopback WebSocket between the chat engine worker and the native bridge.
 *
 * Every Capacitor plugin call and every `notifyListeners` event crosses the
 * WebView's single main JS thread. Q-App iframes share that thread, so a busy
 * app (or a long GC) delays engine commands and Python events by seconds —
 * long enough for peers to time out DM page requests and for group digests to
 * hit their 20 s bridge timeout. A WebSocket from the worker is serviced by
 * Chromium's IO thread and this server's own threads, so engine traffic no
 * longer waits behind UI work.
 *
 * Protocol (text frames, JSON):
 *  - client → server `{"type":"cmd", ...}` is fed verbatim to presence_bridge.py;
 *    `{"type":"fs","id","op","args"}` runs a chat-resource staging op;
 *    `{"type":"ping"}` is answered with `{"type":"pong"}`.
 *  - server → client: every frame the Python bridge emits (`resp` / `event`),
 *    plus `{"type":"fsres","id","result"|"error"}`.
 *
 * Bound to 127.0.0.1 on an ephemeral port. Clients must present the
 * per-process token in the `token` query parameter and, when the handshake
 * carries an Origin header, it must be the WebView's own origin.
 *
 * Handover: Chromium kills the worker's socket when it resumes a frozen page
 * ("Page entered Back-Forward Cache"). Until then the socket looks open, so
 * frames sent during the freeze sit unread in socket buffers and die with
 * it. Those (see [BridgeSentRing]), frames still queued for that client, and
 * frames that arrive before the worker reconnects would be lost. A safe
 * subset is kept and handed to the next client first, in order (see
 * [BridgeHandover.HANDOVER_EVENTS]).
 */
class BridgeSocketServer(
    private val allowedOrigin: String?,
    private val onCommand: (client: Client, frame: String) -> Unit,
    private val onFsRequest: (client: Client, request: org.json.JSONObject) -> Unit,
) : NanoWSD("127.0.0.1", 0) {

    companion object {
        private const val TAG = "BridgeSocket"
        private const val OUTBOUND_QUEUE_CAPACITY = 8192
        /**
         * The worker pings at least this often while it runs
         * (SOCKET_KEEPALIVE_MS in src/reticulumChat/mobile/engineHost.ts).
         * Sent frames from this long before its last message on are replayed
         * at handover: it may have stopped reading any time after that.
         */
        internal const val WORKER_SILENCE_SLACK_MS = 60_000L

        fun newToken(): String {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }

    val token: String = newToken()
    private val clients = CopyOnWriteArraySet<Client>()
    private val dropped = AtomicInteger(0)

    /** A frame and when it reached this server (elapsedRealtime). */
    class Held(val frame: String, val atMs: Long)

    // Guards the handover buffer and the moments a client joins or leaves
    // [clients], so handed-over frames always precede live ones.
    private val handoverLock = Any()
    private val handover = BridgeHandover()

    fun startListening() {
        // timeout 0 = no socket read timeout; the WebSocket read loop must not
        // be torn down by idle periods.
        start(0, true)
        Log.i(TAG, "bridge socket listening on 127.0.0.1:$listeningPort")
    }

    fun url(): String = "ws://127.0.0.1:$listeningPort/bridge"

    /**
     * Copy diagnostics: read-only counters (connected workers, frames waiting
     * per worker, frames dropped on a full queue since this server started,
     * frames kept for the next worker). Changes nothing.
     */
    fun diagnostics(): org.json.JSONObject {
        var queued = 0
        var largest = 0
        for (client in clients) {
            val n = client.queuedFrames()
            queued += n
            if (n > largest) largest = n
        }
        val kept = synchronized(handoverLock) { handover.size }
        return org.json.JSONObject()
            .put("clients", clients.size)
            .put("dropped", dropped.get())
            .put("queued", queued)
            .put("queuedMax", largest)
            .put("queueCapacity", OUTBOUND_QUEUE_CAPACITY)
            .put("handoverFrames", kept)
    }

    /** Fan a Python frame out to every connected worker. Never blocks the caller. */
    fun broadcast(frame: String) {
        val held = Held(frame, SystemClock.elapsedRealtime())
        if (clients.isEmpty()) {
            synchronized(handoverLock) {
                if (clients.isEmpty()) {
                    handover.keep(held)
                    return
                }
            }
        }
        for (client in clients) client.enqueue(held)
    }

    /** Drop kept frames, e.g. when the network pauses. */
    fun clearHandover() {
        synchronized(handoverLock) {
            handover.clear()
            for (client in clients) client.clearSent()
        }
    }

    /**
     * The signed-in session ended (logout): drop kept frames now. The engine
     * worker is shared across accounts (logout does not restart it), so a
     * worker connected now gets later frames live, as before, and its next
     * gaps stay covered. Only a logout during a gap (no worker connected)
     * keeps nothing more until the next worker connects, so that gap's
     * frames are not replayed after the next login (see
     * [BridgeHandover.suspend]).
     */
    fun endSession() {
        synchronized(handoverLock) {
            handover.suspend(clientConnected = clients.isNotEmpty())
            // Frames already sent belong to the ended session too.
            for (client in clients) client.clearSent()
        }
    }

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket = Client(handshake)

    inner class Client(handshake: NanoHTTPD.IHTTPSession) : WebSocket(handshake) {
        private val authorized: Boolean
        private val outbound = LinkedBlockingQueue<Held>(OUTBOUND_QUEUE_CAPACITY)
        @Volatile private var writerRunning = false
        @Volatile private var detached = false
        private var writer: Thread? = null
        /** Recently sent frames; guarded by handoverLock. */
        private val sent = BridgeSentRing()
        /** When this worker last sent anything (elapsedRealtime). */
        @Volatile private var lastInboundMs = SystemClock.elapsedRealtime()

        init {
            val presented = handshake.parameters["token"]?.firstOrNull()
            val origin = handshake.headers["origin"]
            val originOk = origin == null || allowedOrigin == null ||
                origin.equals(allowedOrigin, ignoreCase = true)
            authorized = presented != null && presented == token && originOk
            if (!authorized) {
                Log.w(TAG, "rejecting bridge socket client origin=$origin tokenOk=${presented == token}")
            }
        }

        /** Copy diagnostics: frames waiting for this worker's writer. */
        fun queuedFrames(): Int = outbound.size

        /** Queue a frame for this client; drops the oldest frame if the worker is stalled. */
        fun enqueue(frame: String) {
            enqueue(Held(frame, SystemClock.elapsedRealtime()))
        }

        fun enqueue(held: Held) {
            if (!writerRunning) {
                // A broadcast that raced this client's close: keep the frame,
                // behind the ones drained from the queue, for the next client.
                // A client still connected got it from the same broadcast.
                if (detached) synchronized(handoverLock) {
                    if (clients.isEmpty()) handover.keep(held)
                }
                return
            }
            if (outbound.offer(held)) return
            outbound.poll()
            if (!outbound.offer(held)) return
            val n = dropped.incrementAndGet()
            if (n % 500 == 1) Log.w(TAG, "bridge socket outbound queue full, dropped=$n")
        }

        /** Leave [clients] and keep what this client never received. */
        private fun detach() {
            // One critical section, so frames keep their order: the queue is
            // drained before any racing broadcast can add to the handover.
            synchronized(handoverLock) {
                if (!clients.remove(this)) return
                detached = true
                writerRunning = false
                writer?.interrupt()
                // The handover bridges a gap with no client. With another one
                // connected (e.g. a restarted worker that came up before this
                // socket closed), that client got the same broadcasts, and
                // keeping them would replay them to it on its next reconnect.
                if (clients.isEmpty()) {
                    // Sent frames the worker may never have read come first,
                    // then the ones still queued.
                    sent.drainSince(lastInboundMs - WORKER_SILENCE_SLACK_MS) { handover.keep(it) }
                    while (true) handover.keep(outbound.poll() ?: break)
                } else {
                    outbound.clear()
                    sent.clear()
                }
            }
        }

        /** Forget sent frames. Call with handoverLock held. */
        internal fun clearSent() {
            sent.clear()
        }

        override fun onOpen() {
            if (!authorized) {
                try {
                    close(WebSocketFrame.CloseCode.PolicyViolation, "unauthorized", false)
                } catch (_: IOException) {
                }
                return
            }
            writerRunning = true
            lastInboundMs = SystemClock.elapsedRealtime()
            // Hand over first, then join: every later broadcast lands behind
            // the handed-over frames.
            synchronized(handoverLock) {
                val (handed, stale) =
                    handover.drainTo(SystemClock.elapsedRealtime()) { outbound.offer(it) }
                clients.add(this)
                if (handed > 0 || stale > 0) {
                    Log.i(TAG, "bridge socket handover handed=$handed stale=$stale")
                }
            }
            writer = Thread({
                while (writerRunning) {
                    // Block until a frame arrives; onClose interrupts the
                    // thread, so no polling timeout is needed.
                    val held = try {
                        outbound.take()
                    } catch (_: InterruptedException) {
                        break
                    }
                    // Recorded before the send, under the lock detach() takes,
                    // so the ring and the queue leftovers stay in order. Once
                    // detached, the frame is dropped: keeping it now would put
                    // it behind newer leftovers (a stale link snapshot would
                    // then win).
                    val live = synchronized(handoverLock) {
                        if (!detached) sent.record(held, SystemClock.elapsedRealtime())
                        !detached
                    }
                    if (!live) break
                    try {
                        send(held.frame)
                    } catch (e: IOException) {
                        Log.w(TAG, "bridge socket send failed: ${e.message}")
                        writerRunning = false
                        break
                    }
                }
            }, "bridge-socket-writer").apply { isDaemon = true; start() }
            Log.i(TAG, "bridge socket client connected (clients=${clients.size})")
        }

        override fun onClose(
            code: WebSocketFrame.CloseCode?,
            reason: String?,
            initiatedByRemote: Boolean,
        ) {
            detach()
            Log.i(TAG, "bridge socket client closed code=$code remote=$initiatedByRemote (clients=${clients.size})")
        }

        override fun onMessage(message: WebSocketFrame) {
            if (!authorized) return
            // Any frame proves the worker still reads its socket.
            lastInboundMs = SystemClock.elapsedRealtime()
            val text = message.textPayload ?: return
            if (text.isEmpty()) return
            // Cheap dispatch on the frame type without a full parse for the
            // common command case; Python re-parses the frame anyway.
            when {
                text.contains("\"type\":\"cmd\"") || text.contains("\"type\": \"cmd\"") ->
                    onCommand(this, text)
                text.contains("\"type\":\"ping\"") ->
                    enqueue("{\"type\":\"pong\"}")
                else -> {
                    val parsed = try {
                        org.json.JSONObject(text)
                    } catch (_: Exception) {
                        return
                    }
                    when (parsed.optString("type")) {
                        "cmd" -> onCommand(this, text)
                        "fs" -> onFsRequest(this, parsed)
                        "ping" -> enqueue("{\"type\":\"pong\"}")
                    }
                }
            }
        }

        override fun onPong(pong: WebSocketFrame?) {}

        override fun onException(exception: IOException?) {
            detach()
        }
    }
}

/**
 * Frames kept for the next worker while none is connected, oldest first.
 * Pure (no Android calls) so the rules are unit-tested; not thread-safe, the
 * server holds its handover lock around every call.
 */
internal class BridgeHandover(
    private val maxFrames: Int = HANDOVER_MAX_FRAMES,
    private val maxChars: Long = HANDOVER_MAX_CHARS,
    private val maxAgeMs: Long = HANDOVER_MAX_AGE_MS,
) {
    companion object {
        /**
         * Python events a reconnecting worker may still get late. They are
         * the ones the engine handles idempotently and in order:
         *  - `reticulum_chat_message`: mesh wires; the engine already drops
         *    duplicates (it sees each gossip wire several times anyway).
         *  - `overlay_link_state`: per-link snapshots keyed by link id and
         *    replayed in their original order, so the last one wins.
         *  - `ready`: idempotent.
         * These may reach a worker twice: while its socket is down the main
         * thread relays the same events (PY_EVENTS_FOR_WORKER in
         * src/reticulumChat/mobile/index.ts), and the handover replays them
         * on reconnect. Native cannot tell whether that relay ran (a frozen
         * page relays nothing, which is what the handover is for), so frames
         * are kept either way and the idempotence above absorbs the repeat.
         * Left out on purpose:
         *  - `resp` / `fsres`: the worker fails every pending request when
         *    its socket closes, and a new worker (page reload) restarts its
         *    ids at `w-1`, so a stale answer could resolve the wrong request.
         *  - resource and resource-session events: session waiters match by
         *    peer and lane, so a stale `ready` could settle a newer session,
         *    and a late inbound blob is copied into OPFS with nobody waiting.
         *    The engine re-requests resources on its own timeouts.
         *  - everything else: the worker ignores it (the main thread gets
         *    every frame through notifyListeners already).
         */
        private val HANDOVER_EVENTS =
            setOf("reticulum_chat_message", "overlay_link_state", "ready")
        internal const val HANDOVER_MAX_FRAMES = 1024
        internal const val HANDOVER_MAX_CHARS = 2L * 1024 * 1024
        // Older frames are dropped at handover: a two-minute-old wire is
        // better fetched by the engine's own sync than replayed.
        internal const val HANDOVER_MAX_AGE_MS = 120_000L
        // Python writes compact JSON with `type` then `event` first
        // (presence_bridge.emit_event), so the name is read without a parse.
        private const val EVENT_PREFIX = "{\"type\":\"event\",\"event\":\""

        /** Whether [frame] is one of [HANDOVER_EVENTS]. */
        internal fun isHandoverFrame(frame: String): Boolean =
            handoverEventName(frame)?.let { it in HANDOVER_EVENTS } ?: false

        private fun handoverEventName(frame: String): String? {
            if (!frame.startsWith(EVENT_PREFIX)) return null
            val end = frame.indexOf('"', EVENT_PREFIX.length)
            if (end <= EVENT_PREFIX.length) return null
            return frame.substring(EVENT_PREFIX.length, end)
        }

        /**
         * A closed link can only be deleted by its snapshot, so it is never
         * stale, and it carries nothing of a signed-in session.
         */
        private fun isClosedLinkSnapshot(frame: String): Boolean =
            frame.contains("\"established\":false") &&
                handoverEventName(frame) == "overlay_link_state"
    }

    private val frames = ArrayDeque<BridgeSocketServer.Held>()
    private var chars = 0L
    private var suspended = false

    val size: Int get() = frames.size

    /** Keep [held] if its event is safe to replay; drops the oldest over the caps. */
    fun keep(held: BridgeSocketServer.Held) {
        val name = handoverEventName(held.frame) ?: return
        if (name !in HANDOVER_EVENTS) return
        if (suspended && !isClosedLinkSnapshot(held.frame)) return
        frames.addLast(held)
        chars += held.frame.length
        while (frames.size > maxFrames || (chars > maxChars && frames.size > 1)) {
            chars -= frames.removeFirst().frame.length
        }
    }

    fun clear() {
        frames.clear()
        chars = 0L
    }

    /**
     * The session ended: drop everything. With no client connected, also keep
     * nothing more until the next [drainTo] (the next client connecting):
     * frames that arrive in that gap belong to the old session. Closed-link
     * snapshots are still kept: they only delete a link. With a client
     * connected there is no gap to suspend, and a suspension would outlive
     * the logout and drop that client's next gap (its socket stays open
     * across logout and login), so this only clears.
     */
    fun suspend(clientConnected: Boolean = false) {
        clear()
        if (!clientConnected) suspended = true
    }

    /**
     * Pass the kept frames to [offer] oldest first, skipping ones older than
     * the age cap, and empty the buffer. Returns (handed, stale). Called when
     * a client connects; that client never saw the ended session's frames,
     * so this also ends [suspend] and later gaps are covered again.
     */
    fun drainTo(nowMs: Long, offer: (BridgeSocketServer.Held) -> Boolean): Pair<Int, Int> {
        var handed = 0
        var stale = 0
        for (held in frames) {
            if (nowMs - held.atMs <= maxAgeMs || isClosedLinkSnapshot(held.frame)) {
                if (offer(held)) handed++
            } else {
                stale++
            }
        }
        clear()
        suspended = false
        return Pair(handed, stale)
    }
}

/**
 * Handover-safe frames already sent to one worker, oldest first. While the
 * page is frozen its socket still accepts writes, so these may never have
 * been read; [BridgeSocketServer] hands the ones sent after the worker last
 * proved alive to the next worker. Bounded like [BridgeHandover] and by age.
 * Pure; not thread-safe, the server holds its handover lock around every call.
 */
internal class BridgeSentRing(
    private val maxFrames: Int = BridgeHandover.HANDOVER_MAX_FRAMES,
    private val maxChars: Long = BridgeHandover.HANDOVER_MAX_CHARS,
    private val maxAgeMs: Long = BridgeHandover.HANDOVER_MAX_AGE_MS,
) {
    private class Sent(val held: BridgeSocketServer.Held, val sentAtMs: Long)

    private val frames = ArrayDeque<Sent>()
    private var chars = 0L

    val size: Int get() = frames.size

    /** [held] was sent at [nowMs]; keeps it if it is safe to replay. */
    fun record(held: BridgeSocketServer.Held, nowMs: Long) {
        if (!BridgeHandover.isHandoverFrame(held.frame)) return
        frames.addLast(Sent(held, nowMs))
        chars += held.frame.length
        while (frames.isNotEmpty() &&
            (frames.size > maxFrames ||
                (chars > maxChars && frames.size > 1) ||
                nowMs - frames.first().sentAtMs > maxAgeMs)
        ) {
            chars -= frames.removeFirst().held.frame.length
        }
    }

    /** Pass frames sent at or after [cutoffMs] to [keep], oldest first, and empty the ring. */
    fun drainSince(cutoffMs: Long, keep: (BridgeSocketServer.Held) -> Unit): Int {
        var passed = 0
        for (sent in frames) {
            if (sent.sentAtMs >= cutoffMs) {
                keep(sent.held)
                passed++
            }
        }
        clear()
        return passed
    }

    fun clear() {
        frames.clear()
        chars = 0L
    }
}
