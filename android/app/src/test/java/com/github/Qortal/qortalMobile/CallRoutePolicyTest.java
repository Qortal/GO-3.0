package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.media.AudioDeviceInfo;
import android.media.AudioManager;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.Test;

public class CallRoutePolicyTest {
    private static final String EARPIECE = CallRoutePolicy.ROUTE_EARPIECE;
    private static final String SPEAKER = CallRoutePolicy.ROUTE_SPEAKER;
    private static final String WIRED = CallRoutePolicy.ROUTE_WIRED;
    private static final String BLUETOOTH = CallRoutePolicy.ROUTE_BLUETOOTH;

    private static Set<String> routes(String... names) {
        return new LinkedHashSet<>(Arrays.asList(names));
    }

    @Test
    public void deviceTypeConstantsMatchAndroid() {
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, CallRoutePolicy.TYPE_BUILTIN_EARPIECE);
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, CallRoutePolicy.TYPE_BUILTIN_SPEAKER);
        assertEquals(AudioDeviceInfo.TYPE_WIRED_HEADSET, CallRoutePolicy.TYPE_WIRED_HEADSET);
        assertEquals(AudioDeviceInfo.TYPE_WIRED_HEADPHONES, CallRoutePolicy.TYPE_WIRED_HEADPHONES);
        assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, CallRoutePolicy.TYPE_BLUETOOTH_SCO);
        assertEquals(AudioDeviceInfo.TYPE_USB_DEVICE, CallRoutePolicy.TYPE_USB_DEVICE);
        assertEquals(AudioDeviceInfo.TYPE_USB_HEADSET, CallRoutePolicy.TYPE_USB_HEADSET);
        assertEquals(AudioDeviceInfo.TYPE_HEARING_AID, CallRoutePolicy.TYPE_HEARING_AID);
        assertEquals(AudioDeviceInfo.TYPE_BLE_HEADSET, CallRoutePolicy.TYPE_BLE_HEADSET);
        assertEquals(AudioDeviceInfo.TYPE_BLE_SPEAKER, CallRoutePolicy.TYPE_BLE_SPEAKER);
    }

    @Test
    public void mapsDevicesToRoutes() {
        assertEquals(EARPIECE, CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE));
        assertEquals(SPEAKER, CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER));
        assertEquals(WIRED, CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_WIRED_HEADSET));
        assertEquals(WIRED, CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_USB_HEADSET));
        assertEquals(BLUETOOTH, CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO));
        assertEquals(BLUETOOTH, CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_BLE_HEADSET));
        // A2DP is a media sink, never a call route; HDMI and the like neither.
        assertNull(CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP));
        assertNull(CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_HDMI));
        assertNull(CallRoutePolicy.routeForDeviceType(AudioDeviceInfo.TYPE_TELEPHONY));
    }

    @Test
    public void listsRoutesInAStableOrderWithoutRepeats() {
        Set<String> found = CallRoutePolicy.routesForDeviceTypes(Arrays.asList(
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
            AudioDeviceInfo.TYPE_HDMI
        ));
        assertEquals(Arrays.asList(EARPIECE, SPEAKER, BLUETOOTH), new java.util.ArrayList<>(found));
        assertTrue(CallRoutePolicy.routesForDeviceTypes(null).isEmpty());
    }

    @Test
    public void oneToOneCallsStartOnTheEarpieceGroupCallsOnTheLoudspeaker() {
        assertEquals(EARPIECE, CallRoutePolicy.defaultBuiltinRoute(CallRoutePolicy.KIND_DM, true));
        assertEquals(SPEAKER, CallRoutePolicy.defaultBuiltinRoute(CallRoutePolicy.KIND_GROUP, true));
        // A tablet has no earpiece.
        assertEquals(SPEAKER, CallRoutePolicy.defaultBuiltinRoute(CallRoutePolicy.KIND_DM, false));
        // Unknown kind counts as 1:1.
        assertEquals(EARPIECE, CallRoutePolicy.defaultBuiltinRoute(null, true));
    }

    @Test
    public void headsetWinsWiredOverBluetooth() {
        assertEquals(WIRED, CallRoutePolicy.chooseRoute(routes(EARPIECE, SPEAKER, WIRED, BLUETOOTH), null, SPEAKER));
        assertEquals(BLUETOOTH, CallRoutePolicy.chooseRoute(routes(EARPIECE, SPEAKER, BLUETOOTH), null, SPEAKER));
        assertEquals(BLUETOOTH, CallRoutePolicy.chooseRoute(routes(EARPIECE, SPEAKER, BLUETOOTH), null, EARPIECE));
    }

    @Test
    public void builtinChoiceWithoutHeadset() {
        assertEquals(EARPIECE, CallRoutePolicy.chooseRoute(routes(EARPIECE, SPEAKER), null, EARPIECE));
        assertEquals(SPEAKER, CallRoutePolicy.chooseRoute(routes(EARPIECE, SPEAKER), null, SPEAKER));
        // Earpiece wanted on a phone without one: loudspeaker.
        assertEquals(SPEAKER, CallRoutePolicy.chooseRoute(routes(SPEAKER), null, EARPIECE));
        // Nothing known: loudspeaker (audible beats silent).
        assertEquals(SPEAKER, CallRoutePolicy.chooseRoute(Collections.emptySet(), null, null));
        assertEquals(EARPIECE, CallRoutePolicy.chooseRoute(Collections.emptySet(), null, EARPIECE));
    }

    @Test
    public void aHandPickedRouteWinsWhileItExists() {
        Set<String> all = routes(EARPIECE, SPEAKER, WIRED, BLUETOOTH);
        assertEquals(SPEAKER, CallRoutePolicy.chooseRoute(all, SPEAKER, EARPIECE));
        assertEquals(EARPIECE, CallRoutePolicy.chooseRoute(all, EARPIECE, SPEAKER));
        assertEquals(BLUETOOTH, CallRoutePolicy.chooseRoute(all, BLUETOOTH, SPEAKER));
        // The picked headset went away: back to the automatic order.
        assertEquals(WIRED, CallRoutePolicy.chooseRoute(routes(EARPIECE, SPEAKER, WIRED), BLUETOOTH, SPEAKER));
        assertEquals(SPEAKER, CallRoutePolicy.chooseRoute(routes(EARPIECE, SPEAKER), BLUETOOTH, SPEAKER));
    }

    /**
     * Android refused the headset (setCommunicationDevice false or throwing):
     * the next route in the usual order, which is then the route reported
     * (and the earpiece takes the proximity lock), never the refused one.
     */
    @Test
    public void aRefusedHeadsetFallsThroughToTheNextRoute() {
        Set<String> phone = routes(EARPIECE, SPEAKER, BLUETOOTH);
        // 1:1 call: earpiece (screen off at the ear again).
        String next = CallRoutePolicy.routeAfterRefused(phone, Arrays.asList(BLUETOOTH), EARPIECE);
        assertEquals(EARPIECE, next);
        assertTrue(CallRoutePolicy.shouldHoldProximityLock(true, next));
        // Group call: its loudspeaker.
        assertEquals(SPEAKER, CallRoutePolicy.routeAfterRefused(phone, Arrays.asList(BLUETOOTH), SPEAKER));
        // Wired refused with Bluetooth there: Bluetooth next, then the built-in choice.
        Set<String> both = routes(EARPIECE, SPEAKER, WIRED, BLUETOOTH);
        assertEquals(BLUETOOTH, CallRoutePolicy.routeAfterRefused(both, Arrays.asList(WIRED), EARPIECE));
        assertEquals(EARPIECE, CallRoutePolicy.routeAfterRefused(both, Arrays.asList(WIRED, BLUETOOTH), EARPIECE));
        // Nothing else listed: the built-in choice, loudspeaker without one.
        assertEquals(EARPIECE, CallRoutePolicy.routeAfterRefused(routes(BLUETOOTH), Arrays.asList(BLUETOOTH), EARPIECE));
        assertEquals(SPEAKER, CallRoutePolicy.routeAfterRefused(routes(BLUETOOTH), Arrays.asList(BLUETOOTH), null));
        assertEquals(SPEAKER, CallRoutePolicy.routeAfterRefused(null, null, null));
        // The caller's set is left alone.
        assertEquals(routes(EARPIECE, SPEAKER, BLUETOOTH), phone);
    }

    @Test
    public void aNewHeadsetTakesOverFromAHandPick() {
        assertNull(CallRoutePolicy.explicitAfterDevicesAdded(SPEAKER, routes(BLUETOOTH)));
        assertNull(CallRoutePolicy.explicitAfterDevicesAdded(BLUETOOTH, routes(WIRED)));
        // Speakers / earpiece showing up again change nothing.
        assertEquals(SPEAKER, CallRoutePolicy.explicitAfterDevicesAdded(SPEAKER, routes(EARPIECE)));
        // The same headset reconnecting keeps the pick.
        assertEquals(BLUETOOTH, CallRoutePolicy.explicitAfterDevicesAdded(BLUETOOTH, routes(BLUETOOTH)));
        assertNull(CallRoutePolicy.explicitAfterDevicesAdded(null, routes(WIRED)));
        assertEquals(SPEAKER, CallRoutePolicy.explicitAfterDevicesAdded(SPEAKER, null));
    }

    @Test
    public void handPickedBuiltinBecomesTheNoHeadsetChoice() {
        assertEquals(SPEAKER, CallRoutePolicy.builtinAfterExplicit(EARPIECE, SPEAKER));
        assertEquals(EARPIECE, CallRoutePolicy.builtinAfterExplicit(SPEAKER, EARPIECE));
        assertEquals(EARPIECE, CallRoutePolicy.builtinAfterExplicit(EARPIECE, BLUETOOTH));
    }

    @Test
    public void proximityOnlyOnTheEarpieceInACall() {
        assertTrue(CallRoutePolicy.shouldHoldProximityLock(true, EARPIECE));
        assertFalse(CallRoutePolicy.shouldHoldProximityLock(true, SPEAKER));
        assertFalse(CallRoutePolicy.shouldHoldProximityLock(true, BLUETOOTH));
        assertFalse(CallRoutePolicy.shouldHoldProximityLock(true, WIRED));
        assertFalse(CallRoutePolicy.shouldHoldProximityLock(false, EARPIECE));
        assertFalse(CallRoutePolicy.shouldHoldProximityLock(true, null));
    }

    @Test
    public void onlyAMutedStreamIsRaised() {
        assertEquals(-1, CallRoutePolicy.volumeFloor(3, 15));
        assertEquals(-1, CallRoutePolicy.volumeFloor(1, 7));
        assertEquals(5, CallRoutePolicy.volumeFloor(0, 15));
        assertEquals(3, CallRoutePolicy.volumeFloor(0, 7));
        assertEquals(1, CallRoutePolicy.volumeFloor(0, 1));
        assertEquals(-1, CallRoutePolicy.volumeFloor(0, 0));
    }

    /**
     * A Bluetooth headset is a route like any other: chosen whenever Android
     * lists it, with no permission in the rules at all (verified on Android
     * 16 with BLUETOOTH_CONNECT denied: the call played on the headset).
     */
    @Test
    public void bluetoothIsChosenWithoutAnyPermission() {
        Set<String> found = CallRoutePolicy.routesForDeviceTypes(Arrays.asList(
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        ));
        assertEquals(BLUETOOTH, CallRoutePolicy.chooseRoute(found, null, EARPIECE));
        assertEquals(BLUETOOTH, CallRoutePolicy.chooseRoute(found, BLUETOOTH, SPEAKER));
        for (java.lang.reflect.Method method : CallRoutePolicy.class.getDeclaredMethods()) {
            assertFalse(method.getName(), method.getName().toLowerCase(java.util.Locale.ROOT).contains("permission"));
        }
    }

    private static String manifestText(File file) throws IOException {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)
            .replaceAll("(?s)<!--.*?-->", "");
    }

    /** The XML element around {@code index} ("<" ... ">"). */
    private static String elementAt(String xml, int index) {
        int start = xml.lastIndexOf('<', index);
        int end = xml.indexOf('>', index);
        return xml.substring(Math.max(0, start), end < 0 ? xml.length() : end + 1);
    }

    private static void collectManifests(File dir, List<File> out) {
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory()) collectManifests(child, out);
            else if (child.getName().equals("AndroidManifest.xml")) out.add(child);
        }
    }

    /**
     * Product rule: GO never shows Android's "Nearby devices" prompt. That
     * group's permissions appear in GO's manifest only as tools:node="remove"
     * markers (one for each, so no library or plugin can merge one in), the
     * merged manifest of the variant under test has none of them (Android
     * cannot ask for an undeclared one), and code never names them (comments
     * do not count). The legacy BLUETOOTH permission stays install-time only,
     * capped at Android 11.
     */
    @Test
    public void neverAsksForNearbyDevices() throws IOException {
        File module = null;
        for (String base : new String[] {".", "app", "android/app"}) {
            File candidate = new File(base);
            if (new File(candidate, "src/main/AndroidManifest.xml").isFile()) {
                module = candidate;
                break;
            }
        }
        assertTrue("src/main not found from " + new File("").getAbsolutePath(), module != null);
        File app = new File(module, "src/main");
        // { what code must never name, the permission }
        String[][] nearby = {
            {"BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_CONNECT"},
            {"BLUETOOTH_SCAN", "android.permission.BLUETOOTH_SCAN"},
            {"BLUETOOTH_ADVERTISE", "android.permission.BLUETOOTH_ADVERTISE"},
            {"NEARBY_WIFI_DEVICES", "android.permission.NEARBY_WIFI_DEVICES"},
            {"UWB_RANGING", "android.permission.UWB_RANGING"},
            {"permission.RANGING", "android.permission.RANGING"},
        };

        String manifest = manifestText(new File(app, "AndroidManifest.xml"));
        for (String[] permission : nearby) {
            String token = permission[0];
            for (int at = manifest.indexOf(token); at >= 0; at = manifest.indexOf(token, at + 1)) {
                String element = elementAt(manifest, at);
                assertTrue(
                    "manifest declares " + token + ": " + element,
                    element.startsWith("<uses-permission") && element.contains("tools:node=\"remove\"")
                );
            }
            Matcher removal = Pattern
                .compile("<uses-permission\\s[^>]*android:name=\"" + Pattern.quote(permission[1]) + "\"[^>]*>")
                .matcher(manifest);
            assertTrue(permission[1] + " has no tools:node=\"remove\" marker", removal.find());
            assertTrue(removal.group(), removal.group().contains("tools:node=\"remove\""));
        }

        // What really ships, library manifests included: the merged manifest
        // of the variant under test (the main merge runs before its unit
        // tests compile). Copies older than GO's manifest are left over from
        // an earlier build and skipped; other variants' may be stale too.
        // Absent outside Gradle.
        long sourceTime = new File(app, "AndroidManifest.xml").lastModified();
        File intermediates = new File(module, "build/intermediates");
        for (String dir : new String[] {"merged_manifest", "merged_manifests", "packaged_manifests"}) {
            List<File> merged = new ArrayList<>();
            collectManifests(new File(intermediates, dir + "/" + BuildConfig.BUILD_TYPE), merged);
            for (File file : merged) {
                if (file.lastModified() < sourceTime) continue;
                String text = manifestText(file);
                for (String[] permission : nearby) {
                    assertFalse(file + " declares " + permission[1], text.contains(permission[0]));
                }
            }
        }

        Matcher legacy = Pattern
            .compile("<uses-permission\\s[^>]*android:name=\"android\\.permission\\.BLUETOOTH\"[^>]*>")
            .matcher(manifest);
        assertTrue("legacy BLUETOOTH permission missing", legacy.find());
        assertTrue(legacy.group(), legacy.group().contains("android:maxSdkVersion=\"30\""));

        File[] sources = new File(app, "java/com/github/Qortal/qortalMobile")
            .listFiles((d, name) -> name.endsWith(".java") || name.endsWith(".kt"));
        assertTrue(sources != null && sources.length > 10);
        List<String> found = new ArrayList<>();
        for (File file : sources) {
            List<String> lines = Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i).trim();
                if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
                for (String[] permission : nearby) {
                    if (line.contains(permission[0])) found.add(file.getName() + ":" + (i + 1) + ": " + line);
                }
                if (line.contains("requestBluetoothPermission")) {
                    found.add(file.getName() + ":" + (i + 1) + ": " + line);
                }
            }
        }
        assertEquals("GO never asks for Nearby devices", Collections.emptyList(), found);
    }

    @Test
    public void parsesRoutesAndKinds() {
        assertEquals(SPEAKER, CallRoutePolicy.parseRoute(" Speaker "));
        assertEquals(BLUETOOTH, CallRoutePolicy.parseRoute("bluetooth"));
        assertNull(CallRoutePolicy.parseRoute("hdmi"));
        assertNull(CallRoutePolicy.parseRoute(null));
        assertEquals(CallRoutePolicy.KIND_GROUP, CallRoutePolicy.parseKind("GROUP"));
        assertEquals(CallRoutePolicy.KIND_DM, CallRoutePolicy.parseKind("dm"));
        assertNull(CallRoutePolicy.parseKind("video"));
    }

    @Test
    public void callAudioEndsWithTheLastOwner() {
        CallRoutePolicy.Owners owners = new CallRoutePolicy.Owners();
        assertTrue(owners.acquire("session"));
        // The DM media surface joins (old startCall without owner = legacy).
        assertFalse(owners.acquire(null));
        assertFalse(owners.acquire("session"));
        assertEquals(2, owners.size());
        // The surface stops (e.g. a switch to WebRTC): the session keeps it.
        assertFalse(owners.release("legacy"));
        assertFalse(owners.isEmpty());
        assertTrue(owners.release("session"));
        assertTrue(owners.isEmpty());
        // A late release changes nothing.
        assertFalse(owners.release("session"));
        assertTrue(owners.acquire(" "));
        assertTrue(owners.releaseAll());
        assertFalse(owners.releaseAll());
    }

    @Test
    public void modeConstantsMatchAndroid() {
        assertEquals(AudioManager.MODE_NORMAL, CallRoutePolicy.MODE_NORMAL);
        assertEquals(AudioManager.MODE_RINGTONE, CallRoutePolicy.MODE_RINGTONE);
        assertEquals(AudioManager.MODE_IN_CALL, CallRoutePolicy.MODE_IN_CALL);
        assertEquals(AudioManager.MODE_IN_COMMUNICATION, CallRoutePolicy.MODE_IN_COMMUNICATION);
        assertEquals(AudioManager.MODE_CALL_SCREENING, CallRoutePolicy.MODE_CALL_SCREENING);
    }

    @Test
    public void neverTakesAPhoneCallsAudio() {
        assertTrue(CallRoutePolicy.mayTakeCommunicationMode(CallRoutePolicy.MODE_NORMAL));
        assertTrue(CallRoutePolicy.mayTakeCommunicationMode(CallRoutePolicy.MODE_IN_COMMUNICATION));
        // Unknown (MODE_CURRENT / MODE_INVALID) as before: normal.
        assertTrue(CallRoutePolicy.mayTakeCommunicationMode(-1));
        assertFalse(CallRoutePolicy.mayTakeCommunicationMode(CallRoutePolicy.MODE_RINGTONE));
        assertFalse(CallRoutePolicy.mayTakeCommunicationMode(CallRoutePolicy.MODE_IN_CALL));
        assertFalse(CallRoutePolicy.mayTakeCommunicationMode(CallRoutePolicy.MODE_CALL_SCREENING));
        // MODE_CALL_REDIRECT / MODE_COMMUNICATION_REDIRECT (Android 13).
        assertFalse(CallRoutePolicy.mayTakeCommunicationMode(5));
        assertFalse(CallRoutePolicy.mayTakeCommunicationMode(6));
    }

    @Test
    public void automaticReassertsStopForAPhoneCallOrAfterGivingUp() {
        int comm = CallRoutePolicy.MODE_IN_COMMUNICATION;
        assertTrue(CallRoutePolicy.shouldAutoReassert(null, comm, false));
        assertTrue(CallRoutePolicy.shouldAutoReassert("gain", comm, false));
        assertTrue(CallRoutePolicy.shouldAutoReassert("duck", comm, false));
        // Focus taken (a phone call, another call app): wait for it back.
        assertFalse(CallRoutePolicy.shouldAutoReassert("loss_transient", comm, false));
        assertFalse(CallRoutePolicy.shouldAutoReassert("loss", comm, false));
        // A phone call's mode, even with no focus callback.
        assertFalse(CallRoutePolicy.shouldAutoReassert(null, CallRoutePolicy.MODE_IN_CALL, false));
        assertFalse(CallRoutePolicy.shouldAutoReassert(null, CallRoutePolicy.MODE_RINGTONE, false));
        // GO stopped fighting: until the page asks or the focus returns.
        assertFalse(CallRoutePolicy.shouldAutoReassert("gain", comm, true));
    }

    @Test
    public void answeringAOneToOneCallAfterAGroupCallGoesBackToTheEarpieceDefault() {
        String dm = CallRoutePolicy.KIND_DM;
        String group = CallRoutePolicy.KIND_GROUP;
        // Group (loudspeaker) -> 1:1: recompute (earpiece by default).
        assertNull(CallRoutePolicy.builtinAfterKindChange(SPEAKER, group, dm, null, false));
        // Same kind, or no kind: unchanged.
        assertEquals(SPEAKER, CallRoutePolicy.builtinAfterKindChange(SPEAKER, group, group, null, false));
        assertEquals(SPEAKER, CallRoutePolicy.builtinAfterKindChange(SPEAKER, group, null, null, false));
        // A hand pick, or the page setting the choice in the same call, stays.
        assertEquals(SPEAKER, CallRoutePolicy.builtinAfterKindChange(SPEAKER, group, dm, SPEAKER, false));
        assertEquals(SPEAKER, CallRoutePolicy.builtinAfterKindChange(SPEAKER, group, dm, null, true));
    }
}
