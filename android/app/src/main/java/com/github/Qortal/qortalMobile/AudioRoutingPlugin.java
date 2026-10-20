package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Controls the device audio route during a voice call: the page's API to
 * {@link CallAudioRouter} (communication mode, headset / Bluetooth / earpiece
 * / loudspeaker, proximity screen-off, audio focus).
 *
 * Old API (kept): startCall({speaker}), setSpeaker({speaker}), endCall().
 * New: startCall({owner, kind, route}), getAudioRoutes(), setAudioRoute({route}),
 * reapply(), endCall({owner}); events 'audioRouteChanged' and
 * 'audioFocusChanged'.
 *
 * Asks for no permission: a Bluetooth headset is routed without
 * BLUETOOTH_CONNECT, and GO never shows Android's "Nearby devices" prompt.
 */
@CapacitorPlugin(name = "AudioRouting")
public class AudioRoutingPlugin extends Plugin implements CallAudioRouter.Listener {
    private static final String TAG = "AudioRoutingPlugin";

    private AudioManager am() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private CallAudioRouter router() {
        return CallAudioRouter.get(getContext());
    }

    @Override
    public void load() {
        super.load();
        router().addListener(this);
    }

    /**
     * The page (and the call in it) is gone: put the phone's audio back to
     * normal (a recreated activity must not leave it in call mode).
     */
    @Override
    protected void handleOnDestroy() {
        CallAudioRouter router = router();
        router.removeListener(this);
        router.endAll("page-gone");
        super.handleOnDestroy();
    }

    @Override
    public void onRouteChanged(CallAudioRouter.State state, String reason) {
        JSObject payload = toJs(state);
        payload.put("reason", reason);
        notifyListeners("audioRouteChanged", payload);
        // Same payload under the name the GO call UI listens for.
        notifyListeners("routeChanged", payload);
    }

    @Override
    public void onFocusChanged(String focus) {
        JSObject payload = new JSObject();
        payload.put("focus", focus);
        notifyListeners("audioFocusChanged", payload);
    }

    private static JSObject toJs(CallAudioRouter.State state) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("active", state.active);
        ret.put("route", state.route);
        // Alias for readers that expect "current".
        ret.put("current", state.route);
        JSArray routes = new JSArray();
        for (String route : state.routes) routes.put(route);
        ret.put("routes", routes);
        ret.put("speaker", state.speaker);
        ret.put("kind", state.kind);
        ret.put("explicitChoice", state.explicitChoice);
        ret.put("builtinChoice", state.builtinChoice);
        ret.put("mode", state.mode);
        ret.put("commDeviceType", state.commDeviceType);
        ret.put("focus", state.focus);
        ret.put("proximity", state.proximityHeld);
        ret.put("owners", state.owners);
        return ret;
    }

    /**
     * Enter in-call audio mode. Options: owner (default "legacy"; the call
     * audio ends when every owner called endCall), kind "dm" | "group"
     * (default route: earpiece / loudspeaker), route (a hand pick), and the
     * old speaker boolean (earpiece / loudspeaker choice; a headset still
     * wins).
     */
    @PluginMethod
    public void startCall(PluginCall call) {
        try {
            Boolean speaker = call.hasOption("speaker") ? call.getBoolean("speaker", true) : null;
            CallAudioRouter.State state = router().start(
                call.getString("owner"),
                call.getString("kind"),
                speaker,
                call.getString("route")
            );
            JSObject ret = toJs(state);
            appendRouteDiagnostics(ret, am());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "startCall failed", e);
            call.reject("startCall failed: " + e.getMessage());
        }
    }

    /**
     * Loudspeaker (true) or earpiece (false) for when no headset is in use.
     * A connected headset keeps the call (use setAudioRoute to move it).
     */
    @PluginMethod
    public void setSpeaker(PluginCall call) {
        try {
            boolean speaker = call.getBoolean("speaker", true);
            JSObject ret = toJs(router().setSpeakerChoice(speaker));
            appendRouteDiagnostics(ret, am());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "setSpeaker failed", e);
            call.reject("setSpeaker failed: " + e.getMessage());
        }
    }

    /**
     * This owner (default "legacy") is done with the call audio; with the
     * last owner the phone goes back to normal audio. {all: true} ends it for
     * everyone.
     */
    @PluginMethod
    public void endCall(PluginCall call) {
        try {
            CallAudioRouter router = router();
            if (Boolean.TRUE.equals(call.getBoolean("all", false))) {
                router.endAll("end-all");
            } else {
                router.end(call.getString("owner"));
            }
            JSObject ret = toJs(router.snapshot());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "endCall failed", e);
            call.reject("endCall failed: " + e.getMessage());
        }
    }

    /** Routes the phone offers now and the one in use. */
    @PluginMethod
    public void getAudioRoutes(PluginCall call) {
        JSObject ret = toJs(router().snapshot());
        appendRouteDiagnostics(ret, am());
        call.resolve(ret);
    }

    /** Same as getAudioRoutes (name the GO call UI uses). */
    @PluginMethod
    public void listRoutes(PluginCall call) {
        getAudioRoutes(call);
    }

    /** Same as setAudioRoute with {type} (name the GO call UI uses). */
    @PluginMethod
    public void setRoute(PluginCall call) {
        setAudioRoute(call);
    }

    /** The user picked a route: {route} (or {type}) earpiece | speaker | wired | bluetooth. */
    @PluginMethod
    public void setAudioRoute(PluginCall call) {
        String raw = call.getString("route");
        if (raw == null) raw = call.getString("type");
        String route = CallRoutePolicy.parseRoute(raw);
        if (route == null) {
            call.reject("Unknown route");
            return;
        }
        JSObject ret = toJs(router().setRoute(route));
        appendRouteDiagnostics(ret, am());
        call.resolve(ret);
    }

    /**
     * Apply the current route again without changing any choice (after
     * getUserMedia: the WebView's echo canceller moves the route).
     */
    @PluginMethod
    public void reapply(PluginCall call) {
        JSObject ret = toJs(router().reapply());
        appendRouteDiagnostics(ret, am());
        call.resolve(ret);
    }

    /** Volumes and devices, so the page can log what actually happened. */
    private static void appendRouteDiagnostics(JSObject ret, AudioManager audio) {
        if (audio == null) return;
        try {
            ret.put("speakerphoneOn", audio.isSpeakerphoneOn());
            ret.put("volVoiceCall", audio.getStreamVolume(AudioManager.STREAM_VOICE_CALL));
            ret.put("maxVoiceCall", audio.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL));
            ret.put("volMusic", audio.getStreamVolume(AudioManager.STREAM_MUSIC));
            ret.put("maxMusic", audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                StringBuilder avail = new StringBuilder();
                for (AudioDeviceInfo d : audio.getAvailableCommunicationDevices()) {
                    if (avail.length() > 0) avail.append(',');
                    avail.append(d.getType());
                }
                ret.put("availCommTypes", avail.toString());
            }
        } catch (RuntimeException ignored) {
            // Diagnostics only.
        }
    }
}
