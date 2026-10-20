package com.github.Qortal.qortalMobile

import java.io.File
import java.nio.file.Files
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ChatResourceStagingPolicyTest {

    private lateinit var root: File
    private lateinit var dir: File

    @Before
    fun setUp() {
        root = Files.createTempDirectory("staging-policy").toFile()
        dir = File(root, "reticulum-chat-resources").apply { mkdirs() }
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    /**
     * src/test/resources/chat-resource-staged-names.tsv, which vitest checks
     * the worker's copy of the cleaning against (stagedFileName.test.ts).
     */
    private fun sharedCases(): List<Pair<String, String>> {
        val stream = javaClass.classLoader!!.getResourceAsStream("chat-resource-staged-names.tsv")
        assertNotNull("fixture on the test classpath", stream)
        return stream!!.bufferedReader(Charsets.US_ASCII).readLines()
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .map { line ->
                val tab = line.indexOf('\t')
                unescape(line.substring(0, tab)) to unescape(line.substring(tab + 1))
            }
    }

    private fun unescape(s: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < s.length) {
            if (s[i] == '\\' && i + 1 < s.length && s[i + 1] == '\\') {
                out.append('\\')
                i += 2
            } else if (s[i] == '\\' && i + 6 <= s.length && s[i + 1] == 'u') {
                out.append(s.substring(i + 2, i + 6).toInt(16).toChar())
                i += 6
            } else {
                out.append(s[i])
                i += 1
            }
        }
        return out.toString()
    }

    @Test
    fun namesMatchTheWorkerFixture() {
        val cases = sharedCases()
        assertTrue(cases.size >= 30)
        for ((input, expected) in cases) {
            assertEquals(
                "name for \"$input\"",
                "id-$expected",
                ChatResourceStagingPolicy.stagedName("id", input),
            )
        }
    }

    @Test
    fun pathsTheWorkerBuildsAreAccepted() {
        // The worker builds "<stagingDir>/<uuid>-<clean name>" with the
        // absolutePath bridgeSocket() hands it.
        for ((input, expected) in sharedCases()) {
            val path = "${dir.absolutePath}/${UUID.randomUUID()}-$expected"
            val resolved = ChatResourceStagingPolicy.resolveInside(dir, path)
            assertNotNull("accepts the path for \"$input\"", resolved)
            assertEquals(dir.canonicalFile, resolved!!.parentFile)
            // Writing and deleting through it stays in the folder. (Names
            // over 255 UTF-8 bytes, like 100 emoji, are too long for the
            // file system on either side; engine names are short ASCII.)
            if (resolved.name.toByteArray(Charsets.UTF_8).size <= 255) {
                resolved.writeBytes(byteArrayOf(1, 2, 3))
                assertTrue(File(dir, resolved.name).isFile)
                assertTrue(resolved.delete())
            }
        }
        // Kotlin's own fallback path (no folder in the worker yet) too.
        val own = File(dir, ChatResourceStagingPolicy.stagedName(UUID.randomUUID().toString(), ""))
        assertNotNull(ChatResourceStagingPolicy.resolveInside(dir, own.absolutePath))
        assertTrue(own.name.endsWith("-blob"))
    }

    @Test
    fun traversalAndOutsidePathsAreRefused() {
        val outside = File(root, "secret.txt").apply { writeText("x") }
        val refused = listOf(
            "",
            "   ",
            "x.recv",
            "../x.recv",
            "${dir.absolutePath}/../secret.txt",
            "${dir.absolutePath}/../reticulum-chat-resources/../secret.txt",
            "${dir.absolutePath}/sub/x.recv",
            "${dir.absolutePath}/.",
            "${dir.absolutePath}/..",
            dir.absolutePath,
            outside.absolutePath,
            "/etc/passwd",
            "/",
        )
        for (path in refused) {
            assertNull("refuses \"$path\"", ChatResourceStagingPolicy.resolveInside(dir, path))
        }
        // ".." that comes back into the folder is the same file, so it is fine.
        assertNotNull(
            ChatResourceStagingPolicy.resolveInside(
                dir,
                "${dir.absolutePath}/../reticulum-chat-resources/x.recv",
            )
        )
    }

    @Test
    fun linksOutOfTheFolderAreRefused() {
        val outside = File(root, "secret.txt").apply { writeText("x") }
        val link = File(dir, "link.recv")
        try {
            Files.createSymbolicLink(link.toPath(), outside.toPath())
        } catch (_: UnsupportedOperationException) {
            return
        } catch (_: java.io.IOException) {
            return
        }
        assertNull(ChatResourceStagingPolicy.resolveInside(dir, link.absolutePath))
    }
}
