package com.github.Qortal.qortalMobile;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The most recent vendor freezes, kept as one SharedPreferences string so the
 * page can apply its own notice policy (episodes, cooldown, opt-out). Plain
 * Java without org.json, so the JVM unit tests run it.
 *
 * Format: entries joined by ';', each "at,gapMs,ignoring,charging" with
 * {@code at} (wall-clock ms) and {@code gapMs} as decimal numbers and the two
 * flags as 0 or 1. Entries stay in recording order, oldest first; at most
 * {@link #MAX_ENTRIES} are kept (see {@link #trim} for which ones go first).
 * Malformed entries are dropped on read.
 */
public final class VendorFreezeLog {
    private VendorFreezeLog() {}

    /** The page reads up to 50 (backgroundSync.ts VENDOR_FREEZE_RECENT_MAX). */
    public static final int MAX_ENTRIES = 50;

    private static final long MINUTE_MS = 60_000L;
    /**
     * Retention only, mirroring the page's notice policy
     * (vendorFreezeHintPolicy.ts SIGNIFICANT_FREEZE_MS): an episode with no
     * single freeze this long never counts there, however many short ones it
     * chains, so it is dropped first when the log is full.
     */
    static final long KEEP_EPISODE_GAP_MS = 5L * MINUTE_MS;
    /** A freeze that began this soon after the previous detection continues its episode. */
    static final long EPISODE_MERGE_MS = 2L * MINUTE_MS;
    /**
     * The page looks back at most 14 days (7-day window + 7-day card), so
     * older entries go first.
     */
    static final long STALE_MS = 14L * 24L * 60L * MINUTE_MS;

    // ── Page contract (src/plugins/QortalBackground.ts) ─────────────────────
    // Native writes these keys; a rename here must be a rename there too.

    /** getBackgroundSyncState(): the log as an array of entries, oldest first. */
    public static final String STATE_RECENT = "vendorFreezeRecent";
    /** getBackgroundSyncState(): GO is exempt now (boolean; null when unknown). */
    public static final String STATE_IGNORING = "ignoringBatteryOptimizations";
    /** The live event sent for every freeze. */
    public static final String EVENT_DETECTED = "vendorFreezeDetected";
    public static final String EVENT_COUNT = "count";
    public static final String EVENT_LAST_AT = "lastAt";
    public static final String EVENT_MANUFACTURER = "manufacturer";
    /** One entry's fields, in vendorFreezeRecent and in the event. */
    public static final String FIELD_AT = "at";
    public static final String FIELD_GAP_MS = "gapMs";
    public static final String FIELD_IGNORING = "ignoring";
    public static final String FIELD_CHARGING = "charging";
    /** openVendorBatterySettings(): the result key and its values (or null). */
    public static final String RESULT_OPENED = "opened";
    public static final String OPENED_VENDOR = "vendor";
    public static final String OPENED_APP_DETAILS = "app_details";

    private static final char ENTRY_SEPARATOR = ';';
    private static final char FIELD_SEPARATOR = ',';

    /** One detected freeze. */
    public static final class Entry {
        /** Wall-clock ms (System.currentTimeMillis) when the freeze was seen. */
        public final long at;
        /** Time between the last tick before the freeze and the one that saw it. */
        public final long gapMs;
        /**
         * GO was exempt from battery optimisations both at the last tick
         * before the freeze and when it was seen (so all through it).
         */
        public final boolean ignoring;
        /** The phone was on the charger at the last tick before the freeze. */
        public final boolean charging;

        public Entry(long at, long gapMs, boolean ignoring, boolean charging) {
            this.at = at;
            this.gapMs = gapMs;
            this.ignoring = ignoring;
            this.charging = charging;
        }

        boolean isValid() {
            return at > 0 && gapMs >= 0;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) return true;
            if (!(other instanceof Entry)) return false;
            Entry that = (Entry) other;
            return at == that.at
                && gapMs == that.gapMs
                && ignoring == that.ignoring
                && charging == that.charging;
        }

        @Override
        public int hashCode() {
            int result = Long.hashCode(at);
            result = 31 * result + Long.hashCode(gapMs);
            result = 31 * result + (ignoring ? 1 : 0);
            result = 31 * result + (charging ? 1 : 0);
            return result;
        }

        @Override
        public String toString() {
            return "Entry{at=" + at + ", gapMs=" + gapMs
                + ", ignoring=" + ignoring + ", charging=" + charging + "}";
        }
    }

    /** One entry as the page reads it (vendorFreezeRecent item), keys in contract order. */
    public static Map<String, Object> fields(Entry entry) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put(FIELD_AT, entry.at);
        out.put(FIELD_GAP_MS, entry.gapMs);
        out.put(FIELD_IGNORING, entry.ignoring);
        out.put(FIELD_CHARGING, entry.charging);
        return out;
    }

    /**
     * The vendorFreezeDetected payload: count, lastAt (= entry.at),
     * manufacturer, then the entry's own fields.
     */
    public static Map<String, Object> eventFields(int count, Entry entry, String manufacturer) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put(EVENT_COUNT, count);
        out.put(EVENT_LAST_AT, entry.at);
        out.put(EVENT_MANUFACTURER, manufacturer != null ? manufacturer : "");
        out.put(FIELD_GAP_MS, entry.gapMs);
        out.put(FIELD_IGNORING, entry.ignoring);
        out.put(FIELD_CHARGING, entry.charging);
        return out;
    }

    /** The stored entries, oldest first; empty for null, blank or unreadable input. */
    public static List<Entry> decode(String stored) {
        List<Entry> entries = new ArrayList<>();
        if (stored == null || stored.isEmpty()) return entries;
        int start = 0;
        int length = stored.length();
        while (start <= length) {
            int end = stored.indexOf(ENTRY_SEPARATOR, start);
            if (end < 0) end = length;
            Entry entry = parseEntry(stored.substring(start, end));
            if (entry != null) entries.add(entry);
            start = end + 1;
        }
        return trim(entries);
    }

    /** The stored form of the valid entries, trimmed to {@link #MAX_ENTRIES}. */
    public static String encode(List<Entry> entries) {
        if (entries == null || entries.isEmpty()) return "";
        List<Entry> valid = new ArrayList<>();
        for (Entry entry : entries) {
            if (entry != null && entry.isValid()) valid.add(entry);
        }
        StringBuilder out = new StringBuilder();
        for (Entry entry : trim(valid)) {
            if (out.length() > 0) out.append(ENTRY_SEPARATOR);
            out.append(entry.at)
                .append(FIELD_SEPARATOR)
                .append(entry.gapMs)
                .append(FIELD_SEPARATOR)
                .append(entry.ignoring ? '1' : '0')
                .append(FIELD_SEPARATOR)
                .append(entry.charging ? '1' : '0');
        }
        return out.toString();
    }

    /** {@code stored} with {@code entry} added last, trimmed to {@link #MAX_ENTRIES}. */
    public static String append(String stored, Entry entry) {
        List<Entry> entries = decode(stored);
        if (entry != null) entries.add(entry);
        return encode(entries);
    }

    /**
     * At most {@link #MAX_ENTRIES} entries, recording order kept. vivo freezes
     * GO after nearly every screen-off on the charger, so short daytime
     * freezes would otherwise push the long overnight ones (the only ones the
     * page counts) out of the log. One at a time, a full log drops:
     * <ol>
     *   <li>the oldest entry more than {@link #STALE_MS} older than the newest;</li>
     *   <li>else the first entry of the oldest short episode (no single freeze
     *       of {@link #KEEP_EPISODE_GAP_MS} or more, grouped like the page
     *       does), never of the newest episode, which the next freeze may
     *       extend;</li>
     *   <li>else the oldest entry.</li>
     * </ol>
     */
    static List<Entry> trim(List<Entry> entries) {
        if (entries.size() <= MAX_ENTRIES) return entries;
        List<Entry> kept = new ArrayList<>(entries);
        while (kept.size() > MAX_ENTRIES) {
            kept.remove(evictionIndex(kept));
        }
        return kept;
    }

    private static int evictionIndex(List<Entry> entries) {
        long newestAt = entries.get(entries.size() - 1).at;
        for (int i = 0; i < entries.size(); i++) {
            if (newestAt - entries.get(i).at > STALE_MS) return i;
        }
        int episodeStart = 0;
        // The longest single freeze: the page counts an episode only by it.
        long episodeMaxGap = entries.get(0).gapMs;
        for (int i = 1; i < entries.size(); i++) {
            Entry previous = entries.get(i - 1);
            Entry current = entries.get(i);
            // Capped so absurd stored values cannot overflow.
            long startAt = current.at - Math.min(current.gapMs, current.at);
            if (startAt - previous.at <= EPISODE_MERGE_MS) {
                episodeMaxGap = Math.max(episodeMaxGap, current.gapMs);
                continue;
            }
            // The episode [episodeStart, i) is complete.
            if (episodeMaxGap < KEEP_EPISODE_GAP_MS) return episodeStart;
            episodeStart = i;
            episodeMaxGap = current.gapMs;
        }
        return 0;
    }

    private static Entry parseEntry(String raw) {
        String text = raw.trim();
        if (text.isEmpty()) return null;
        String[] fields = text.split(String.valueOf(FIELD_SEPARATOR), -1);
        if (fields.length != 4) return null;
        try {
            long at = Long.parseLong(fields[0].trim());
            long gapMs = Long.parseLong(fields[1].trim());
            Boolean ignoring = parseFlag(fields[2]);
            Boolean charging = parseFlag(fields[3]);
            if (ignoring == null || charging == null) return null;
            Entry entry = new Entry(at, gapMs, ignoring, charging);
            return entry.isValid() ? entry : null;
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static Boolean parseFlag(String raw) {
        String flag = raw.trim();
        if ("1".equals(flag)) return Boolean.TRUE;
        if ("0".equals(flag)) return Boolean.FALSE;
        return null;
    }
}
