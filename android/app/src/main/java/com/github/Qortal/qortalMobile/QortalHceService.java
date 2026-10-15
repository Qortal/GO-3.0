package com.github.Qortal.qortalMobile;

import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;

/**
 * Lets another GO phone read this phone's payment request by tapping
 * (Android host card emulation). The paying phone selects GO's request AID,
 * gets the address and amount, and pays from its own wallet after its user
 * confirms in its own Send QORT screen.
 *
 * Answers only while the page has a request out ({@link #arm}), and only on
 * an unlocked phone (requireDeviceUnlock in res/xml/qortal_hce_service.xml).
 * Otherwise every command gets "not ready", so a reader learns nothing.
 */
public class QortalHceService extends HostApduService {
    private static final Object LOCK = new Object();
    private static byte[] payload;
    private static long armedUntilMs;
    private static Runnable onRead;

    /** Served the request during this contact. */
    private boolean served;

    static void arm(byte[] request, long ttlMs, Runnable readListener) {
        synchronized (LOCK) {
            payload = request.clone();
            armedUntilMs = System.currentTimeMillis() + TapRequestPolicy.clampTtl(ttlMs);
            onRead = readListener;
        }
    }

    static void disarm() {
        synchronized (LOCK) {
            payload = null;
            armedUntilMs = 0L;
            onRead = null;
        }
    }

    @Override
    public byte[] processCommandApdu(byte[] apdu, Bundle extras) {
        byte[] request;
        long until;
        synchronized (LOCK) {
            request = payload;
            until = armedUntilMs;
        }
        byte[] answer = TapRequestPolicy.answer(apdu, request, until, System.currentTimeMillis());
        if (answer.length > 2) {
            served = true;
        }
        return answer;
    }

    @Override
    public void onDeactivated(int reason) {
        if (!served) {
            return;
        }
        served = false;
        Runnable listener;
        synchronized (LOCK) {
            listener = onRead;
        }
        if (listener != null) {
            listener.run();
        }
    }
}
