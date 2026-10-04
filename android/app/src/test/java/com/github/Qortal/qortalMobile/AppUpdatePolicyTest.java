package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class AppUpdatePolicyTest {
    private static final String GO = "com.github.Qortal.qortalGo2";
    private static final String GO_KEY = "de8e72357e98d2555f84b6d0c94c490bcc92442a322902f84aab9e54d680b7e4";
    private static final String NEW_KEY = "1111111111111111111111111111111111111111111111111111111111111111";
    private static final String OTHER_KEY = "2222222222222222222222222222222222222222222222222222222222222222";

    private static AppUpdatePolicy.PackageFacts pkg(String name, long version, List<String> signers, List<String> history) {
        return new AppUpdatePolicy.PackageFacts(name, version, signers, history);
    }

    private static AppUpdatePolicy.PackageFacts installed() {
        return pkg(GO, 17, Collections.singletonList(GO_KEY), Collections.singletonList(GO_KEY));
    }

    @Test
    public void aNewerGoSignedByTheSameKeyIsInstalled() {
        AppUpdatePolicy.PackageFacts update = pkg(GO, 18, Collections.singletonList(GO_KEY), Collections.singletonList(GO_KEY));
        assertEquals(AppUpdatePolicy.Verdict.OK, AppUpdatePolicy.checkArchive(update, installed()));
    }

    @Test
    public void digestsCompareWithoutCaseOrColons() {
        String colons = GO_KEY.toUpperCase().replaceAll("(..)(?!$)", "$1:");
        AppUpdatePolicy.PackageFacts update = pkg(GO, 18, Collections.singletonList(colons), Collections.<String>emptyList());
        assertEquals(AppUpdatePolicy.Verdict.OK, AppUpdatePolicy.checkArchive(update, installed()));
    }

    @Test
    public void aLookAlikeAppWithAnotherPackageNameIsRefused() {
        AppUpdatePolicy.PackageFacts trojan = pkg("com.github.Qortal.qortalGo3", 99, Collections.singletonList(OTHER_KEY), Collections.<String>emptyList());
        assertEquals(AppUpdatePolicy.Verdict.WRONG_PACKAGE, AppUpdatePolicy.checkArchive(trojan, installed()));
        // Even signed with GO's key, another package installs beside GO: refused.
        AppUpdatePolicy.PackageFacts sameKey = pkg("com.example.wallet", 99, Collections.singletonList(GO_KEY), Collections.<String>emptyList());
        assertEquals(AppUpdatePolicy.Verdict.WRONG_PACKAGE, AppUpdatePolicy.checkArchive(sameKey, installed()));
    }

    @Test
    public void goSignedByAnotherKeyIsRefused() {
        AppUpdatePolicy.PackageFacts update = pkg(GO, 18, Collections.singletonList(OTHER_KEY), Collections.singletonList(OTHER_KEY));
        assertEquals(AppUpdatePolicy.Verdict.WRONG_SIGNER, AppUpdatePolicy.checkArchive(update, installed()));
    }

    @Test
    public void anUnsignedOrUnreadableFileIsRefused() {
        AppUpdatePolicy.PackageFacts unsigned = pkg(GO, 18, Collections.<String>emptyList(), Collections.<String>emptyList());
        assertEquals(AppUpdatePolicy.Verdict.WRONG_SIGNER, AppUpdatePolicy.checkArchive(unsigned, installed()));
        assertEquals(AppUpdatePolicy.Verdict.UNREADABLE, AppUpdatePolicy.checkArchive(null, installed()));
        assertEquals(AppUpdatePolicy.Verdict.UNREADABLE, AppUpdatePolicy.checkArchive(pkg("", 18, null, null), installed()));
    }

    @Test
    public void anInstalledAppWithoutKnownSignersAcceptsNothing() {
        AppUpdatePolicy.PackageFacts unknown = pkg(GO, 17, Collections.<String>emptyList(), Collections.<String>emptyList());
        AppUpdatePolicy.PackageFacts update = pkg(GO, 18, Collections.singletonList(GO_KEY), Collections.<String>emptyList());
        assertEquals(AppUpdatePolicy.Verdict.WRONG_SIGNER, AppUpdatePolicy.checkArchive(update, unknown));
    }

    @Test
    public void theSameOrAnOlderBuildIsRefused() {
        AppUpdatePolicy.PackageFacts same = pkg(GO, 17, Collections.singletonList(GO_KEY), Collections.<String>emptyList());
        AppUpdatePolicy.PackageFacts older = pkg(GO, 12, Collections.singletonList(GO_KEY), Collections.<String>emptyList());
        assertEquals(AppUpdatePolicy.Verdict.NOT_NEWER, AppUpdatePolicy.checkArchive(same, installed()));
        assertEquals(AppUpdatePolicy.Verdict.NOT_NEWER, AppUpdatePolicy.checkArchive(older, installed()));
    }

    @Test
    public void aKeyRotatedFromTheInstalledKeyIsAccepted() {
        AppUpdatePolicy.PackageFacts rotated = pkg(GO, 18, Collections.singletonList(NEW_KEY), Arrays.asList(GO_KEY, NEW_KEY));
        assertEquals(AppUpdatePolicy.Verdict.OK, AppUpdatePolicy.checkArchive(rotated, installed()));
        // A history that does not include the installed key proves nothing.
        AppUpdatePolicy.PackageFacts foreign = pkg(GO, 18, Collections.singletonList(NEW_KEY), Arrays.asList(OTHER_KEY, NEW_KEY));
        assertEquals(AppUpdatePolicy.Verdict.WRONG_SIGNER, AppUpdatePolicy.checkArchive(foreign, installed()));
    }

    @Test
    public void multipleSignersMustMatchExactly() {
        AppUpdatePolicy.PackageFacts both = pkg(GO, 17, Arrays.asList(GO_KEY, OTHER_KEY), Collections.<String>emptyList());
        AppUpdatePolicy.PackageFacts same = pkg(GO, 18, Arrays.asList(OTHER_KEY, GO_KEY), Collections.<String>emptyList());
        AppUpdatePolicy.PackageFacts one = pkg(GO, 18, Collections.singletonList(GO_KEY), Collections.<String>emptyList());
        AppUpdatePolicy.PackageFacts extra = pkg(GO, 18, Arrays.asList(GO_KEY, OTHER_KEY, NEW_KEY), Collections.<String>emptyList());
        assertEquals(AppUpdatePolicy.Verdict.OK, AppUpdatePolicy.checkArchive(same, both));
        assertEquals(AppUpdatePolicy.Verdict.WRONG_SIGNER, AppUpdatePolicy.checkArchive(one, both));
        assertEquals(AppUpdatePolicy.Verdict.WRONG_SIGNER, AppUpdatePolicy.checkArchive(extra, both));
    }

    @Test
    public void httpsIsAllowedEverywhere() {
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("https://ext-node.qortal.link/arbitrary/FILE/GO%203.0/x?attachment=true"));
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("HTTPS://192.168.1.20:12391/arbitrary/FILE/a/b"));
    }

    @Test
    public void plainHttpOnlyToThisPhone() {
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("http://127.0.0.1:12391/arbitrary/FILE/a/b"));
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("http://localhost:12391/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("http://[::1]:12391/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("http://127.10.0.3/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://192.168.1.20:12391/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://100.64.1.2:12391/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://ext-node.qortal.link/x"));
        // Look-alikes of loopback names are not loopback.
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://127.0.0.1.evil.example/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://localhost.evil.example/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://localhost@evil.example/x"));
    }

    @Test
    public void httpsHostsJavaNetUriCannotReadStillUpdate() {
        // java.net.URI has no host for these, but HttpURLConnection fetches them.
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("https://my_node.local/arbitrary/FILE/a/b"));
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("https://my_node.local:12391/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("https://user@my_node.local:12391/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("https://\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl("https://my_node.local:abc/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl("https:///x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl("https:x"));
    }

    @Test
    public void plainHttpNeedsThePlainLoopbackSpelling() {
        // Spellings a browser or the C resolver may still read as 127.0.0.1:
        // refused here and in appUpdateSafety.isSecureUpdateUrl alike.
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://127.1/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://0x7f.0.0.1/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://2130706433/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://127.0.0.1./x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://localhost./x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://127.0.0.08/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INSECURE, AppUpdatePolicy.checkDownloadUrl("http://my_node.local/x"));
        assertEquals(AppUpdatePolicy.UrlVerdict.OK, AppUpdatePolicy.checkDownloadUrl("http://a_b@127.0.0.1:12391/x"));
    }

    @Test
    public void otherSchemesAndJunkAreInvalid() {
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl(null));
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl(""));
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl("file:///sdcard/Download/go.apk"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl("ftp://node/go.apk"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl("content://x/y"));
        assertEquals(AppUpdatePolicy.UrlVerdict.INVALID, AppUpdatePolicy.checkDownloadUrl("not a url"));
    }

    @Test
    public void loopbackHostLiterals() {
        assertTrue(AppUpdatePolicy.isLoopbackHost("127.0.0.1"));
        assertTrue(AppUpdatePolicy.isLoopbackHost("LOCALHOST"));
        assertTrue(AppUpdatePolicy.isLoopbackHost("[::1]"));
        assertFalse(AppUpdatePolicy.isLoopbackHost("128.0.0.1"));
        assertFalse(AppUpdatePolicy.isLoopbackHost("127.0.0.256"));
        assertFalse(AppUpdatePolicy.isLoopbackHost("127.0.0"));
        assertFalse(AppUpdatePolicy.isLoopbackHost("127.0.0.1.2"));
        assertFalse(AppUpdatePolicy.isLoopbackHost("0x7f.0.0.1"));
        assertFalse(AppUpdatePolicy.isLoopbackHost("localhost."));
        assertFalse(AppUpdatePolicy.isLoopbackHost("127.0.0.1."));
        assertFalse(AppUpdatePolicy.isLoopbackHost("127.0.0.01"));
        assertFalse(AppUpdatePolicy.isLoopbackHost("127.\u0660.0.1"));
        assertTrue(AppUpdatePolicy.isLoopbackHost("127.0.0.0"));
        assertTrue(AppUpdatePolicy.isLoopbackHost("0:0:0:0:0:0:0:1"));
        assertFalse(AppUpdatePolicy.isLoopbackHost(""));
        assertFalse(AppUpdatePolicy.isLoopbackHost(null));
    }

    @Test
    public void onlyFilesInsideTheUpdateFolderInstall() {
        String dir = "/data/user/0/com.github.Qortal.qortalGo2/cache/updates";
        assertTrue(AppUpdatePolicy.isInsideDirectory(dir + "/GO_3.0_v0.0.15.apk", dir));
        assertTrue(AppUpdatePolicy.isInsideDirectory(dir + "/x.apk", dir + "/"));
        assertFalse(AppUpdatePolicy.isInsideDirectory(dir, dir));
        assertFalse(AppUpdatePolicy.isInsideDirectory(dir + "-evil/x.apk", dir));
        assertFalse(AppUpdatePolicy.isInsideDirectory("/storage/emulated/0/Documents/Qortal Go/Apps/x.apk", dir));
        assertFalse(AppUpdatePolicy.isInsideDirectory(null, dir));
        assertFalse(AppUpdatePolicy.isInsideDirectory(dir + "/x.apk", ""));
    }

    @Test
    public void updateFileNamesStayInTheFolder() {
        assertEquals("GO_3.0_v0.0.15.apk", AppUpdatePolicy.safeFileName("GO 3.0 v0.0.15.apk"));
        assertEquals(".._.._x.apk", AppUpdatePolicy.safeFileName("../../x.apk"));
        assertEquals("update.apk", AppUpdatePolicy.safeFileName(".."));
        assertEquals("update.apk", AppUpdatePolicy.safeFileName(""));
        assertEquals("update.apk", AppUpdatePolicy.safeFileName(null));
    }

    @Test
    public void hexIsLowercase() {
        assertEquals("00ff10", AppUpdatePolicy.hex(new byte[] {0, (byte) 0xff, 0x10}));
        assertEquals("", AppUpdatePolicy.hex(null));
    }

    @Test
    public void verdictCodesAreStable() {
        assertEquals("UPDATE_WRONG_PACKAGE", AppUpdatePolicy.Verdict.WRONG_PACKAGE.code);
        assertEquals("UPDATE_WRONG_SIGNER", AppUpdatePolicy.Verdict.WRONG_SIGNER.code);
        assertEquals("UPDATE_NOT_NEWER", AppUpdatePolicy.Verdict.NOT_NEWER.code);
        assertEquals("UPDATE_UNREADABLE", AppUpdatePolicy.Verdict.UNREADABLE.code);
        assertEquals("UPDATE_INSECURE_URL", AppUpdatePolicy.UrlVerdict.INSECURE.code);
    }
}
