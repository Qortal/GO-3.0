package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PackageArchivePolicyTest {
    private static final byte[] ZIP = {'P', 'K', 3, 4, 20, 0};
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G'};

    @Test
    public void appPackageNamesAreRecognised() {
        assertTrue(PackageArchivePolicy.isPackageArchiveName("GO 3.0 v0.0.15.apk"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("wallet.APK"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("bundle.apks"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("bundle.xapk"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("bundle.apkm"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("app-release.aab"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("/storage/emulated/0/Documents/Qortal Go/Apps/x.apk"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("trailing.apk."));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("trailing.apk  "));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("cleaned.apk_"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("cleaned.apk._ "));
    }

    @Test
    public void disguisedPackageNamesAreRecognised() {
        // Zero-width space and a right-to-left mark inside the extension.
        assertTrue(PackageArchivePolicy.isPackageArchiveName("GO.a\u200Bpk"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("GO.ap\u200Fk"));
        // Cyrillic "a" and Greek "kappa" drawn like Latin letters.
        assertTrue(PackageArchivePolicy.isPackageArchiveName("GO.\u0430pk"));
        assertTrue(PackageArchivePolicy.isPackageArchiveName("GO.ap\u03ba"));
        // Fullwidth letters fold to ASCII under NFKC.
        assertTrue(PackageArchivePolicy.isPackageArchiveName("GO.\uFF41\uFF50\uFF4B"));
    }

    @Test
    public void otherNamesAreNot() {
        assertFalse(PackageArchivePolicy.isPackageArchiveName("photo.jpg"));
        assertFalse(PackageArchivePolicy.isPackageArchiveName("notes.apk.txt"));
        assertFalse(PackageArchivePolicy.isPackageArchiveName("apk"));
        assertFalse(PackageArchivePolicy.isPackageArchiveName("archive.zip"));
        assertFalse(PackageArchivePolicy.isPackageArchiveName("content://media/external/file/123"));
        assertFalse(PackageArchivePolicy.isPackageArchiveName(""));
        assertFalse(PackageArchivePolicy.isPackageArchiveName(null));
    }

    @Test
    public void packageArchiveMimeIsRecognised() {
        assertTrue(PackageArchivePolicy.isPackageArchiveMime("application/vnd.android.package-archive"));
        assertTrue(PackageArchivePolicy.isPackageArchiveMime(" Application/VND.Android.Package-Archive; charset=binary"));
        assertFalse(PackageArchivePolicy.isPackageArchiveMime("application/zip"));
        assertFalse(PackageArchivePolicy.isPackageArchiveMime("application/octet-stream"));
        assertFalse(PackageArchivePolicy.isPackageArchiveMime(null));
    }

    @Test
    public void anyNameOrTypeMarksAPackage() {
        assertTrue(PackageArchivePolicy.isPackageArchive(
            new String[] {"photo.jpg", "x.apk"}, new String[] {"image/jpeg"}));
        assertTrue(PackageArchivePolicy.isPackageArchive(
            new String[] {"photo.jpg"}, new String[] {null, PackageArchivePolicy.APK_MIME}));
        assertFalse(PackageArchivePolicy.isPackageArchive(
            new String[] {"photo.jpg", null}, new String[] {"image/jpeg", null}));
        assertFalse(PackageArchivePolicy.isPackageArchive(null, null));
    }

    @Test
    public void wildcardTypes() {
        assertTrue(PackageArchivePolicy.isWildcardMime("*/*"));
        assertTrue(PackageArchivePolicy.isWildcardMime("application/*"));
        assertTrue(PackageArchivePolicy.isWildcardMime(""));
        assertTrue(PackageArchivePolicy.isWildcardMime(null));
        assertFalse(PackageArchivePolicy.isWildcardMime("text/markdown"));
    }

    @Test
    public void aZipBehindAWildcardOpensAsAZip() {
        assertEquals("application/zip", PackageArchivePolicy.viewType("*/*", ZIP));
        assertEquals("application/zip", PackageArchivePolicy.viewType(null, ZIP));
        assertEquals("application/zip", PackageArchivePolicy.viewType("application/*", ZIP));
        // Known types keep what they had, whatever the content.
        assertEquals(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            PackageArchivePolicy.viewType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ZIP));
        assertEquals("image/png", PackageArchivePolicy.viewType("image/png", PNG));
        assertEquals("text/plain", PackageArchivePolicy.viewType(" text/plain ", null));
    }

    @Test
    public void aWildcardIsNeverHandedOut() {
        // The installer matches any wildcard, and the file can be swapped for
        // an APK after the type is decided, so non-ZIP content gets the
        // generic binary type instead.
        assertEquals("application/octet-stream", PackageArchivePolicy.viewType("*/*", PNG));
        assertEquals("application/octet-stream", PackageArchivePolicy.viewType("application/*", PNG));
        assertEquals("application/octet-stream", PackageArchivePolicy.viewType("*/*", null));
        assertEquals("application/octet-stream", PackageArchivePolicy.viewType("", new byte[] {'P', 'K'}));
        assertEquals("application/octet-stream", PackageArchivePolicy.viewType(null, null));
        assertFalse(PackageArchivePolicy.viewType("*/*", PNG).contains("*"));
    }

    @Test
    public void zipMagic() {
        assertTrue(PackageArchivePolicy.looksLikeZip(ZIP));
        assertFalse(PackageArchivePolicy.looksLikeZip(PNG));
        assertFalse(PackageArchivePolicy.looksLikeZip(new byte[] {'P', 'K'}));
        assertFalse(PackageArchivePolicy.looksLikeZip(null));
    }
}
