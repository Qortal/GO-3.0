package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WebMediaPermissionPolicyTest {
    private static final String AUDIO = "android.webkit.resource.AUDIO_CAPTURE";
    private static final String VIDEO = "android.webkit.resource.VIDEO_CAPTURE";
    private static final String DRM = "android.webkit.resource.PROTECTED_MEDIA_ID";
    private static final String MIDI = "android.webkit.resource.MIDI_SYSEX";

    /** GO's page is http://localhost (bridge.getLocalUrl()). */
    private static boolean allowed(String scheme, String host, int port, String... resources) {
        return WebMediaPermissionPolicy.allow(scheme, host, port, "http", "localhost", -1, resources);
    }

    @Test
    public void constantsMatchAndroid() {
        assertEquals(AUDIO, WebMediaPermissionPolicy.AUDIO_CAPTURE);
        assertEquals(VIDEO, WebMediaPermissionPolicy.VIDEO_CAPTURE);
    }

    @Test
    public void goGetsTheMicrophoneForCallsAndTheCameraForTheScanner() {
        assertTrue(allowed("http", "localhost", -1, AUDIO));
        assertTrue(allowed("http", "localhost", -1, VIDEO));
        assertTrue(allowed("http", "localhost", -1, AUDIO, VIDEO));
        assertTrue(allowed("http", "localhost", -1, AUDIO, AUDIO));
        // WebView reports the origin as "http://localhost/"; case and the
        // explicit default port do not matter.
        assertTrue(allowed("HTTP", "LocalHost", 80, AUDIO));
    }

    @Test
    public void drmMidiAndUnknownResourcesAreDeniedEvenToGo() {
        assertFalse(allowed("http", "localhost", -1, DRM));
        assertFalse(allowed("http", "localhost", -1, MIDI));
        assertFalse(allowed("http", "localhost", -1, "android.webkit.resource.SOMETHING_NEW"));
        // A request that mixes in anything else is denied as a whole.
        assertFalse(allowed("http", "localhost", -1, AUDIO, DRM));
        assertFalse(allowed("http", "localhost", -1, VIDEO, MIDI));
        assertFalse(allowed("http", "localhost", -1, AUDIO, null));
    }

    @Test
    public void otherOriginsAreDenied() {
        // Q-Apps and QDN sites from the node or the public gateway.
        assertFalse(allowed("http", "127.0.0.1", 12391, AUDIO));
        assertFalse(allowed("http", "127.0.0.1", 12391, VIDEO));
        assertFalse(allowed("https", "ext-node.qortal.link", -1, AUDIO, VIDEO));
        assertFalse(allowed("http", "192.168.1.20", 12391, AUDIO));
        // Look-alikes of GO's origin.
        assertFalse(allowed("https", "localhost", -1, AUDIO));
        assertFalse(allowed("http", "localhost", 8080, AUDIO));
        assertFalse(allowed("http", "localhost.evil.example", -1, AUDIO));
        assertFalse(allowed("http", "127.0.0.1", -1, AUDIO));
        // Opaque origins (sandboxed frames, data: URLs) have no scheme or host.
        assertFalse(allowed(null, null, -1, AUDIO));
        assertFalse(allowed("data", null, -1, AUDIO));
    }

    @Test
    public void emptyRequestsAreDenied() {
        assertFalse(allowed("http", "localhost", -1));
        assertFalse(WebMediaPermissionPolicy.allow("http", "localhost", -1, "http", "localhost", -1, null));
    }

    @Test
    public void unknownAppOriginDeniesEverything() {
        assertFalse(WebMediaPermissionPolicy.allow("http", "localhost", -1, null, null, -1, new String[] { AUDIO }));
    }
}
