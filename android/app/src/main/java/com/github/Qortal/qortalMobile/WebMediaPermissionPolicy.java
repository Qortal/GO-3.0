package com.github.Qortal.qortalMobile;

/**
 * Pure rules behind {@link QortalWebChromeClient#onPermissionRequest}: no
 * Android types, so the JVM unit tests can check them.
 *
 * Only GO's own page (http://localhost) may use the microphone (calls) and
 * the camera (QR scanner). Every other origin (Q-Apps, QDN sites, the node)
 * is denied, and so is any request that includes something else, such as DRM
 * ids (PROTECTED_MEDIA_ID) or MIDI system-exclusive access: GO uses neither.
 */
public final class WebMediaPermissionPolicy {
    private WebMediaPermissionPolicy() {}

    /** Values of android.webkit.PermissionRequest.RESOURCE_*. */
    public static final String AUDIO_CAPTURE = "android.webkit.resource.AUDIO_CAPTURE";
    public static final String VIDEO_CAPTURE = "android.webkit.resource.VIDEO_CAPTURE";

    /**
     * True when the whole request may go on to Capacitor (which then asks
     * Android for RECORD_AUDIO/CAMERA); false means deny it.
     *
     * @param originScheme scheme of the requesting origin (Uri.getScheme())
     * @param originHost host of the requesting origin (Uri.getHost())
     * @param originPort port of the requesting origin (Uri.getPort(), -1 when absent)
     */
    public static boolean allow(
        String originScheme,
        String originHost,
        int originPort,
        String appScheme,
        String appHost,
        int appPort,
        String[] requested
    ) {
        if (requested == null || requested.length == 0) {
            return false;
        }
        if (!sameOrigin(originScheme, originHost, originPort, appScheme, appHost, appPort)) {
            return false;
        }
        for (String resource : requested) {
            if (!AUDIO_CAPTURE.equals(resource) && !VIDEO_CAPTURE.equals(resource)) {
                return false;
            }
        }
        return true;
    }

    static boolean sameOrigin(
        String scheme,
        String host,
        int port,
        String appScheme,
        String appHost,
        int appPort
    ) {
        return scheme != null
            && host != null
            && appScheme != null
            && appHost != null
            && scheme.equalsIgnoreCase(appScheme)
            && host.equalsIgnoreCase(appHost)
            && effectivePort(scheme, port) == effectivePort(appScheme, appPort);
    }

    private static int effectivePort(String scheme, int port) {
        if (port != -1) {
            return port;
        }
        return "https".equalsIgnoreCase(scheme) ? 443 : 80;
    }
}
