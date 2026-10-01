package com.github.Qortal.qortalMobile

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Log
import com.chaquo.python.PyObject
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Native Reticulum bridge.
 *
 * Hosts the Chaquopy-embedded Python presence bridge (presence_bridge.py),
 * which owns the single RNS instance connected to the Qortal community hubs
 * (IFAC `network_name = qortal-hub`, the same parameters Qortal Hub uses).
 * Chat, presence, calls and file transfer all ride on that instance; the
 * transport status the badge shows is read from it too. The web UI talks to
 * this plugin through `window.Reticulum` (see src/plugins/Reticulum.ts).
 */
@CapacitorPlugin(name = "Reticulum")
class ReticulumPlugin : Plugin() {

    companion object {
        private const val TAG = "ReticulumPlugin"
        private const val DEFAULT_NETNAME = "qortal-hub"
        /** Lets the offline presence notice leave before logout closes the hubs. */
        private const val LOGOUT_NETWORK_PAUSE_DELAY_MS = 5_000L

        // Process-lifetime state. MainActivity / the Capacitor plugin are
        // destroyed on swipe-away; the foreground service keeps this process.
        // Stopping Python on that destroy ran on the UI thread and blocked
        // the next launch until the leftover process died (~1 min).
        @Volatile private var started = false
        @Volatile private var netname: String = DEFAULT_NETNAME
        private val presenceWorker = Executors.newSingleThreadExecutor()
        @Volatile private var presenceHost: PyObject? = null
        @Volatile private var presenceStarted = false
        @Volatile private var presenceReaderRunning = false
        @Volatile private var presenceConfigDir: String = ""
        private var presenceReader: Thread? = null
        // A reader from a destroyed Activity may still sit in poll() when the
        // next one starts; it exits once it sees a newer generation.
        @Volatile private var presenceReaderGeneration = 0
        private val presenceReaderLock = Any()
        // Direct worker <-> bridge channel; process-lifetime like the reader.
        @Volatile private var bridgeSocket: BridgeSocketServer? = null
        private val bridgeSocketLock = Any()

        // Network pause: hub sockets closed while no GO screen needs the mesh
        // (dataSync time-out, swipe from recents, logout). The Python bridge
        // stays up, so JS never has to start it again. Only presenceWorker
        // touches networkPaused, which orders every pause and resume.
        private var networkPaused = false
        private val pauseHandler = Handler(Looper.getMainLooper())
        private val pauseLock = Any()
        private var pendingPause: Runnable? = null
        // Bumped by every pause/resume request; a pause that is overtaken by
        // a resume before it reaches presenceWorker is dropped.
        private var networkRequestSeq = 0L

        /**
         * Close the hub sockets after [delayMs] (0 = now). A later
         * [resumeNetwork] cancels a pause that has not run yet. Never blocks
         * the caller: the Python call runs on presenceWorker (see
         * handleOnDestroy for why the UI thread must not wait on Python).
         */
        @JvmStatic
        fun pauseNetwork(reason: String, delayMs: Long) {
            val seq: Long
            val task: Runnable
            synchronized(pauseLock) {
                pendingPause?.let { pauseHandler.removeCallbacks(it) }
                seq = ++networkRequestSeq
                // Removing an already-run task later is a harmless no-op.
                task = Runnable { runPause(reason, seq) }
                pendingPause = if (delayMs > 0) task else null
            }
            if (delayMs > 0) pauseHandler.postDelayed(task, delayMs) else task.run()
        }

        private fun runPause(reason: String, seq: Long) {
            presenceWorker.execute {
                synchronized(pauseLock) {
                    if (seq != networkRequestSeq) return@execute
                }
                val host = presenceHost
                if (host == null || !presenceStarted || networkPaused) return@execute
                try {
                    // Frames kept for a reconnecting worker predate the pause.
                    // Clear first so the link-closed events the pause emits
                    // still reach the next worker.
                    bridgeSocket?.clearHandover()
                    host.callAttr("pause_network")
                    networkPaused = true
                    Log.i(TAG, "Presence network paused ($reason)")
                } catch (t: Throwable) {
                    Log.e(TAG, "Presence network pause failed ($reason)", t)
                }
            }
        }

        /**
         * Feed one command [frame] to the Python bridge from native code, with
         * no page involved; a no-op when the bridge is not running. Never
         * blocks the caller (runs on presenceWorker).
         */
        @JvmStatic
        fun feedPresenceFrame(frame: String, reason: String) {
            presenceWorker.execute {
                val host = presenceHost
                if (host == null || !presenceStarted) return@execute
                try {
                    host.callAttr("feed", frame)
                } catch (t: Throwable) {
                    Log.e(TAG, "Presence command failed ($reason)", t)
                }
            }
        }

        /** Redial the hubs after [pauseNetwork]; a no-op when not paused. */
        @JvmStatic
        fun resumeNetwork(reason: String) {
            synchronized(pauseLock) {
                pendingPause?.let { pauseHandler.removeCallbacks(it) }
                pendingPause = null
                networkRequestSeq++
            }
            presenceWorker.execute {
                val host = presenceHost
                if (host == null || !networkPaused) return@execute
                try {
                    host.callAttr("resume_network")
                    networkPaused = false
                    Log.i(TAG, "Presence network resumed ($reason)")
                } catch (t: Throwable) {
                    Log.e(TAG, "Presence network resume failed ($reason)", t)
                }
            }
        }
    }

