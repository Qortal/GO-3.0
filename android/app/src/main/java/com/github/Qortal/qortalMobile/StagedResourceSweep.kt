package com.github.Qortal.qortalMobile

import java.io.File

/**
 * Deletes leftovers in the chat resource staging directory
 * (cacheDir/reticulum-chat-resources). The worker copies every outbound
 * resource there for Python to read and deletes it on the transfer's
 * terminal status; a worker that restarted, crashed or never saw that status
 * leaves the file behind. Run once when the worker's bridge comes up.
 *
 * Only files older than [MIN_AGE_MS] go: every staged send expires after the
 * engine's 10 min resource TTL (RETICULUM_CHAT_RESOURCE_TTL_MS and
 * RETICULUM_RESOURCE_TRANSFER_TTL_MS), so no request can still start one. A
 * transfer already running keeps its open file handle, which a delete does
 * not disturb.
 */
internal object StagedResourceSweep {
    /** The engine's resource TTL; a caller cannot ask for less. */
    internal const val MIN_AGE_MS: Long = 10 * 60 * 1000L

    /**
     * Deletes the regular files directly in [dir] last modified at least
     * [maxAgeMs] (never under [MIN_AGE_MS]) before [nowMs]. Subdirectories
     * and newer files stay. Returns how many files were deleted.
     */
    @JvmStatic
    fun sweep(dir: File, nowMs: Long, maxAgeMs: Long): Int {
        val minAge = maxOf(maxAgeMs, MIN_AGE_MS)
        val files = dir.listFiles() ?: return 0
        var deleted = 0
        for (file in files) {
            if (!file.isFile) continue
            if (nowMs - file.lastModified() < minAge) continue
            if (file.delete()) deleted += 1
        }
        return deleted
    }

    /** What the staging directory holds right now (Copy diagnostics). */
    internal data class Stats(val files: Int, val bytes: Long, val oldestAgeMs: Long)

    /**
     * Regular files directly in [dir], their total size and the oldest one's
     * age at [nowMs] (0 when empty). A missing directory counts as empty.
     */
    @JvmStatic
    fun stats(dir: File, nowMs: Long): Stats {
        val files = dir.listFiles()?.filter { it.isFile } ?: emptyList()
        val oldest = files.minOfOrNull { it.lastModified() }
        return Stats(
            files = files.size,
            bytes = files.sumOf { it.length() },
            oldestAgeMs = if (oldest == null) 0L else maxOf(0L, nowMs - oldest),
        )
    }
}
