package com.github.Qortal.qortalMobile;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Pure rules behind {@link CallAudioRouter}: which speaker a call plays on.
 * No Android types, so the JVM unit tests can check them.
 *
 * Route names are what the page sees (AudioRouting.getAudioRoutes):
 * "earpiece", "speaker", "wired" (wired or USB headset / headphones) and
 * "bluetooth" (SCO headset, LE Audio headset or speaker, hearing aid).
 *
 * Preference: a headset the user plugged in or paired wins (wired over
 * Bluetooth), then the user's own choice between the phone's earpiece and
 * loudspeaker. A route the user picked by hand (setAudioRoute) wins over all
 * of that until a new headset arrives, which takes over again.
 *
 * No permission takes part: Android 12+ lists a Bluetooth headset among the
 * communication devices and switches to it without BLUETOOTH_CONNECT, which
 * GO never asks for (the "Nearby devices" prompt).
 */
public final class CallRoutePolicy {
    private CallRoutePolicy() {}

    public static final String ROUTE_EARPIECE = "earpiece";
    public static final String ROUTE_SPEAKER = "speaker";
    public static final String ROUTE_WIRED = "wired";
    public static final String ROUTE_BLUETOOTH = "bluetooth";

    public static final String KIND_DM = "dm";
    public static final String KIND_GROUP = "group";

    // AudioDeviceInfo.TYPE_* values (stable platform constants; the unit test
    // checks them against android.media.AudioDeviceInfo).
    public static final int TYPE_BUILTIN_EARPIECE = 1;
    public static final int TYPE_BUILTIN_SPEAKER = 2;
    public static final int TYPE_WIRED_HEADSET = 3;
    public static final int TYPE_WIRED_HEADPHONES = 4;
    public static final int TYPE_BLUETOOTH_SCO = 7;
    public static final int TYPE_USB_DEVICE = 11;
    public static final int TYPE_USB_HEADSET = 22;
    public static final int TYPE_HEARING_AID = 23;
    public static final int TYPE_BLE_HEADSET = 26;
    public static final int TYPE_BLE_SPEAKER = 27;

    /** Known route name, or null. */
    public static String parseRoute(String raw) {
        if (raw == null) return null;
        String route = raw.trim().toLowerCase(Locale.ROOT);
        switch (route) {
            case ROUTE_EARPIECE:
            case ROUTE_SPEAKER:
            case ROUTE_WIRED:
            case ROUTE_BLUETOOTH:
                return route;
            default:
                return null;
        }
    }

    /** "group" for group calls; everything else is a 1:1 call. */
    public static String parseKind(String raw) {
        if (raw == null) return null;
        String kind = raw.trim().toLowerCase(Locale.ROOT);
        if (KIND_GROUP.equals(kind)) return KIND_GROUP;
        if (KIND_DM.equals(kind)) return KIND_DM;
        return null;
    }

    /**
     * The route an AudioDeviceInfo type belongs to, or null for devices a call
     * never uses (A2DP media sinks, HDMI, telephony, the "safe" speaker...).
     */
    public static String routeForDeviceType(int type) {
        switch (type) {
            case TYPE_BUILTIN_EARPIECE:
                return ROUTE_EARPIECE;
            case TYPE_BUILTIN_SPEAKER:
                return ROUTE_SPEAKER;
            case TYPE_WIRED_HEADSET:
            case TYPE_WIRED_HEADPHONES:
            case TYPE_USB_DEVICE:
            case TYPE_USB_HEADSET:
                return ROUTE_WIRED;
            case TYPE_BLUETOOTH_SCO:
            case TYPE_HEARING_AID:
            case TYPE_BLE_HEADSET:
            case TYPE_BLE_SPEAKER:
                return ROUTE_BLUETOOTH;
            default:
                return null;
        }
    }

    /** Routes for a list of device types, in a stable order (earpiece, speaker, wired, bluetooth). */
    public static Set<String> routesForDeviceTypes(Collection<Integer> types) {
        Set<String> found = new LinkedHashSet<>();
        if (types != null) {
            for (Integer type : types) {
                if (type == null) continue;
                String route = routeForDeviceType(type);
                if (route != null) found.add(route);
            }
        }
        Set<String> ordered = new LinkedHashSet<>();
        for (String route : new String[] {ROUTE_EARPIECE, ROUTE_SPEAKER, ROUTE_WIRED, ROUTE_BLUETOOTH}) {
            if (found.contains(route)) ordered.add(route);
        }
        return ordered;
    }

    /**
     * The phone's own speaker a call starts on: earpiece for a 1:1 call
     * (screen off at the ear), loudspeaker for a group call. A tablet with no
     * earpiece uses the loudspeaker.
     */
    public static String defaultBuiltinRoute(String kind, boolean hasEarpiece) {
        if (KIND_GROUP.equals(kind)) return ROUTE_SPEAKER;
        return hasEarpiece ? ROUTE_EARPIECE : ROUTE_SPEAKER;
    }

    /** True for a headset route (wired or Bluetooth). */
    public static boolean isHeadsetRoute(String route) {
        return ROUTE_WIRED.equals(route) || ROUTE_BLUETOOTH.equals(route);
    }

    /**
     * The route to use now.
     *
     * @param available routes the phone offers right now
     * @param explicitChoice route the user picked by hand, or null
     * @param builtinChoice earpiece or speaker: the user's (or the default)
     *     choice for when no headset is connected
     */
    public static String chooseRoute(Set<String> available, String explicitChoice, String builtinChoice) {
        if (available == null || available.isEmpty()) {
            return builtinChoice != null ? builtinChoice : ROUTE_SPEAKER;
        }
        if (explicitChoice != null && available.contains(explicitChoice)) return explicitChoice;
        if (available.contains(ROUTE_WIRED)) return ROUTE_WIRED;
        if (available.contains(ROUTE_BLUETOOTH)) return ROUTE_BLUETOOTH;
        if (builtinChoice != null && available.contains(builtinChoice)) return builtinChoice;
        if (available.contains(ROUTE_SPEAKER)) return ROUTE_SPEAKER;
        if (available.contains(ROUTE_EARPIECE)) return ROUTE_EARPIECE;
        return available.iterator().next();
    }