    @PluginMethod
    fun start(call: PluginCall) {
        // Transport lives in the Python presence bridge (see presenceStart);
        // this used to boot a second reticulum-kt stack with its own hub
        // sockets, keepalives and announce processing purely to feed the
        // status badge. The badge now reads the bridge's own interfaces.
        netname = call.getString("networkName", DEFAULT_NETNAME) ?: DEFAULT_NETNAME
        started = true
        call.resolve(statusObject())
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(statusObject())
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        started = false
        call.resolve(JSObject().put("stopped", true))
    }

    /**
     * Logout: nothing signed in needs the mesh, so close the hub sockets.
     * The default delay lets the offline presence notice sent just before
     * logout leave first. The next presenceStart or status service start
     * redials. Kept apart from stopping the status service, which the page
     * also does when it only changes layout (e.g. rotation).
     *
     * Frames kept for a reconnecting worker are dropped now, not when the
     * delayed pause runs: a quick login cancels that pause, and the kept
     * frames would then be replayed after the next login. The engine worker
     * is shared across accounts; if none is connected now, nothing more is
     * kept until one connects, otherwise the connected one keeps getting
     * frames live and its later gaps stay covered. This call is the only
     * native signal that the signed-in session ended.
     */
    @PluginMethod
    fun presencePauseNetwork(call: PluginCall) {
        bridgeSocket?.endSession()
        // Signed out: no background keep-alive or wake lock for this page.
        context?.let { BackgroundKeepAlive.get(it).setSessionActive(false) }
        val delayMs = (call.getInt("delayMs") ?: LOGOUT_NETWORK_PAUSE_DELAY_MS.toInt())
            .coerceIn(0, 60_000)
        pauseNetwork(call.getString("reason") ?: "logout", delayMs.toLong())
        call.resolve(JSObject().put("ok", true))
    }

    // ── Presence bridge methods ─────────────────────────────────────────────

    @PluginMethod
    fun presenceStart(call: PluginCall) {
        // Only a signed-in page starts the presence bridge.
        context?.let { BackgroundKeepAlive.get(it).setSessionActive(true) }
        if (presenceStarted) {
            if (!presenceReaderRunning) startPresenceReader()
            // A new page after a swipe or logout: the hubs were paused.
            resumeNetwork("presence_start")
            reemitPresenceReady()
            call.resolve(JSObject().put("started", true).put("reused", true))
            return
        }
        presenceWorker.execute {
            try {
                if (!Python.isStarted()) {
                    Python.start(AndroidPlatform(context))
                }
                val py = Python.getInstance()
                val host = py.getModule("qortal_presence_host")
                presenceHost = host

                val configDir = File(context.filesDir, "reticulum-presence").apply { mkdirs() }
                presenceConfigDir = configDir.absolutePath
                host.callAttr("start", configDir.absolutePath)
                presenceStarted = true

                startPresenceReader()

                // Kick the bridge: open its RNS instance + presence destination.
                val startCmd = JSONObject()
                    .put("type", "cmd")
                    .put("id", "start")
                    .put("action", "start")
                    .put("payload", JSONObject().put("configDir", configDir.absolutePath))
                host.callAttr("feed", startCmd.toString())

                Log.i(TAG, "Presence bridge started (configDir=${configDir.absolutePath})")
                call.resolve(JSObject().put("started", true))
            } catch (t: Throwable) {
                Log.e(TAG, "Presence bridge start failed", t)
                call.reject("Presence bridge start failed: ${t.message}", t as? Exception)
            }
        }
    }

