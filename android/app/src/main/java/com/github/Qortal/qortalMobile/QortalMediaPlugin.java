package com.github.Qortal.qortalMobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * The page's side of GO's background player ({@link GoMediaHub};
 * src/plugins/QortalMedia.ts): its settings, the sleep timer, "Now playing"
 * with Play / Pause for the settings window, and the notification's taps.
 *
 * Events: 'playerChanged' (same shape as getState), 'openSettings' {} (the
 * gear in the notification), 'openSource' {frameId, goPage} (the
 * notification itself was tapped).
 */
@CapacitorPlugin(name = "QortalMedia")
public class QortalMediaPlugin extends Plugin implements GoMediaHub.Listener {

    private GoMediaHub hub() {
        return GoMediaHub.get(getContext());
    }

    @Override
    public void load() {
        super.load();
        hub().attach(getBridge().getWebView());
        hub().setListener(this);
        if (hub().takePendingOpenSettings()) onOpenSettings();
    }

    @Override
    protected void handleOnDestroy() {
        hub().clearListener(this);
        super.handleOnDestroy();
    }

    // ── Listener (to the page) ──────────────────────────────────────────────

    @Override
    public void onPlayerChanged(JSONObject state) {
        notifyListeners("playerChanged", toJs(state));
    }

    @Override
    public void onOpenSettings() {
        // Kept for a page that subscribes late (GO opened by the gear).
        notifyListeners("openSettings", new JSObject(), !hasListeners("openSettings"));
    }

    @Override
    public void onOpenSource(String frameId, boolean goPage) {
        JSObject payload = new JSObject();
        payload.put("frameId", frameId != null ? frameId : "");
        payload.put("goPage", goPage);
        notifyListeners("openSource", payload, !hasListeners("openSource"));
    }

    private static JSObject toJs(JSONObject source) {
        JSObject out = new JSObject();
        if (source == null) return out;
        for (Iterator<String> it = source.keys(); it.hasNext(); ) {
            String key = it.next();
            out.put(key, source.opt(key));
        }
        return out;
    }

    // ── Methods ─────────────────────────────────────────────────────────────

    @PluginMethod
    public void getSettings(PluginCall call) {
        call.resolve(settingsToJs(hub().settings()));
    }

    @PluginMethod
    public void setSettings(PluginCall call) {
        MediaPlayerPolicy.Settings s = hub().settings().copy();
        JSObject data = call.getData();
        if (data.has("backgroundAudio")) s.backgroundAudio = data.optBoolean("backgroundAudio", s.backgroundAudio);
        if (data.has("backgroundVideo")) s.backgroundVideo = data.optBoolean("backgroundVideo", s.backgroundVideo);
        if (data.has("pauseOnScreenLock")) s.pauseOnScreenLock = data.optBoolean("pauseOnScreenLock", s.pauseOnScreenLock);
        if (data.has("resumeOnReturn")) s.resumeOnReturn = data.optBoolean("resumeOnReturn", s.resumeOnReturn);
        if (data.has("lockScreen")) s.lockScreen = data.optBoolean("lockScreen", s.lockScreen);
        if (data.has("logoOnCover")) s.logoOnCover = data.optBoolean("logoOnCover", s.logoOnCover);
        if (data.has("pauseOnNoisy")) s.pauseOnNoisy = data.optBoolean("pauseOnNoisy", s.pauseOnNoisy);
        if (data.has("seekStepSec")) s.seekStepSec = data.optInt("seekStepSec", s.seekStepSec);
        if (data.has("closePausedAfterMin")) s.closePausedAfterMin = data.optInt("closePausedAfterMin", s.closePausedAfterMin);
        hub().saveSettings(s);
        call.resolve(settingsToJs(hub().settings()));
    }

    private static JSObject settingsToJs(MediaPlayerPolicy.Settings s) {
        JSObject out = new JSObject();
        out.put("backgroundAudio", s.backgroundAudio);
        out.put("backgroundVideo", s.backgroundVideo);
        out.put("pauseOnScreenLock", s.pauseOnScreenLock);
        out.put("resumeOnReturn", s.resumeOnReturn);
        out.put("lockScreen", s.lockScreen);
        out.put("logoOnCover", s.logoOnCover);
        out.put("pauseOnNoisy", s.pauseOnNoisy);
        out.put("seekStepSec", s.seekStepSec);
        out.put("closePausedAfterMin", s.closePausedAfterMin);
        return out;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(toJs(hub().pageState()));
    }

    /** play | pause | toggle | next | previous | back | forward */
    @PluginMethod
    public void control(PluginCall call) {
        hub().control(call.getString("action", ""));
        call.resolve();
    }

    /** minutes: 0 off, -1 end of the track, or 15 / 30 / 45 / 60 / 90. */
    @PluginMethod
    public void setSleepTimer(PluginCall call) {
        hub().setSleepTimer(call.getInt("minutes", 0));
        call.resolve();
    }

    @PluginMethod
    public void setStrings(PluginCall call) {
        JSObject strings = call.getObject("strings", new JSObject());
        Map<String, String> map = new HashMap<>();
        for (String key : GoMediaHub.STRING_KEYS) {
            String value = strings.getString(key);
            if (value != null) map.put(key, value);
        }
        hub().setStrings(map);
        call.resolve();
    }
}