    /**
     * Android refused a headset route (the communication device switch said
     * no or threw, SCO would not start): the route to use instead, in the
     * usual order without the refused ones, so the call plays, and is
     * reported, where it really is. A hand pick takes no part (it is the
     * refused route). Never one of {@code refused}; with nothing else left,
     * the built-in choice (loudspeaker when there is none).
     */
    public static String routeAfterRefused(Set<String> available, Collection<String> refused, String builtinChoice) {
        Set<String> left = new LinkedHashSet<>();
        if (available != null) left.addAll(available);
        if (refused != null) left.removeAll(refused);
        return chooseRoute(left, null, builtinChoice);
    }

    /**
     * A hand-picked route stays until a headset arrives: plugging in or
     * pairing a headset mid-call moves the call to it, like a phone call.
     * Returns the explicit choice to keep (null = automatic again).
     */
    public static String explicitAfterDevicesAdded(String explicitChoice, Set<String> addedRoutes) {
        if (explicitChoice == null) return null;
        if (addedRoutes == null) return explicitChoice;
        for (String route : addedRoutes) {
            if (isHeadsetRoute(route) && !route.equals(explicitChoice)) return null;
        }
        return explicitChoice;
    }

    /**
     * What a hand-picked earpiece or loudspeaker also means: it becomes the
     * built-in choice for when the headset goes away again.
     */
    public static String builtinAfterExplicit(String builtinChoice, String explicitChoice) {
        if (ROUTE_EARPIECE.equals(explicitChoice) || ROUTE_SPEAKER.equals(explicitChoice)) {
            return explicitChoice;
        }
        return builtinChoice;
    }

    /** Screen off at the ear: only while a call plays on the earpiece. */
    public static boolean shouldHoldProximityLock(boolean callActive, String route) {
        return callActive && ROUTE_EARPIECE.equals(route);
    }

    /**
     * Volume fix-up for a stream at {@code current} of {@code max}: a stream
     * the user turned all the way down would make the other side silent, so
     * only 0 is raised (to a third). Anything the user set is left alone.
     * Returns the volume to set, or -1 to leave it.
     */
    public static int volumeFloor(int current, int max) {
        if (max <= 0 || current > 0) return -1;
        return Math.max(1, (int) Math.ceil(max / 3.0));
    }

    /**
     * The call's kind changed while its audio was held (call waiting: a 1:1
     * call answered after a group call): the earpiece/loudspeaker choice goes
     * back to the new kind's default (null = recompute), unless the user
     * picked a route by hand or the page set the choice in the same call.
     */
    public static String builtinAfterKindChange(
        String builtinChoice,
        String oldKind,
        String newKind,
        String explicitChoice,
        boolean choiceSetNow
    ) {
        if (newKind == null || newKind.equals(oldKind)) return builtinChoice;
        if (explicitChoice != null || choiceSetNow) return builtinChoice;
        return null;
    }

    // AudioManager.MODE_* values (the unit test checks them against the platform).
    public static final int MODE_NORMAL = 0;
    public static final int MODE_RINGTONE = 1;
    public static final int MODE_IN_CALL = 2;
    public static final int MODE_IN_COMMUNICATION = 3;
    public static final int MODE_CALL_SCREENING = 4;

    /**
     * GO may put the phone in communication mode (and move the call device)
     * only from normal mode or its own communication mode, never over a
     * phone call (ringing, in call, call screening, redirect modes).
     */
    public static boolean mayTakeCommunicationMode(int currentMode) {
        return currentMode <= MODE_NORMAL || currentMode == MODE_IN_COMMUNICATION;
    }

    /**
     * An automatic re-assert of the route (the communication device moved,
     * a device came or went): not while the audio focus is lost (a phone call
     * or another call app took it), not over a phone call's mode, and not
     * once GO stopped fighting someone who keeps moving the device (until
     * the page asks again or the focus comes back).
     */
    public static boolean shouldAutoReassert(String focus, int mode, boolean suspended) {
        if (suspended) return false;
        if ("loss".equals(focus) || "loss_transient".equals(focus)) return false;
        return mayTakeCommunicationMode(mode);
    }

    /**
     * Owners that hold the in-call audio mode. Routing ends only when the last
     * one lets go, so the Reticulum surface stopping (e.g. on a switch to
     * WebRTC) cannot drop the call's audio mode under the call session.
     */
    public static final class Owners {
        private final Set<String> owners = new LinkedHashSet<>();

        public static String normalize(String owner) {
            if (owner == null) return "legacy";
            String trimmed = owner.trim();
            return trimmed.isEmpty() ? "legacy" : trimmed;
        }

        /** Returns true when this is the first owner (routing must start). */
        public boolean acquire(String owner) {
            boolean first = owners.isEmpty();
            owners.add(normalize(owner));
            return first;
        }

        /** Returns true when the last owner let go (routing must end). */
        public boolean release(String owner) {
            if (owners.isEmpty()) return false;
            owners.remove(normalize(owner));
            return owners.isEmpty();
        }

        /** Everyone lets go (call end from the session, page gone). */
        public boolean releaseAll() {
            boolean had = !owners.isEmpty();
            owners.clear();
            return had;
        }

        public boolean isEmpty() {
            return owners.isEmpty();
        }

        public int size() {
            return owners.size();
        }
    }
}
