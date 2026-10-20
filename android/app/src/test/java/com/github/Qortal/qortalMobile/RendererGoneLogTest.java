package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RendererGoneLogTest {
    private static final long AT = 1_790_000_000_000L;

    @Test
    public void roundTripsTheLastDeath() {
        RendererGoneLog.Entry entry = new RendererGoneLog.Entry(AT, true, 3);
        String stored = RendererGoneLog.encode(entry);
        assertEquals(AT + ",1,3", stored);
        RendererGoneLog.Entry back = RendererGoneLog.decode(stored);
        assertEquals(AT, back.at);
        assertTrue(back.crashed);
        assertEquals(3, back.count);
        assertFalse(RendererGoneLog.decode(AT + ",0,1").crashed);
    }

    @Test
    public void countsDeathsAndKeepsTheLatestTime() {
        RendererGoneLog.Entry first = RendererGoneLog.next(null, AT, false);
        assertEquals(1, first.count);
        RendererGoneLog.Entry second = RendererGoneLog.next(first, AT + 60_000L, true);
        assertEquals(2, second.count);
        assertEquals(AT + 60_000L, second.at);
        assertTrue(second.crashed);
    }

    @Test
    public void dropsMalformedValues() {
        assertNull(RendererGoneLog.decode(null));
        assertNull(RendererGoneLog.decode(""));
        assertNull(RendererGoneLog.decode("abc,1,1"));
        assertNull(RendererGoneLog.decode(AT + ",2,1"));
        assertNull(RendererGoneLog.decode(AT + ",1"));
        assertNull(RendererGoneLog.decode(AT + ",1,0"));
        assertNull(RendererGoneLog.decode("0,1,1"));
        assertNull(RendererGoneLog.decode(AT + ",1,1,9"));
    }
}
