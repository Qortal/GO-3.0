package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

public class VendorFreezeLogTest {
    private static final long AT = 1_790_000_000_000L;
    private static final long MIN = 60_000L;
    private static final long HOUR = 60 * MIN;
    private static final long DAY = 24 * HOUR;
    private static final int MAX = VendorFreezeLog.MAX_ENTRIES;

    private static VendorFreezeLog.Entry entry(long at, long gapMs, boolean ignoring, boolean charging) {
        return new VendorFreezeLog.Entry(at, gapMs, ignoring, charging);
    }

    @Test
    public void roundTripsEntriesInRecordingOrder() {
        List<VendorFreezeLog.Entry> entries = Arrays.asList(
            entry(AT, 6 * MIN, false, true),
            entry(AT + 10 * MIN, 95_000L, true, false),
            entry(AT + 20 * MIN, 45 * MIN, true, true),
            entry(AT + 30 * MIN, 0L, false, false));
        String stored = VendorFreezeLog.encode(entries);
        assertEquals(
            AT + ",360000,0,1;" + (AT + 10 * MIN) + ",95000,1,0;"
                + (AT + 20 * MIN) + ",2700000,1,1;" + (AT + 30 * MIN) + ",0,0,0",
            stored);
        assertEquals(entries, VendorFreezeLog.decode(stored));
    }

    @Test
    public void emptyOrMissingLogDecodesToNothing() {
        assertTrue(VendorFreezeLog.decode(null).isEmpty());
        assertTrue(VendorFreezeLog.decode("").isEmpty());
        assertTrue(VendorFreezeLog.decode(" ; ;").isEmpty());
        assertEquals("", VendorFreezeLog.encode(null));
        assertEquals("", VendorFreezeLog.encode(new ArrayList<>()));
    }

    @Test
    public void appendAddsLastAndStartsAFreshLog() {
        String stored = VendorFreezeLog.append(null, entry(AT, 6 * MIN, false, true));
        stored = VendorFreezeLog.append(stored, entry(AT + MIN, 7 * MIN, true, true));
        assertEquals(
            Arrays.asList(entry(AT, 6 * MIN, false, true), entry(AT + MIN, 7 * MIN, true, true)),
            VendorFreezeLog.decode(stored));
        // A null entry changes nothing.
        assertEquals(stored, VendorFreezeLog.append(stored, null));
    }

    @Test
    public void keepsAtMostFiftyEntriesDroppingTheOldestWhenAllCount() {
        assertEquals(50, MAX);
        // Separate 10 min freezes an hour apart: every episode counts.
        String stored = null;
        List<VendorFreezeLog.Entry> all = new ArrayList<>();
        StringBuilder raw = new StringBuilder();
        for (int i = 0; i < MAX + 10; i++) {
            VendorFreezeLog.Entry next = entry(AT + i * HOUR, 10 * MIN, i % 2 == 0, true);
            all.add(next);
            stored = VendorFreezeLog.append(stored, next);
            if (raw.length() > 0) raw.append(';');
            raw.append(AT + i * HOUR).append(",600000,").append(i % 2 == 0 ? 1 : 0).append(",1");
        }
        assertEquals(all.subList(10, MAX + 10), VendorFreezeLog.decode(stored));
        // encode caps too, and decode caps an over-long stored value.
        assertEquals(
            all.subList(10, MAX + 10), VendorFreezeLog.decode(VendorFreezeLog.encode(all)));
        assertEquals(all.subList(10, MAX + 10), VendorFreezeLog.decode(raw.toString()));
    }

    @Test
    public void shortFreezesDoNotPushOutLongOnes() {
        // Two overnight freezes on the charger, then a busy day of short
        // screen-offs (2.5 min frozen, 15 min apart): the case measured on vivo.
        VendorFreezeLog.Entry night1 = entry(AT, 8 * HOUR, false, true);
        VendorFreezeLog.Entry night2 = entry(AT + DAY, 8 * HOUR, false, true);
        String stored = VendorFreezeLog.append(null, night1);
        stored = VendorFreezeLog.append(stored, night2);
        List<VendorFreezeLog.Entry> shorts = new ArrayList<>();
        for (int i = 0; i < MAX + 10; i++) {
            VendorFreezeLog.Entry next =
                entry(AT + DAY + (i + 1) * 15 * MIN, 150_000L, false, true);
            shorts.add(next);
            stored = VendorFreezeLog.append(stored, next);
        }
        List<VendorFreezeLog.Entry> expected = new ArrayList<>();
        expected.add(night1);
        expected.add(night2);
        // The oldest short ones made room; recording order is kept.
        expected.addAll(shorts.subList(shorts.size() - (MAX - 2), shorts.size()));
        assertEquals(expected, VendorFreezeLog.decode(stored));
    }

