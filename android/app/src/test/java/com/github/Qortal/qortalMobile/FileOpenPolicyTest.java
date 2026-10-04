package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

/** N-19 / N-27: what qchatFileOpen and qchatFileStat may act on, and how. */
public class FileOpenPolicyTest {
    private static final String PKG = "com.github.Qortal.qortalGo2";
    private static final String FILES = "/data/user/0/" + PKG + "/files";
    private static final String CACHE = "/data/user/0/" + PKG + "/cache";
    private static final String PRIVATE = FILES + "/qchat-received";
    private static final String LEGACY =
        "/storage/emulated/0/Android/data/" + PKG + "/files/Download/QortalFiles";
    private static final String SAVED = "/storage/emulated/0/Documents/Qortal Go";
    private static final String DOWNLOADS = "/storage/emulated/0/Download";
    private static final String[] RECEIVED = {PRIVATE, LEGACY};
    private static final String[] PUBLIC = {SAVED, DOWNLOADS};

    /** What MimeTypeMap answers for a few extensions on a stock phone. */
    private static final SavedFilePolicy.ExtensionTypes TYPES = new SavedFilePolicy.ExtensionTypes() {
        private final Map<String, String> map = new HashMap<>();

        {
            map.put("rss", "application/rss+xml");
            map.put("atom", "application/atom+xml");
            map.put("kml", "application/vnd.google-earth.kml+xml");
            map.put("xspf", "application/xspf+xml");
            map.put("rdf", "application/rdf+xml");
            map.put("jpg", "image/jpeg");
            map.put("pdf", "application/pdf");
            map.put("txt", "text/plain");
        }

        @Override
        public String mimeFor(String ext) {
            return map.get(ext);
        }
    };

    private static String[] names(String... n) {
        return n;
    }

    @Test
    public void openRootsAddTheShareStagingFolder() {
        assertArrayEquals(
            new String[] {PRIVATE, LEGACY, CACHE + "/shared-files"},
            FileOpenPolicy.openRoots(RECEIVED, CACHE, PUBLIC, 29)
        );
        assertArrayEquals(
            new String[] {PRIVATE, LEGACY, CACHE + "/shared-files"},
            FileOpenPolicy.openRoots(RECEIVED, CACHE + "/", PUBLIC, 34)
        );
    }

    @Test
    public void publicFoldersOpenByPathOnlyBelowAndroid10() {
        assertArrayEquals(
            new String[] {PRIVATE, LEGACY, CACHE + "/shared-files", SAVED, DOWNLOADS},
            FileOpenPolicy.openRoots(RECEIVED, CACHE, PUBLIC, 28)
        );
        assertArrayEquals(
            new String[] {PRIVATE, LEGACY, CACHE + "/shared-files", SAVED, DOWNLOADS},
            FileOpenPolicy.openRoots(RECEIVED, CACHE, PUBLIC, 26)
        );
    }

    @Test
    public void missingRootsAreSkipped() {
        assertArrayEquals(
            new String[] {PRIVATE},
            FileOpenPolicy.openRoots(new String[] {PRIVATE, null, ""}, null, new String[] {null, ""}, 26)
        );
        assertArrayEquals(new String[0], FileOpenPolicy.statRoots(null, ""));
    }

    @Test
    public void statRootsAddTheSendStagingFolder() {
        assertArrayEquals(
            new String[] {PRIVATE, LEGACY, CACHE + "/qchat-send"},
            FileOpenPolicy.statRoots(RECEIVED, CACHE)
        );
    }

    @Test
    public void privateAppFilesAreOutsideEveryRoot() {
        String[] open = FileOpenPolicy.openRoots(RECEIVED, CACHE, PUBLIC, 26);
        String[] stat = FileOpenPolicy.statRoots(RECEIVED, CACHE);
        String identity = FILES + "/reticulum-presence/presence-bridge.identity";
        String prefs = "/data/user/0/" + PKG + "/shared_prefs/CapacitorStorage.xml";
        String webview = "/data/user/0/" + PKG + "/app_webview/Default/Cookies";
        for (String path : new String[] {identity, prefs, webview, CACHE + "/x.jpg"}) {
            assertFalse(path, ReceivedFilePolicy.isInside(path, open));
            assertFalse(path, ReceivedFilePolicy.isInside(path, stat));
        }
        // Outside the public roots even on Android 8/9.
        assertFalse(ReceivedFilePolicy.isInside("/storage/emulated/0/DCIM/Camera/x.jpg", open));
        assertFalse(ReceivedFilePolicy.isInside("/storage/emulated/0/Documents/other.pdf", open));
        // And no public root at all from Android 10.
        String[] open10 = FileOpenPolicy.openRoots(RECEIVED, CACHE, PUBLIC, 29);
        assertFalse(ReceivedFilePolicy.isInside(SAVED + "/Images/x.jpg", open10));
        assertFalse(ReceivedFilePolicy.isInside(DOWNLOADS + "/x.jpg", open10));
    }