    @PluginMethod
    fun publishPresence(call: PluginCall) {
        val host = presenceHost
        if (host == null || !presenceStarted) {
            call.reject("Presence bridge not started")
            return
        }
        val envelope = call.getObject("envelope")
        if (envelope == null) {
            call.reject("Missing envelope")
            return
        }
        presenceWorker.execute {
            try {
                val cmd = JSONObject()
                    .put("type", "cmd")
                    .put("id", UUID.randomUUID().toString())
                    .put("action", "publish_presence")
                    .put("payload", JSONObject().put("envelope", JSONObject(envelope.toString())))
                host.callAttr("feed", cmd.toString())
                call.resolve(JSObject().put("ok", true))
            } catch (t: Throwable) {
                Log.e(TAG, "publishPresence failed", t)
                call.reject("publishPresence failed: ${t.message}", t as? Exception)
            }
        }
    }

    /**
     * Generic command passthrough to presence_bridge.py.
     *
     * The Hub presence overlay needs more than publish: the mobile coordinator
     * (capacitorBridge.ts) drives `overlay_sync_state` (who to fan out to),
     * `forward_presence`, etc. This forwards an arbitrary `{action, payload}`
     * as a well-formed `cmd` frame so the TS layer can speak the full bridge
     * protocol without a new native method per action.
     */
    @PluginMethod
    fun presenceCommand(call: PluginCall) {
        val host = presenceHost
        if (host == null || !presenceStarted) {
            call.reject("Presence bridge not started")
            return
        }
        val action = call.getString("action")
        if (action == null) {
            call.reject("Missing action")
            return
        }
        val payload = call.getObject("payload") ?: JSObject()
        // Optional caller-supplied id lets the JS layer correlate the bridge's
        // `{type:"resp", id, ...}` frame with this command (request/response).
        val cmdId = call.getString("id") ?: UUID.randomUUID().toString()
        presenceWorker.execute {
            try {
                val cmd = JSONObject()
                    .put("type", "cmd")
                    .put("id", cmdId)
                    .put("action", action)
                    .put("payload", JSONObject(payload.toString()))
                host.callAttr("feed", cmd.toString())
                call.resolve(JSObject().put("ok", true).put("id", cmdId))
            } catch (t: Throwable) {
                Log.e(TAG, "presenceCommand($action) failed", t)
                call.reject("presenceCommand failed: ${t.message}", t as? Exception)
            }
        }
    }

    // ── Direct worker bridge socket ─────────────────────────────────────────

    /**
     * Returns the loopback WebSocket endpoint the chat engine worker uses to
     * reach the Python bridge without going through the WebView main thread.
     * Starts the server on first use. See BridgeSocketServer for the protocol.
     */
    @PluginMethod
    fun bridgeSocket(call: PluginCall) {
        try {
            val server = ensureBridgeSocket()
            call.resolve(
                JSObject()
                    .put("url", server.url())
                    .put("token", server.token)
            )
        } catch (t: Throwable) {
            Log.e(TAG, "bridgeSocket failed", t)
            call.reject("bridgeSocket failed: ${t.message}", t as? Exception)
        }
    }

    private fun ensureBridgeSocket(): BridgeSocketServer {
        bridgeSocket?.let { return it }
        synchronized(bridgeSocketLock) {
            bridgeSocket?.let { return it }
            val origin = try {
                bridge?.localUrl
            } catch (_: Throwable) {
                null
            }
            val server = BridgeSocketServer(
                allowedOrigin = origin,
                onCommand = { client, frame -> handleSocketCommand(client, frame) },
                onFsRequest = { client, request -> handleSocketFsRequest(client, request) },
            )
            server.startListening()
            bridgeSocket = server
            return server
        }
    }

    /** A worker command frame: feed to Python on the same executor as plugin calls. */
    private fun handleSocketCommand(client: BridgeSocketServer.Client, frame: String) {
        val host = presenceHost
        if (host == null || !presenceStarted) {
            val id = try {
                JSONObject(frame).optString("id")
            } catch (_: Throwable) {
                ""
            }
            client.enqueue(
                JSONObject()
                    .put("type", "resp")
                    .put("id", id)
                    .put("ok", false)
                    .put("error", "Presence bridge not started")
                    .toString()
            )
            return
        }
        presenceWorker.execute {
            try {
                host.callAttr("feed", frame)
            } catch (t: Throwable) {
                Log.e(TAG, "bridge socket feed failed", t)
            }
        }
    }

