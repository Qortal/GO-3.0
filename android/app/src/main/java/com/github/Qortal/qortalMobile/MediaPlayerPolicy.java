package com.github.Qortal.qortalMobile;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pure rules behind GO's background player ({@link GoMediaHub}): settings,
 * when leaving GO pauses what plays, which player the notification shows,
 * which buttons it gets, text clean-up, where a frame's media comes from.
 * No Android types, so the JVM tests can check them. Times are
 * SystemClock.elapsedRealtime() values unless said otherwise.
 */
public final class MediaPlayerPolicy {
    private MediaPlayerPolicy() {}

    // ── Settings ────────────────────────────────────────────────────────────

    /** Back / forward steps the notification offers (Material has icons for these). */
    public static final int[] SEEK_STEPS_SEC = {5, 10, 30};
    public static final int DEFAULT_SEEK_STEP_SEC = 10;
    /** A paused player leaves the notification after this many minutes (0 = never). */
    public static final int[] CLOSE_PAUSED_OPTIONS_MIN = {5, 15, 30, 60, 0};
    public static final int DEFAULT_CLOSE_PAUSED_MIN = 30;
    /** Sleep timer choices in minutes; {@link #SLEEP_END_OF_TRACK} stops at the end of the track. */
    public static final int[] SLEEP_OPTIONS_MIN = {15, 30, 45, 60, 90};
    public static final int SLEEP_OFF = 0;
    public static final int SLEEP_END_OF_TRACK = -1;

    /** Everything the user can set for the background player. */
    public static final class Settings {
        /** Audio keeps playing when GO leaves the screen. */
        public boolean backgroundAudio = true;
        /** Video keeps playing (its sound) when GO leaves the screen. */
        public boolean backgroundVideo = true;
        /** Pause whatever plays when the screen turns off, even with the two above on. */
        public boolean pauseOnScreenLock = false;
        /** Play again what leaving GO paused, once GO is back on screen. */
        public boolean resumeOnReturn = true;
        /** The lock screen player shows what plays (off: only "Audio" / "Video" and its buttons). */
        public boolean lockScreen = true;
        /** The small Qortal logo on the cover. */
        public boolean logoOnCover = true;
        /** Pause when headphones or a Bluetooth speaker disconnect. */
        public boolean pauseOnNoisy = true;
        public int seekStepSec = DEFAULT_SEEK_STEP_SEC;
        public int closePausedAfterMin = DEFAULT_CLOSE_PAUSED_MIN;

        public Settings copy() {
            Settings s = new Settings();
            s.backgroundAudio = backgroundAudio;
            s.backgroundVideo = backgroundVideo;
            s.pauseOnScreenLock = pauseOnScreenLock;
            s.resumeOnReturn = resumeOnReturn;
            s.lockScreen = lockScreen;
            s.logoOnCover = logoOnCover;
            s.pauseOnNoisy = pauseOnNoisy;
            s.seekStepSec = seekStepSec;
            s.closePausedAfterMin = closePausedAfterMin;
            return s;
        }

        /** Out-of-range numbers fall back to the nearest allowed value. */
        public Settings normalized() {
            Settings s = copy();
            s.seekStepSec = normalizeSeekStep(seekStepSec);
            s.closePausedAfterMin = normalizeClosePaused(closePausedAfterMin);
            return s;
        }
    }

