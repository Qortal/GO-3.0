package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Controls the device audio route during a voice call.
 *
 * The WebView audio surface captures the mic with echo-cancellation, which puts
 * Android into communication mode and, by default, routes playback to the tiny
 * earpiece at low volume — so the remote party's voice is effectively inaudible.
 * This plugin forces MODE_IN_COMMUNICATION and lets the call UI pick the
 * loudspeaker (default) or the earpiece.
 */
@CapacitorPlugin(name = "AudioRouting")
public class AudioRoutingPlugin extends Plugin {
    private static final String TAG = "AudioRoutingPlugin";

    private Integer savedMode = null;
    private Boolean savedSpeakerphone = null;

    private AudioManager am() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /** Enter in-call audio mode. Call when a voice call becomes active. */
    @PluginMethod
    public void startCall(PluginCall call) {
        try {
            AudioManager audio = am();
            if (savedMode == null) {
                savedMode = audio.getMode();
            }
            if (savedSpeakerphone == null) {
                savedSpeakerphone = audio.isSpeakerphoneOn();
            }
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            boolean speaker = !call.hasOption("speaker") || call.getBoolean("speaker", true);
            applyRoute(audio, speaker);
            call.resolve(routeState(audio, speaker));
        } catch (Exception e) {
            Log.e(TAG, "startCall failed", e);
            call.reject("startCall failed: " + e.getMessage());
        }
    }

    /** Toggle between loudspeaker (true) and earpiece (false) mid-call. */
    @PluginMethod
    public void setSpeaker(PluginCall call) {
        try {
            boolean speaker = call.getBoolean("speaker", true);
            AudioManager audio = am();
            if (audio.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            }
            applyRoute(audio, speaker);
            call.resolve(routeState(audio, speaker));
        } catch (Exception e) {
            Log.e(TAG, "setSpeaker failed", e);
            call.reject("setSpeaker failed: " + e.getMessage());
        }
    }

    /** Restore the prior audio mode/route. Call when the call ends. */
    @PluginMethod
    public void endCall(PluginCall call) {
        try {
            AudioManager audio = am();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audio.clearCommunicationDevice();
            }
            if (savedSpeakerphone != null) {
                audio.setSpeakerphoneOn(savedSpeakerphone);
                savedSpeakerphone = null;
            }
            if (savedMode != null) {
                audio.setMode(savedMode);
                savedMode = null;
            } else {
                audio.setMode(AudioManager.MODE_NORMAL);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "endCall failed", e);
            call.reject("endCall failed: " + e.getMessage());
        }
    }

    /** Snapshot the resulting route + volumes so the JS layer can log what
     *  actually happened (route gets silently clobbered by getUserMedia AEC). */
    private JSObject routeState(AudioManager audio, boolean speaker) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("speaker", speaker);
        ret.put("mode", audio.getMode());
        ret.put("speakerphoneOn", audio.isSpeakerphoneOn());
        try {
            ret.put("volVoiceCall", audio.getStreamVolume(AudioManager.STREAM_VOICE_CALL));
            ret.put("maxVoiceCall", audio.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL));
            ret.put("volMusic", audio.getStreamVolume(AudioManager.STREAM_MUSIC));
            ret.put("maxMusic", audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        } catch (Exception ignored) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo cd = audio.getCommunicationDevice();
            ret.put("commDeviceType", cd != null ? cd.getType() : -1);
            StringBuilder avail = new StringBuilder();
            for (AudioDeviceInfo d : audio.getAvailableCommunicationDevices()) {
                if (avail.length() > 0) avail.append(',');
                avail.append(d.getType());
            }
            ret.put("availCommTypes", avail.toString());
        }
        return ret;
    }

    private void bumpStream(AudioManager audio, int stream) {
        try {
            int max = audio.getStreamMaxVolume(stream);
            int cur = audio.getStreamVolume(stream);
            // Don't blast to max, but ensure it's at least audible (~70%).
            int want = Math.max(cur, (int) Math.ceil(max * 0.7));
            if (want > cur) {
                audio.setStreamVolume(stream, want, 0);
            }
        } catch (Exception ignored) {}
    }

    private void applyRoute(AudioManager audio, boolean speaker) {
        // The WebView's AudioContext output plays on STREAM_MUSIC; the mic AEC
        // and in-call route use STREAM_VOICE_CALL. A device with media volume at
        // 0 renders the decoded remote voice silently, so raise both.
        bumpStream(audio, AudioManager.STREAM_VOICE_CALL);
        bumpStream(audio, AudioManager.STREAM_MUSIC);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // setSpeakerphoneOn is deprecated on API 31+; use the explicit
            // communication-device API which actually moves the route.
            int wantType = speaker
                ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            AudioDeviceInfo target = null;
            for (AudioDeviceInfo d : audio.getAvailableCommunicationDevices()) {
                if (d.getType() == wantType) {
                    target = d;
                    break;
                }
            }
            if (target != null) {
                audio.setCommunicationDevice(target);
            } else {
                audio.setSpeakerphoneOn(speaker);
            }
        } else {
            audio.setSpeakerphoneOn(speaker);
        }
    }
}