    /** Chat-resource staging op from the worker; same confinement as the plugin methods. */
    private fun handleSocketFsRequest(client: BridgeSocketServer.Client, request: JSONObject) {
        val id = request.optString("id")
        val op = request.optString("op")
        val args = request.optJSONObject("args") ?: JSONObject()
        fileWorker.execute {
            val reply = JSONObject().put("type", "fsres").put("id", id)
            try {
                val result: JSONObject = when (op) {
                    "path" -> stagedResourcePath(args.optString("name", "blob"))
                    "read" -> stagedResourceRead(args.optString("path"))
                    "write" -> stagedResourceWrite(args.optString("path"), args.optString("dataBase64"))
                    "delete" -> {
                        stagedResourceDelete(args.optString("path"))
                        JSONObject()
                    }
                    else -> throw IllegalArgumentException("unknown native fs op: $op")
                }
                reply.put("result", result)
            } catch (t: Throwable) {
                reply.put("error", t.message ?: t.toString())
            }
            client.enqueue(reply.toString())
        }
    }

    // ── Q-Chat Reticulum file transfer helpers ──────────────────────────────
    // The Python bridge reads/writes plain filesystem paths, while Android file
    // pickers hand the WebView opaque content:// URIs. These helpers stage
    // picked files into app storage (and back out to public Downloads) so the
    // bridge's send/accept actions can stream them as RNS Resources.

    private val fileWorker = Executors.newSingleThreadExecutor()

    /**
     * Copies a picked file (content:// or file:// URI, or a plain path) into
     * the app cache and returns `{ path, name, size, sha256 }` for the bridge.
     */
    @PluginMethod
    fun qchatFilePrepare(call: PluginCall) {
        val rawUri = call.getString("uri")
        if (rawUri.isNullOrBlank()) {
            call.reject("Missing uri")
            return
        }
        fileWorker.execute {
            try {
                val resolvedName = call.getString("name")
                    ?: resolveDisplayName(rawUri)
                    ?: "shared-file"
                val safeName = sanitizeFileName(resolvedName)
                val destDir = File(context.cacheDir, "qchat-send/${UUID.randomUUID()}")
                    .apply { mkdirs() }
                val destFile = File(destDir, safeName)

                val input = openUriStream(rawUri)
                    ?: throw IllegalStateException("Unable to open file stream")
                val digest = MessageDigest.getInstance("SHA-256")
                var total = 0L
                input.use { stream ->
                    destFile.outputStream().use { out ->
                        val buf = ByteArray(256 * 1024)
                        while (true) {
                            val n = stream.read(buf)
                            if (n <= 0) break
                            out.write(buf, 0, n)
                            digest.update(buf, 0, n)
                            total += n
                        }
                    }
                }
                if (total <= 0L) {
                    destFile.delete()
                    throw IllegalStateException("Selected file is empty")
                }
                val sha256 = digest.digest().joinToString("") { "%02x".format(it) }
                call.resolve(
                    JSObject()
                        .put("path", destFile.absolutePath)
                        .put("name", safeName)
                        .put("size", total)
                        .put("sha256", sha256)
                )
            } catch (t: Throwable) {
                Log.e(TAG, "qchatFilePrepare failed", t)
                call.reject("qchatFilePrepare failed: ${t.message}", t as? Exception)
            }
        }
    }

    /** Returns a unique, bridge-writable save path for an inbound transfer. */
    @PluginMethod
    fun qchatFileSavePath(call: PluginCall) {
        try {
            val requested = sanitizeFileName(call.getString("fileName") ?: "received-file")
            val baseDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: File(context.filesDir, "downloads")
            val dir = File(baseDir, "QortalFiles").apply { mkdirs() }
            var candidate = File(dir, requested)
            if (candidate.exists()) {
                val dot = requested.lastIndexOf('.')
                val stem = if (dot > 0) requested.substring(0, dot) else requested
                val ext = if (dot > 0) requested.substring(dot) else ""
                var i = 1
                while (candidate.exists() && i < 1000) {
                    candidate = File(dir, "$stem ($i)$ext")
                    i += 1
                }
            }
            call.resolve(JSObject().put("path", candidate.absolutePath))
        } catch (t: Throwable) {
            Log.e(TAG, "qchatFileSavePath failed", t)
            call.reject("qchatFileSavePath failed: ${t.message}", t as? Exception)
        }
    }

