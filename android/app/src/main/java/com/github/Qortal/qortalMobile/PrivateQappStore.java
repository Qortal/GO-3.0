package com.github.Qortal.qortalMobile;

import java.net.URI;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The private Q-Apps GO unpacked itself ({@link PrivateQappArchive}), in
 * memory only, each at an address on the node it was opened from:
 * {@code <node>/render/hash/<id>}, where the node would have put its own
 * preview of the same zip. {@link AppOriginGuardWebViewClient} answers those
 * addresses from here ({@link PrivateQappRenderer}), for frames only, so the
 * request never leaves the phone. Being on the node's origin, the app reaches
 * the node and q-apps.js exactly as a node-built preview would.
 *
 * <p>An id is 32 random bytes in Base58, like the node's own preview hashes;
 * only the frame showing the app knows it. Apps go when the page releases
 * them (their tab closed), and the least recently used go first past
 * {@link #MAX_APPS} apps or {@link #MAX_TOTAL_BYTES}. No Android types, so
 * the JVM unit tests can check it.
 */
public final class PrivateQappStore {
    static final int MAX_APPS = 8;
    static final long MAX_TOTAL_BYTES = 320L * 1024 * 1024;
    /** An app just added is kept through a release-all while its tab opens. */
    static final long NEW_APP_GRACE_MS = 60_000;

    private static final String ADDRESS_START = PrivateQappRenderer.PREFIX + "/";
    private static final String BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    private static final PrivateQappStore SHARED =
        new PrivateQappStore(new SecureRandom(), MAX_APPS, MAX_TOTAL_BYTES);

    private static final class Entry {
        final String scheme;
        final String host;
        final int port;
        final PrivateQappArchive archive;
        final long addedAt;

        Entry(String scheme, String host, int port, PrivateQappArchive archive, long addedAt) {
            this.scheme = scheme;
            this.host = host;
            this.port = port;
            this.archive = archive;
            this.addedAt = addedAt;
        }
    }

    /** Access order: the first entry is the least recently used. */
    private final LinkedHashMap<String, Entry> apps = new LinkedHashMap<>(16, 0.75f, true);
    private final SecureRandom random;
    private final int maxApps;
    private final long maxTotalBytes;
    private long totalBytes;

    PrivateQappStore(SecureRandom random, int maxApps, long maxTotalBytes) {
        this.random = random;
        this.maxApps = maxApps;
        this.maxTotalBytes = maxTotalBytes;
    }

    public static PrivateQappStore shared() {
        return SHARED;
    }

    /**
     * Keeps {@code archive} under a new id on the origin of {@code nodeUrl}.
     *
     * @return the id; the app's address is {@code <nodeUrl>/render/hash/<id>}
     * @throws IllegalArgumentException when {@code nodeUrl} is not an http(s) address with a host
     */
    public String add(String nodeUrl, PrivateQappArchive archive, long now) {
        URI node;
        try {
            node = new URI(nodeUrl);
        } catch (Exception e) {
            throw new IllegalArgumentException("not a node address");
        }
        String scheme = node.getScheme() == null ? null : node.getScheme().toLowerCase(Locale.ROOT);
        String host = node.getHost();
        if (!("http".equals(scheme) || "https".equals(scheme)) || host == null || host.isEmpty()) {
            throw new IllegalArgumentException("not a node address");
        }
        synchronized (this) {
            String id;
            do {
                id = newId();
            } while (apps.containsKey(id));
            apps.put(id, new Entry(scheme, host.toLowerCase(Locale.ROOT), effectivePort(scheme, node.getPort()), archive, now));
            totalBytes += archive.size();
            trim(id);
            return id;
        }
    }

    public synchronized boolean has(String id) {
        return id != null && apps.containsKey(id);
    }

    public synchronized boolean release(String id) {
        Entry gone = id == null ? null : apps.remove(id);
        if (gone == null) {
            return false;
        }
        totalBytes -= gone.archive.size();
        return true;
    }

    /** Releases every app not in {@code ids}, except ones added in the last {@link #NEW_APP_GRACE_MS}. */
    public synchronized int retainOnly(Collection<String> ids, long now) {
        Set<String> keep = ids == null ? new HashSet<>() : new HashSet<>(ids);
        int released = 0;
        Iterator<Map.Entry<String, Entry>> it = apps.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Entry> app = it.next();
            if (keep.contains(app.getKey()) || now - app.getValue().addedAt < NEW_APP_GRACE_MS) {
                continue;
            }
            totalBytes -= app.getValue().archive.size();
            it.remove();
            released++;
        }
        return released;
    }

    public synchronized void clear() {
        apps.clear();
        totalBytes = 0;
    }

    public synchronized int size() {
        return apps.size();
    }

    /**
     * The reply for a frame's GET of {@code scheme://host:port/path}, or null
     * when that is not the address of an app kept here.
     *
     * @param path the decoded path, as Uri.getPath() gives it
     * @param theme the address's theme parameter, or null
     * @param lang the address's lang parameter, or null
     */
    public PrivateQappRenderer.Reply respond(String scheme, String host, int port, String path, String theme, String lang) {
        if (scheme == null || host == null || path == null || !path.startsWith(ADDRESS_START)) {
            return null;
        }
        String rest = path.substring(ADDRESS_START.length());
        int slash = rest.indexOf('/');
        String id = slash < 0 ? rest : rest.substring(0, slash);
        String inPath = slash < 0 ? "" : rest.substring(slash);
        String lowerScheme = scheme.toLowerCase(Locale.ROOT);
        Entry entry;
        synchronized (this) {
            entry = apps.get(id);
        }
        if (entry == null
            || !entry.scheme.equals(lowerScheme)
            || !entry.host.equalsIgnoreCase(host)
            || entry.port != effectivePort(lowerScheme, port)) {
            return null;
        }
        String goPolicy = QappFramePolicy.contentSecurityPolicy(scheme, host, port);
        return PrivateQappRenderer.render(entry.archive, id, inPath, theme, lang, goPolicy);
    }

    /** Ids of the kept apps, least recently used first. */
    synchronized List<String> ids() {
        return new ArrayList<>(apps.keySet());
    }

    private void trim(String justAdded) {
        Iterator<Map.Entry<String, Entry>> it = apps.entrySet().iterator();
        while ((apps.size() > maxApps || totalBytes > maxTotalBytes) && it.hasNext()) {
            Map.Entry<String, Entry> oldest = it.next();
            if (oldest.getKey().equals(justAdded)) {
                continue;
            }
            totalBytes -= oldest.getValue().archive.size();
            it.remove();
        }
    }

    private String newId() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return base58(bytes);
    }

    static String base58(byte[] input) {
        byte[] digits = input.clone();
        StringBuilder out = new StringBuilder();
        int start = 0;
        while (start < digits.length && digits[start] == 0) {
            out.append('1');
            start++;
        }
        StringBuilder rest = new StringBuilder();
        for (int i = start; i < digits.length; ) {
            int remainder = 0;
            for (int j = i; j < digits.length; j++) {
                int value = (remainder << 8) | (digits[j] & 0xff);
                digits[j] = (byte) (value / 58);
                remainder = value % 58;
            }
            rest.append(BASE58.charAt(remainder));
            while (i < digits.length && digits[i] == 0) {
                i++;
            }
        }
        return out.append(rest.reverse()).toString();
    }

    private static int effectivePort(String scheme, int port) {
        if (port > 0) {
            return port;
        }
        return "https".equals(scheme) ? 443 : 80;
    }
}
