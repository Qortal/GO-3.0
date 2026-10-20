package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * In-call audio for GO, process-wide (AudioRoutingPlugin is its page API).
 *
 * - Communication mode while a call runs, back to normal at the end.
 * - Route: wired / USB headset, then Bluetooth (SCO or LE Audio via
 *   setCommunicationDevice on Android 12+, startBluetoothSco before; no
 *   runtime permission either way, GO never asks for BLUETOOTH_CONNECT), then
 *   the user's choice of earpiece or loudspeaker (default earpiece for 1:1
 *   calls, loudspeaker for group calls). A headset Android refuses falls
 *   through to the next route, and that is the route reported. Follows
 *   plug / unplug and pairing (AudioDeviceCallback) and re-asserts the
 *   route when the WebView's echo canceller grabs the communication device
 *   behind GO's back.
 * - Screen off at the ear: proximity wake lock while on the earpiece.
 * - Audio focus (voice communication) so music pauses and a phone call
 *   can be noticed (focus loss is reported to the page).
 * - No more forcing volumes to 70 %: a stream turned all the way down is
 *   raised to a third, anything else is the user's.
 *
 * Several owners may hold the call audio (the call session and the DM media
 * surface); it ends when the last one lets go. Thread-safe (synchronized);
 * callbacks arrive on the main thread.
 */
public final class CallAudioRouter {
    private static final String TAG = "QortalCallAudio";
    /** At most this many automatic re-asserts within {@link #REASSERT_WINDOW_MS}. */
    private static final int REASSERT_MAX = 4;
    private static final long REASSERT_WINDOW_MS = 5_000L;
    /** While a phone call holds the audio mode, look again this often (the focus may return before the mode). */
    private static final long PHONE_CALL_RETRY_MS = 2_000L;

    public static final String FOCUS_GAIN = "gain";
    public static final String FOCUS_LOSS = "loss";
    public static final String FOCUS_LOSS_TRANSIENT = "loss_transient";
    public static final String FOCUS_DUCK = "duck";

    /** Route snapshot for the page. */
    public static final class State {
        public boolean active;
        public String route;
        public List<String> routes = new ArrayList<>();
        public boolean speaker;
        public String kind;
        public String explicitChoice;
        public String builtinChoice;
        public int mode;
        public int commDeviceType = -1;
        public String focus;
        public boolean proximityHeld;
        public int owners;
    }

    public interface Listener {
        void onRouteChanged(State state, String reason);

        void onFocusChanged(String focus);
    }

    private static volatile CallAudioRouter instance;

    public static CallAudioRouter get(Context context) {
        CallAudioRouter local = instance;
        if (local != null) return local;
        synchronized (CallAudioRouter.class) {
            if (instance == null) instance = new CallAudioRouter(context.getApplicationContext());
            return instance;
        }
    }

    private final Context app;
    private final AudioManager audio;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<Listener> listeners = new CopyOnWriteArraySet<>();
    private final CallRoutePolicy.Owners owners = new CallRoutePolicy.Owners();

    // Guarded by this.
    private String kind = CallRoutePolicy.KIND_DM;
    private String builtinChoice;
    private String explicitChoice;
    private String currentRoute;
    private Set<String> lastRoutes = Collections.emptySet();
    private Boolean savedSpeakerphone;
    private boolean scoStarted;
    private AudioFocusRequest focusRequest;
    private String focus;
    /**
     * The focus as the last focus callback reported it (null = no change
     * since the call started). Only a real loss pauses automatic re-asserts:
     * a request refused at the start gets no callback when the phone call
     * that refused it ends (the mode check covers that call).
     */
    private String focusFromCallback;
    private AudioDeviceCallback deviceCallback;
    private boolean deviceCallbackPrimed;
    private Object commDeviceListener;
    private PowerManager.WakeLock proximityLock;
    private long reassertWindowStart;
    private int reassertCount;
    /**
     * Someone else kept moving the communication device (REASSERT_MAX in a
     * window): no more automatic re-asserts until the page asks (start,
     * route, speaker, reapply), a device comes or goes, or the focus returns.
     */
    private boolean reassertSuspended;
    private boolean phoneCallRetryPosted;
    private final Runnable phoneCallRetry = this::retryAfterPhoneCall;

