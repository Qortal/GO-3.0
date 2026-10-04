package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class AppOriginGuardPolicyTest {
    private static final Map<String, String> NAVIGATION = new HashMap<>();
    private static final Map<String, String> SUBRESOURCE = new HashMap<>();

    static {
        NAVIGATION.put("Upgrade-Insecure-Requests", "1");
        SUBRESOURCE.put("Accept", "image/*");
    }

    private static AppOriginGuardPolicy.Request req(String scheme, String host, int port, String path, boolean mainFrame, Map<String, String> headers) {
        AppOriginGuardPolicy.Request r = new AppOriginGuardPolicy.Request();
        r.scheme = scheme;
        r.host = host;
        r.port = port;
        r.path = path;
        r.mainFrame = mainFrame;
        r.headers = headers;
        return r;
    }

    private static boolean refused(AppOriginGuardPolicy.Request r) {
        return AppOriginGuardPolicy.refuse(r, "http", "localhost", -1);
    }

    @Test
    public void goItselfStillLoadsInTheMainFrame() {
        assertFalse(refused(req("http", "localhost", -1, "/", true, NAVIGATION)));
        assertFalse(refused(req("http", "localhost", -1, "/index.html", true, NAVIGATION)));
        assertFalse(refused(req("http", "localhost", -1, "/assets/index-abc.js", false, SUBRESOURCE)));
    }

    @Test
    public void goKeepsItsImageAndVideoPreviews() {
        assertFalse(refused(req("http", "localhost", -1, "/_capacitor_file_/data/user/0/x/cache/photo.jpg", false, SUBRESOURCE)));
        assertFalse(refused(req("http", "localhost", -1, "/_capacitor_content_/media/external/images/12", false, null)));
    }

    @Test
    public void framesNeverGetAPageOnGosOrigin() {
        // GO-01: a Q-App frame navigating to a saved HTML file, or to any page of GO's own.
        assertTrue(refused(req("http", "localhost", -1, "/_capacitor_file_/storage/emulated/0/Documents/Qortal Go/x.html", false, NAVIGATION)));
        assertTrue(refused(req("http", "localhost", -1, "/index.html", false, NAVIGATION)));
        assertTrue(refused(req("http", "localhost", -1, "/pdfjs/web/viewer.html", false, NAVIGATION)));
        assertTrue(refused(req("HTTP", "LOCALHOST", 80, "/", false, NAVIGATION)));
    }

    @Test
    public void capacitorPathsAreNeverAPage() {
        // A tapped chat link that navigates the main window.
        assertTrue(refused(req("http", "localhost", -1, "/_capacitor_file_/data/user/0/x/files/a.png", true, NAVIGATION)));
        assertTrue(refused(req("http", "localhost", -1, "/_capacitor_content_/downloads/1", true, NAVIGATION)));
        // Document types are refused even when the request does not look like a navigation.
        assertTrue(refused(req("http", "localhost", -1, "/_capacitor_file_/sdcard/Download/a.SVG", false, SUBRESOURCE)));
        assertTrue(refused(req("http", "localhost", -1, "/_capacitor_file_/sdcard/Download/a.xhtml", false, null)));
    }

    @Test
    public void theHttpProxyIsRefusedOnEveryHost() {
        assertTrue(refused(req("http", "localhost", -1, "/_capacitor_http_interceptor_", false, SUBRESOURCE)));
        assertTrue(refused(req("http", "localhost", -1, "/_capacitor_http_interceptor_/x", true, NAVIGATION)));
        assertTrue(refused(req("http", "127.0.0.1", 12391, "/_capacitor_http_interceptor_", false, SUBRESOURCE)));
    }

    @Test
    public void otherOriginsAreLeftToTheirOwnRules() {
        // Q-Apps load from the node; their own navigations are not GO's origin.
        assertFalse(refused(req("http", "127.0.0.1", 12391, "/render/APP/Q-Tube", false, NAVIGATION)));
        assertFalse(refused(req("https", "ext-node.qortal.link", -1, "/_capacitor_file_/x.html", false, NAVIGATION)));
        // Same host on another port is another origin.
        assertFalse(refused(req("http", "localhost", 12391, "/index.html", false, NAVIGATION)));
    }
}
