package com.github.Qortal.qortalMobile

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
 */
class BridgeSocketServer(
    private val allowedOrigin: String?,
    private val onCommand: (client: Client, frame: String) -> Unit,
    private val onFsRequest: (client: Client, request: org.json.JSONObject) -> Unit,
) : NanoWSD("127.0.0.1", 0) {

    companion object {
        private const val TAG = "BridgeSocket"
        private const val OUTBOUND_QUEUE_CAPACITY = 8192

        fun newToken(): String {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }

    val token: String = newToken()
    private val clients = CopyOnWriteArraySet<Client>()
    private val dropped = AtomicInteger(0)

    fun startListening() {
        // timeout 0 = no socket read timeout; the WebSocket read loop must not
        // be torn down by idle periods.
        start(0, true)
        Log.i(TAG, "bridge socket listening on 127.0.0.1:$listeningPort")
    }

    fun url(): String = "ws://127.0.0.1:$listeningPort/bridge"

    fun clientCount(): Int = clients.size

    /** Fan a Python frame out to every connected worker. Never blocks the caller. */
    fun broadcast(frame: String) {
        if (clients.isEmpty()) return
        for (client in clients) client.enqueue(frame)
    }

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket = Client(handshake)

    inner class Client(handshake: NanoHTTPD.IHTTPSession) : WebSocket(handshake) {
        private val authorized: Boolean
        private val outbound = LinkedBlockingQueue<String>(OUTBOUND_QUEUE_CAPACITY)
        @Volatile private var writerRunning = false
        private var writer: Thread? = null

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

        /** Queue a frame for this client; drops the oldest frame if the worker is stalled. */
        fun enqueue(frame: String) {
            if (!writerRunning) return
            if (outbound.offer(frame)) return
            outbound.poll()
            if (!outbound.offer(frame)) return
            val n = dropped.incrementAndGet()
            if (n % 500 == 1) Log.w(TAG, "bridge socket outbound queue full, dropped=$n")
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
            writer = Thread({
                while (writerRunning) {
                    // Block until a frame arrives; onClose interrupts the
                    // thread, so no polling timeout is needed.
                    val frame = try {
                        outbound.take()
                    } catch (_: InterruptedException) {
                        break
                    }
                    try {
                        send(frame)
                    } catch (e: IOException) {
                        Log.w(TAG, "bridge socket send failed: ${e.message}")
                        writerRunning = false
                        break
                    }
                }
            }, "bridge-socket-writer").apply { isDaemon = true; start() }
            clients.add(this)
            Log.i(TAG, "bridge socket client connected (clients=${clients.size})")
        }

        override fun onClose(
            code: WebSocketFrame.CloseCode?,
            reason: String?,
            initiatedByRemote: Boolean,
        ) {
            writerRunning = false
            clients.remove(this)
            writer?.interrupt()
            Log.i(TAG, "bridge socket client closed code=$code remote=$initiatedByRemote (clients=${clients.size})")
        }

        override fun onMessage(message: WebSocketFrame) {
            if (!authorized) return
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
            writerRunning = false
            clients.remove(this)
            writer?.interrupt()
        }
    }
}