    private CallAudioRouter(Context app) {
        this.app = app;
        this.audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
    }

    public void addListener(Listener listener) {
        if (listener != null) listeners.add(listener);
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    // ── Session ─────────────────────────────────────────────────────────────

    /**
     * Start (or join) the call audio. {@code kind} "dm" / "group" picks the
     * default speaker when nothing else decides; {@code legacySpeaker} (old
     * startCall({speaker})) sets the earpiece/loudspeaker choice directly;
     * {@code route} is a hand-picked route.
     */
    public synchronized State start(String owner, String kindRaw, Boolean legacySpeaker, String routeRaw) {
        boolean first = owners.acquire(owner);
        String parsedKind = CallRoutePolicy.parseKind(kindRaw);
        resumeReassertsLocked();
        if (first) {
            kind = parsedKind != null ? parsedKind : CallRoutePolicy.KIND_DM;
            explicitChoice = null;
            builtinChoice = null;
            beginLocked();
        } else if (parsedKind != null) {
            // Call waiting answered across kinds (group -> 1:1): the new
            // kind's default speaker, unless a route was picked by hand.
            builtinChoice = CallRoutePolicy.builtinAfterKindChange(
                builtinChoice,
                kind,
                parsedKind,
                explicitChoice,
                legacySpeaker != null
            );
            kind = parsedKind;
        }
        if (legacySpeaker != null) {
            builtinChoice = legacySpeaker ? CallRoutePolicy.ROUTE_SPEAKER : CallRoutePolicy.ROUTE_EARPIECE;
        }
        String route = CallRoutePolicy.parseRoute(routeRaw);
        if (route != null) {
            explicitChoice = route;
            builtinChoice = CallRoutePolicy.builtinAfterExplicit(builtinChoice, route);
        }
        if (builtinChoice == null) {
            builtinChoice = CallRoutePolicy.defaultBuiltinRoute(kind, hasEarpieceLocked());
        }
        applyLocked(first ? "start" : "start-again");
        return stateLocked();
    }

    /**
     * Old setSpeaker({speaker}): the earpiece / loudspeaker choice. A
     * headset still wins (a re-assert after getUserMedia must not pull the
     * call off the user's earbuds); use {@link #setRoute} for a hand pick.
     */
    public synchronized State setSpeakerChoice(boolean speaker) {
        resumeReassertsLocked();
        builtinChoice = speaker ? CallRoutePolicy.ROUTE_SPEAKER : CallRoutePolicy.ROUTE_EARPIECE;
        if (explicitChoice != null && !CallRoutePolicy.isHeadsetRoute(explicitChoice)) {
            explicitChoice = null;
        }
        if (owners.isEmpty()) {
            // Before the call (or after it): remembered for the next start.
            return stateLocked();
        }
        applyLocked("speaker-choice");
        return stateLocked();
    }

    /** The user picked a route (route sheet). Unknown or missing routes are refused. */
    public synchronized State setRoute(String routeRaw) {
        String route = CallRoutePolicy.parseRoute(routeRaw);
        if (route == null) return stateLocked();
        resumeReassertsLocked();
        explicitChoice = route;
        builtinChoice = CallRoutePolicy.builtinAfterExplicit(builtinChoice, route);
        if (!owners.isEmpty()) applyLocked("user-route");
        return stateLocked();
    }

    /** Apply the current route again (after getUserMedia: the echo canceller may have moved it). */
    public synchronized State reapply() {
        resumeReassertsLocked();
        if (!owners.isEmpty()) applyLocked("reapply");
        return stateLocked();
    }

    /** One owner lets go; the call audio ends with the last one. */
    public synchronized State end(String owner) {
        if (owners.release(owner)) endLocked("end");
        return stateLocked();
    }

    /** Everyone lets go (page gone, task removed). */
    public synchronized void endAll(String reason) {
        if (owners.releaseAll()) endLocked(reason);
    }

    public synchronized State snapshot() {
        return stateLocked();
    }

    // ── Internals ───────────────────────────────────────────────────────────

    /** A phone call held the audio mode: the call's route again once it is over. */
    private void retryAfterPhoneCall() {
        synchronized (this) {
            phoneCallRetryPosted = false;
            if (owners.isEmpty()) return;
            // The phone call still has the focus: its focus-gain re-applies.
            if (FOCUS_LOSS.equals(focusFromCallback) || FOCUS_LOSS_TRANSIENT.equals(focusFromCallback)) return;
            // Looks again in a moment while the mode is still the phone call's.
            applyLocked("after-phone-call");
        }
    }

    private void resumeReassertsLocked() {
        reassertSuspended = false;
        reassertCount = 0;
        reassertWindowStart = 0L;
    }

    /** AudioManager mode now; normal when unreadable. */
    private int currentModeLocked() {
        if (audio == null) return AudioManager.MODE_NORMAL;
        try {
            return audio.getMode();
        } catch (RuntimeException error) {
            return AudioManager.MODE_NORMAL;
        }
    }

    private void beginLocked() {
        if (audio == null) return;
        try {
            savedSpeakerphone = audio.isSpeakerphoneOn();
        } catch (RuntimeException ignored) {
            savedSpeakerphone = null;
        }
        try {
            if (CallRoutePolicy.mayTakeCommunicationMode(audio.getMode())) {
                audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            } else {
                Log.i(TAG, "A phone call holds the audio; communication mode waits");
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Communication mode refused", error);
        }
        requestFocusLocked();
        raiseSilentStreamsLocked();
        registerCallbacksLocked();
        Log.i(TAG, "Call audio started (" + kind + ")");
    }

    private void endLocked(String reason) {
        main.removeCallbacks(phoneCallRetry);
        phoneCallRetryPosted = false;
        unregisterCallbacksLocked();
        releaseProximityLocked();
        abandonFocusLocked();
        if (audio != null) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    audio.clearCommunicationDevice();
                }
            } catch (RuntimeException error) {
                Log.w(TAG, "clearCommunicationDevice failed", error);
            }
            stopScoLocked();
            try {
                if (savedSpeakerphone != null) audio.setSpeakerphoneOn(savedSpeakerphone);
            } catch (RuntimeException ignored) {
                // Best effort.
            }
            try {
                // Only GO (or the WebView's capture) puts the phone in
                // communication mode; never touch a phone call's mode.
                if (audio.getMode() == AudioManager.MODE_IN_COMMUNICATION) {
                    audio.setMode(AudioManager.MODE_NORMAL);
                }
            } catch (RuntimeException error) {
                Log.w(TAG, "Normal mode refused", error);
            }
        }
        savedSpeakerphone = null;
        currentRoute = null;
        explicitChoice = null;
        builtinChoice = null;
        lastRoutes = Collections.emptySet();
        focus = null;
        focusFromCallback = null;
        resumeReassertsLocked();
        Log.i(TAG, "Call audio ended (" + reason + ")");
        emitRouteLocked(reason);
    }

    private boolean hasEarpieceLocked() {
        return availableRoutesLocked().contains(CallRoutePolicy.ROUTE_EARPIECE);
    }

    private List<AudioDeviceInfo> communicationDevicesLocked() {
        List<AudioDeviceInfo> out = new ArrayList<>();
        if (audio == null) return out;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                out.addAll(audio.getAvailableCommunicationDevices());
            } else {
                Collections.addAll(out, audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS));
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Audio devices not readable", error);
        }
        return out;
    }

    private Set<String> availableRoutesLocked() {
        List<Integer> types = new ArrayList<>();
        for (AudioDeviceInfo device : communicationDevicesLocked()) types.add(device.getType());
        Set<String> routes = CallRoutePolicy.routesForDeviceTypes(types);
        if (routes.isEmpty()) {
            routes = new LinkedHashSet<>();
            routes.add(CallRoutePolicy.ROUTE_SPEAKER);
        }
        return routes;
    }

    private void applyLocked(String reason) {
        applyLocked(reason, false);
    }

    /**
     * Apply the chosen route. {@code automatic}: GO's own re-assert (device
     * moved, devices changed), which waits while the audio focus is lost or
     * after GO stopped fighting (see CallRoutePolicy.shouldAutoReassert).
     * Never over a phone call's audio mode, page request or not.
     */
    private void applyLocked(String reason, boolean automatic) {
        if (audio == null) return;
        Set<String> available = availableRoutesLocked();
        String want = CallRoutePolicy.chooseRoute(available, explicitChoice, builtinChoice);
        lastRoutes = available;
        int mode = currentModeLocked();
        if (automatic && !CallRoutePolicy.shouldAutoReassert(focusFromCallback, mode, reassertSuspended)) {
            emitRouteLocked(reason + "-waiting");
            return;
        }
        if (!CallRoutePolicy.mayTakeCommunicationMode(mode)) {
            // A phone call rings or runs: its audio is not GO's to move.
            // Look again once it is over.
            if (!phoneCallRetryPosted) {
                phoneCallRetryPosted = true;
                main.postDelayed(phoneCallRetry, PHONE_CALL_RETRY_MS);
            }
            emitRouteLocked(reason + "-phone-call");
            return;
        }
        try {
            if (mode != AudioManager.MODE_IN_COMMUNICATION) {
                audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            }
        } catch (RuntimeException ignored) {
            // Reported through the state's mode.
        }
        // The route the call really got (a refused headset falls through to
        // the next one), so the page, the diagnostics and the proximity lock
        // follow where it plays.
        currentRoute = applyRouteLocked(want, available);
        updateProximityLocked();
        emitRouteLocked(reason);
    }

    /**
     * Puts the call on {@code want}; when Android refuses that headset, on
     * the next route in the usual order instead. Returns the route applied.
     */
    private String applyRouteLocked(String want, Set<String> available) {
        String route = want;
        List<String> refused = new ArrayList<>();
        // Only a headset is ever refused (wired, Bluetooth), each once, and a
        // built-in route always applies: three tries at most.
        for (int tries = 0; tries < 3 && !applyDeviceLocked(route); tries++) {
            refused.add(route);
            String next = CallRoutePolicy.routeAfterRefused(available, refused, builtinChoice);
            Log.i(TAG, "Route " + route + " refused; call on " + next);
            route = next;
        }
        return route;
    }

    /**
     * Puts the call on {@code route}. False only when Android refused a
     * headset route (the caller then takes the next one); the earpiece and
     * loudspeaker always count as applied (the speakerphone switch is their
     * last resort).
     *
     * Never checks or needs BLUETOOTH_CONNECT: on Android 12+ the headset is
     * an ordinary communication device. A vendor build that still throws a
     * SecurityException for one only loses that device (logged, next route),
     * never the call.
     */
    private boolean applyDeviceLocked(String route) {
        boolean headset = CallRoutePolicy.isHeadsetRoute(route);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                AudioDeviceInfo target = null;
                for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
                    if (route.equals(CallRoutePolicy.routeForDeviceType(device.getType()))) {
                        target = device;
                        break;
                    }
                }
                if (target != null) {
                    try {
                        if (audio.setCommunicationDevice(target)) return true;
                        Log.w(TAG, "Communication device " + route + " refused");
                    } catch (RuntimeException error) {
                        Log.w(TAG, "Communication device " + route + " refused", error);
                    }
                }
                // A headset Android would not take (or no longer lists).
                if (headset) return false;
                // Fallback for a built-in speaker the comm-device list does not show.
                audio.setSpeakerphoneOn(CallRoutePolicy.ROUTE_SPEAKER.equals(route));
                return true;
            }
            if (CallRoutePolicy.ROUTE_BLUETOOTH.equals(route)) {
                audio.setSpeakerphoneOn(false);
                if (!scoStarted) {
                    audio.startBluetoothSco();
                    scoStarted = true;
                }
                audio.setBluetoothScoOn(true);
                return true;
            }
            stopScoLocked();
            // Wired: Android plays on the headset by itself once speakerphone is off.
            audio.setSpeakerphoneOn(CallRoutePolicy.ROUTE_SPEAKER.equals(route));
            return true;
        } catch (RuntimeException error) {
            Log.w(TAG, "Route " + route + " not applied", error);
            return !headset;
        }
    }

    private void stopScoLocked() {
        if (!scoStarted || audio == null) return;
        try {
            audio.setBluetoothScoOn(false);
            audio.stopBluetoothSco();
        } catch (RuntimeException error) {
            Log.w(TAG, "Bluetooth SCO not stopped", error);
        }
        scoStarted = false;
    }

    private void raiseSilentStreamsLocked() {
        for (int stream : new int[] {AudioManager.STREAM_VOICE_CALL, AudioManager.STREAM_MUSIC}) {
            try {
                int floor = CallRoutePolicy.volumeFloor(
                    audio.getStreamVolume(stream),
                    audio.getStreamMaxVolume(stream)
                );
                if (floor >= 0) audio.setStreamVolume(stream, floor, 0);
            } catch (RuntimeException ignored) {
                // Do Not Disturb can refuse volume changes; the user's setting stands.
            }
        }
    }

    private void requestFocusLocked() {
        if (audio == null) return;
        try {
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(this::onFocusChange, main)
                .build();
            int result = audio.requestAudioFocus(focusRequest);
            focus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED ? FOCUS_GAIN : FOCUS_LOSS_TRANSIENT;
        } catch (RuntimeException error) {
            Log.w(TAG, "Audio focus not requested", error);
        }
    }

    private void abandonFocusLocked() {
        if (audio == null || focusRequest == null) return;
        try {
            audio.abandonAudioFocusRequest(focusRequest);
        } catch (RuntimeException ignored) {
            // Best effort.
        }
        focusRequest = null;
    }

    private void onFocusChange(int change) {
        String next;
        switch (change) {
            case AudioManager.AUDIOFOCUS_GAIN:
            case AudioManager.AUDIOFOCUS_GAIN_TRANSIENT:
            case AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE:
            case AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK:
                next = FOCUS_GAIN;
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                next = FOCUS_LOSS;
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                next = FOCUS_LOSS_TRANSIENT;
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                next = FOCUS_DUCK;
                break;
            default:
                return;
        }
        synchronized (this) {
            if (owners.isEmpty()) return;
            String before = focus;
            focus = next;
            focusFromCallback = next;
            if (FOCUS_GAIN.equals(next) && !FOCUS_GAIN.equals(before)) {
                // Back from a phone call (or another app): the call's route again.
                resumeReassertsLocked();
                applyLocked("focus-gain");
            }
        }
        Log.i(TAG, "Audio focus " + next);
        for (Listener listener : listeners) {
            try {
                listener.onFocusChanged(next);
            } catch (RuntimeException error) {
                Log.w(TAG, "focus listener failed", error);
            }
        }
    }

    private void registerCallbacksLocked() {
        if (audio == null) return;
        if (deviceCallback == null) {
            deviceCallbackPrimed = false;
            deviceCallback = new AudioDeviceCallback() {
                @Override
                public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                    onDevicesChanged(added, true);
                }

                @Override
                public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                    onDevicesChanged(removed, false);
                }
            };
            try {
                audio.registerAudioDeviceCallback(deviceCallback, main);
            } catch (RuntimeException error) {
                Log.w(TAG, "Audio device callback not registered", error);
                deviceCallback = null;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && commDeviceListener == null) {
            try {
                AudioManager.OnCommunicationDeviceChangedListener listener = this::onCommDeviceChanged;
                audio.addOnCommunicationDeviceChangedListener(main::post, listener);
                commDeviceListener = listener;
            } catch (RuntimeException error) {
                Log.w(TAG, "Communication device listener not added", error);
            }
        }
    }

    private void unregisterCallbacksLocked() {
        if (audio == null) return;
        if (deviceCallback != null) {
            try {
                audio.unregisterAudioDeviceCallback(deviceCallback);
            } catch (RuntimeException ignored) {
                // Best effort.
            }
            deviceCallback = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && commDeviceListener != null) {
            try {
                audio.removeOnCommunicationDeviceChangedListener(
                    (AudioManager.OnCommunicationDeviceChangedListener) commDeviceListener
                );
            } catch (RuntimeException ignored) {
                // Best effort.
            }
            commDeviceListener = null;
        }
    }

    private void onDevicesChanged(AudioDeviceInfo[] devices, boolean added) {
        synchronized (this) {
            if (owners.isEmpty()) return;
            if (added) {
                if (!deviceCallbackPrimed) {
                    // Registration reports every connected device once; not news.
                    deviceCallbackPrimed = true;
                } else {
                    List<Integer> types = new ArrayList<>();
                    if (devices != null) {
                        for (AudioDeviceInfo device : devices) types.add(device.getType());
                    }
                    explicitChoice = CallRoutePolicy.explicitAfterDevicesAdded(
                        explicitChoice,
                        CallRoutePolicy.routesForDeviceTypes(types)
                    );
                }
            }
            // A headset plugged in or out is the user's doing: GO follows it
            // again even after it stopped fighting over the device, but not
            // during a phone call (focus / mode checks).
            resumeReassertsLocked();
            applyLocked(added ? "devices-added" : "devices-removed", true);
        }
    }

    /** Android 12+: the WebView's echo canceller (or a phone call) moved the comm device. */
    private void onCommDeviceChanged(AudioDeviceInfo device) {
        synchronized (this) {
            if (owners.isEmpty() || currentRoute == null) return;
            String now = device != null ? CallRoutePolicy.routeForDeviceType(device.getType()) : null;
            if (currentRoute.equals(now)) return;
            if (!CallRoutePolicy.shouldAutoReassert(focusFromCallback, currentModeLocked(), reassertSuspended)) {
                // A phone call, another app with the focus, or GO already gave up.
                emitRouteLocked("moved-elsewhere");
                return;
            }
            long t = SystemClock.elapsedRealtime();
            if (t - reassertWindowStart > REASSERT_WINDOW_MS) {
                reassertWindowStart = t;
                reassertCount = 0;
            }
            if (reassertCount >= REASSERT_MAX) {
                // Someone else keeps moving it: stop fighting until the page
                // asks again, a device changes or the focus comes back.
                reassertSuspended = true;
                Log.i(TAG, "Communication device keeps moving; no more automatic re-asserts");
                emitRouteLocked("moved-elsewhere");
                return;
            }
            reassertCount++;
            Log.i(TAG, "Communication device moved to " + now + "; back to " + currentRoute);
            applyLocked("reassert", true);
        }
    }

    private void updateProximityLocked() {
        boolean hold = CallRoutePolicy.shouldHoldProximityLock(!owners.isEmpty(), currentRoute);
        if (hold) {
            if (proximityLock == null) {
                try {
                    PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
                    if (pm != null && pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                        proximityLock = pm.newWakeLock(
                            PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                            "QortalGo:callProximity"
                        );
                        proximityLock.setReferenceCounted(false);
                    }
                } catch (RuntimeException error) {
                    Log.w(TAG, "Proximity wake lock unavailable", error);
                }
            }
            if (proximityLock != null && !proximityLock.isHeld()) {
                try {
                    proximityLock.acquire();
                } catch (RuntimeException error) {
                    Log.w(TAG, "Proximity wake lock not taken", error);
                }
            }
        } else {
            releaseProximityLocked();
        }
    }

    private void releaseProximityLocked() {
        if (proximityLock == null || !proximityLock.isHeld()) return;
        try {
            // Screen back on only once the phone left the ear.
            proximityLock.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY);
        } catch (RuntimeException error) {
            Log.w(TAG, "Proximity wake lock not released", error);
        }
    }

    private State stateLocked() {
        State state = new State();
        state.active = !owners.isEmpty();
        state.owners = owners.size();
        state.kind = kind;
        state.explicitChoice = explicitChoice;
        state.builtinChoice = builtinChoice;
        Set<String> routes = state.active ? lastRoutes : availableRoutesLocked();
        state.routes = new ArrayList<>(routes);
        state.route = state.active
            ? currentRoute
            : CallRoutePolicy.chooseRoute(
                routes,
                explicitChoice,
                builtinChoice != null
                    ? builtinChoice
                    : CallRoutePolicy.defaultBuiltinRoute(kind, routes.contains(CallRoutePolicy.ROUTE_EARPIECE))
            );
        state.speaker = CallRoutePolicy.ROUTE_SPEAKER.equals(state.route);
        state.focus = focus;
        state.proximityHeld = proximityLock != null && proximityLock.isHeld();
        if (audio != null) {
            try {
                state.mode = audio.getMode();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    AudioDeviceInfo device = audio.getCommunicationDevice();
                    state.commDeviceType = device != null ? device.getType() : -1;
                }
            } catch (RuntimeException ignored) {
                // Diagnostics only.
            }
        }
        return state;
    }

    private void emitRouteLocked(String reason) {
        State state = stateLocked();
        main.post(() -> {
            for (Listener listener : listeners) {
                try {
                    listener.onRouteChanged(state, reason);
                } catch (RuntimeException error) {
                    Log.w(TAG, "route listener failed", error);
                }
            }
        });
    }
}
