package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class RedirectPolicyTest {
    private static final String KEY = "NODE-API-KEY";
    private static final String START = "https://node.example:12391/arbitrary/FILE/GO%203.0/x";

    /** A scripted server: each URL answers with a status and maybe a Location. */
    private static final class FakeTransport implements RedirectPolicy.Transport<FakeTransport.Reply> {
        static final class Reply {
            final String url;
            final int status;
            final String location;
            boolean closed;

            Reply(String url, int status, String location) {
                this.url = url;
                this.status = status;
                this.location = location;
            }
        }

        final Map<String, Reply> script = new HashMap<>();
        /** Every hop opened, in order, and whether it carried the key. */
        final List<String> opened = new ArrayList<>();
        final List<Boolean> keyed = new ArrayList<>();
        final List<Reply> replies = new ArrayList<>();

        FakeTransport answer(String url, int status, String location) {
            script.put(url, new Reply(url, status, location));
            return this;
        }

        @Override
        public Reply open(String url, boolean withKey) {
            opened.add(url);
            keyed.add(withKey);
            Reply scripted = script.get(url);
            Reply reply = scripted != null
                ? new Reply(url, scripted.status, scripted.location)
                : new Reply(url, 404, null);
            replies.add(reply);
            return reply;
        }

        @Override
        public int status(Reply reply) {
            return reply.status;
        }

        @Override
        public String location(Reply reply) {
            return reply.location;
        }

        @Override
        public void close(Reply reply) {
            reply.closed = true;
        }
    }

    /** The updater's rule: refuse a hop AppUpdatePolicy does not allow. */
    private static final RedirectPolicy.AddressCheck UPDATE_RULE = url -> {
        AppUpdatePolicy.UrlVerdict verdict = AppUpdatePolicy.checkDownloadUrl(url);
        if (verdict != AppUpdatePolicy.UrlVerdict.OK) throw new IllegalStateException(verdict.code);
    };

    @Test
    public void noRedirectReturnsTheFirstReplyWithTheKey() throws Exception {
        FakeTransport server = new FakeTransport().answer(START, 200, null);
        FakeTransport.Reply reply = RedirectPolicy.open(START, KEY, 5, UPDATE_RULE, server);
        assertEquals(START, reply.url);
        assertFalse(reply.closed);
        assertEquals(Arrays.asList(true), server.keyed);
    }

    @Test
    public void aRelativeLocationResolvesAndKeepsTheKeyOnTheSameOrigin() throws Exception {
        FakeTransport server = new FakeTransport()
            .answer(START, 302, "../../FILE/GO%203.0/y?attachment=true")
            .answer("https://node.example:12391/arbitrary/FILE/GO%203.0/y?attachment=true", 200, null);
        FakeTransport.Reply reply = RedirectPolicy.open(START, KEY, 5, UPDATE_RULE, server);
        assertEquals("https://node.example:12391/arbitrary/FILE/GO%203.0/y?attachment=true", reply.url);
        assertEquals(Arrays.asList(true, true), server.keyed);
        assertTrue(server.replies.get(0).closed);
        assertFalse(reply.closed);
    }

    @Test
    public void aCrossOriginHopDropsTheKey() throws Exception {
        FakeTransport server = new FakeTransport()
            .answer(START, 302, "https://cdn.example/go.apk")
            .answer("https://cdn.example/go.apk", 200, null);
        RedirectPolicy.open(START, KEY, 5, UPDATE_RULE, server);
        assertEquals(Arrays.asList(true, false), server.keyed);
    }

    @Test
    public void theKeyIsJudgedAgainstTheStartNotTheHopBefore() throws Exception {
        // node -> cdn -> cdn -> node. Comparing each hop with the one before
        // would hand the key to cdn on the third hop.
        FakeTransport server = new FakeTransport()
            .answer(START, 302, "https://cdn.example/a")
            .answer("https://cdn.example/a", 302, "/b")
            .answer("https://cdn.example/b", 302, "https://node.example:12391/final")
            .answer("https://node.example:12391/final", 200, null);
        FakeTransport.Reply reply = RedirectPolicy.open(START, KEY, 5, UPDATE_RULE, server);
        assertEquals("https://node.example:12391/final", reply.url);
        assertEquals(Arrays.asList(true, false, false, true), server.keyed);
    }

    @Test
    public void aSchemeRelativeLocationToAnotherHostDropsTheKey() throws Exception {
        FakeTransport server = new FakeTransport()
            .answer(START, 301, "//evil.example/x")
            .answer("https://evil.example/x", 200, null);
        RedirectPolicy.open(START, KEY, 5, UPDATE_RULE, server);
        assertEquals(Arrays.asList(true, false), server.keyed);
    }

    @Test
    public void anotherPortOrSchemeOnTheSameHostDropsTheKey() throws Exception {
        FakeTransport server = new FakeTransport()
            .answer("http://127.0.0.1:12391/x", 307, "http://127.0.0.1:8080/x")
            .answer("http://127.0.0.1:8080/x", 200, null);
        RedirectPolicy.open("http://127.0.0.1:12391/x", KEY, 5, UPDATE_RULE, server);
        assertEquals(Arrays.asList(true, false), server.keyed);
    }

    @Test
    public void aDowngradeToPlainHttpOffThePhoneIsRefusedBeforeItIsOpened() throws Exception {
        FakeTransport server = new FakeTransport()
            .answer(START, 302, "http://192.168.1.20:12391/go.apk")
            .answer("http://192.168.1.20:12391/go.apk", 200, null);
        try {
            RedirectPolicy.open(START, KEY, 5, UPDATE_RULE, server);
            fail("an HTTPS to plain-HTTP hop must be refused");
        } catch (IllegalStateException refused) {
            assertEquals("UPDATE_INSECURE_URL", refused.getMessage());
        }
        assertEquals(Arrays.asList(START), server.opened);
        assertTrue(server.replies.get(0).closed);
    }

    @Test
    public void theFirstHopIsCheckedToo() throws Exception {
        FakeTransport server = new FakeTransport().answer("http://192.168.1.20/x", 200, null);
        try {
            RedirectPolicy.open("http://192.168.1.20/x", KEY, 5, UPDATE_RULE, server);
            fail("plain HTTP off the phone must be refused");
        } catch (IllegalStateException refused) {
            assertEquals("UPDATE_INSECURE_URL", refused.getMessage());
        }
        assertTrue(server.opened.isEmpty());
    }

    @Test
    public void fiveRedirectsAreFollowedAndASixthFails() throws Exception {
        FakeTransport five = new FakeTransport();
        for (int i = 0; i < 5; i++) {
            five.answer("https://node.example/" + i, 302, "/" + (i + 1));
        }
        five.answer("https://node.example/5", 200, null);
        FakeTransport.Reply reply = RedirectPolicy.open("https://node.example/0", KEY, 5, UPDATE_RULE, five);
        assertEquals("https://node.example/5", reply.url);
        assertEquals(6, five.opened.size());

        FakeTransport six = new FakeTransport();
        for (int i = 0; i < 6; i++) {
            six.answer("https://node.example/" + i, 302, "/" + (i + 1));
        }
        six.answer("https://node.example/6", 200, null);
        try {
            RedirectPolicy.open("https://node.example/0", KEY, 5, UPDATE_RULE, six);
            fail("a sixth redirect must fail");
        } catch (RedirectPolicy.RedirectRefused refused) {
            assertEquals(302, refused.status);
        }
        assertEquals(6, six.opened.size());
        for (FakeTransport.Reply opened : six.replies) assertTrue(opened.closed);
    }

    @Test
    public void qortinoFollowsOneRedirectAtMost() throws Exception {
        FakeTransport server = new FakeTransport()
            .answer("http://10.0.0.2:12391/a", 302, "/b")
            .answer("http://10.0.0.2:12391/b", 302, "/c")
            .answer("http://10.0.0.2:12391/c", 200, null);
        try {
            RedirectPolicy.open("http://10.0.0.2:12391/a", KEY, 1, null, server);
            fail("a second redirect must fail");
        } catch (RedirectPolicy.RedirectRefused refused) {
            assertEquals(302, refused.status);
        }
        assertEquals(Arrays.asList(true, true), server.keyed);
    }

    @Test
    public void aRedirectWithoutAUsableLocationFails() throws Exception {
        String[] bad = {null, "", "   ", "ftp://node.example/go.apk", "file:///sdcard/go.apk", "content://x/y"};
        for (String location : bad) {
            FakeTransport server = new FakeTransport().answer(START, 302, location);
            try {
                RedirectPolicy.open(START, KEY, 5, UPDATE_RULE, server);
                fail("Location " + location + " must fail");
            } catch (RedirectPolicy.RedirectRefused refused) {
                assertEquals(302, refused.status);
            }
            assertEquals(1, server.opened.size());
        }
    }

    @Test
    public void otherStatusesAreTheCallersToJudge() throws Exception {
        FakeTransport server = new FakeTransport().answer(START, 304, "https://cdn.example/x");
        FakeTransport.Reply reply = RedirectPolicy.open(START, KEY, 5, UPDATE_RULE, server);
        assertSame(server.replies.get(0), reply);
        assertEquals(1, server.opened.size());
    }

    @Test
    public void noKeyMeansNoKeyHeader() throws Exception {
        FakeTransport server = new FakeTransport().answer(START, 200, null);
        RedirectPolicy.open(START, null, 5, UPDATE_RULE, server);
        RedirectPolicy.open(START, "", 5, UPDATE_RULE, server);
        assertEquals(Arrays.asList(false, false), server.keyed);
    }

    @Test
    public void redirectStatuses() {
        for (int status : new int[] {301, 302, 303, 307, 308}) assertTrue(RedirectPolicy.isRedirect(status));
        for (int status : new int[] {200, 204, 300, 304, 305, 400, 404, 500}) assertFalse(RedirectPolicy.isRedirect(status));
    }

    @Test
    public void resolve() {
        assertEquals("https://node.example/b", RedirectPolicy.resolve("https://node.example/a", "/b"));
        assertEquals("https://cdn.example/x", RedirectPolicy.resolve("https://node.example/a", "//cdn.example/x"));
        assertEquals("http://127.0.0.1:12391/c", RedirectPolicy.resolve("http://127.0.0.1:12391/a/b", "../c"));
        assertEquals("https://my_node.local/b", RedirectPolicy.resolve("https://my_node.local/a", "/b"));
        assertNull(RedirectPolicy.resolve("https://node.example/a", null));
        assertNull(RedirectPolicy.resolve("https://node.example/a", "javascript:alert(1)"));
        assertNull(RedirectPolicy.resolve("not a url", "/b"));
    }

    @Test
    public void sendKey() {
        assertTrue(RedirectPolicy.sendKey(START, "https://node.example:12391/other", KEY));
        assertFalse(RedirectPolicy.sendKey(START, "https://node.example/other", KEY));
        assertFalse(RedirectPolicy.sendKey(START, START, null));
        assertFalse(RedirectPolicy.sendKey(START, START, ""));
    }
}
