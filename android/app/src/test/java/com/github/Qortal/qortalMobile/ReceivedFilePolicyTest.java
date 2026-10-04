package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** N-22 / N-27: received chat files stay in GO's private storage. */
public class ReceivedFilePolicyTest {
    private static final String PRIVATE =
        "/data/user/0/com.github.Qortal.qortalMobile/files/qchat-received";
    private static final String LEGACY =
        "/storage/emulated/0/Android/data/com.github.Qortal.qortalMobile/files/Download/QortalFiles";

    @Test
    public void filesInsideAReceivedDirectoryAreAccepted() {
        assertTrue(ReceivedFilePolicy.isInside(PRIVATE + "/3f2a/photo.jpg", PRIVATE, LEGACY));
        assertTrue(ReceivedFilePolicy.isInside(LEGACY + "/report (1).pdf", PRIVATE, LEGACY));
        assertTrue(ReceivedFilePolicy.isInside(PRIVATE + "/a/b/c.txt", PRIVATE + "/"));
    }

    @Test
    public void otherAppFilesAreRefused() {
        String files = "/data/user/0/com.github.Qortal.qortalMobile/files";
        assertFalse(ReceivedFilePolicy.isInside(files + "/wallets.json", PRIVATE, LEGACY));
        assertFalse(ReceivedFilePolicy.isInside(
            "/data/user/0/com.github.Qortal.qortalMobile/shared_prefs/CapacitorStorage.xml",
            PRIVATE,
            LEGACY
        ));
        assertFalse(ReceivedFilePolicy.isInside("/storage/emulated/0/Download/x.jpg", PRIVATE, LEGACY));
    }

    @Test
    public void aRootIsNotInsideItself() {
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE, PRIVATE));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/", PRIVATE));
    }

    @Test
    public void aSiblingWithTheSamePrefixIsRefused() {
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "2/x.jpg", PRIVATE));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "-old/x.jpg", PRIVATE));
    }

    @Test
    public void pathsThatWereNotCanonicalisedFailClosed() {
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/../wallets.json", PRIVATE));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/a/../../x", PRIVATE));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/./x.jpg", PRIVATE));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/a/..", PRIVATE));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/x.jpg", PRIVATE + "/../files"));
    }

    @Test
    public void missingInputIsRefused() {
        assertFalse(ReceivedFilePolicy.isInside(null, PRIVATE));
        assertFalse(ReceivedFilePolicy.isInside("", PRIVATE));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/x.jpg"));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/x.jpg", (String[]) null));
        assertFalse(ReceivedFilePolicy.isInside(PRIVATE + "/x.jpg", (String) null, ""));
        // An empty root must not turn into "/", which every path starts with.
        assertFalse(ReceivedFilePolicy.isInside("/x.jpg", ""));
    }

    @Test
    public void readsAreSlicedAndClamped() {
        assertEquals(ReceivedFilePolicy.DEFAULT_READ_BYTES, ReceivedFilePolicy.readLength(10_000_000, 0, 0));
        assertEquals(1000, ReceivedFilePolicy.readLength(10_000_000, 0, 1000));
        assertEquals(
            ReceivedFilePolicy.MAX_READ_BYTES,
            ReceivedFilePolicy.readLength(10_000_000, 0, 50 * 1024 * 1024)
        );
        // The last slice stops at the end of the file.
        assertEquals(100, ReceivedFilePolicy.readLength(1100, 1000, 512));
        assertEquals(0, ReceivedFilePolicy.readLength(1100, 1100, 512));
        assertEquals(0, ReceivedFilePolicy.readLength(1100, 5000, 512));
        assertEquals(0, ReceivedFilePolicy.readLength(0, 0, 512));
        assertEquals(-1, ReceivedFilePolicy.readLength(1100, -1, 512));
    }
}
