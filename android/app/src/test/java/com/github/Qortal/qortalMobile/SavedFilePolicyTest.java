package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

public class SavedFilePolicyTest {

    /** A small stand-in for Android's MimeTypeMap. */
    private static final Map<String, String> PLATFORM_TYPES = new HashMap<>();

    static {
        PLATFORM_TYPES.put("rss", "application/rss+xml");
        PLATFORM_TYPES.put("atom", "application/atom+xml");
        PLATFORM_TYPES.put("rdf", "application/rdf+xml");
        PLATFORM_TYPES.put("kml", "application/vnd.google-earth.kml+xml");
        PLATFORM_TYPES.put("xul", "application/vnd.mozilla.xul+xml");
        PLATFORM_TYPES.put("html", "text/html");
        PLATFORM_TYPES.put("svg", "image/svg+xml");
        PLATFORM_TYPES.put("png", "image/png");
        PLATFORM_TYPES.put("jpg", "image/jpeg");
        PLATFORM_TYPES.put("pdf", "application/pdf");
        PLATFORM_TYPES.put("txt", "text/plain");
        PLATFORM_TYPES.put("json", "application/json");
        PLATFORM_TYPES.put("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        PLATFORM_TYPES.put("epub", "application/epub+zip");
    }

    private static final SavedFilePolicy.ExtensionTypes TYPES = PLATFORM_TYPES::get;

    private static SavedFilePolicy.Target save(String name, String mime) {
        return SavedFilePolicy.forSave(name, mime, TYPES);
    }

    @Test
    public void ordinaryDownloadsKeepTheirNameAndType() {
        SavedFilePolicy.Target t = save("holiday photo.jpg", "image/jpeg");
        assertEquals("holiday photo.jpg", t.name);
        assertEquals("image/jpeg", t.mime);

        t = save("report.pdf", "application/pdf");
        assertEquals("report.pdf", t.name);
        assertEquals("application/pdf", t.mime);

        t = save("notes.txt", "text/plain");
        assertEquals("notes.txt", t.name);
        assertEquals("text/plain", t.mime);

        t = save("GO 3.0 v0.0.15.apk", "application/vnd.android.package-archive");
        assertEquals("GO 3.0 v0.0.15.apk", t.name);

        t = save("archive.tar.gz", null);
        assertEquals("archive.tar.gz", t.name);
        assertNull(t.mime);

        // Non-Latin names and emoji survive.
        t = save("\u0444\u043E\u0442\u043E \uD83D\uDE00.png", "image/png");
        assertEquals("\u0444\u043E\u0442\u043E \uD83D\uDE00.png", t.name);
    }

    @Test
    public void pageTypesAreSavedAsPlainText() {
        String[] names = {
            "x.html", "x.htm", "x.xhtml", "x.xht", "x.shtml", "x.mht", "x.mhtml",
            "x.svg", "x.svgz", "x.xml", "x.xsl", "x.xslt",
        };
        for (String name : names) {
            SavedFilePolicy.Target t = save(name, "application/octet-stream");
            assertEquals(name + ".txt", t.name);
            assertEquals("text/plain", t.mime);
        }
    }

    @Test
    public void pageExtensionCheckIgnoresCaseAndTrailingDotsOrSpaces() {
        assertEquals("Invoice.HTML.txt", save("Invoice.HTML", "text/html").name);
        assertEquals("a.svg.txt", save("a.svg.", "image/svg+xml").name);
        assertEquals("a.svg.txt", save("a.svg . ", null).name);
        assertEquals("text/plain", save("a.SvG", "image/png").mime);
    }

    @Test
    public void extensionsThePlatformMapsToAPageTypeAreSavedAsPlainText() {
        // DocumentSaver would otherwise take the type from the extension when
        // none is declared, and file managers open by extension anyway.
        String[] declared = {
            null, "", "application/force-download", "application/octet-stream",
            "application/rss+xml", "image/png",
        };
        String[] names = {"x.rss", "x.atom", "x.rdf", "x.kml", "x.xul", "Feed.RSS"};
        for (String name : names) {
            for (String mime : declared) {
                SavedFilePolicy.Target t = save(name, mime);
                assertEquals(name + " / " + mime, name + ".txt", t.name);
                assertEquals(name + " / " + mime, "text/plain", t.mime);
            }
        }
        // Trailing dots and invisible characters do not hide the extension.
        assertEquals("x.rss.txt", save("x.rss.", null).name);
        assertEquals("x.kml.txt", save("x.k\u200Bml", null).name);
    }

    @Test
    public void extensionsThePlatformMapsToOtherTypesAreUntouched() {
        assertEquals("a.json", save("a.json", null).name);
        assertNull(save("a.json", null).mime);
        assertEquals("a.docx", save("a.docx", "application/force-download").name);
        assertEquals("book.epub", save("book.epub", "application/epub+zip").name);
        assertEquals("unknown.qqq", save("unknown.qqq", null).name);
        assertEquals("no-extension", save("no-extension", null).name);
        // "rss" with no dot is a name, not an extension.
        assertEquals("rss", save("rss", null).name);
    }

    @Test
    public void withoutAPlatformMapOnlyTheFixedListApplies() {
        assertEquals("x.rss", SavedFilePolicy.forSave("x.rss", null).name);
        assertEquals("x.rss", SavedFilePolicy.forSave("x.rss", null, null).name);
        assertEquals("x.html.txt", SavedFilePolicy.forSave("x.html", null, null).name);
    }

    @Test
    public void extensionHelper() {
        assertEquals("rss", SavedFilePolicy.extension("Feed.RSS"));
        assertEquals("gz", SavedFilePolicy.extension("archive.tar.gz"));
        assertEquals("pdf", SavedFilePolicy.extension("a.pdf. "));
        assertEquals("", SavedFilePolicy.extension("noext"));
        assertEquals("", SavedFilePolicy.extension("a."));
        assertEquals("", SavedFilePolicy.extension(null));
    }

    @Test
    public void pageTypeWithAnotherNameKeepsTheNameButLosesThePageType() {
        // MediaStore would otherwise add ".html" to the name.
        SavedFilePolicy.Target t = save("cat.png", "text/html");
        assertEquals("cat.png", t.name);
        assertEquals("application/octet-stream", t.mime);

        t = save("download", "text/html; charset=UTF-8");
        assertEquals("download", t.name);
        assertEquals("application/octet-stream", t.mime);

        assertEquals("application/octet-stream", save("a.txt", "Image/SVG+XML").mime);
        assertEquals("application/octet-stream", save("a.bin", "application/xhtml+xml").mime);
        assertEquals("application/octet-stream", save("feed", "application/rss+xml").mime);
        assertEquals("application/octet-stream", save("page", "multipart/related").mime);
        assertEquals("application/octet-stream", save("page", "message/rfc822").mime);
        assertEquals("application/octet-stream", save("data", "text/xml").mime);
    }

    @Test
    public void neutralisingIsIdempotent() {
        SavedFilePolicy.Target once = save("evil.html", "text/html");
        SavedFilePolicy.Target twice = save(once.name, once.mime);
        assertEquals(once.name, twice.name);
        assertEquals(once.mime, twice.mime);

        once = save("cat.png", "image/svg+xml");
        twice = save(once.name, once.mime);
        assertEquals(once.name, twice.name);
        assertEquals(once.mime, twice.mime);

        once = save("feed.rss", null);
        twice = save(once.name, once.mime);
        assertEquals(once.name, twice.name);
        assertEquals(once.mime, twice.mime);
    }

    @Test
    public void theSavedNameDoesNotDependOnTheType() {
        // QortalDownloadListener shows the name before it knows the final type.
        String[] names = {"x.html", "x.rss", "cat.png", "report.pdf", "a\u202Eb.svg"};
        String[] types = {null, "text/html", "image/png", "application/octet-stream"};
        for (String name : names) {
            String first = save(name, types[0]).name;
            for (String mime : types) {
                assertEquals(first, save(name, mime).name);
                assertEquals(first, save(first, mime).name);
            }
        }
    }

    @Test
    public void bidiAndInvisibleCharactersAreRemoved() {
        // Right-to-left override: would display as "photokpa.jpg".
        assertEquals("photogpj.apk", SavedFilePolicy.cleanName("photo\u202Egpj.apk"));
        // Isolates, marks, zero-width characters, BOM, soft hyphen.
        assertEquals(
            "abcdefgh.pdf",
            SavedFilePolicy.cleanName("a\u2066b\u2067c\u2068d\u2069e\u200Ef\u200Fg\u061Ch.pdf")
        );
        assertEquals("ab.pdf", SavedFilePolicy.cleanName("a\u200B\u200C\u200D\uFEFF\u00ADb.pdf"));
        // Control characters, including newlines and NUL.
        assertEquals("ab.pdf", SavedFilePolicy.cleanName("a\n\r\t\0\u0007\u0085b.pdf"));
        // Line and paragraph separators.
        assertEquals("ab.pdf", SavedFilePolicy.cleanName("a\u2028\u2029b.pdf"));
        // A lone surrogate half.
        assertEquals("ab.pdf", SavedFilePolicy.cleanName("a\uD83Db.pdf"));
    }

    @Test
    public void bidiTricksCannotHideAPageExtension() {
        // "x.htm[RLO]l" is "x.html" once the override is gone: still a page.
        SavedFilePolicy.Target t = save("x.htm\u202El", "application/octet-stream");
        assertEquals("x.html.txt", t.name);
        assertEquals("text/plain", t.mime);

        t = save("x.html\u200B", null);
        assertEquals("x.html.txt", t.name);
    }

    @Test
    public void pathAndReservedCharactersBecomeUnderscores() {
        assertEquals("_.._etc_passwd", SavedFilePolicy.cleanName("/../etc/passwd"));
        assertEquals("a_b_c_d_e_f_g_h_i_j_.txt", SavedFilePolicy.cleanName("a/b\\c?d%e*f:g|h\"i<j>.txt"));
    }

    @Test
    public void hiddenAndDotOnlyNamesAreNotCreated() {
        assertEquals("download", SavedFilePolicy.cleanName(".."));
        assertEquals("download", SavedFilePolicy.cleanName("."));
        assertEquals("bashrc", SavedFilePolicy.cleanName(".bashrc"));
        assertEquals("download", SavedFilePolicy.cleanName("   "));
        assertEquals("download", SavedFilePolicy.cleanName(""));
        assertEquals("download", SavedFilePolicy.cleanName(null));
        assertEquals("download", SavedFilePolicy.cleanName("\u202E\u200B"));
        assertEquals("name.pdf", SavedFilePolicy.cleanName("  name.pdf  "));
    }

    @Test
    public void longNamesAreShortenedKeepingTheExtension() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 300; i++) {
            sb.append('a');
        }
        String name = SavedFilePolicy.cleanName(sb + ".pdf");
        assertEquals(SavedFilePolicy.MAX_NAME_LENGTH, name.length());
        assertTrue(name.endsWith(".pdf"));

