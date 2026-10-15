package com.github.Qortal.qortalMobile;

import java.util.Arrays;

/**
 * Rules for GO's payment request over NFC ({@link QortalHceService}): the
 * phone that wants QORT answers one SELECT with its request (address and an
 * optional amount, JSON written by the page), and only while armed. Free of
 * Android types so the JVM tests can check it.
 */
final class TapRequestPolicy {
    /** F0 + "QORTALP": an unregistered proprietary AID, GO's own. */
    static final byte[] AID = {
        (byte) 0xF0, 0x51, 0x4F, 0x52, 0x54, 0x41, 0x4C, 0x50
    };
    /** Fits one short APDU answer with room to spare. */
    static final int MAX_PAYLOAD_BYTES = 240;
    /** A request lives at most this long; the page asks for less. */
    static final long MAX_TTL_MS = 5 * 60_000L;

    static final byte[] SW_INS_NOT_SUPPORTED = {0x6D, 0x00};
    /** "Conditions of use not satisfied": no request is out right now. */
    static final byte[] SW_NOT_READY = {0x69, (byte) 0x85};

    private TapRequestPolicy() {}

    /** SELECT by name (00 A4 04 xx) of exactly {@link #AID}. */
    static boolean isSelectOfOurs(byte[] apdu) {
        if (apdu == null || apdu.length < 5 + AID.length) {
            return false;
        }
        if (apdu[0] != 0x00 || apdu[1] != (byte) 0xA4 || apdu[2] != 0x04) {
            return false;
        }
        if ((apdu[4] & 0xFF) != AID.length) {
            return false;
        }
        return Arrays.equals(Arrays.copyOfRange(apdu, 5, 5 + AID.length), AID);
    }

    /** The answer to one command from a reader. */
    static byte[] answer(byte[] apdu, byte[] payload, long armedUntilMs, long nowMs) {
        if (!isSelectOfOurs(apdu)) {
            return SW_INS_NOT_SUPPORTED;
        }
        if (payload == null || payload.length == 0 || nowMs > armedUntilMs) {
            return SW_NOT_READY;
        }
        byte[] out = Arrays.copyOf(payload, payload.length + 2);
        out[payload.length] = (byte) 0x90;
        out[payload.length + 1] = 0x00;
        return out;
    }

    static long clampTtl(long ttlMs) {
        return Math.max(1_000L, Math.min(MAX_TTL_MS, ttlMs));
    }
}
