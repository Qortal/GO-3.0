package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

public class PrivateQappStoreTest {
    private static final long T0 = 1_000_000_000L;
    private static final long LATER = T0 + PrivateQappStore.NEW_APP_GRACE_MS + 1;

    private static PrivateQappStore store() {
        return new PrivateQappStore(new SecureRandom(), PrivateQappStore.MAX_APPS, PrivateQappStore.MAX_TOTAL_BYTES);
    }

    private static PrivateQappArchive app() throws Exception {
        return PrivateQappArchive.unzip(PrivateQappArchiveTest.zip(
            "index.html", "<html><head></head><body>private</body></html>",
            "app.js", "go()"
        ));
    }

    /** An archive of exactly {@code bytes} unpacked bytes. */
    private static PrivateQappArchive appOfSize(int bytes) throws Exception {
        Map<String, byte[]> files = new HashMap<>();
        files.put("index.html", new byte[bytes - 1]);
        files.put("a.js", new byte[1]);
        Set<String> dirs = new HashSet<>();
        return PrivateQappArchive.fromUnpacked(files, dirs);
    }

    @Test
    public void anAppIsServedOnlyOnItsNodeAndPath() throws Exception {
        PrivateQappStore store = store();
        String id = store.add("https://ext-node.qortal.link", app(), T0);
        String path = "/render/hash/" + id;

        PrivateQappRenderer.Reply page = store.respond("https", "ext-node.qortal.link", -1, path, "dark", "en");
        assertNotNull(page);
        assertEquals(200, page.status);
        assertTrue(new String(page.body, StandardCharsets.UTF_8).contains("private"));
        assertEquals("go()", new String(store.respond("https", "EXT-NODE.qortal.link", 443, path + "/app.js", null, null).body, StandardCharsets.UTF_8));
        // A missing file of a kept app is the app's own 404, not the network.
        assertEquals(404, store.respond("https", "ext-node.qortal.link", -1, path + "/nope.js", null, null).status);

        assertNull(store.respond("http", "ext-node.qortal.link", -1, path, null, null));
        assertNull(store.respond("https", "other-node.example", -1, path, null, null));
        assertNull(store.respond("https", "ext-node.qortal.link", 8443, path, null, null));
        assertNull(store.respond("https", "ext-node.qortal.link", -1, "/render/hash/" + id + "x", null, null));
        assertNull(store.respond("https", "ext-node.qortal.link", -1, "/render/APP/" + id, null, null));
        assertNull(store.respond("https", "ext-node.qortal.link", -1, "/render/hash/", null, null));
        assertNull(store.respond("https", "ext-node.qortal.link", -1, null, null, null));
    }

    @Test
    public void portsAndLocalNodesMatch() throws Exception {
        PrivateQappStore store = store();
        String id = store.add("http://127.0.0.1:12398/", app(), T0);
        assertNotNull(store.respond("http", "127.0.0.1", 12398, "/render/hash/" + id, null, null));
        assertNull(store.respond("http", "127.0.0.1", 12391, "/render/hash/" + id, null, null));
        String plain = store.add("http://node.example", app(), T0);
        assertNotNull(store.respond("http", "node.example", 80, "/render/hash/" + plain, null, null));
    }

    @Test
    public void onlyHttpNodesAreAccepted() throws Exception {
        PrivateQappStore store = store();
        for (String bad : new String[] {"file:///sdcard", "localhost", "javascript:alert(1)", "http://", "not a url"}) {
            try {
                store.add(bad, app(), T0);
                fail("accepted " + bad);
            } catch (IllegalArgumentException expected) {
                // ok
            }
        }
        assertEquals(0, store.size());
    }

    @Test
    public void idsAreRandomBase58() throws Exception {
        PrivateQappStore store = store();
        String a = store.add("https://ext-node.qortal.link", app(), T0);
        String b = store.add("https://ext-node.qortal.link", app(), T0);
        assertNotEquals(a, b);
        assertTrue(a.matches("[1-9A-HJ-NP-Za-km-z]{40,44}"));
    }

    @Test
    public void base58MatchesTheStandardAlphabet() {
        assertEquals("JxF12TrwUP45BMd", PrivateQappStore.base58("Hello World".getBytes(StandardCharsets.US_ASCII)));
        assertEquals("112", PrivateQappStore.base58(new byte[] {0, 0, 1}));
        assertEquals("11", PrivateQappStore.base58(new byte[] {0, 0}));
        assertEquals("5Q", PrivateQappStore.base58(new byte[] {(byte) 0xff}));
    }

    @Test
    public void releaseAndRetainDropApps() throws Exception {
        PrivateQappStore store = store();
        String a = store.add("https://ext-node.qortal.link", app(), T0);
        String b = store.add("https://ext-node.qortal.link", app(), T0);
        String c = store.add("https://ext-node.qortal.link", app(), T0);

        assertTrue(store.release(a));
        assertFalse(store.release(a));
        assertFalse(store.has(a));
        assertNull(store.respond("https", "ext-node.qortal.link", -1, "/render/hash/" + a, null, null));

        // Just added: kept while its tab opens, even when no tab names it yet.
        assertEquals(0, store.retainOnly(Collections.emptyList(), T0 + 1000));
        assertEquals(1, store.retainOnly(Collections.singletonList(b), LATER));
        assertTrue(store.has(b));
        assertFalse(store.has(c));

        store.clear();
        assertEquals(0, store.size());
    }

    @Test
    public void theLeastRecentlyUsedGoPastTheLimits() throws Exception {
        PrivateQappStore store = store();
        String first = store.add("https://ext-node.qortal.link", app(), T0);
        String second = store.add("https://ext-node.qortal.link", app(), T0);
        for (int i = 2; i < PrivateQappStore.MAX_APPS; i++) {
            store.add("https://ext-node.qortal.link", app(), T0);
        }
        assertEquals(PrivateQappStore.MAX_APPS, store.size());
        // Using the first app makes the second the oldest.
        assertNotNull(store.respond("https", "ext-node.qortal.link", -1, "/render/hash/" + first, null, null));
        store.add("https://ext-node.qortal.link", app(), T0);
        assertEquals(PrivateQappStore.MAX_APPS, store.size());
        assertTrue(store.has(first));
        assertFalse(store.has(second));
    }

    @Test
    public void memoryLimitDropsOlderAppsButNeverTheNewOne() throws Exception {
        PrivateQappStore store = new PrivateQappStore(new SecureRandom(), 8, 3000);
        int third = 1000;
        String a = store.add("https://ext-node.qortal.link", appOfSize(third), T0);
        String b = store.add("https://ext-node.qortal.link", appOfSize(third), T0);
        String c = store.add("https://ext-node.qortal.link", appOfSize(third), T0);
        assertEquals(Arrays.asList(a, b, c), store.ids());
        String big = store.add("https://ext-node.qortal.link", appOfSize(third * 2), T0);
        assertEquals(Arrays.asList(c, big), store.ids());
        String huge = store.add("https://ext-node.qortal.link", appOfSize(3010), T0);
        assertEquals(Collections.singletonList(huge), store.ids());
    }
}
