package com.github.Qortal.qortalMobile;

/**
 * Rules for the Qortal Card NFC bridge ({@link QortalNfcPlugin}), kept free of
 * Android types so the JVM tests can check them.
 */
final class NfcApduPolicy {
    /**
     * Largest command GO sends: a short APDU (4 header bytes, Lc, 255 data
     * bytes, Le). A Qortal payment is 167 bytes on the wire, a key import 69.
     */
    static final int MAX_APDU_BYTES = 261;
    /** Smallest command: CLA INS P1 P2. */
    static final int MIN_APDU_BYTES = 4;
    /**
     * Card answer timeout. An Ed25519 signature takes 0.2 to 0.4 s on the
     * J3R452; the rest is room for a weak field at the edge of the antenna.
     */
    static final int TRANSCEIVE_TIMEOUT_MS = 5000;
    /**
     * How often Android checks the card is still there between commands.
     * Slow on purpose, so a check never lands in the middle of a signature.
     */
    static final int PRESENCE_CHECK_DELAY_MS = 2000;

    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private NfcApduPolicy() {}

    /**
     * Parses a command from the page: hex, 4 to 261 bytes. Returns null for
     * anything else, so a bad call never reaches the card.
     */
    static byte[] parseApdu(String hex) {
        return parseHex(hex, MIN_APDU_BYTES, MAX_APDU_BYTES);
    }

    /** Hex of {@code minBytes} to {@code maxBytes} bytes, or null. */
    static byte[] parseHex(String hex, int minBytes, int maxBytes) {
        if (hex == null) {
            return null;
        }
        int chars = hex.length();
        if (chars % 2 != 0 || chars < 2 * minBytes || chars > 2 * maxBytes) {
            return null;
        }
        byte[] out = new byte[chars / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = nibble(hex.charAt(2 * i));
            int lo = nibble(hex.charAt(2 * i + 1));
            if (hi < 0 || lo < 0) {
                return null;
            }
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    static String toHex(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            out[2 * i] = HEX[(bytes[i] >> 4) & 0x0F];
            out[2 * i + 1] = HEX[bytes[i] & 0x0F];
        }
        return new String(out);
    }

    /** ASCII hex digits only: Character.digit would also take other scripts. */
    private static int nibble(char c) {
        if (c >= '0' && c <= '9') {
            return c - '0';
        }
        if (c >= 'a' && c <= 'f') {
            return c - 'a' + 10;
        }
        if (c >= 'A' && c <= 'F') {
            return c - 'A' + 10;
        }
        return -1;
    }
}