    public static int normalizeSeekStep(int sec) {
        int best = DEFAULT_SEEK_STEP_SEC;
        if (sec <= 0) return best;
        int bestDiff = Integer.MAX_VALUE;
        for (int step : SEEK_STEPS_SEC) {
            int diff = Math.abs(step - sec);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = step;
            }
        }
        return best;
    }

    public static int normalizeClosePaused(int min) {
        for (int option : CLOSE_PAUSED_OPTIONS_MIN) {
            if (option == min) return min;
        }
        return DEFAULT_CLOSE_PAUSED_MIN;
    }

    /** {@link #SLEEP_OFF}, {@link #SLEEP_END_OF_TRACK} or one of {@link #SLEEP_OPTIONS_MIN}. */
    public static int normalizeSleep(int min) {
        if (min == SLEEP_OFF || min == SLEEP_END_OF_TRACK) return min;
        for (int option : SLEEP_OPTIONS_MIN) {
            if (option == min) return min;
        }
        return SLEEP_OFF;
    }

    // ── Leaving GO ──────────────────────────────────────────────────────────

    /**
     * GO left the screen while this plays: pause it? The screen turning off
     * pauses everything when the user asked for that; otherwise audio and
     * video each follow their own switch.
     */
    public static boolean shouldPauseOnLeave(Settings s, boolean video, boolean screenOff) {
        if (s == null) return false;
        if (screenOff && s.pauseOnScreenLock) return true;
        return video ? !s.backgroundVideo : !s.backgroundAudio;
    }

    // ── Which player the notification shows ─────────────────────────────────

    /** What {@link #pickCurrent} needs to know of one player. */
    public static final class PlayerView {
        public String key;
        /** Audible and long enough to count as media (the frame decides, see go_media_watch.js). */
        public boolean eligible;
        public boolean playing;
        /** elapsedRealtime when it last started playing, 0 = never. */
        public long playingSinceMs;
        /** elapsedRealtime of its last report. */
        public long updatedAtMs;

        public PlayerView(String key, boolean eligible, boolean playing, long playingSinceMs, long updatedAtMs) {
            this.key = key;
            this.eligible = eligible;
            this.playing = playing;
            this.playingSinceMs = playingSinceMs;
            this.updatedAtMs = updatedAtMs;
        }
    }

    /**
     * The player the notification shows: whatever started playing last. A
     * paused current player stays (so its Play button works) until another
     * one plays. Null when no player counts as media.
     */
    public static String pickCurrent(List<PlayerView> players, String currentKey) {
        if (players == null || players.isEmpty()) return null;
        PlayerView current = null;
        PlayerView newestPlaying = null;
        PlayerView newestUpdated = null;
        for (PlayerView p : players) {
            if (p == null || !p.eligible) continue;
            if (p.key != null && p.key.equals(currentKey)) current = p;
            if (p.playing && (newestPlaying == null || p.playingSinceMs > newestPlaying.playingSinceMs)) {
                newestPlaying = p;
            }
            if (newestUpdated == null || p.updatedAtMs > newestUpdated.updatedAtMs) {
                newestUpdated = p;
            }
        }
        if (current != null) {
            if (newestPlaying == null || newestPlaying == current) return current.key;
            if (!current.playing) return newestPlaying.key;
            return newestPlaying.playingSinceMs > current.playingSinceMs ? newestPlaying.key : current.key;
        }
        if (newestPlaying != null) return newestPlaying.key;
        return newestUpdated != null ? newestUpdated.key : null;
    }

    // ── Buttons ─────────────────────────────────────────────────────────────

    public static final String CUSTOM_BACK = "go.media.back";
    public static final String CUSTOM_FORWARD = "go.media.forward";
    public static final String CUSTOM_SETTINGS = "go.media.settings";

    /** The notification's custom buttons, in the order the system places them. */
    public static final class ButtonLayout {
        /** Custom actions, in order: a missing previous / next slot takes the first ones. */
        public final List<String> custom = new ArrayList<>();
        /** Keep the previous / next slot empty instead of moving a custom button into it. */
        public boolean reservePrev;
        public boolean reserveNext;
    }

    /**
     * Android 13+ puts Previous, Play/Pause and Next in the middle and fills a
     * missing Previous or Next with the first custom buttons. Without a
     * playlist, seekable media gets Back and Forward there; the settings gear
     * always comes last. Media that cannot seek (a live stream) keeps the
     * empty slots so the gear does not land beside Play.
     */
    public static ButtonLayout buttonLayout(boolean hasPrev, boolean hasNext, boolean seekable) {
        ButtonLayout layout = new ButtonLayout();
        if (!hasPrev) {
            if (seekable) layout.custom.add(CUSTOM_BACK);
            else layout.reservePrev = true;
        }
        if (!hasNext) {
            if (seekable) layout.custom.add(CUSTOM_FORWARD);
            else layout.reserveNext = true;
        }
        layout.custom.add(CUSTOM_SETTINGS);
        return layout;
    }

    // ── Seeking and position ────────────────────────────────────────────────

    /** Where a seek lands, in seconds: never below 0 or past the end (when known). */
    public static double seekTarget(double positionSec, double deltaSec, double durationSec) {
        double target = positionSec + deltaSec;
        if (Double.isNaN(target)) target = 0;
        if (target < 0) target = 0;
        if (durationSec > 0 && !Double.isInfinite(durationSec) && target > durationSec) {
            target = Math.max(0, durationSec - 0.25);
        }
        return target;
    }

    /** Position now, from the last report (seconds) moved on by the rate while playing. */
    public static double positionNow(double reportedSec, long reportedAtMs, long nowMs,
                                     boolean playing, double rate, double durationSec) {
        double pos = Double.isNaN(reportedSec) || reportedSec < 0 ? 0 : reportedSec;
        if (playing && rate > 0 && nowMs > reportedAtMs) {
            pos += (nowMs - reportedAtMs) / 1000.0 * rate;
        }
        if (durationSec > 0 && !Double.isInfinite(durationSec) && pos > durationSec) pos = durationSec;
        return pos;
    }

    /** Duration for the system's seek bar in ms, or -1 when unknown or live. */
    public static long durationMs(double durationSec) {
        if (Double.isNaN(durationSec) || Double.isInfinite(durationSec) || durationSec <= 0) return -1L;
        return Math.round(durationSec * 1000.0);
    }

    // ── Timers ──────────────────────────────────────────────────────────────

    /** A paused player leaves the notification once paused this long ({@code closeAfterMin} 0 = never). */
    public static long msUntilClosePaused(long pausedSinceMs, long nowMs, int closeAfterMin) {
        if (closeAfterMin <= 0 || pausedSinceMs <= 0) return -1L;
        long due = pausedSinceMs + closeAfterMin * 60_000L;
        return Math.max(0L, due - nowMs);
    }

    /**
     * End-of-track sleep timer: ms until the current track ends, or -1 when
     * that cannot be known (paused, live, no duration).
     */
    public static long msUntilTrackEnds(double positionSec, double durationSec, boolean playing, double rate) {
        if (!playing || durationSec <= 0 || Double.isInfinite(durationSec) || Double.isNaN(durationSec)) return -1L;
        double r = rate > 0 ? rate : 1.0;
        double remaining = (durationSec - Math.max(0, positionSec)) / r;
        if (remaining < 0) remaining = 0;
        return Math.round(remaining * 1000.0);
    }

    // ── Text ────────────────────────────────────────────────────────────────

    public static final int MAX_TITLE_CHARS = 120;
    public static final int MAX_ARTIST_CHARS = 80;
    public static final int MAX_APP_CHARS = 48;

    /**
     * Text a frame sent for the notification: no control or direction-override
     * characters (they could make the lines read differently from what they
     * are), whitespace collapsed, cut to {@code max} code points with "…".
     * Null or blank gives "".
     */
    public static String cleanText(String raw, int max) {
        if (raw == null || max <= 0) return "";
        // Only look at a bounded prefix: a frame could send a huge string.
        String input = raw.length() > max * 8 + 64 ? raw.substring(0, max * 8 + 64) : raw;
        StringBuilder clean = new StringBuilder(Math.min(input.length(), max * 2 + 8));
        boolean space = false;
        int i = 0;
        while (i < input.length()) {
            int cp = input.codePointAt(i);
            i += Character.charCount(cp);
            if (Character.isWhitespace(cp) || Character.isSpaceChar(cp)) {
                space = clean.length() > 0;
                continue;
            }
            if (isHiddenCodePoint(cp)) continue;
            if (space) {
                clean.append(' ');
                space = false;
            }
            clean.appendCodePoint(cp);
        }
        String text = clean.toString();
        if (text.codePointCount(0, text.length()) <= max) return text;
        // max - 1 code points, then the ellipsis.
        int end = text.offsetByCodePoints(0, max - 1);
        return text.substring(0, end).trim() + "…";
    }

    /**
     * Control characters, lone surrogates and invisible format characters
     * (direction overrides and isolates, marks, BOM). Zero-width joiner and
     * non-joiner stay: emoji sequences and Persian or Indic text need them.
     * Characters unknown to an older Android stay too (new emoji).
     */
    private static boolean isHiddenCodePoint(int cp) {
        if (cp == 0x200C || cp == 0x200D) return false;
        int type = Character.getType(cp);
        return type == Character.CONTROL || type == Character.FORMAT || type == Character.SURROGATE;
    }

    /** Same name, ignoring case, spaces and punctuation ("Ear Bump" = "Ear-Bump"). */
    public static boolean sameName(String a, String b) {
        if (a == null || b == null) return false;
        String x = a.replaceAll("[^\\p{L}\\p{N}]+", "").toLowerCase(Locale.ROOT);
        String y = b.replaceAll("[^\\p{L}\\p{N}]+", "").toLowerCase(Locale.ROOT);
        return !x.isEmpty() && x.equals(y);
    }

    // ── Where the media comes from ──────────────────────────────────────────

    /** The app or site a frame belongs to, for the notification's small line. */
    public static final class Source {
        /** The Q-App or website name, or the site's host; "" for GO's own page. */
        public String label = "";
        /** APP, WEBSITE, or "" (GO's page, another site). */
        public String service = "";
        /** QDN name when the frame renders one (APP / WEBSITE), else "". */
        public String name = "";
    }

    /**
     * Reads the Q-App or website from a frame's URL. {@code reportedHref} comes
     * from the frame and is only used when its origin is the one the WebView
     * says sent the message ({@code trustedOrigin}); otherwise the trusted
     * origin's host is all that is shown. GO's own page gives an empty label.
     */
    public static Source sourceOf(String reportedHref, String trustedOrigin, boolean goPage) {
        Source source = new Source();
        if (goPage) return source;
        String origin = normalizeOrigin(trustedOrigin);
        URI uri = parse(reportedHref);
        if (uri != null && origin != null && origin.equals(originOf(uri))) {
            String[] named = qdnName(uri.getRawPath());
            if (named != null) {
                source.service = named[0];
                source.name = named[1];
                source.label = cleanText(named[1], MAX_APP_CHARS);
                return source;
            }
        }
        String host = hostOf(origin);
        source.label = host != null ? cleanText(host, MAX_APP_CHARS) : "";
        return source;
    }

    /** {service, name} for /render/APP/name, /render/WEBSITE/name, /APP/name, /WEBSITE/name. */
    static String[] qdnName(String rawPath) {
        if (rawPath == null) return null;
        String[] parts = rawPath.split("/");
        List<String> segments = new ArrayList<>();
        for (String part : parts) {
            if (!part.isEmpty()) segments.add(part);
        }
        int at = 0;
        if (!segments.isEmpty() && "render".equalsIgnoreCase(segments.get(0))) at = 1;
        if (segments.size() < at + 2) return null;
        String service = segments.get(at).toUpperCase(Locale.ROOT);
        if (!"APP".equals(service) && !"WEBSITE".equals(service)) return null;
        String name = decode(segments.get(at + 1));
        if (name == null || name.trim().isEmpty()) return null;
        return new String[] {service, name.trim()};
    }

    private static String decode(String raw) {
        try {
            return URLDecoder.decode(raw.replace("+", "%2B"), StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return null;
        }
    }

    private static URI parse(String href) {
        if (href == null || href.isEmpty() || href.length() > 4096) return null;
        try {
            URI uri = new URI(href);
            String scheme = uri.getScheme();
            if (scheme == null) return null;
            scheme = scheme.toLowerCase(Locale.ROOT);
            if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
            return uri;
        } catch (Exception e) {
            return null;
        }
    }

    private static String originOf(URI uri) {
        if (uri == null || uri.getHost() == null) return null;
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        int port = uri.getPort();
        if (port == defaultPort(scheme)) port = -1;
        return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + (port > 0 ? ":" + port : "");
    }

    static String normalizeOrigin(String origin) {
        URI uri = parse(origin);
        return uri != null ? originOf(uri) : null;
    }

    private static String hostOf(String origin) {
        URI uri = parse(origin);
        return uri != null ? uri.getHost() : null;
    }

    private static int defaultPort(String scheme) {
        return "https".equals(scheme) ? 443 : 80;
    }

    // ── Limits on what a frame may send ─────────────────────────────────────

    /** Longest state message (a few hundred characters normally). */
    public static final int MAX_STATE_MESSAGE_CHARS = 8_000;
    /** Longest artwork message: a 512 px JPEG as a data: URL is about 60 KB. */
    public static final int MAX_ART_MESSAGE_CHARS = 1_200_000;
    public static final int MAX_PLAYERS_PER_FRAME = 16;
    public static final int MAX_FRAMES = 32;
    /** Messages a frame may send per second; more are dropped. */
    public static final int MAX_MESSAGES_PER_SECOND = 30;

    /** Counts a frame's messages in one-second windows. */
    public static final class RateWindow {
        private long windowStartMs = -1L;
        private int count;

        /** True when one more message fits in this second. */
        public boolean allow(long nowMs) {
            if (windowStartMs < 0 || nowMs - windowStartMs >= 1000L || nowMs < windowStartMs) {
                windowStartMs = nowMs;
                count = 0;
            }
            if (count >= MAX_MESSAGES_PER_SECOND) return false;
            count++;
            return true;
        }
    }

    // ── Cover ───────────────────────────────────────────────────────────────

    /** {left, top, size} of the Qortal logo in a w × h cover: bottom right, about a quarter wide. */
    public static int[] logoBadgeRect(int width, int height) {
        int min = Math.max(1, Math.min(width, height));
        int size = Math.max(12, Math.round(min * 0.24f));
        int margin = Math.max(2, Math.round(min * 0.045f));
        return new int[] {width - margin - size, height - margin - size, size};
    }
}