    @Test
    public void filesFromGosOwnFlowsAreInside() {
        String[] open = FileOpenPolicy.openRoots(RECEIVED, CACHE, PUBLIC, 28);
        assertTrue(ReceivedFilePolicy.isInside(PRIVATE + "/u/photo.jpg", open));
        assertTrue(ReceivedFilePolicy.isInside(LEGACY + "/old.pdf", open));
        assertTrue(ReceivedFilePolicy.isInside(CACHE + "/shared-files/1-2/doc.pdf", open));
        assertTrue(ReceivedFilePolicy.isInside(SAVED + "/Images/x.jpg", open));
        // An Android 8/9 copy a v0.0.14 build made of a received file.
        assertTrue(ReceivedFilePolicy.isInside(DOWNLOADS + "/report.pdf", open));
        String[] stat = FileOpenPolicy.statRoots(RECEIVED, CACHE);
        assertTrue(ReceivedFilePolicy.isInside(CACHE + "/qchat-send/u/clip.mp4", stat));
        // Share copies are not probed, and pending sends are not opened.
        assertFalse(ReceivedFilePolicy.isInside(CACHE + "/shared-files/1-2/doc.pdf", stat));
        assertFalse(ReceivedFilePolicy.isInside(CACHE + "/qchat-send/u/clip.mp4", open));
    }

    @Test
    public void gosOwnProvidersAreRefused() {
        assertTrue(FileOpenPolicy.isOwnAuthority(PKG + ".fileprovider", PKG));
        assertTrue(FileOpenPolicy.isOwnAuthority(PKG + ".androidx-startup", PKG));
        assertTrue(FileOpenPolicy.isOwnAuthority(PKG, PKG));
        assertTrue(FileOpenPolicy.isOwnAuthority("COM.github.qortal.QORTALGO2.FileProvider", PKG));
        assertTrue(FileOpenPolicy.isOwnAuthority(null, PKG));
        assertTrue(FileOpenPolicy.isOwnAuthority("", PKG));
    }

    @Test
    public void otherProvidersAreNotGos() {
        assertFalse(FileOpenPolicy.isOwnAuthority("media", PKG));
        assertFalse(FileOpenPolicy.isOwnAuthority("com.android.providers.downloads.documents", PKG));
        assertFalse(FileOpenPolicy.isOwnAuthority(PKG + "x.fileprovider", PKG));
        assertFalse(FileOpenPolicy.isOwnAuthority("com.github.Qortal", PKG));
    }

    @Test
    public void pagesByNameOpenAsText() {
        assertEquals("text/plain", FileOpenPolicy.openType(names("x.svg"), "image/svg+xml", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("x.svg"), "image/png", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("x.html."), "*/*", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("x.HTM "), null, null));
        assertEquals("text/plain", FileOpenPolicy.openType(names("page.xhtml"), "*/*", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("app.js"), "*/*", TYPES));
        // A bidi override does not hide the extension.
        assertEquals(
            "text/plain",
            FileOpenPolicy.openType(names("invoice\u202Efdp.html"), "application/pdf", TYPES)
        );
    }

    @Test
    public void xmlTypesFromTheExtensionOpenAsText() {
        assertEquals("text/plain", FileOpenPolicy.openType(names("feed.rss"), "application/rss+xml", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("feed.rss"), "*/*", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("x.kml"), "*/*", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("x.atom"), "*/*", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("x.xspf"), "*/*", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("x.rdf"), "*/*", TYPES));
    }

    @Test
    public void pageTypesOpenAsTextWhateverTheName() {
        assertEquals("text/plain", FileOpenPolicy.openType(names("photo.jpg"), "text/html", TYPES));
        assertEquals(
            "text/plain",
            FileOpenPolicy.openType(names("x"), "Application/XHTML+XML; charset=utf-8", TYPES)
        );
        assertEquals("text/plain", FileOpenPolicy.openType(names("x"), "application/javascript", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(null, "application/foo+xml", null));
    }

    @Test
    public void anyNameCounts() {
        // The name the caller gave and the file's own name are both checked.
        assertEquals(
            "text/plain",
            FileOpenPolicy.openType(names("photo.jpg", "/x/qchat-received/u/page.html"), "image/jpeg", TYPES)
        );
        assertEquals(
            "image/jpeg",
            FileOpenPolicy.openType(names(null, "", "photo.jpg"), "image/jpeg", TYPES)
        );
    }

    @Test
    public void otherFilesKeepTheirType() {
        assertEquals("image/jpeg", FileOpenPolicy.openType(names("photo.jpg"), "image/jpeg", TYPES));
        assertEquals("application/pdf", FileOpenPolicy.openType(names("a.pdf"), "application/pdf", TYPES));
        assertEquals("*/*", FileOpenPolicy.openType(names("notes.md"), "*/*", TYPES));
        assertEquals("text/plain", FileOpenPolicy.openType(names("a.txt"), "text/plain", TYPES));
        assertEquals(null, FileOpenPolicy.openType(names("x"), null, TYPES));
    }
}