    /**
     * Staging area for chat-engine resource transfers.
     *
     * The engine runs in a WebView worker whose filesystem is OPFS, which the
     * python bridge cannot see. Resource payloads therefore have to be handed
     * over through real files: the engine stages outbound blobs here for python
     * to read, and hands python a path in here to write inbound blobs to.
     * Everything is confined to this directory so the bridge never turns into
     * an arbitrary-path read primitive.
     */
    private fun chatResourceStageDir(): File =
        File(context.cacheDir, "reticulum-chat-resources").apply { mkdirs() }

    /** Rejects paths outside the staging directory. */
    private fun resolveStagedFile(path: String): File? {
        val dir = chatResourceStageDir().canonicalFile
        val file = File(path).canonicalFile
        return if (file.parentFile == dir) file else null
    }

    private fun stagedResourcePath(name: String): JSONObject {
        val requested = sanitizeFileName(name.ifBlank { "blob" })
        val file = File(chatResourceStageDir(), "${UUID.randomUUID()}-$requested")
        return JSONObject().put("path", file.absolutePath)
    }

    private fun stagedResourceWrite(path: String, dataBase64: String?): JSONObject {
        if (path.isBlank() || dataBase64 == null) {
            throw IllegalArgumentException("Missing path or dataBase64")
        }
        val file = resolveStagedFile(path)
            ?: throw IllegalArgumentException("Path is outside the chat resource staging directory")
        val bytes = android.util.Base64.decode(dataBase64, android.util.Base64.DEFAULT)
        file.writeBytes(bytes)
        return JSONObject().put("path", file.absolutePath).put("size", bytes.size)
    }

    private fun stagedResourceRead(path: String): JSONObject {
        if (path.isBlank()) throw IllegalArgumentException("Missing path")
        val file = resolveStagedFile(path)
        if (file == null || !file.isFile) {
            throw IllegalStateException("Chat resource file is unavailable")
        }
        val bytes = file.readBytes()
        return JSONObject()
            .put("dataBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
            .put("size", bytes.size)
    }

    private fun stagedResourceDelete(path: String) {
        if (path.isBlank()) throw IllegalArgumentException("Missing path")
        resolveStagedFile(path)?.delete()
    }

    @PluginMethod
    fun chatResourcePath(call: PluginCall) {
        try {
            call.resolve(JSObject.fromJSONObject(stagedResourcePath(call.getString("name") ?: "blob")))
        } catch (t: Throwable) {
            call.reject("chatResourcePath failed: ${t.message}", t as? Exception)
        }
    }

    @PluginMethod
    fun chatResourceWrite(call: PluginCall) {
        val path = call.getString("path")
        val dataBase64 = call.getString("dataBase64")
        if (path.isNullOrBlank() || dataBase64 == null) {
            call.reject("Missing path or dataBase64")
            return
        }
        fileWorker.execute {
            try {
                call.resolve(JSObject.fromJSONObject(stagedResourceWrite(path, dataBase64)))
            } catch (t: Throwable) {
                call.reject("chatResourceWrite failed: ${t.message}", t as? Exception)
            }
        }
    }

    @PluginMethod
    fun chatResourceRead(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) {
            call.reject("Missing path")
            return
        }
        fileWorker.execute {
            try {
                call.resolve(JSObject.fromJSONObject(stagedResourceRead(path)))
            } catch (t: Throwable) {
                call.reject("chatResourceRead failed: ${t.message}", t as? Exception)
            }
        }
    }

