package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * The page's API to {@link CallSession} (src/plugins/QortalCall.ts,
 * src/bridge/nativeCallSession.ts): call active / ringing, notification
 * buttons, lock screen state.
 *
 * Events: 'callAction' {action, callId, source, at}, 'ringStateChanged'
 * {callId, ringing, posted, silent, confirmed, source, reason, fromAddress,
 * name}, 'deviceLockChanged' {locked, interactive}, 'callForegroundChanged'
 * {micForeground, typeFlags, callId}.
 */
@CapacitorPlugin(name = "QortalCall")
public class QortalCallPlugin extends Plugin implements CallSession.Listener {
    private static final String TAG = "QortalCallPlugin";

    private CallSession session() {
        return CallSession.get(getContext());
    }

    @Override
    public void load() {
        super.load();
        session().attachListener(this);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        session().onAppForeground();
    }

    /**
     * The activity and its page are gone (recreate after a renderer crash,
     * or destroyed while the process lives): the call in that page is over.
     * Without this the microphone service, call notification, keep-alive
     * and lock-screen flags would outlive it, and its Hang up would reach a
     * new page that knows no call.
     */
    @Override
    protected void handleOnDestroy() {
        CallSession session = session();
        session.detachListener(this);
        session.onPageGone("page-destroyed");
        super.handleOnDestroy();
    }

    // ── Listener (to the page) ──────────────────────────────────────────────

    @Override
    public void onCallAction(String action, String callId, String source, long atMs) {
        JSObject payload = new JSObject();
        payload.put("action", action);
        payload.put("callId", callId != null ? callId : "");
        payload.put("source", source);
        payload.put("at", atMs);
        // Accept / decline / open wait for a page that subscribes late (cold start).
        boolean retain = CallSessionPolicy.ACTION_ACCEPT.equals(action)
            || CallSessionPolicy.ACTION_DECLINE.equals(action)
            || CallSessionPolicy.ACTION_OPEN.equals(action);
        notifyListeners("callAction", payload, retain && !hasListeners("callAction"));
    }

    @Override
    public void onRingStateChanged(CallSession.RingSnapshot ring) {
        notifyListeners("ringStateChanged", ringToJs(ring));
    }

    @Override
    public void onDeviceLockChanged(boolean locked, boolean interactive) {
        JSObject payload = new JSObject();
        payload.put("locked", locked);
        payload.put("interactive", interactive);
        notifyListeners("deviceLockChanged", payload);
    }

    @Override
    public void onCallForegroundChanged(Boolean micForeground, int typeFlags, String callId) {
        JSObject payload = new JSObject();
        payload.put("micForeground", micForeground != null ? (Object) micForeground : org.json.JSONObject.NULL);
        payload.put("typeFlags", typeFlags);
        payload.put("callId", callId != null ? callId : "");
        notifyListeners("callForegroundChanged", payload);
    }

    @Override
    public boolean hasCallActionListeners() {
        return hasListeners("callAction");
    }

    private static JSObject ringToJs(CallSession.RingSnapshot ring) {
        JSObject payload = new JSObject();
        if (ring == null) {
            payload.put("ringing", false);
            return payload;
        }
        payload.put("callId", ring.callId != null ? ring.callId : "");
        payload.put("fromAddress", ring.fromAddress != null ? ring.fromAddress : "");
        payload.put("name", ring.name != null ? ring.name : "");
        payload.put("source", ring.source);
        payload.put("ringing", ring.ringing);
        payload.put("posted", ring.posted);
        payload.put("silent", ring.silent);
        payload.put("confirmed", ring.confirmed);
        payload.put("reason", ring.reason);
        return payload;
    }

    // ── Methods ─────────────────────────────────────────────────────────────

