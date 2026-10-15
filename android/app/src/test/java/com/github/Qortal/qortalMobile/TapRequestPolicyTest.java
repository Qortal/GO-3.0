package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TapRequestPolicyTest {
    private static final byte[] SELECT_OURS = NfcApduPolicy.parseApdu("00A4040008F0514F5254414C50");
    private static final byte[] PAYLOAD = {0x7B, 0x7D};

    @Test
    public void recognisesOnlyASelectOfGosAid() {
        assertTrue(TapRequestPolicy.isSelectOfOurs(SELECT_OURS));
        assertTrue(TapRequestPolicy.isSelectOfOurs(NfcApduPolicy.parseApdu("00A4040008F0514F5254414C5000")));
        assertFalse(TapRequestPolicy.isSelectOfOurs(NfcApduPolicy.parseApdu("00A4040008F0514F5254414C01")));
        assertFalse(TapRequestPolicy.isSelectOfOurs(NfcApduPolicy.parseApdu("00A4000008F0514F5254414C50")));
        assertFalse(TapRequestPolicy.isSelectOfOurs(NfcApduPolicy.parseApdu("00A4040007F0514F5254414C")));
        assertFalse(TapRequestPolicy.isSelectOfOurs(NfcApduPolicy.parseApdu("80A4040008F0514F5254414C50")));
        assertFalse(TapRequestPolicy.isSelectOfOurs(null));
    }

    @Test
    public void servesTheRequestOnlyWhileArmed() {
        assertArrayEquals(
            new byte[] {0x7B, 0x7D, (byte) 0x90, 0x00},
            TapRequestPolicy.answer(SELECT_OURS, PAYLOAD, 2_000L, 1_000L)
        );
        assertArrayEquals(TapRequestPolicy.SW_NOT_READY, TapRequestPolicy.answer(SELECT_OURS, PAYLOAD, 2_000L, 2_001L));
        assertArrayEquals(TapRequestPolicy.SW_NOT_READY, TapRequestPolicy.answer(SELECT_OURS, null, 2_000L, 1_000L));
        assertArrayEquals(TapRequestPolicy.SW_NOT_READY, TapRequestPolicy.answer(SELECT_OURS, new byte[0], 2_000L, 1_000L));
    }

    @Test
    public void answersAnythingElseWithNotSupported() {
        assertArrayEquals(
            TapRequestPolicy.SW_INS_NOT_SUPPORTED,
            TapRequestPolicy.answer(NfcApduPolicy.parseApdu("00B0000000"), PAYLOAD, 2_000L, 1_000L)
        );
    }

    @Test
    public void keepsTheLifetimeShort() {
        assertEquals(1_000L, TapRequestPolicy.clampTtl(0L));
        assertEquals(120_000L, TapRequestPolicy.clampTtl(120_000L));
        assertEquals(TapRequestPolicy.MAX_TTL_MS, TapRequestPolicy.clampTtl(Long.MAX_VALUE));
    }
}
