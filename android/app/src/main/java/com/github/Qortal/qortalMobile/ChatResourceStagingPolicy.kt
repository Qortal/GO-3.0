package com.github.Qortal.qortalMobile

import java.io.File

/**
 * Pure rules for chat-resource staging paths (cacheDir/reticulum-chat-resources),
 * kept apart from [ReticulumPlugin] so the JVM unit tests can check them.
 *
 * The engine worker builds new staging paths itself:
 * `<folder>/<uuid>-<clean name>` (src/reticulumChat/mobile/stagedFileName.ts),
 * with the folder [ReticulumPlugin.bridgeSocket] hands it once. That saves a
 * round trip to Kotlin per serve and per accept. The worker's name cleaning
 * is a copy of [stagedName]; both are checked against one fixture
 * (src/test/resources/chat-resource-staged-names.tsv).
 *
 * Kotlin still decides what it touches: every staged read, write and delete
 * goes through [resolveInside], so a path from the worker can never reach a
 * file outside the folder.
 */
internal object ChatResourceStagingPolicy {
    /**
     * The file for [path] when it sits directly in [dir], else null.
     * Symbolic links and ".." are resolved, in the path and in [dir], before
     * the check, so "../x", absolute paths elsewhere, subfolders and links
     * out of the folder are all refused.
     */
    @JvmStatic
    fun resolveInside(dir: File, path: String): File? {
        if (path.isBlank()) return null
        val canonicalDir = dir.canonicalFile
        val file = File(path).canonicalFile
        return if (file.parentFile == canonicalDir) file else null
    }

    /**
     * The name part of a new staging file for [name] (an engine OPFS
     * basename): a blank name becomes "blob", then
     * [SavedFilePolicy.cleanName] keeps it to one safe path component.
     */
    @JvmStatic
    fun stagedName(id: String, name: String): String =
        "$id-${SavedFilePolicy.cleanName(name.ifBlank { "blob" })}"
}