    @Test
    public void anEpisodeWithOneLongFreezeIsKept() {
        // 3 min, then 6 min with 1 min on screen between: one episode that
        // counts on the page (its 6 min freeze does).
        VendorFreezeLog.Entry first = entry(AT, 3 * MIN, false, true);
        VendorFreezeLog.Entry second = entry(AT + 7 * MIN, 6 * MIN, false, true);
        String stored = VendorFreezeLog.append(null, first);
        stored = VendorFreezeLog.append(stored, second);
        for (int i = 0; i < MAX + 10; i++) {
            stored = VendorFreezeLog.append(
                stored, entry(AT + HOUR + i * 15 * MIN, 150_000L, false, true));
        }
        List<VendorFreezeLog.Entry> decoded = VendorFreezeLog.decode(stored);
        assertEquals(MAX, decoded.size());
        assertEquals(first, decoded.get(0));
        assertEquals(second, decoded.get(1));
    }

    @Test
    public void chainedShortFreezesDoNotPushOutLongOnes() {
        // A desk day on the charger: 3 min screen-offs with under 2 min on
        // screen between them chain into long episodes the page never counts
        // (no single freeze reaches 5 min). They must not evict the nights.
        VendorFreezeLog.Entry night1 = entry(AT, 8 * HOUR, false, true);
        VendorFreezeLog.Entry night2 = entry(AT + DAY, 8 * HOUR, false, true);
        String stored = VendorFreezeLog.append(null, night1);
        stored = VendorFreezeLog.append(stored, night2);
        List<VendorFreezeLog.Entry> chained = new ArrayList<>();
        for (int i = 0; i < MAX + 10; i++) {
            // Every 4 min: frozen 3 min, 1 min on screen. A new chain each 10.
            long at = AT + DAY + HOUR + i * 4 * MIN + (i / 10) * HOUR;
            VendorFreezeLog.Entry next = entry(at, 3 * MIN, false, true);
            chained.add(next);
            stored = VendorFreezeLog.append(stored, next);
        }
        List<VendorFreezeLog.Entry> decoded = VendorFreezeLog.decode(stored);
        assertEquals(MAX, decoded.size());
        assertEquals(night1, decoded.get(0));
        assertEquals(night2, decoded.get(1));
        // The newest chain is untouched (the next freeze may extend it).
        assertEquals(
            chained.subList(chained.size() - 10, chained.size()),
            decoded.subList(MAX - 10, MAX));
    }

    @Test
    public void theNewestEpisodeIsKeptSoTheNextFreezeCanExtendIt() {
        String stored = null;
        List<VendorFreezeLog.Entry> long10 = new ArrayList<>();
        for (int i = 0; i < MAX; i++) {
            VendorFreezeLog.Entry next = entry(AT + i * HOUR, 10 * MIN, false, true);
            long10.add(next);
            stored = VendorFreezeLog.append(stored, next);
        }
        // Short on its own, but newest: the oldest long one goes instead.
        long shortAt = AT + MAX * HOUR;
        VendorFreezeLog.Entry shortFirst = entry(shortAt, 3 * MIN, false, true);
        stored = VendorFreezeLog.append(stored, shortFirst);
        // Its continuation (a 6 min freeze) makes it count.
        VendorFreezeLog.Entry shortSecond = entry(shortAt + 7 * MIN, 6 * MIN, false, true);
        stored = VendorFreezeLog.append(stored, shortSecond);

        List<VendorFreezeLog.Entry> expected = new ArrayList<>(long10.subList(2, MAX));
        expected.add(shortFirst);
        expected.add(shortSecond);
        assertEquals(expected, VendorFreezeLog.decode(stored));
    }

