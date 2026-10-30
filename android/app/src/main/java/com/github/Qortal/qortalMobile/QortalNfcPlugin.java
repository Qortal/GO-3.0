package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.TagLostException;
import android.nfc.tech.IsoDep;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * Qortal Card: raw APDUs to a contactless smart card (ISO 14443-4, IsoDep),
 * for the Qortal Card screen. Android's own NFC API only, no other library.
 * The same plugin puts out this phone's payment request for another GO phone
 * to read ({@link QortalHceService}).
 *
 * <ul>
 *   <li>Reading is off until the page calls {@code startSession}, which the
 *       Qortal Card screen does only while it waits for a tap. It goes off
 *       again on {@code stopSession}, while GO is in the background, and when
 *       the page reloads ({@link #onPageStarted(Bridge)}).</li>
 *   <li>Reader mode keeps tags away from other apps while GO reads, and GO has
 *       no NFC intent filters, so no tag ever opens GO by itself.</li>
 *   <li>Only IsoDep cards are used. Anything else is reported and dropped.</li>
 *   <li>APDUs are never logged: during setup one of them carries a card key.</li>
 *   <li>Card I/O runs on its own thread. Capacitor runs plugin calls one at a
 *       time on one thread, and a signature takes up to 0.4 s.</li>
 * </ul>
 */
@CapacitorPlugin(name = QortalNfcPlugin.NAME)
public class QortalNfcPlugin extends Plugin implements NfcAdapter.ReaderCallback {
    static final String NAME = "QortalNfc";
    private static final String TAG = "QortalNfc";
    private static final int READER_FLAGS =
        NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Object lock = new Object();
    /** Looked up on first Qortal Card use, not at launch. Read through {@link #adapter()}. */
    private volatile NfcAdapter adapter;
    private volatile boolean adapterChecked;
    /** The card in the field, connected. Guarded by {@link #lock}. */
    private IsoDep card;
    /** The page wants to read. Guarded by {@link #lock}. */
    private boolean sessionWanted;
    /** Reader mode is on. UI thread only. */
    private boolean readerOn;

    /** Ends any session when GO's page starts loading. Called on the UI thread. */
    static void onPageStarted(Bridge bridge) {
        if (bridge == null) {
            return;
        }
        // A request belongs to the screen that put it out.
        QortalHceService.disarm();
        PluginHandle handle = bridge.getPlugin(NAME);
        Plugin instance = handle != null ? handle.getInstance() : null;
        if (instance instanceof QortalNfcPlugin) {
            ((QortalNfcPlugin) instance).endSession();
        }
    }

    /** This phone's NFC adapter, or null without NFC. */
    private NfcAdapter adapter() {
        if (!adapterChecked) {
            synchronized (this) {
                if (!adapterChecked) {
                    adapter = NfcAdapter.getDefaultAdapter(getContext());
                    adapterChecked = true;
                }
            }
        }
        return adapter;
    }

    @PluginMethod
    public void status(PluginCall call) {
        NfcAdapter a = adapter();
        JSObject out = new JSObject();
        out.put("supported", a != null);
        out.put("enabled", a != null && a.isEnabled());
        out.put(
            "hce",
            a != null
                && getContext()
                    .getPackageManager()
                    .hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)
        );
        call.resolve(out);
    }

    /**
     * Puts a payment request out for another GO phone to read by tapping
     * ({@link QortalHceService}). {@code payload}: hex of the page's request,
     * up to 240 bytes. {@code ttlMs}: how long it stays out (at most 5 min).
     * Emits {@code requestRead} each time a phone read it.
     */
    @PluginMethod
    public void armRequest(PluginCall call) {
        byte[] payload =
            NfcApduPolicy.parseHex(call.getString("payload"), 1, TapRequestPolicy.MAX_PAYLOAD_BYTES);
        if (payload == null) {
            call.reject("Not a valid request", "BAD_REQUEST");
            return;
        }
        long ttlMs = call.getLong("ttlMs", 120_000L);
        QortalHceService.arm(payload, ttlMs, () -> notifyListeners("requestRead", new JSObject()));
        call.resolve();
    }

    @PluginMethod
    public void disarmRequest(PluginCall call) {
        QortalHceService.disarm();
        call.resolve();
    }

    /** Opens Android's NFC switch, so the user can turn NFC on. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity", "NO_ACTIVITY");
            return;
        }
        try {
            activity.startActivity(new Intent(Settings.ACTION_NFC_SETTINGS));
            call.resolve();
        } catch (RuntimeException e) {
            try {
                activity.startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
                call.resolve();
            } catch (RuntimeException ignored) {
                call.reject("Cannot open the NFC settings", "NO_SETTINGS");
            }
        }
    }

    @PluginMethod
    public void startSession(PluginCall call) {
        NfcAdapter a = adapter();
        if (a == null) {
            call.reject("This phone has no NFC", "NFC_UNSUPPORTED");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("NFC is turned off", "NFC_DISABLED");
            return;
        }
        synchronized (lock) {
            sessionWanted = true;
        }
        runOnUi(this::applyReaderMode);
        call.resolve();
    }

    @PluginMethod
    public void stopSession(PluginCall call) {
        endSession();
        call.resolve();
    }

    @PluginMethod
    public void transceive(PluginCall call) {
        byte[] apdu = NfcApduPolicy.parseApdu(call.getString("apdu"));
        if (apdu == null) {
            call.reject("Not a valid APDU", "BAD_APDU");
            return;
        }
        try {
            io.execute(() -> exchange(call, apdu));
        } catch (RejectedExecutionException e) {
            call.reject("NFC is shutting down", "CARD_IO");
        }
    }

    private void exchange(PluginCall call, byte[] apdu) {
        IsoDep current;
        synchronized (lock) {
            current = card;
        }
        if (current == null) {
            call.reject("No card", "NO_CARD");
            return;
        }
        try {
            byte[] response = current.transceive(apdu);
            JSObject out = new JSObject();
            out.put("response", NfcApduPolicy.toHex(response));
            call.resolve(out);
        } catch (TagLostException e) {
            dropCard(current);
            call.reject("The card moved away", "CARD_LOST");
        } catch (IOException | RuntimeException e) {
            dropCard(current);
            call.reject("Reading the card failed", "CARD_IO");
        }
    }

    /** Called by Android on its NFC thread for every tag in the field. */
    @Override
    public void onTagDiscovered(Tag tag) {
        IsoDep dep = IsoDep.get(tag);
        if (dep == null) {
            notifyListeners("unsupportedTag", new JSObject());
            return;
        }
        try {
            dep.connect();
            dep.setTimeout(NfcApduPolicy.TRANSCEIVE_TIMEOUT_MS);
        } catch (IOException | RuntimeException e) {
            closeQuietly(dep);
            notifyListeners("unsupportedTag", new JSObject());
            return;
        }
        IsoDep previous;
        synchronized (lock) {
            if (!sessionWanted) {
                closeQuietly(dep);
                return;
            }
            previous = card;
            card = dep;
        }
        if (previous != null) {
            closeQuietly(previous);
        }
        JSObject info = new JSObject();
        info.put("maxTransceiveLength", dep.getMaxTransceiveLength());
        info.put("extendedLength", dep.isExtendedLengthApduSupported());
        notifyListeners("cardPresent", info);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // Reader mode only works in the foreground; Android drops it anyway.
        runOnUi(() -> setReader(false));
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        runOnUi(this::applyReaderMode);
    }

    @Override
    protected void handleOnDestroy() {
        QortalHceService.disarm();
        endSession();
        io.shutdownNow();
        super.handleOnDestroy();
    }

    private void endSession() {
        IsoDep current;
        synchronized (lock) {
            sessionWanted = false;
            current = card;
            card = null;
        }
        if (current != null) {
            closeQuietly(current);
        }
        runOnUi(() -> setReader(false));
    }

    private void dropCard(IsoDep lost) {
        synchronized (lock) {
            if (card == lost) {
                card = null;
            }
        }
        closeQuietly(lost);
    }

    /** UI thread. */
    private void applyReaderMode() {
        boolean want;
        synchronized (lock) {
            want = sessionWanted;
        }
        setReader(want);
    }

    /** UI thread. */
    private void setReader(boolean on) {
        if (!on && !readerOn) {
            return;
        }
        Activity activity = getActivity();
        NfcAdapter a = adapter();
        if (a == null || activity == null) {
            return;
        }
        try {
            if (on) {
                Bundle extras = new Bundle();
                extras.putInt(
                    NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY,
                    NfcApduPolicy.PRESENCE_CHECK_DELAY_MS
                );
                a.enableReaderMode(activity, this, READER_FLAGS, extras);
            } else {
                a.disableReaderMode(activity);
            }
            readerOn = on;
        } catch (RuntimeException e) {
            // Not resumed yet, or NFC switched off meanwhile: resume retries.
            Log.w(TAG, "Reader mode " + (on ? "on" : "off") + " failed: " + e.getClass().getSimpleName());
            readerOn = false;
        }
    }

    private void runOnUi(Runnable task) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(task);
        }
    }

    private static void closeQuietly(IsoDep dep) {
        try {
            dep.close();
        } catch (IOException | RuntimeException ignored) {
            // Already gone.
        }
    }
}
