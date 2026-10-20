package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The last time the WebView's renderer died (MainActivity.onRenderProcessGone),
 * kept in SharedPreferences so the next page's Copy diagnostics can say
 * "previous page ended: renderer gone". A renderer death rebuilds the page and
 * clears everything it held in memory, so only native code can remember it.
 *
 * Stored as one string "at,crashed,count": wall-clock ms of the last death,
 * 1 when Android said the renderer crashed (0 when it was killed, e.g. for
 * memory), and how many deaths were recorded so far. The encoding is plain
 * Java so the JVM unit tests run it.
 */
public final class RendererGoneLog {
    private RendererGoneLog() {}

    private static final String PREFS = "qortal_go_renderer_gone";
    private static final String KEY = "last";

    /** getStatus({ detail: true }).native.rendererGone fields. */
    public static final String FIELD_AT = "at";
    public static final String FIELD_CRASHED = "crashed";
    public static final String FIELD_COUNT = "count";

    /** One recorded renderer death. */
    public static final class Entry {
        public final long at;
        public final boolean crashed;
        public final long count;

        public Entry(long at, boolean crashed, long count) {
            this.at = at;
            this.crashed = crashed;
            this.count = count;
        }
    }

    static String encode(Entry entry) {
        return entry.at + "," + (entry.crashed ? 1 : 0) + "," + entry.count;
    }

    /** Null for a missing or malformed value. */
    static Entry decode(String stored) {
        if (stored == null) return null;
        String[] parts = stored.split(",", -1);
        if (parts.length != 3) return null;
        try {
            long at = Long.parseLong(parts[0]);
            long count = Long.parseLong(parts[2]);
            if (at <= 0 || count <= 0) return null;
            if (!"0".equals(parts[1]) && !"1".equals(parts[1])) return null;
            return new Entry(at, "1".equals(parts[1]), count);
        } catch (NumberFormatException error) {
            return null;
        }
    }

    /** The entry to store for a death at {@code at}, after {@code previous}. */
    static Entry next(Entry previous, long at, boolean crashed) {
        long count = previous == null ? 1 : previous.count + 1;
        return new Entry(at, crashed, count);
    }

    /** MainActivity.onRenderProcessGone: remember this death. Never throws. */
    public static void record(Context context, boolean crashed) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            Entry previous = decode(prefs.getString(KEY, null));
            // commit(): the activity is about to be recreated.
            prefs.edit().putString(KEY, encode(next(previous, System.currentTimeMillis(), crashed))).commit();
        } catch (RuntimeException ignored) {
            // Diagnostics only.
        }
    }

    /** The last death for Copy diagnostics, or null when none was recorded. */
    public static JSONObject read(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            Entry entry = decode(prefs.getString(KEY, null));
            if (entry == null) return null;
            return new JSONObject()
                .put(FIELD_AT, entry.at)
                .put(FIELD_CRASHED, entry.crashed)
                .put(FIELD_COUNT, entry.count);
        } catch (RuntimeException | JSONException error) {
            return null;
        }
    }
}