    @Test
    public void entriesTwoWeeksOlderThanTheNewestGoFirst() {
        VendorFreezeLog.Entry old = entry(AT, 8 * HOUR, false, true);
        String stored = VendorFreezeLog.append(null, old);
        List<VendorFreezeLog.Entry> shorts = new ArrayList<>();
        for (int i = 0; i < MAX; i++) {
            VendorFreezeLog.Entry next = entry(AT + 20 * DAY + i * 15 * MIN, 150_000L, false, true);
            shorts.add(next);
            stored = VendorFreezeLog.append(stored, next);
        }
        List<VendorFreezeLog.Entry> decoded = VendorFreezeLog.decode(stored);
        assertFalse(decoded.contains(old));
        assertEquals(shorts, decoded);
    }

    @Test
    public void contractKeysMatchThePage() {
        // src/plugins/QortalBackground.ts and backgroundSync.ts read these names.
        assertEquals("vendorFreezeRecent", VendorFreezeLog.STATE_RECENT);
        assertEquals("ignoringBatteryOptimizations", VendorFreezeLog.STATE_IGNORING);
        assertEquals("vendorFreezeDetected", VendorFreezeLog.EVENT_DETECTED);
        assertEquals("count", VendorFreezeLog.EVENT_COUNT);
        assertEquals("lastAt", VendorFreezeLog.EVENT_LAST_AT);
        assertEquals("manufacturer", VendorFreezeLog.EVENT_MANUFACTURER);
        assertEquals("at", VendorFreezeLog.FIELD_AT);
        assertEquals("gapMs", VendorFreezeLog.FIELD_GAP_MS);
        assertEquals("ignoring", VendorFreezeLog.FIELD_IGNORING);
        assertEquals("charging", VendorFreezeLog.FIELD_CHARGING);
        assertEquals("opened", VendorFreezeLog.RESULT_OPENED);
        assertEquals("vendor", VendorFreezeLog.OPENED_VENDOR);
        assertEquals("app_details", VendorFreezeLog.OPENED_APP_DETAILS);
    }

    @Test
    public void fieldsPutEachValueUnderItsOwnKey() {
        VendorFreezeLog.Entry sample = entry(AT, 6 * MIN, true, false);
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("at", AT);
        item.put("gapMs", 6 * MIN);
        item.put("ignoring", true);
        item.put("charging", false);
        assertEquals(item, VendorFreezeLog.fields(sample));
        assertEquals(Arrays.asList("at", "gapMs", "ignoring", "charging"),
            new ArrayList<>(VendorFreezeLog.fields(sample).keySet()));

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("count", 7);
        event.put("lastAt", AT);
        event.put("manufacturer", "vivo");
        event.put("gapMs", 6 * MIN);
        event.put("ignoring", true);
        event.put("charging", false);
        assertEquals(event, VendorFreezeLog.eventFields(7, sample, "vivo"));
        assertEquals("", VendorFreezeLog.eventFields(7, sample, null).get("manufacturer"));
    }

    @Test
    public void dropsMalformedEntriesAndKeepsTheRest() {
        String good1 = AT + ",360000,0,1";
        String good2 = (AT + MIN) + ",400000,1,0";
        String stored = String.join(";",
            "garbage",
            good1,
            "1,2,3",                       // too few fields
            AT + ",1,0,1,1",               // too many fields
            "x," + "360000,0,1",           // not a number
            AT + ",360000,yes,1",          // flag not 0/1
            AT + ",360000,0,2",
            "0,360000,0,1",                // no time
            "-5,360000,0,1",
            AT + ",-1,0,1",                // negative gap
            "99999999999999999999,1,0,1",  // overflow
            "",
            " " + good2 + " ");
        assertEquals(
            Arrays.asList(entry(AT, 6 * MIN, false, true), entry(AT + MIN, 400_000L, true, false)),
            VendorFreezeLog.decode(stored));

        // Appending to a damaged log keeps the valid part and rewrites it clean.
        String repaired = VendorFreezeLog.append(stored, entry(AT + 2 * MIN, 500_000L, false, false));
        assertEquals(good1 + ";" + good2 + ";" + (AT + 2 * MIN) + ",500000,0,0", repaired);
    }

    @Test
    public void encodeSkipsInvalidEntries() {
        List<VendorFreezeLog.Entry> entries = Arrays.asList(
            null,
            entry(0L, 1_000L, false, false),
            entry(AT, -1L, false, false),
            entry(AT, 1_000L, true, false));
        assertEquals(AT + ",1000,1,0", VendorFreezeLog.encode(entries));
    }
}
