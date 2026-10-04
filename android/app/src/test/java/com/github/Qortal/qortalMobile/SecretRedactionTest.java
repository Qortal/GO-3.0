package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SecretRedactionTest {
    @Test
    public void stripQueryDropsTheKey() {
        assertEquals(
            "http://192.168.1.20:12391/arbitrary/FILE/Qortino%20AI/qshare_file_x",
            SecretRedaction.stripQuery("http://192.168.1.20:12391/arbitrary/FILE/Qortino%20AI/qshare_file_x?apiKey=SECRET"));
        assertEquals(
            "https://node/a",
            SecretRedaction.stripQuery("https://node/a?async=true&apiKey=SECRET#frag"));
        assertEquals("https://node/a", SecretRedaction.stripQuery("https://node/a#apiKey=SECRET"));
        assertEquals("https://node/a", SecretRedaction.stripQuery("https://node/a"));
        assertEquals("", SecretRedaction.stripQuery(null));
    }

    @Test
    public void stripQueryDropsUserInfo() {
        assertEquals("https://node:443/a", SecretRedaction.stripQuery("https://user:pass@node:443/a?x=1"));
        assertEquals("https://node", SecretRedaction.stripQuery("https://user@node"));
    }

    @Test
    public void redactTextCleansUrlsAndKeyValues() {
        String message = "java.io.FileNotFoundException: http://10.0.0.2:12391/arbitrary/THUMBNAIL/bob/qortal_avatar?async=true&apiKey=SECRET";
        String out = SecretRedaction.redactText(message);
        assertFalse(out.contains("SECRET"));
        assertEquals("java.io.FileNotFoundException: http://10.0.0.2:12391/arbitrary/THUMBNAIL/bob/qortal_avatar", out);

        String loose = SecretRedaction.redactText("rejected apiKey=SECRET, X-API-KEY: SECRET2 password=hunter2");
        assertFalse(loose.contains("SECRET"));
        assertFalse(loose.contains("hunter2"));
        assertTrue(loose.contains("apiKey=<redacted>"));

        assertEquals("HTTP 404 from node", SecretRedaction.redactText("HTTP 404 from node"));
        assertEquals("", SecretRedaction.redactText(null));
    }

    @Test
    public void sameOrigin() {
        assertTrue(SecretRedaction.sameOrigin("http://node:12391/a?apiKey=x", "http://NODE:12391/b"));
        assertTrue(SecretRedaction.sameOrigin("https://node/a", "https://node:443/b"));
        assertFalse(SecretRedaction.sameOrigin("http://node:12391/a", "https://node:12391/a"));
        assertFalse(SecretRedaction.sameOrigin("http://node:12391/a", "http://node:12392/a"));
        assertFalse(SecretRedaction.sameOrigin("http://node/a", "http://evil/a"));
        assertFalse(SecretRedaction.sameOrigin("http://node/a", "/relative"));
        assertFalse(SecretRedaction.sameOrigin(null, "http://node/a"));
    }

    @Test
    public void sameOriginReadsHostsJavaNetUriDoesNot() {
        // An underscore or another script leaves java.net.URI without a host;
        // the key must still reach such a node, and only that node.
        assertTrue(SecretRedaction.sameOrigin("https://my_node.local:12391/a?apiKey=x", "https://MY_NODE.local:12391/b"));
        assertTrue(SecretRedaction.sameOrigin("https://my_node.local/a", "https://user@my_node.local:443/b"));
        assertTrue(SecretRedaction.sameOrigin("https://\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444/a", "https://\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444/b"));
        assertFalse(SecretRedaction.sameOrigin("https://my_node.local/a", "https://my_node.local:8443/a"));
        assertFalse(SecretRedaction.sameOrigin("https://my_node.local/a", "https://other_node.local/a"));
        assertFalse(SecretRedaction.sameOrigin("https://my_node.local/a", "http://my_node.local/a"));
        assertFalse(SecretRedaction.sameOrigin("https://my_node.local/a", "https://my_node.local:abc/a"));
    }
}
