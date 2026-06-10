package com.github.Qortal.qortalMobile

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
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
import network.reticulum.Reticulum
import network.reticulum.interfaces.tcp.TCPClientInterface
import network.reticulum.interfaces.toRef
import network.reticulum.transport.AnnounceHandler
import network.reticulum.transport.Transport
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Native Reticulum transport bridge.
 *
 * Runs the Kotlin RNS stack (reticulum-kt) in client-only mode and connects to
 * the Qortal community Reticulum hubs over TCP with IFAC keyed by
 * `network_name = qortal-hub` — the exact parameters Qortal Hub (Electron) uses.
 *
 * This is the transport substrate the v2.0 features (voice calls, direct file
 * transfer, presence) ride on. The web UI talks to it through `window.Reticulum`
 * (see src/plugins/Reticulum.ts).
 */
@CapacitorPlugin(name = "Reticulum")
class ReticulumPlugin : Plugin() {

    companion object {
        private const val TAG = "ReticulumPlugin"
        private const val DEFAULT_NETNAME = "qortal-hub"

        // Qortal community Reticulum hubs (TCPClientInterface; Backbone is Linux-only).
        private val DEFAULT_HUBS = listOf(
            Triple("Qortal Hub 1", "reticulum.qortal.link", 4444),
            Triple("Qortal Hub 2", "reticulum2.qortal.link", 4444),
        )
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val interfaces = mutableListOf<TCPClientInterface>()
    private val announceCount = AtomicInteger(0)
    @Volatile private var started = false
    @Volatile private var netname: String = DEFAULT_NETNAME

    // ── Python presence bridge (Chaquopy) ──────────────────────────────────
    // Runs the proven Qortal RNS presence bridge (presence_bridge.py) in an
    // embedded CPython interpreter. The web UI's window.presence forwards
    // signed announce/heartbeat/offline envelopes here via publishPresence().
    private val presenceWorker = Executors.newSingleThreadExecutor()
    @Volatile private var presenceHost: PyObject? = null
    @Volatile private var presenceStarted = false
    @Volatile private var presenceReaderRunning = false
    private var presenceReader: Thread? = null

    @PluginMethod
    fun start(call: PluginCall) {
        if (started) {
            call.resolve(statusObject())
            return
        }
        netname = call.getString("networkName", DEFAULT_NETNAME) ?: DEFAULT_NETNAME
        worker.execute {
            try {
                val configDir = File(context.filesDir, "reticulum").apply { mkdirs() }
                Reticulum.start(configDir = configDir.absolutePath, enableTransport = false)

                Transport.registerAnnounceHandler(handler = AnnounceHandler { destHash, _, _ ->
                    val hex = destHash.joinToString("") { "%02x".format(it) }
                    announceCount.incrementAndGet()
                    val ev = JSObject().put("destinationHash", hex)
                    notifyListeners("announce", ev)
                    true
                })

                for ((name, host, port) in DEFAULT_HUBS) {
                    val iface = TCPClientInterface(
                        name = name,
                        targetHost = host,
                        targetPort = port,
                        ifacNetname = netname,
                    )
                    iface.onPacketReceived = { data, ifc -> Transport.inbound(data, ifc.toRef()) }
                    Transport.registerInterface(iface.toRef())
                    iface.start()
                    interfaces.add(iface)
                }

                started = true
                Log.i(TAG, "Reticulum started: ${interfaces.size} hub interfaces, netname=$netname")
                notifyListeners("status", statusObject())
                call.resolve(statusObject())
            } catch (t: Throwable) {
                Log.e(TAG, "Reticulum start failed", t)
                call.reject("Reticulum start failed: ${t.message}", t as? Exception)
            }
        }
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(statusObject())
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        worker.execute {
            try {
                interfaces.forEach { runCatching { it.detach() } }
                interfaces.clear()
                if (started) Reticulum.stop()
                started = false
                call.resolve(JSObject().put("stopped", true))
            } catch (t: Throwable) {
                Log.e(TAG, "Reticulum stop failed", t)
                call.reject("Reticulum stop failed: ${t.message}", t as? Exception)
            }
        }
    }

    // ── Presence bridge methods ─────────────────────────────────────────────

    @PluginMethod
    fun presenceStart(call: PluginCall) {
        if (presenceStarted) {
            call.resolve(JSObject().put("started", true))
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
     * plain app-storage path (exposed through the app's FileProvider).
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
            val mimeType = android.webkit.MimeTypeMap.getSingleton()
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
        if (presenceReaderRunning) return
        presenceReaderRunning = true
        presenceReader = Thread({
            val host = presenceHost ?: return@Thread
            while (presenceReaderRunning) {
                try {
                    val frame = host.callAttr("poll", 250).toString()
                    if (frame.isNotEmpty()) {
                        notifyListeners("presence", JSObject().put("frame", frame))
                    }
                } catch (t: Throwable) {
                    Log.e(TAG, "Presence reader error", t)
                    try { Thread.sleep(500) } catch (_: InterruptedException) {}
                }
            }
        }, "presence-reader").apply { isDaemon = true; start() }
    }

    private fun statusObject(): JSObject {
        val online = interfaces.any { runCatching { it.online.value }.getOrDefault(false) }
        val rx = interfaces.sumOf { runCatching { it.rxBytes.get() }.getOrDefault(0L) }
        val tx = interfaces.sumOf { runCatching { it.txBytes.get() }.getOrDefault(0L) }
        val ifacSize = interfaces.firstOrNull()?.let { runCatching { it.ifacSize }.getOrDefault(0) } ?: 0
        return JSObject()
            .put("started", started)
            .put("online", online)
            .put("networkName", netname)
            .put("ifacSize", ifacSize)
            .put("interfaces", interfaces.size)
            .put("announces", announceCount.get())
            .put("rxBytes", rx)
            .put("txBytes", tx)
    }

    override fun handleOnDestroy() {
        runCatching {
            presenceReaderRunning = false
            if (presenceStarted) presenceHost?.callAttr("stop")
        }
        runCatching {
            interfaces.forEach { runCatching { it.detach() } }
            if (started) Reticulum.stop()
        }
        super.handleOnDestroy()
    }
}