        // A long page name is still neutralised.
        SavedFilePolicy.Target t = save(sb + ".html", "text/html");
        assertTrue(t.name.endsWith(".txt"));
        assertTrue(t.name.length() <= SavedFilePolicy.MAX_NAME_LENGTH);
        assertFalse(SavedFilePolicy.hasPageExtension(t.name));
        assertEquals("text/plain", t.mime);
    }

    @Test
    public void shorteningNeverSplitsASurrogatePair() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 150; i++) {
            sb.append("\uD83D\uDE00");
        }
        String name = SavedFilePolicy.cleanName(sb.toString());
        assertTrue(name.length() <= SavedFilePolicy.MAX_NAME_LENGTH);
        assertFalse(Character.isHighSurrogate(name.charAt(name.length() - 1)));
        assertEquals(name.codePointCount(0, name.length()) * 2, name.length());
    }

    @Test
    public void mimeHelpers() {
        assertEquals("text/html", SavedFilePolicy.baseMime(" Text/HTML ; charset=utf-8"));
        assertEquals("", SavedFilePolicy.baseMime(null));
        assertFalse(SavedFilePolicy.isPageMime(null));
        assertFalse(SavedFilePolicy.isPageMime(""));
        assertFalse(SavedFilePolicy.isPageMime("image/png"));
        assertFalse(SavedFilePolicy.isPageMime("application/json"));
        assertFalse(SavedFilePolicy.isPageMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
        assertTrue(SavedFilePolicy.isPageMime("application/vnd.google-earth.kml+xml"));
        assertTrue(SavedFilePolicy.isPageMime("application/xml"));
    }
}
