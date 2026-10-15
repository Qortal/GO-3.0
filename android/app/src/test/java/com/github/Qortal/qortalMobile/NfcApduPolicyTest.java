package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class NfcApduPolicyTest {
    @Test
    public void parsesHexInBothCases() {
        assertArrayEquals(
            new byte[] {(byte) 0x80, 0x20, 0x00, 0x00, 0x02, (byte) 0xAF, (byte) 0x82, 0x00},
            NfcApduPolicy.parseApdu("80200000 02aF8200".replace(" ", ""))
        );
    }

    @Test
    public void acceptsTheSmallestAndLargestShortApdu() {
        assertEquals(4, NfcApduPolicy.parseApdu("00A40400").length);
        assertEquals(261, NfcApduPolicy.parseApdu(repeat("00", 261)).length);
    }

    @Test
    public void refusesWhatShouldNeverReachTheCard() {
        assertNull(NfcApduPolicy.parseApdu(null));
        assertNull(NfcApduPolicy.parseApdu(""));
        assertNull(NfcApduPolicy.parseApdu("00A404"));
        assertNull(NfcApduPolicy.parseApdu("00A40400F"));
        assertNull(NfcApduPolicy.parseApdu(repeat("00", 262)));
        assertNull(NfcApduPolicy.parseApdu("00A4040G"));
        assertNull(NfcApduPolicy.parseApdu("00A4 0400"));
        // Arabic-Indic digits pass Character.digit, not this parser.
        assertNull(NfcApduPolicy.parseApdu("00A40٠0"));
    }

    @Test
    public void hexOutIsUpperCase() {
        assertEquals("0090FF", NfcApduPolicy.toHex(new byte[] {0x00, (byte) 0x90, (byte) 0xFF}));
        assertEquals("", NfcApduPolicy.toHex(null));
    }

    private static String repeat(String s, int times) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < times; i++) {
            out.append(s);
        }
        return out.toString();
    }
}
