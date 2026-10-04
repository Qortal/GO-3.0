package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UrlOriginTest {
    @Test
    public void hostsJavaNetUriReads() {
        UrlOrigin origin = UrlOrigin.parse("HTTPS://Node.Example:12391/a?apiKey=k");
        assertEquals("https", origin.scheme);
        assertEquals("node.example", origin.host);
        assertEquals(12391, origin.port);
        assertTrue(origin.strictHost);

        UrlOrigin ipv6 = UrlOrigin.parse("http://[::1]/x");
        assertEquals("::1", ipv6.host);
        assertEquals(80, ipv6.port);
        assertTrue(ipv6.strictHost);
    }

    @Test
    public void hostsReadFromTheRawAuthority() {
        UrlOrigin underscore = UrlOrigin.parse("https://user:pw@My_Node.local:8443/x");
        assertEquals("my_node.local", underscore.host);
        assertEquals(8443, underscore.port);
        assertFalse(underscore.strictHost);

        UrlOrigin idn = UrlOrigin.parse("https://пример.рф/x");
        assertEquals("пример.рф", idn.host);
        assertEquals(443, idn.port);
        assertFalse(idn.strictHost);

        // Not loopback to java.net.URI, so not "strict" either.
        assertFalse(UrlOrigin.parse("http://127.1/x").strictHost);
    }

    @Test
    public void junkHasNoOrigin() {
        assertNull(UrlOrigin.parse(null));
        assertNull(UrlOrigin.parse("/relative/path"));
        assertNull(UrlOrigin.parse("not a url"));
        assertNull(UrlOrigin.parse("https:///x"));
        assertNull(UrlOrigin.parse("https:x"));
        assertNull(UrlOrigin.parse("https://my_node.local:abc/x"));
        assertNull(UrlOrigin.parse("https://my_node.local:70000/x"));
        assertNull(UrlOrigin.parse("https://user@:443/x"));
    }

    @Test
    public void sameAs() {
        assertTrue(UrlOrigin.parse("https://node/a").sameAs(UrlOrigin.parse("https://NODE:443/b")));
        assertFalse(UrlOrigin.parse("https://node/a").sameAs(UrlOrigin.parse("http://node:443/b")));
        assertFalse(UrlOrigin.parse("https://node/a").sameAs(null));
    }
}
