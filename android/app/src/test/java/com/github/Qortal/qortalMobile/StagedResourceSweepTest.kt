package com.github.Qortal.qortalMobile

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class StagedResourceSweepTest {

    private lateinit var dir: File
    private val now = 1_800_000_000_000L
    private val minute = 60_000L

    @Before
    fun setUp() {
        dir = Files.createTempDirectory("staged-sweep").toFile()
    }

    @After
    fun tearDown() {
        dir.deleteRecursively()
    }

    private fun staged(name: String, ageMs: Long): File =
        File(dir, name).apply {
            writeText("x")
            setLastModified(now - ageMs)
        }

    @Test
    fun deletesOnlyFilesPastTheAge() {
        val old = staged("old-page.json", 11 * minute)
        val fresh = staged("fresh-page.json", 2 * minute)
        val edge = staged("edge-page.json", 10 * minute)

        assertEquals(2, StagedResourceSweep.sweep(dir, now, 10 * minute))
        assertFalse(old.exists())
        assertFalse(edge.exists())
        assertTrue(fresh.exists())
    }

    @Test
    fun neverUsesAnAgeBelowTheResourceTtl() {
        val fiveMinutes = staged("five.json", 5 * minute)

        // A caller asking for 0 or 1 min still keeps anything a live send may use.
        assertEquals(0, StagedResourceSweep.sweep(dir, now, 0))
        assertEquals(0, StagedResourceSweep.sweep(dir, now, minute))
        assertTrue(fiveMinutes.exists())
    }

    @Test
    fun leavesSubdirectoriesAndCopesWithAMissingDirectory() {
        val sub = File(dir, "nested").apply { mkdirs() }
        sub.setLastModified(now - 60 * minute)

        assertEquals(0, StagedResourceSweep.sweep(dir, now, 10 * minute))
        assertTrue(sub.isDirectory)
        assertEquals(0, StagedResourceSweep.sweep(File(dir, "missing"), now, 10 * minute))
    }

    @Test
    fun reportsFilesBytesAndTheOldestAge() {
        staged("a.json", 3 * minute)
        File(dir, "b.json").apply {
            writeText("12345")
            setLastModified(now - 25 * minute)
        }
        File(dir, "nested").apply { mkdirs() }

        assertEquals(
            StagedResourceSweep.Stats(files = 2, bytes = 6, oldestAgeMs = 25 * minute),
            StagedResourceSweep.stats(dir, now),
        )
        assertEquals(
            StagedResourceSweep.Stats(files = 0, bytes = 0, oldestAgeMs = 0),
            StagedResourceSweep.stats(File(dir, "missing"), now),
        )
    }
}
