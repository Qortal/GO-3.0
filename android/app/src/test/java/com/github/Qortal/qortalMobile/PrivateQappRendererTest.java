package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class PrivateQappRendererTest {
    private static final String ID = "8eTqYyGvDdPyprD1pJ1CbMr3eWwg3vN4VBuuwqsYtZd5";
    private static final String GO_POLICY = QappFramePolicy.contentSecurityPolicy("https", "ext-node.qortal.link", -1);

    private static PrivateQappArchive app(String... nameAndText) throws Exception {
        return PrivateQappArchive.unzip(PrivateQappArchiveTest.zip(nameAndText));
    }

    private static PrivateQappRenderer.Reply get(PrivateQappArchive app, String inPath) {
        return PrivateQappRenderer.render(app, ID, inPath, "dark", "de", GO_POLICY);
    }

    private static String body(PrivateQappRenderer.Reply reply) {
        return new String(reply.body, StandardCharsets.UTF_8);
    }

    @Test
    public void theIndexGetsCoresAdditionsInCoresOrder() throws Exception {
        PrivateQappArchive app = app(
            "index.html", "<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>",
            "app.js", "go()"
        );
        PrivateQappRenderer.Reply reply = get(app, "");
        assertEquals(200, reply.status);
        assertEquals("text/html", reply.mimeType);
        assertEquals("utf-8", reply.charset);
        String page = body(reply);
        String base = "/render/hash/" + ID;
        assertTrue(page.startsWith("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><base href=\"" + base + "/\"><script>"));
        assertTrue(page.contains("var _qdnContext=\"render\"; var _qdnTheme=\"dark\"; var _qdnLang=\"de\"; "
            + "var _qdnService=\"ARBITRARY_DATA\"; var _qdnName=\"" + ID + "\"; var _qdnIdentifier=\"default\"; "
            + "var _qdnPath=\"/\"; var _qdnBase=\"" + base + "\"; var _qdnBaseWithPath=\"" + base + "\";</script>"));
        assertTrue(page.contains("<script src=\"/apps/q-apps.js?time="));
        assertTrue(page.endsWith("<title>t</title></head><body>hi</body></html>"));
        // "/" and "" are the same page.
        assertEquals(200, get(app, "/").status);
    }

    @Test
    public void pagesCarryTheNodesPolicyAndGos() throws Exception {
        PrivateQappRenderer.Reply page = get(app("index.html", "<p>x</p>", "a.js", "x"), "/index.html");
        assertEquals(PrivateQappRenderer.NODE_PAGE_POLICY + ", " + GO_POLICY, page.headers.get("Content-Security-Policy"));
        assertEquals("no-store", page.headers.get("Cache-Control"));
        PrivateQappRenderer.Reply file = get(app("index.html", "<p>x</p>", "a.js", "x"), "/a.js");
        assertEquals(PrivateQappRenderer.NODE_FILE_POLICY + ", " + GO_POLICY, file.headers.get("content-security-policy"));
    }

    @Test
    public void otherFilesAreServedAsTheyAre() throws Exception {
        PrivateQappArchive app = app(
            "index.html", "<p>x</p>",
            "js/app.mjs", "export const a = 1;",
            "img/logo.svg", "<svg/>",
            "data.bin", "raw",
            "fonts/f.woff2", "w"
        );
        PrivateQappRenderer.Reply js = get(app, "/js/app.mjs");
        assertEquals(200, js.status);
        assertEquals("text/javascript", js.mimeType);
        assertEquals("utf-8", js.charset);
        assertEquals("export const a = 1;", body(js));
        assertEquals("image/svg+xml", get(app, "/img/logo.svg").mimeType);
        assertEquals("font/woff2", get(app, "/fonts/f.woff2").mimeType);
        assertNull(get(app, "/fonts/f.woff2").charset);
        PrivateQappRenderer.Reply unknown = get(app, "/data.bin");
        assertNull(unknown.mimeType);
        assertEquals("raw", body(unknown));
    }

    @Test
    public void aMissingFileIsA404WithNoIndexFallback() throws Exception {
        PrivateQappArchive app = app("index.html", "<p>x</p>", "a.js", "x");
        PrivateQappRenderer.Reply reply = get(app, "/settings/profile");
        assertEquals(404, reply.status);
        assertEquals("Not Found", reply.reason);
        assertEquals("Error 404: File Not Found", body(reply));
        assertTrue(reply.headers.get("Content-Security-Policy").startsWith("sandbox"));
    }

    @Test
    public void aFolderServesItsIndexWithItsOwnBase() throws Exception {
        PrivateQappArchive app = app(
            "index.html", "<html><head></head></html>",
            "docs/index.html", "<html><head></head><body>docs</body></html>",
            "docs/page.html", "<head></head>p"
        );
        String base = "/render/hash/" + ID;
        PrivateQappRenderer.Reply folder = get(app, "/docs");
        assertEquals(200, folder.status);
        String page = body(folder);
        assertTrue(page.contains("<base href=\"" + base + "/docs/\">"));
        assertTrue(page.contains("var _qdnPath=\"/docs/\""));
        assertTrue(page.contains("var _qdnBaseWithPath=\"" + base + "/docs\""));
        assertTrue(page.endsWith("<body>docs</body></html>"));
        assertTrue(body(get(app, "/docs/page.html")).contains("<base href=\"" + base + "/docs/\">"));
    }

    @Test
    public void aFolderIndexNeedsTheSameIndexAtTheRootAsInCore() throws Exception {
        // Core looks for the index name in the app's root, then serves it from the folder.
        PrivateQappArchive app = app("default.html", "<p>root</p>", "docs/index.html", "<p>docs</p>");
        assertEquals(404, get(app, "/docs/").status);
        assertEquals(200, get(app, "/").status);
        assertTrue(body(get(app, "/")).endsWith("<p>root</p>"));
    }

    @Test
    public void aOneFileAppServesThatFileEverywhere() throws Exception {
        PrivateQappArchive app = app("game.html", "<html><head></head>g</html>");
        PrivateQappRenderer.Reply anywhere = get(app, "/any/where.js");
        assertEquals(200, anywhere.status);
        assertEquals("text/html", anywhere.mimeType);
        String page = body(anywhere);
        assertTrue(page.contains("var _qdnPath=\"game.html\""));
        assertTrue(page.contains("<base href=\"/render/hash/" + ID + "/game.html/\">"));
    }

    @Test
    public void pagesWithoutAHeadStillGetTheTags() throws Exception {
        String withHtml = body(get(app("index.html", "<!doctype html><html lang=\"en\"><body>b</body></html>", "x.js", ""), "/"));
        assertTrue(withHtml.startsWith("<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\">"));
        String doctypeOnly = body(get(app("index.html", "<!DOCTYPE html><p>b</p>", "x.js", ""), "/"));
        assertTrue(doctypeOnly.startsWith("<!DOCTYPE html><head><meta charset=\"UTF-8\">"));
        String bare = body(get(app("index.html", "<p>b</p>", "x.js", ""), "/"));
        assertTrue(bare.startsWith("<head><meta charset=\"UTF-8\">"));
        assertTrue(bare.endsWith("</head><p>b</p>"));
        // <header> is not <head>
        String header = body(get(app("index.html", "<header>h</header>", "x.js", ""), "/"));
        assertTrue(header.startsWith("<head>"));
    }

    @Test
    public void addressValuesCannotBreakOutOfTheScript() throws Exception {
        PrivateQappArchive app = app("index.html", "<head></head>", "x.js", "");
        String page = body(PrivateQappRenderer.render(app, ID, "/", "</script><script>alert(1)</script>", "en\"", GO_POLICY));
        assertFalse(page.contains("alert(1)"));
        assertTrue(page.contains("var _qdnTheme=\"light\""));
        assertTrue(page.contains("var _qdnLang=\"en\""));
        assertEquals("\"\\u003c/script\\u003e \\\"q\\\" \\\\ \\u2028\"", PrivateQappRenderer.jsString("</script> \"q\" \\ \u2028"));
    }

    @Test
    public void oddFolderNamesStayInsideTheBaseAttribute() throws Exception {
        PrivateQappArchive app = app("index.html", "<head></head>", "a b\"<x>/index.html", "<head></head>");
        String page = body(get(app, "/a b\"<x>/"));
        assertTrue(page.contains("<base href=\"/render/hash/" + ID + "/a%20b%22%3Cx%3E/\">"));
        assertTrue(page.contains("var _qdnPath=\"/a b\\\"\\u003cx\\u003e/\""));
    }

    @Test
    public void dotSegmentsNeverLeaveTheApp() throws Exception {
        PrivateQappArchive app = app("index.html", "<p>x</p>", "a.js", "x");
        assertEquals(404, get(app, "/../a.js").status);
        assertEquals(200, get(app, "/./a.js").status);
        assertEquals(200, get(app, "//a.js").status);
    }
}