    /**
     * {active, callId, kind: 'dm'|'group', phase: 'calling'|'connecting'|
     * 'joining'|'connected', peerName, avatarDataUrl, muted, connectedAt}.
     * Resolves {ok, active, micForeground (null = not known yet), typeFlags}.
     */
    @PluginMethod
    public void setCallActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        CallNotifications.OngoingSpec spec = new CallNotifications.OngoingSpec();
        spec.callId = call.getString("callId");
        String kind = CallRoutePolicy.parseKind(call.getString("kind"));
        spec.kind = kind != null ? kind : (active ? CallRoutePolicy.KIND_DM : null);
        spec.phase = call.getString("phase");
        spec.peerName = call.getString("peerName");
        String avatar = call.getString("avatarDataUrl");
        spec.avatarDataUrl = avatar != null && avatar.startsWith("data:image/") ? avatar : null;
        spec.muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
        Long connectedAt = call.getLong("connectedAt");
        spec.connectedAtMs = connectedAt != null ? connectedAt : 0L;
        session().setCallActive(active, spec, (isActive, micForeground, typeFlags) -> {
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("active", isActive);
            ret.put("micForeground", micForeground != null ? (Object) micForeground : org.json.JSONObject.NULL);
            ret.put("typeFlags", typeFlags);
            call.resolve(ret);
        });
    }

    /**
     * The page rings (or updates the caller's name / avatar):
     * {callId, fromAddress, fromName, avatarDataUrl, kind}. Native shows the
     * ringing notification only while GO is off screen, the screen is off or
     * the phone is locked ('ringStateChanged' says when: posted).
     */
    @PluginMethod
    public void showIncomingCall(PluginCall call) {
        String callId = call.getString("callId");
        if (callId == null || callId.trim().isEmpty()) {
            call.reject("callId is required");
            return;
        }
        String avatar = call.getString("avatarDataUrl");
        session().showIncomingFromPage(
            callId.trim(),
            call.getString("fromAddress"),
            call.getString("fromName"),
            avatar != null && avatar.startsWith("data:image/") ? avatar : null,
            CallRoutePolicy.KIND_GROUP.equals(CallRoutePolicy.parseKind(call.getString("kind"))),
            CallSession.SOURCE_PAGE
        );
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** Stop the ringtone, keep the call offer (Android back on the ring screen): {callId}. */
    @PluginMethod
    public void silenceRing(PluginCall call) {
        session().silenceRingFromPage(call.getString("callId"));
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** The ring ended: {callId (required for a native ring), reason}. */
    @PluginMethod
    public void cancelIncomingCall(PluginCall call) {
        session().cancelIncomingFromPage(call.getString("callId"), call.getString("reason", "page"));
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * The addresses this page answers calls for (window.call.setLocalAddresses):
     * native rings a CALL_REQUEST addressed to one of them while the page is frozen.
     * An empty list (logout) turns native ringing off.
     */
    @PluginMethod
    public void setRingAddresses(PluginCall call) {
        List<String> addresses = new ArrayList<>();
        JSArray raw = call.getArray("addresses");
        if (raw != null) {
            for (int i = 0; i < raw.length(); i++) {
                Object value = raw.opt(i);
                if (value instanceof String) addresses.add((String) value);
            }
        }
        session().setRingAddresses(addresses);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("count", addresses.size());
        call.resolve(ret);
    }

    /** The last accept/decline/open/hangup from a notification (≤ 60 s old), or {}. */
    @PluginMethod
    public void getPendingCallAction(PluginCall call) {
        session().pendingAction(pending -> {
            JSObject ret = new JSObject();
            if (pending != null) {
                ret.put("action", pending.action);
                ret.put("callId", pending.callId != null ? pending.callId : "");
                ret.put("source", pending.source);
                ret.put("at", pending.atMs);
            }
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void clearPendingCallAction(PluginCall call) {
        session().clearPendingAction();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** The ring in progress ({ringing:false} when none). */
    @PluginMethod
    public void getRingState(PluginCall call) {
        session().ringSnapshot(ring -> call.resolve(ringToJs(ring)));
    }

    /**
     * {locked: lock screen showing (GO may be over it), secure: PIN /
     * pattern / password set, interactive: screen on}.
     */
    @PluginMethod
    public void isDeviceLocked(PluginCall call) {
        CallSession session = session();
        JSObject ret = new JSObject();
        ret.put("locked", session.isKeyguardLocked());
        ret.put("secure", session.isDeviceSecure());
        ret.put("interactive", session.isInteractive());
        call.resolve(ret);
    }

    /**
     * Ask Android to unlock (PIN / fingerprint over GO), e.g. when the user
     * leaves the call screen for the rest of GO. Resolves {result:
     * 'unlocked' | 'cancelled' | 'error' | 'not-locked' | 'unavailable'}.
     */
    @PluginMethod
    public void requestUnlock(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            resolveUnlock(call, "unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                KeyguardManager km = activity.getSystemService(KeyguardManager.class);
                if (km == null) {
                    resolveUnlock(call, "unavailable");
                    return;
                }
                if (!km.isKeyguardLocked()) {
                    resolveUnlock(call, "not-locked");
                    return;
                }
                km.requestDismissKeyguard(activity, new KeyguardManager.KeyguardDismissCallback() {
                    @Override
                    public void onDismissSucceeded() {
                        resolveUnlock(call, "unlocked");
                    }

                    @Override
                    public void onDismissCancelled() {
                        resolveUnlock(call, "cancelled");
                    }

                    @Override
                    public void onDismissError() {
                        resolveUnlock(call, "error");
                    }
                });
            } catch (RuntimeException error) {
                Log.w(TAG, "requestDismissKeyguard failed", error);
                resolveUnlock(call, "error");
            }
        });
    }

    private static void resolveUnlock(PluginCall call, String result) {
        JSObject ret = new JSObject();
        ret.put("result", result);
        call.resolve(ret);
    }

    /** Android 14+ may refuse the full-screen ring: {allowed}. */
    @PluginMethod
    public void canUseFullScreenIntent(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                NotificationManager manager = getContext().getSystemService(NotificationManager.class);
                allowed = manager == null || manager.canUseFullScreenIntent();
            } catch (RuntimeException error) {
                allowed = true;
            }
        }
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    /** Opens Android's own "full screen notifications" switch for GO (Android 14+). */
    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        boolean opened = false;
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= 34 && context != null) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                Activity activity = getActivity();
                if (activity != null) {
                    activity.startActivity(intent);
                } else {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                }
                opened = true;
            } catch (RuntimeException error) {
                Log.w(TAG, "Full-screen notification settings not opened", error);
            }
        }
        JSObject ret = new JSObject();
        ret.put("opened", opened);
        call.resolve(ret);
    }

    /**
     * GO's own language for the call notifications ({strings: {key: text}};
     * keys CallNotifications.STRING_KEYS). Persisted; a missing key uses the
     * system language.
     */
    @PluginMethod
    public void setStrings(PluginCall call) {
        JSObject strings = call.getObject("strings");
        Map<String, String> values = new HashMap<>();
        if (strings != null) {
            Iterator<String> keys = strings.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object value = strings.opt(key);
                if (value instanceof String) values.put(key, (String) value);
            }
        }
        int kept = CallNotifications.setStrings(getContext(), values);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("kept", kept);
        call.resolve(ret);
    }

    /** Copy diagnostics. */
    @PluginMethod
    public void getState(PluginCall call) {
        session().diagnostics(map -> {
            JSObject ret = new JSObject();
            for (Map.Entry<String, Object> entry : map.entrySet()) {
                Object value = entry.getValue();
                ret.put(entry.getKey(), value != null ? value : org.json.JSONObject.NULL);
            }
            ret.put("knownStringKeys", new JSONArray(java.util.Arrays.asList(CallNotifications.STRING_KEYS)));
            call.resolve(ret);
        });
    }
}