    @PluginMethod
    fun chatResourceDelete(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) {
            call.reject("Missing path")
            return
        }
        fileWorker.execute {
            try {
                stagedResourceDelete(path)
                call.resolve()
            } catch (t: Throwable) {
                call.reject("chatResourceDelete failed: ${t.message}", t as? Exception)
            }
        }
    }

    /** Existence/size probe used to prune stale pending sends after restart. */
    @PluginMethod
    fun qchatFileStat(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) {
            call.reject("Missing path")
            return
        }
        val f = File(path)
        call.resolve(
            JSObject()
                .put("exists", f.isFile)
                .put("size", if (f.isFile) f.length() else 0L)
        )
    }

    /**
     * Copies a completed inbound transfer into the public Downloads collection
     * (MediaStore) so the user can find it outside the app sandbox.
     */
    @PluginMethod
    fun qchatFileExportToDownloads(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) {
            call.reject("Missing path")
            return
        }
        fileWorker.execute {
            try {
                val source = File(path)
                if (!source.isFile) throw IllegalStateException("File not found")
                val fileName = sanitizeFileName(
                    call.getString("fileName") ?: source.name
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                        put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val resolver = context.contentResolver
                    val uri = resolver.insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        values
                    ) ?: throw IllegalStateException("Unable to create Downloads entry")
                    resolver.openOutputStream(uri).use { out ->
                        if (out == null) throw IllegalStateException("Unable to open Downloads stream")
                        FileInputStream(source).use { it.copyTo(out, 256 * 1024) }
                    }
                    values.clear()
                    values.put(MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    call.resolve(JSObject().put("ok", true).put("uri", uri.toString()))
                } else {
                    @Suppress("DEPRECATION")
                    val downloads = Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS
                    ).apply { mkdirs() }
                    val dest = File(downloads, fileName)
                    FileInputStream(source).use { input ->
                        dest.outputStream().use { input.copyTo(it, 256 * 1024) }
                    }
                    call.resolve(JSObject().put("ok", true).put("uri", dest.absolutePath))
                }
            } catch (t: Throwable) {
                Log.e(TAG, "qchatFileExportToDownloads failed", t)
                call.reject(
                    "qchatFileExportToDownloads failed: ${t.message}",
                    t as? Exception
                )
            }
        }
    }

    /**
     * Opens a received file in the user's preferred viewer app. Accepts the
     * MediaStore content:// URI returned by qchatFileExportToDownloads or a
     * plain app-storage path (exposed through the app's FileProvider). An
     * optional `mimeType` wins over the extension guess, which knows nothing
     * about e.g. `.md`.
     */
    @PluginMethod
    fun qchatFileOpen(call: PluginCall) {
        val rawUri = call.getString("uri")
        if (rawUri.isNullOrBlank()) {
            call.reject("Missing uri")
            return
        }
        try {
            val fileName = call.getString("fileName") ?: rawUri.substringAfterLast('/')
            val contentUri: Uri = if (rawUri.startsWith("content://")) {
                Uri.parse(rawUri)
            } else {
                val file = File(
                    if (rawUri.startsWith("file://")) Uri.parse(rawUri).path ?: rawUri
                    else rawUri
                )
                if (!file.isFile) throw IllegalStateException("File not found")
                androidx.core.content.FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    file
                )
            }
            val extension = fileName.substringAfterLast('.', "").lowercase()
            val mimeType = call.getString("mimeType")
                ?.takeIf { it.isNotBlank() && it != "application/octet-stream" }
                ?: android.webkit.MimeTypeMap.getSingleton()
                    .getMimeTypeFromExtension(extension)
                ?: "*/*"
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, mimeType)
                addFlags(
                    android.content.Intent.FLAG_ACTIVITY_NEW_TASK or
                        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
            context.startActivity(
                android.content.Intent.createChooser(intent, "Open $fileName").apply {
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
            call.resolve(JSObject().put("ok", true))
        } catch (t: Throwable) {
            Log.e(TAG, "qchatFileOpen failed", t)
            call.reject("qchatFileOpen failed: ${t.message}", t as? Exception)
        }
    }

    private fun openUriStream(rawUri: String): InputStream? {
        return when {
            rawUri.startsWith("content://") ->
                context.contentResolver.openInputStream(Uri.parse(rawUri))
            rawUri.startsWith("file://") ->
                FileInputStream(File(Uri.parse(rawUri).path ?: return null))
            else -> {
                val f = File(rawUri)
                if (f.isFile) FileInputStream(f) else null
            }
        }
    }

    private fun resolveDisplayName(rawUri: String): String? {
        if (!rawUri.startsWith("content://")) {
            return rawUri.substringAfterLast('/').takeIf { it.isNotBlank() }
        }
        return try {
            context.contentResolver.query(
                Uri.parse(rawUri),
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (t: Throwable) {
            null
        }
    }

    private fun sanitizeFileName(name: String): String {
        val trimmed = name.trim().replace(Regex("[/\\\\\u0000]"), "_")
        val safe = trimmed.ifBlank { "shared-file" }
        return if (safe.length > 200) safe.takeLast(200) else safe
    }

    @PluginMethod
    fun presenceStop(call: PluginCall) {
        presenceWorker.execute {
            try {
                presenceReaderRunning = false
                presenceHost?.callAttr("stop")
                presenceStarted = false
                call.resolve(JSObject().put("stopped", true))
            } catch (t: Throwable) {
                call.reject("Presence bridge stop failed: ${t.message}", t as? Exception)
            }
        }
    }

    /** Drains JSON frames emitted by the Python bridge and relays them to JS. */
    private fun startPresenceReader() {
        val generation: Int
        synchronized(presenceReaderLock) {
            if (presenceReaderRunning) return
            presenceReaderRunning = true
            generation = ++presenceReaderGeneration
        }
        presenceReader = Thread({
            val host = presenceHost ?: return@Thread
            // The generation check retires a reader left over from a destroyed
            // Activity, which would otherwise keep taking frames for a dead
            // plugin instance alongside the new one.
            while (presenceReaderRunning && generation == presenceReaderGeneration) {
                try {
                    // poll() returns the moment a frame is queued; the timeout
                    // only bounds how long a stop takes to be noticed. 250 ms
                    // meant four JNI/GIL hops per idle second; 2 s was 0.5 Hz.
                    // 5 s is 0.2 Hz when the queue is empty and still wakes
                    // immediately when a frame arrives.
                    val frame = host.callAttr("poll", 5000).toString()
                    if (frame.isNotEmpty()) {
                        // The worker's direct socket gets the frame first: it is
                        // a queue hand-off, whereas notifyListeners posts to the
                        // (possibly saturated) WebView main thread.
                        bridgeSocket?.broadcast(frame)
                        notifyListeners("presence", JSObject().put("frame", frame))
                    }
                } catch (t: Throwable) {
                    Log.e(TAG, "Presence reader error", t)
                    try { Thread.sleep(500) } catch (_: InterruptedException) {}
                }
            }
        }, "presence-reader").apply { isDaemon = true; start() }
    }

    /** handle_start is idempotent and re-emits `ready` for a new WebView. */
    private fun reemitPresenceReady() {
        val host = presenceHost ?: return
        val configDir = presenceConfigDir
        if (configDir.isEmpty()) return
        presenceWorker.execute {
            try {
                val startCmd = JSONObject()
                    .put("type", "cmd")
                    .put("id", "start-reattach")
                    .put("action", "start")
                    .put("payload", JSONObject().put("configDir", configDir))
                host.callAttr("feed", startCmd.toString())
            } catch (t: Throwable) {
                Log.e(TAG, "Presence ready re-emit failed", t)
            }
        }
    }

    private fun statusObject(): JSObject {
        val result = JSObject()
            .put("started", started)
            .put("online", false)
            .put("networkName", netname)
            .put("ifacSize", 0)
            .put("interfaces", 0)
            .put("announces", 0)
            .put("rxBytes", 0L)
            .put("txBytes", 0L)
        val host = presenceHost ?: return result
        if (!presenceStarted) return result
        return try {
            val snapshot = JSONObject(host.callAttr("transport_status").toString())
            result
                .put("online", snapshot.optBoolean("online", false))
                .put("ifacSize", snapshot.optInt("ifacSize", 0))
                .put("interfaces", snapshot.optInt("interfaces", 0))
                .put("announces", snapshot.optInt("announces", 0))
                .put("rxBytes", snapshot.optLong("rxBytes", 0L))
                .put("txBytes", snapshot.optLong("txBytes", 0L))
                // Per packet-type byte tallies (diagnostics; see
                // qortal_presence_host._install_packet_mix_counters).
                .put("packetMix", snapshot.optJSONArray("packetMix") ?: JSONArray())
                .put("cryptoBackend", snapshot.optString("cryptoBackend", ""))
        } catch (t: Throwable) {
            Log.w(TAG, "transport_status failed: ${t.message}")
            result
        }
    }

    override fun load() {
        super.load()
        if (presenceStarted && !presenceReaderRunning) {
            startPresenceReader()
            reemitPresenceReady()
        }
    }

    override fun handleOnDestroy() {
        // Detach the JS pump only. Stopping Python/RNS here blocked the UI
        // thread and left the process unable to start a new Activity.
        presenceReaderRunning = false
        super.handleOnDestroy()
    }
}
