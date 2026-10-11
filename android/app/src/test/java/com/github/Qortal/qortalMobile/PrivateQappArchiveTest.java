package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Test;

public class PrivateQappArchiveTest {

    /** A zip of name/text pairs; a name ending in "/" is a folder entry. */
    static byte[] zip(String... nameAndText) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bytes)) {
            for (int i = 0; i < nameAndText.length; i += 2) {
                out.putNextEntry(new ZipEntry(nameAndText[i]));
                if (!nameAndText[i].endsWith("/")) {
                    out.write(nameAndText[i + 1].getBytes(StandardCharsets.UTF_8));
                }
                out.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    private static String text(PrivateQappArchive app, String path) {
        byte[] data = app.file(path);
        return data == null ? null : new String(data, StandardCharsets.UTF_8);
    }

    @Test
    public void filesAtTheTopStayWhereTheyAre() throws Exception {
        PrivateQappArchive app = PrivateQappArchive.unzip(zip(
            "index.html", "<p>hi</p>",
            "js/app.js", "go()",
            "css/", ""
        ));
        assertEquals("<p>hi</p>", text(app, "index.html"));
        assertEquals("go()", text(app, "js/app.js"));
        assertTrue(app.isDirectory("js"));
        assertTrue(app.isDirectory("css"));
        assertTrue(app.isDirectory(""));
        assertEquals(Arrays.asList("css", "index.html", "js"), app.rootNames());
        assertEquals(2, app.fileCount());
        assertEquals(13, app.size());
    }

    @Test
    public void oneTopFolderBecomesTheRootAsInCore() throws Exception {
        PrivateQappArchive app = PrivateQappArchive.unzip(zip(
            "dist/index.html", "page",
            "dist/assets/a.js", "a",
            "__MACOSX/dist/._index.html", "junk",
            "_extra/notes.txt", "junk"
        ));
        assertEquals("page", text(app, "index.html"));
        assertEquals("a", text(app, "assets/a.js"));
        assertNull(text(app, "dist/index.html"));
        assertNull(text(app, "__MACOSX/dist/._index.html"));
        assertEquals(Arrays.asList("assets", "index.html"), app.rootNames());
    }

    @Test
    public void severalTopEntriesKeepUnderscoreFolders() throws Exception {
        PrivateQappArchive app = PrivateQappArchive.unzip(zip(
            "index.html", "page",
            "app.js", "a",
            "_next/chunk.js", "c"
        ));
        assertEquals("c", text(app, "_next/chunk.js"));
        assertEquals(Arrays.asList("_next", "app.js", "index.html"), app.rootNames());
    }

    @Test
    public void aSingleFileIsTheWholeApp() throws Exception {
        PrivateQappArchive app = PrivateQappArchive.unzip(zip("game.html", "<p>game</p>", "__MACOSX/._game.html", "x"));
        assertEquals("<p>game</p>", text(app, "game.html"));
        assertEquals(Arrays.asList("game.html"), app.rootNames());
    }

    @Test
    public void coresMetadataFolderIsLeftOut() throws Exception {
        PrivateQappArchive app = PrivateQappArchive.unzip(zip(
            "index.html", "page",
            "style.css", "s",
            ".qortal/patch", "meta"
        ));
        assertNull(app.file(".qortal/patch"));
        assertFalse(app.isDirectory(".qortal"));
        assertEquals(Arrays.asList("index.html", "style.css"), app.rootNames());
    }

    @Test
    public void namesAreCleanedUp() throws Exception {
        PrivateQappArchive app = PrivateQappArchive.unzip(zip(
            "/index.html", "page",
            "./js//app.js", "a",
            "css\\site.css", "c"
        ));
        assertEquals("page", text(app, "index.html"));
        assertEquals("a", text(app, "js/app.js"));
        assertEquals("c", text(app, "css/site.css"));
    }

    @Test
    public void anEntryOutsideTheZipRefusesTheZip() throws Exception {
        try {
            PrivateQappArchive.unzip(zip("index.html", "page", "../evil.js", "x"));
            fail("expected a refusal");
        } catch (PrivateQappArchive.InvalidArchiveException expected) {
            // as in Core: the whole zip fails
        }
        try {
            PrivateQappArchive.unzip(zip("js/../../evil.js", "x"));
            fail("expected a refusal");
        } catch (PrivateQappArchive.InvalidArchiveException expected) {
            // ok
        }
    }

    @Test
    public void emptyOrFolderOnlyZipsAreRefused() throws Exception {
        try {
            PrivateQappArchive.unzip(zip("only/", ""));
            fail("expected a refusal");
        } catch (PrivateQappArchive.InvalidArchiveException expected) {
            // ok
        }
        try {
            PrivateQappArchive.unzip(zip());
            fail("expected a refusal");
        } catch (PrivateQappArchive.InvalidArchiveException expected) {
            // ok
        }
    }

    @Test
    public void notAZipIsRefused() throws Exception {
        try {
            PrivateQappArchive.unzip("{\"error\":1401}".getBytes(StandardCharsets.UTF_8));
            fail("expected a refusal");
        } catch (PrivateQappArchive.InvalidArchiveException expected) {
            // no entries
        }
    }

    @Test
    public void sizeAndEntryLimitsHold() throws Exception {
        byte[] big = zip("index.html", "0123456789", "b.txt", "0123456789");
        try {
            PrivateQappArchive.unzip(new ByteArrayInputStream(big), 15, 100);
            fail("expected a refusal");
        } catch (PrivateQappArchive.InvalidArchiveException expected) {
            // too large
        }
        try {
            PrivateQappArchive.unzip(new ByteArrayInputStream(big), 1000, 1);
            fail("expected a refusal");
        } catch (PrivateQappArchive.InvalidArchiveException expected) {
            // too many entries
        }
        PrivateQappArchive ok = PrivateQappArchive.unzip(new ByteArrayInputStream(big), 20, 2);
        assertEquals(20, ok.size());
    }

    @Test
    public void binaryFilesAreKeptByteForByte() throws Exception {
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', 0, 1, 2, (byte) 0xff};
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bytes)) {
            out.putNextEntry(new ZipEntry("index.html"));
            out.write("x".getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
            out.putNextEntry(new ZipEntry("logo.png"));
            out.write(png);
            out.closeEntry();
        }
        PrivateQappArchive app = PrivateQappArchive.unzip(bytes.toByteArray());
        assertArrayEquals(png, app.file("logo.png"));
    }
}
