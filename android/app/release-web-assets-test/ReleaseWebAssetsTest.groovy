/*
 * Tests for ../release-web-assets.gradle (GO-40: release APKs without source
 * maps and debug pages). Run with ./run.sh: it compiles this file with the
 * Groovy and JUnit that ship inside the Gradle 8.13 distribution, plus the
 * AGP API jar the project builds with, and runs JUnit. No Gradle build runs.
 *
 * The script itself is compiled here exactly as written: its policy class is
 * tested on fixture trees and on the synced bundle in src/main/assets, its
 * APK check on fixture zips, its AGP wiring (the assets transform and the
 * APK check that gates assemble/install) is run against fakes with the same
 * overloads as AGP, and the calls it makes are checked by reflection against
 * the real AGP and Gradle APIs. check-apk.sh is run on fixture zips too.
 */

import com.android.build.api.artifact.Artifact
import com.android.build.api.artifact.ArtifactKind
import com.android.build.api.artifact.SingleArtifact
import kotlin.jvm.functions.Function1
import org.codehaus.groovy.runtime.InvokerHelper
import org.gradle.api.Action
import org.gradle.api.DefaultTask
import org.gradle.api.DomainObjectCollection
import org.gradle.api.Task
import org.gradle.api.file.Directory
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.provider.Provider
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import org.gradle.api.tasks.TaskContainer
import org.gradle.api.tasks.TaskProvider
import org.junit.Assume
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

import java.lang.reflect.Modifier

import static org.junit.Assert.assertEquals
import static org.junit.Assert.assertFalse
import static org.junit.Assert.assertNotNull
import static org.junit.Assert.assertSame
import static org.junit.Assert.assertTrue
import static org.junit.Assert.fail

class ReleaseWebAssetsTest {
    static Class scriptClass
    static Class policy
    static Class taskClass
    static Class verifyTaskClass

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder()

    @BeforeClass
    static void compileScript() {
        File script = new File(System.getProperty('releaseWebAssets.script', '../release-web-assets.gradle'))
        assertTrue("script not found: $script", script.isFile())
        GroovyClassLoader loader = new GroovyClassLoader(ReleaseWebAssetsTest.classLoader)
        scriptClass = loader.parseClass(script)
        policy = loader.loadClass('ReleaseWebAssets')
        taskClass = loader.loadClass('StripReleaseWebAssetsTask')
        verifyTaskClass = loader.loadClass('VerifyReleaseApkWebAssetsTask')
    }

    // ---- fixtures -------------------------------------------------------

    static final String INDEX = '''<!doctype html>
<html lang="en">
  <head>
    <link rel="icon" type="image/x-icon" href="./favicon.ico" />
    <script type="module" crossorigin src="./assets/main-AAA.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/groupCallTopology-GGG.js">
    <link rel="modulepreload" crossorigin href="./assets/index-BBB.js">
    <link rel="stylesheet" crossorigin href="./assets/index-CCC.css">
  </head>
  <body><img src="qortal.png" /><div id="root"></div></body>
</html>'''

    static final String QORTINO_DEBUG = '''<!doctype html>
<html lang="en">
  <head>
    <title>Qortino PC Debug</title>
    <script type="module" crossorigin src="./assets/qortinoDebug-DDD.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/index-BBB.js">
    <link rel="modulepreload" crossorigin href="./assets/QortinoAgentChat-QQQ.js">
    <link rel="stylesheet" crossorigin href="./assets/index-CCC.css">
  </head>
  <body><div id="root"></div></body>
</html>'''

    static final String AUDIO_SURFACE = '''<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Qortal Hub Audio Surface</title>
    <script type="module" crossorigin src="./assets/audioSurface-EEE.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/groupCallTopology-GGG.js">
  </head>
  <body></body>
</html>'''

    /** Shaped like the merged release assets: Capacitor files, Chaquopy, public/. */
    static Map<String, String> bundle() {
        [
                'capacitor.config.json'                       : '{"appId":"com.example"}',
                'capacitor.plugins.json'                      : '[]',
                'native-bridge.js'                            : 'var nativeBridge = {};',
                'chaquopy/app.imy'                            : 'zip bytes',
                'chaquopy/build.json'                         : '{"assets":{}}',
                'chaquopy/notes.map'                          : 'not part of the web bundle',
                'public/index.html'                           : INDEX,
                'public/favicon.ico'                          : 'ico',
                'public/qortal.png'                           : 'png',
                'public/qort-coin-blue.png'                   : 'png',
                'public/qortino-debug.html'                   : QORTINO_DEBUG,
                'public/audio-surface.html'                   : AUDIO_SURFACE,
                'public/assets/main-AAA.js'                   :
                        'import "./index-BBB.js";\n//# sourceMappingURL=main-AAA.js.map',
                'public/assets/main-AAA.js.map'               : '{"sources":["../../src/main.tsx"]}',
                'public/assets/index-BBB.js'                  :
                        'const deps=["assets/QortinoAgentChat-QQQ.js","assets/recorder.worker-WWW.js"];\n' +
                        '//# sourceMappingURL=index-BBB.js.map',
                'public/assets/index-BBB.js.map'              : '{"sources":["../../src/App.tsx"]}',
                'public/assets/index-CCC.css'                 : 'body{margin:0}',
                'public/assets/index-CCC.css.map'             : '{}',
                'public/assets/groupCallTopology-GGG.js'      : 'export const t = 1;',
                // Names the debug page (a pathname check), never its chunk.
                'public/assets/QortinoAgentChat-QQQ.js'       :
                        'if (location.pathname.endsWith("qortino-debug.html")) {}',
                'public/assets/qortinoDebug-DDD.js'           :
                        'import "./index-BBB.js";\n//# sourceMappingURL=qortinoDebug-DDD.js.map',
                'public/assets/qortinoDebug-DDD.js.map'       : '{"sources":["../../src/qortinoDebugMain.tsx"]}',
                'public/assets/audioSurface-EEE.js'           :
                        'import "./groupCallTopology-GGG.js";\n//# sourceMappingURL=audioSurface-EEE.js.map',
                'public/assets/audioSurface-EEE.js.map'       : '{}',
                'public/assets/recorder.worker-WWW.js'        : 'self.onmessage = () => {};',
                'public/assets/recorder.worker-WWW.js.map'    : '{}',
                'public/pdfjs/build/pdf.mjs'                  : 'export const version = "4";',
                'public/pdfjs/build/pdf.worker.mjs'           : 'export {};',
                'public/pdfjs/build/pdf.sandbox.mjs'          : 'export const QuickJSSandbox = () => {};',
                'public/pdfjs/web/viewer.html'                : '<html><script src="viewer.mjs"></script></html>',
                'public/pdfjs/web/viewer.mjs'                 :
                        'const o = {sandboxBundleSrc: "../build/pdf.sandbox.mjs"};',
                'public/pdfjs/web/debugger.mjs'               : 'export {};',
                'public/pdfjs/web/standard_fonts/FoxitSerif.pfb': 'font',
                'public/worklets/capture-processor.js'        : 'registerProcessor("capture", class {});',
        ]
    }

    static final Set<String> BUNDLE_REMOVALS = [
            'public/assets/main-AAA.js.map',
            'public/assets/index-BBB.js.map',
            'public/assets/index-CCC.css.map',
            'public/assets/qortinoDebug-DDD.js.map',
            'public/assets/audioSurface-EEE.js.map',
            'public/assets/recorder.worker-WWW.js.map',
            'public/qortino-debug.html',
            'public/audio-surface.html',
            'public/assets/qortinoDebug-DDD.js',
            'public/assets/audioSurface-EEE.js',
            'public/pdfjs/web/viewer.html',
            'public/pdfjs/web/viewer.mjs',
            'public/pdfjs/web/debugger.mjs',
            'public/pdfjs/web/standard_fonts/FoxitSerif.pfb',
            'public/pdfjs/build/pdf.sandbox.mjs',
            'public/qort-coin-blue.png',
    ] as TreeSet

    File tree(Map<String, String> files) {
        File root = tmp.newFolder()
        files.each { String rel, String text ->
            File f = new File(root, rel)
            f.parentFile.mkdirs()
            f.setText(text, 'UTF-8')
        }
        root
    }

    Set<String> plan(Map<String, String> files) {
        policy.planRemovals(tree(files)) as TreeSet
    }

    // ---- what is left out -----------------------------------------------

    @Test
    void leavesOutMapsDebugPagesTheirEntryChunksThePdfViewerAndTheSandbox() {
        assertEquals(BUNDLE_REMOVALS, plan(bundle()))
    }

    @Test
    void keepsTheMainAppTheWorkersPdfJsBuildAndNonWebAssets() {
        Set<String> removed = plan(bundle())
        [
                'public/index.html', 'public/favicon.ico', 'public/qortal.png',
                'public/assets/main-AAA.js', 'public/assets/index-BBB.js',
                'public/assets/index-CCC.css', 'public/assets/groupCallTopology-GGG.js',
                'public/assets/QortinoAgentChat-QQQ.js', 'public/assets/recorder.worker-WWW.js',
                'public/pdfjs/build/pdf.mjs', 'public/pdfjs/build/pdf.worker.mjs',
                'public/worklets/capture-processor.js',
                'capacitor.config.json', 'capacitor.plugins.json', 'native-bridge.js',
                'chaquopy/app.imy', 'chaquopy/build.json',
        ].each { assertFalse("must ship: $it", removed.contains(it)) }
    }

    @Test
    void touchesNothingOutsideTheWebBundle() {
        Set<String> removed = plan(bundle())
        assertFalse(removed.contains('chaquopy/notes.map'))
        assertTrue(removed.every { it.startsWith('public/') })
    }

    @Test
    void keepsADebugEntryChunkTheMainAppImports() {
        Map<String, String> files = bundle()
        files['public/assets/main-AAA.js'] =
                'import "./index-BBB.js"; const a = () => import("./audioSurface-EEE.js");'
        Set<String> removed = plan(files)
        assertFalse(removed.contains('public/assets/audioSurface-EEE.js'))
        assertTrue(removed.contains('public/assets/audioSurface-EEE.js.map'))
        assertTrue(removed.contains('public/audio-surface.html'))
        assertTrue(removed.contains('public/assets/qortinoDebug-DDD.js'))
    }

    @Test
    void keepsADebugEntryChunkNamedInAPreloadListOrWorkerUrl() {
        Map<String, String> files = bundle()
        files['public/assets/index-BBB.js'] =
                'const deps=["assets/qortinoDebug-DDD.js"];' +
                'new Worker(new URL("/assets/audioSurface-EEE.js", import.meta.url));'
        Set<String> removed = plan(files)
        assertFalse(removed.contains('public/assets/qortinoDebug-DDD.js'))
        assertFalse(removed.contains('public/assets/audioSurface-EEE.js'))
    }

    @Test
    void dropsAnEntryChunkNamedOnlyByAnotherDroppedOne() {
        Map<String, String> files = bundle()
        files['public/assets/qortinoDebug-DDD.js'] = 'import "./audioSurface-EEE.js";'
        Set<String> removed = plan(files)
        assertTrue(removed.contains('public/assets/qortinoDebug-DDD.js'))
        assertTrue(removed.contains('public/assets/audioSurface-EEE.js'))
    }

    @Test
    void keepsAnEntryChunkNamedByAnotherEntryChunkThatShips() {
        Map<String, String> files = bundle()
        files['public/assets/qortinoDebug-DDD.js'] = 'import "./audioSurface-EEE.js";'
        files['public/assets/main-AAA.js'] = 'import("./qortinoDebug-DDD.js");'
        Set<String> removed = plan(files)
        assertFalse(removed.contains('public/assets/qortinoDebug-DDD.js'))
        assertFalse(removed.contains('public/assets/audioSurface-EEE.js'))
    }

    @Test
    void neverDropsAScriptThatIndexHtmlAlsoRuns() {
        Map<String, String> files = bundle()
        files['public/qortino-debug.html'] =
                '<script type="module" src="./assets/main-AAA.js"></script>'
        Set<String> removed = plan(files)
        assertFalse(removed.contains('public/assets/main-AAA.js'))
    }

    @Test
    void doesNothingWithoutAWebBundle() {
        assertEquals([] as TreeSet, plan(['chaquopy/app.imy': 'zip', 'capacitor.config.json': '{}']))
        assertEquals([] as TreeSet, policy.planRemovals(new File(tmp.root, 'missing')) as TreeSet)
    }

    @Test
    void handlesABundleWithoutTheDebugPages() {
        Map<String, String> files = bundle()
        files.remove('public/qortino-debug.html')
        files.remove('public/audio-surface.html')
        Set<String> removed = plan(files)
        assertFalse(removed.contains('public/assets/qortinoDebug-DDD.js'))
        assertTrue(removed.contains('public/assets/qortinoDebug-DDD.js.map'))
    }

    // ---- HTML parsing ------------------------------------------------------

    @Test
    void readsTheScriptsAPageRuns() {
        String html = '''
            <script type="module" crossorigin src="./assets/a-1.js"></script>
            <SCRIPT SRC='/assets/b-2.mjs' type=module></SCRIPT>
            <script src="assets/c-3.js?v=1#x"></script>
            <script>inline()</script>
            <script src="https://cdn.example/x.js"></script>
            <script src="//cdn.example/y.js"></script>
            <script src="../outside.js"></script>
            <script src="data:text/javascript,alert(1)"></script>
            <link rel="modulepreload" href="./assets/preload-4.js">
            <script src="./assets/style.css"></script>
        '''
        assertEquals(['assets/a-1.js', 'assets/b-2.mjs', 'assets/c-3.js'], policy.pageScripts(html))
    }

    @Test
    void readsEveryLocalFileAPageNames() {
        assertEquals(
                ['favicon.ico', 'assets/main-AAA.js', 'assets/groupCallTopology-GGG.js',
                 'assets/index-BBB.js', 'assets/index-CCC.css', 'qortal.png'],
                policy.pageReferences(INDEX))
    }

    @Test
    void mapsPageUrlsToWebRootPaths() {
        assertEquals('assets/a.js', policy.localWebPath('./assets/a.js'))
        assertEquals('assets/a.js', policy.localWebPath('/assets/a.js'))
        assertEquals('assets/a.js', policy.localWebPath(' assets/a.js '))
        assertEquals('a.js', policy.localWebPath('././a.js'))
        assertEquals(null, policy.localWebPath('http://localhost/assets/a.js'))
        assertEquals(null, policy.localWebPath('//host/a.js'))
        assertEquals(null, policy.localWebPath('../a.js'))
        assertEquals(null, policy.localWebPath(''))
        assertEquals(null, policy.localWebPath('#top'))
        assertEquals(null, policy.localWebPath(null))
    }

    // ---- copy and self-check -----------------------------------------------

    @Test
    void copyLeavesOutThePlanAndCopiesEverythingElseByteForByte() {
        File from = tree(bundle())
        File into = tmp.newFolder()
        new File(into, 'stale/old.js.map').with { parentFile.mkdirs(); text = 'stale' }

        List<String> removed = policy.copyStripped(from, into)

        assertEquals(BUNDLE_REMOVALS, removed as TreeSet)
        List<String> expected = policy.listFiles(from).findAll { !BUNDLE_REMOVALS.contains(it) }
        assertEquals(expected, policy.listFiles(into))
        expected.each { String rel ->
            assertTrue(rel, Arrays.equals(new File(from, rel).bytes, new File(into, rel).bytes))
        }
        assertFalse(new File(into, 'stale').exists())
        assertFalse(new File(into, 'public/pdfjs/web').exists())
    }

    @Test
    void copyCreatesTheOutputFolder() {
        File from = tree(bundle())
        File into = new File(tmp.root, 'not/yet/there')
        policy.copyStripped(from, into)
        assertTrue(new File(into, 'public/index.html').isFile())
    }

    @Test
    void refusesAnOutputThatOverlapsTheInput() {
        File from = tree(bundle())
        [from, new File(from, 'public/out'), from.parentFile].each { File into ->
            try {
                policy.copyStripped(from, into)
                fail("accepted $into")
            } catch (IllegalArgumentException expected) {
                assertTrue(expected.message.contains('overlaps'))
            }
        }
        assertTrue(new File(from, 'public/index.html').isFile())
        assertTrue(new File(from, 'public/assets/main-AAA.js.map').isFile())
    }

    @Test
    void checkFailsWhenAChunkIndexHtmlLoadsIsMissing() {
        File from = tree(bundle())
        File into = tmp.newFolder()
        List<String> removed = policy.copyStripped(from, into)
        assertTrue(new File(into, 'public/assets/index-BBB.js').delete())
        String message = verifyFailure(from, into, removed as Set)
        assertTrue(message, message.contains('index.html loads assets/index-BBB.js'))
        assertTrue(message, message.contains('missing: public/assets/index-BBB.js'))
    }

    @Test
    void checkFailsWhenIndexHtmlIsMissing() {
        File from = tree(bundle())
        File into = tmp.newFolder()
        List<String> removed = policy.copyStripped(from, into)
        assertTrue(new File(into, 'public/index.html').delete())
        assertTrue(verifyFailure(from, into, removed as Set).contains('missing: public/index.html'))
    }

    @Test
    void checkFailsWhenAMapOrDebugPageIsStillPackaged() {
        File from = tree(bundle())
        File into = tmp.newFolder()
        List<String> removed = policy.copyStripped(from, into)
        new File(into, 'public/assets/extra.js.map').text = '{}'
        new File(into, 'public/audio-surface.html').text = '<html></html>'
        new File(into, 'public/pdfjs/build/pdf.sandbox.mjs').text = 'export {};'
        String message = verifyFailure(from, into, removed as Set)
        assertTrue(message, message.contains('source map still packaged: public/assets/extra.js.map'))
        assertTrue(message, message.contains('debug page still packaged: public/audio-surface.html'))
        assertTrue(message, message.contains(
                'unused file still packaged: public/pdfjs/build/pdf.sandbox.mjs'))
    }

    @Test
    void checkFailsWhenACopyIsTruncated() {
        File from = tree(bundle())
        File into = tmp.newFolder()
        List<String> removed = policy.copyStripped(from, into)
        new File(into, 'public/assets/main-AAA.js').text = ''
        assertTrue(verifyFailure(from, into, removed as Set)
                .contains('copied with a different size: public/assets/main-AAA.js'))
    }

    @Test
    void describesWhatWasLeftOut() {
        File from = tree(bundle())
        String line = policy.describe(from, policy.planRemovals(from))
        assertEquals('left out 6 source maps (0.0 MB), 2 debug pages, 2 debug entry chunks, ' +
                '4 pdf.js viewer files, 2 unused files', line)
    }

    static String verifyFailure(File from, File into, Set<String> removed) {
        try {
            policy.verify(from, into, removed)
        } catch (IllegalStateException e) {
            return e.message
        }
        fail('verify should have failed')
        null
    }

    // ---- links into pdfjs/web, which only the release APK lacks --------------

    String copyFailure(Map<String, String> files) {
        try {
            policy.copyStripped(tree(files), tmp.newFolder())
        } catch (IllegalStateException e) {
            return e.message
        }
        fail('copyStripped should have failed')
        null
    }

    @Test
    void checkFailsWhenAShippedFileLoadsPdfJsDataFromTheViewerFolder() {
        Map<String, String> files = bundle()
        files['public/assets/QortinoAgentChat-QQQ.js'] =
                'getDocument({url, standardFontDataUrl: base + "/../web/standard_fonts/"})'
        files['public/assets/index-BBB.js'] = 'const c = {cMapUrl: "../web/cmaps/", cMapPacked: true};'
        files['public/assets/index-CCC.css'] = '@font-face{src:url(../pdfjs/web/images/x.svg)}'
        String message = copyFailure(files)
        assertTrue(message, message.contains(
                "public/assets/QortinoAgentChat-QQQ.js names 'web/standard_fonts'"))
        assertTrue(message, message.contains("public/assets/index-BBB.js names 'web/cmaps'"))
        assertTrue(message, message.contains("public/assets/index-CCC.css names 'pdfjs/web/'"))
    }

    @Test
    void checkFailsWhenIndexHtmlLinksToThePdfViewer() {
        Map<String, String> files = bundle()
        files['public/index.html'] = INDEX.replace(
                '<div id="root">', '<a href="./pdfjs/web/viewer.html">pdf</a><div id="root">')
        assertTrue(copyFailure(files).contains("public/index.html names 'pdfjs/web/'"))
    }

    @Test
    void theViewerItselfAndTheDroppedMapsMayNameTheirFolder() {
        Map<String, String> files = bundle()
        files['public/pdfjs/web/viewer.mjs'] = 'const o = {cMapUrl: "../web/cmaps/"};'
        files['public/assets/main-AAA.js.map'] = '{"sourcesContent":["../web/standard_fonts/"]}'
        files['chaquopy/build.json'] = '{"note":"pdfjs/web/"}'
        policy.copyStripped(tree(files), tmp.newFolder())
    }

    @Test
    void linksIntoPdfjsWebAreOnlyCheckedWhenTheFolderIsLeftOut() {
        Map<String, String> files = bundle()
        files.keySet().removeAll { it.startsWith('public/pdfjs/web/') }
        files['public/assets/index-BBB.js'] = 'const c = {cMapUrl: "../web/cmaps/"};'
        policy.copyStripped(tree(files), tmp.newFolder())
    }

    // ---- pdf.sandbox.mjs, which only the release APK lacks ---------------------

    @Test
    void checkFailsWhenAShippedFileNamesTheSandbox() {
        Map<String, String> files = bundle()
        files['public/pdfjs/build/pdf.mjs'] =
                'const s = await import(base + "/pdf.sandbox.mjs");'
        files['public/assets/index-BBB.js'] =
                'getViewer({sandboxBundleSrc: "./pdfjs/build/pdf.sandbox.mjs"})'
        String message = copyFailure(files)
        assertTrue(message, message.contains(
                "public/pdfjs/build/pdf.mjs names 'pdf.sandbox.mjs'"))
        assertTrue(message, message.contains(
                "public/assets/index-BBB.js names 'pdf.sandbox.mjs'"))
    }

    @Test
    void theViewerAndTheDroppedMapsMayNameTheSandbox() {
        Map<String, String> files = bundle()
        files['public/assets/main-AAA.js.map'] = '{"sourcesContent":["pdf.sandbox.mjs"]}'
        File into = tmp.newFolder()
        List<String> removed = policy.copyStripped(tree(files), into)
        assertTrue(removed.contains('public/pdfjs/build/pdf.sandbox.mjs'))
        assertFalse(new File(into, 'public/pdfjs/build/pdf.sandbox.mjs').exists())
        assertTrue(new File(into, 'public/pdfjs/build/pdf.mjs').isFile())
        assertTrue(new File(into, 'public/pdfjs/build/pdf.worker.mjs').isFile())
    }

    @Test
    void checkFailsWhenAShippedFileNamesTheCoinPicture() {
        Map<String, String> files = bundle()
        files['public/assets/index-CCC.css'] = '.coin{background:url(/qort-coin-blue.png)}'
        assertTrue(copyFailure(files).contains(
                "public/assets/index-CCC.css names 'qort-coin-blue.png'"))
    }

    // ---- the packaged APK -----------------------------------------------------

    File zip(Map<String, String> entries) {
        File out = new File(tmp.newFolder(), 'app-release.apk')
        new java.util.zip.ZipOutputStream(new FileOutputStream(out)).withCloseable { zos ->
            entries.each { String name, String text ->
                zos.putNextEntry(new java.util.zip.ZipEntry(name))
                zos.write(text.getBytes('UTF-8'))
                zos.closeEntry()
            }
        }
        out
    }

    /** An APK's entries for a merged-assets tree, plus the non-asset parts. */
    static Map<String, String> apkOf(Map<String, String> assets) {
        Map<String, String> entries = [
                'AndroidManifest.xml': 'manifest',
                'classes.dex'        : 'dex',
                'res/raw/x.map'      : 'not an asset',
                'lib/arm64-v8a/libpython.so': 'so',
        ]
        assets.each { String rel, String text -> entries['assets/' + rel] = text }
        entries
    }

    static Map<String, String> filesOf(File root) {
        policy.listFiles(root).collectEntries { [(it): new File(root, it).getText('UTF-8')] }
    }

    @Test
    void apkCheckPassesTheApkOfAStrippedBundle() {
        File from = tree(bundle())
        File into = tmp.newFolder()
        policy.copyStripped(from, into)
        File apk = zip(apkOf(filesOf(into)))
        assertEquals([], policy.apkProblems(apk))
        policy.verifyPackages([apk], apk.parentFile)
    }

    @Test
    void apkCheckFailsTheApkOfAnUnstrippedBundle() {
        File apk = zip(apkOf(bundle()))
        List<String> problems = policy.apkProblems(apk)
        assertTrue(problems.toString(), problems.contains(
                'app-release.apk: source map packaged: assets/public/assets/main-AAA.js.map'))
        assertTrue(problems.toString(), problems.contains(
                'app-release.apk: debug page packaged: assets/public/qortino-debug.html'))
        assertTrue(problems.toString(), problems.contains(
                'app-release.apk: debug page packaged: assets/public/pdfjs/web/viewer.html'))
        assertTrue(problems.toString(), problems.contains(
                'app-release.apk: unused file packaged: assets/public/pdfjs/build/pdf.sandbox.mjs'))
        assertTrue(problems.toString(), problems.contains(
                'app-release.apk: unused file packaged: assets/public/qort-coin-blue.png'))
        // 6 maps, 2 pages, 4 pdf.js viewer files, 2 unused files;
        // chaquopy/notes.map and res/raw/x.map are not web assets.
        assertEquals(14, problems.size())
        try {
            policy.verifyPackages([apk], apk.parentFile)
            fail('an unstripped APK passed')
        } catch (IllegalStateException e) {
            assertTrue(e.message, e.message.contains('no longer reaches packaging'))
            assertTrue(e.message, e.message.contains('assets/public/assets/index-BBB.js.map'))
        }
    }

    @Test
    void apkCheckFailsWithoutIndexHtml() {
        Map<String, String> entries = apkOf(['public/assets/main-AAA.js': 'x'])
        assertEquals(['app-release.apk: missing: assets/public/index.html'],
                policy.apkProblems(zip(entries)))
    }

    @Test
    void apkCheckFailsWhenThereIsNoApk() {
        File folder = tmp.newFolder()
        try {
            policy.verifyPackages([], folder)
            fail('passed without an APK')
        } catch (IllegalStateException e) {
            assertTrue(e.message.contains('No APK to check'))
        }
    }

    @Test
    void apkCheckListsAtMostTwentyProblems() {
        Map<String, String> assets = ['public/index.html': INDEX]
        (1..30).each { assets["public/assets/c$it-X.js.map".toString()] = '{}' }
        File apk = zip(apkOf(assets))
        try {
            policy.verifyPackages([apk], apk.parentFile)
            fail('passed with 30 maps')
        } catch (IllegalStateException e) {
            assertEquals(20, e.message.count('source map packaged'))
            assertTrue(e.message, e.message.endsWith('... and 10 more'))
        }
    }

    @Test
    void apkFilesComeFromTheMetadataListOrElseFromTheFolder() {
        File folder = tmp.newFolder()
        File b = new File(folder, 'b.apk')
        File a = new File(folder, 'a.apk')
        [b, a].each { it.text = 'x' }
        new File(folder, 'output-metadata.json').text = '{}'
        new File(folder, 'notes.txt').text = 'x'
        new File(folder, 'dir.apk').mkdirs()
        assertEquals([b], policy.apkFiles([b.absolutePath], folder))
        assertEquals([b], policy.apkFiles(['b.apk'], folder))
        assertEquals([a, b], policy.apkFiles([], folder))
        assertEquals([], policy.apkFiles([], new File(folder, 'missing')))
    }

    // ---- Gradle / AGP wiring -----------------------------------------------

    /** Runs the script against the fakes and hands it one release variant. */
    static Map runScript() {
        def components = new FakeComponents()
        def tasks = new FakeTasks()
        Script script = InvokerHelper.createScript(
                scriptClass, new Binding([androidComponents: components, tasks: tasks]))
        script.run()
        def variant = new FakeVariant()
        if (components.action != null) components.action.execute(variant)
        [components: components, tasks: tasks, variant: variant]
    }

    @Test
    void registersAReleaseOnlyTransformOfTheMergedAssets() {
        Map run = runScript()
        FakeComponents components = run.components
        FakeTasks tasks = run.tasks
        FakeVariant variant = run.variant

        assertEquals('release', components.selected.buildType)
        assertEquals(0, components.function1Calls)
        assertNotNull(components.action)

        FakeRegistration strip = tasks.registered['stripReleaseWebAssets']
        assertNotNull(tasks.registered.keySet().toString(), strip)
        assertSame(taskClass, strip.type)
        FakeOperation op = variant.artifacts.op
        assertSame(strip.provider, op.used)
        assertSame(SingleArtifact.ASSETS.INSTANCE, op.target)
        def task = new Expando(inputDir: 'merged assets', outputDir: 'stripped assets')
        assertEquals('merged assets', op.input.invoke(task))
        assertEquals('stripped assets', op.output.invoke(task))
    }

    @Test
    void registersAnApkCheckThatGatesAssembleAndInstall() {
        Map run = runScript()
        FakeTasks tasks = run.tasks
        FakeVariant variant = run.variant

        FakeRegistration verify = tasks.registered['verifyReleaseApkWebAssets']
        assertNotNull(tasks.registered.keySet().toString(), verify)
        assertSame(verifyTaskClass, verify.type)
        assertNotNull(verify.configure)
        def task = new FakeVerifyTask()
        verify.configure.execute(task)
        assertSame(SingleArtifact.APK.INSTANCE, variant.artifacts.requested)
        assertSame(variant.artifacts.apkProvider, task.apkFolder.value)
        assertSame(variant.artifacts.builtArtifactsLoader, task.builtArtifactsLoader.value)

        assertEquals(1, tasks.configureEachActions.size())
        Map<String, FakeTask> all = ['assembleRelease', 'installRelease', 'assembleDebug',
                                     'installDebug', 'bundleRelease', 'packageRelease']
                .collectEntries { [(it): new FakeTask(name: it)] }
        all.values().each { tasks.configureEachActions[0].execute(it) }
        assertEquals([verify.provider], all.assembleRelease.dependencies)
        assertEquals([verify.provider], all.installRelease.dependencies)
        ['assembleDebug', 'installDebug', 'bundleRelease', 'packageRelease'].each {
            assertEquals(it, [], all[it].dependencies)
        }
    }

    @Test
    void taskIsAnAbstractGradleTaskWithAnnotatedDirectories() {
        assertTrue(DefaultTask.isAssignableFrom(taskClass))
        assertTrue(Modifier.isAbstract(taskClass.modifiers))
        assertNotNull(taskClass.getMethod('getInputDir').getAnnotation(InputDirectory))
        assertNotNull(taskClass.getMethod('getOutputDir').getAnnotation(OutputDirectory))
        assertNotNull(taskClass.getMethod('strip').getAnnotation(TaskAction))
    }

    @Test
    void apkCheckTaskIsAnAbstractGradleTaskWithAnnotatedInputs() {
        assertTrue(DefaultTask.isAssignableFrom(verifyTaskClass))
        assertTrue(Modifier.isAbstract(verifyTaskClass.modifiers))
        assertNotNull(verifyTaskClass.getMethod('getApkFolder').getAnnotation(InputFiles))
        assertTrue(DirectoryProperty.isAssignableFrom(verifyTaskClass.getMethod('getApkFolder').returnType))
        assertNotNull(verifyTaskClass.getMethod('getBuiltArtifactsLoader').getAnnotation(Internal))
        assertTrue(Property.isAssignableFrom(verifyTaskClass.getMethod('getBuiltArtifactsLoader').returnType))
        assertNotNull(verifyTaskClass.getMethod('verifyApk').getAnnotation(TaskAction))
    }

    /** The real AGP API (the version android/build.gradle uses) has every call the script makes. */
    @Test
    void agpApiHasEveryCallTheScriptMakes() {
        Class ext = Class.forName('com.android.build.api.variant.AndroidComponentsExtension')
        Class selector = Class.forName('com.android.build.api.variant.VariantSelector')
        assertNotNull(ext.getMethod('selector'))
        assertNotNull(ext.getMethod('onVariants', selector, Action))
        assertNotNull(ext.getMethod('onVariants', selector, Function1))
        assertNotNull(selector.getMethod('withBuildType', String))
        Class variant = Class.forName('com.android.build.api.variant.Variant')
        assertNotNull(variant.getMethod('getName'))
        assertNotNull(variant.getMethod('getArtifacts'))
        Class artifacts = Class.forName('com.android.build.api.artifact.Artifacts')
        assertNotNull(artifacts.getMethod('use', TaskProvider))
        Class operation = Class.forName('com.android.build.api.artifact.TaskBasedOperation')
        assertNotNull(operation.getMethod('wiredWithDirectories', Function1, Function1))
        Class request = Class.forName('com.android.build.api.artifact.InAndOutDirectoryOperationRequest')
        assertNotNull(request.getMethod('toTransform', Artifact.Single))
        def assets = SingleArtifact.ASSETS.INSTANCE
        assertTrue(assets instanceof Artifact.Transformable)
        assertSame(ArtifactKind.DIRECTORY.INSTANCE, assets.kind)

        // The APK check.
        assertNotNull(artifacts.getMethod('get', SingleArtifact))
        Class loader = Class.forName('com.android.build.api.variant.BuiltArtifactsLoader')
        assertSame(loader, artifacts.getMethod('getBuiltArtifactsLoader').returnType)
        assertNotNull(loader.getMethod('load', Directory))
        Class built = Class.forName('com.android.build.api.variant.BuiltArtifacts')
        assertNotNull(built.getMethod('getElements'))
        Class element = Class.forName('com.android.build.api.variant.BuiltArtifact')
        assertSame(String, element.getMethod('getOutputFile').returnType)
        assertSame(ArtifactKind.DIRECTORY.INSTANCE, SingleArtifact.APK.INSTANCE.kind)
    }

    /** The Gradle API (this distribution's) has every call the script makes on it. */
    @Test
    void gradleApiHasEveryCallTheScriptMakes() {
        assertNotNull(TaskContainer.getMethod('register', String, Class))
        assertNotNull(TaskContainer.getMethod('register', String, Class, Action))
        assertNotNull(DomainObjectCollection.getMethod('configureEach', Action))
        assertNotNull(Task.getMethod('dependsOn', Object[]))
        assertNotNull(DirectoryProperty.getMethod('set', Provider))
        assertNotNull(Property.getMethod('set', Object))
    }

    // ---- the bundle `npx cap sync` put in src/main/assets ---------------------

    @Test
    void syncedBundleLosesOnlyMapsDebugPagesUnusedChunksAndTheSandbox() {
        File assets = new File(System.getProperty('releaseWebAssets.syncedAssets', '../src/main/assets'))
        Assume.assumeTrue("no synced bundle at $assets", new File(assets, 'public/index.html').isFile())

        Set<String> removed = policy.planRemovals(assets) as TreeSet
        List<String> all = policy.listFiles(assets)

        all.findAll { policy.isSourceMap(it) }.each { assertTrue(it, removed.contains(it)) }
        policy.DEBUG_PAGES.each { String page ->
            String rel = 'public/' + page
            if (all.contains(rel)) assertTrue(rel, removed.contains(rel))
        }
        policy.pageReferences(new File(assets, 'public/index.html').getText('UTF-8')).each {
            assertFalse(it, removed.contains('public/' + it))
        }
        assertTrue(removed.every { it.startsWith('public/') })

        // Anything else that goes must be a debug page's entry chunk that no
        // shipped file names.
        Set<String> entryChunks = [] as Set
        policy.DEBUG_PAGES.each { String page ->
            File html = new File(assets, 'public/' + page)
            if (html.isFile()) policy.pageScripts(html.getText('UTF-8')).each { entryChunks << 'public/' + it }
        }
        policy.UNUSED_FILES.each { String file ->
            String rel = 'public/' + file
            if (all.contains(rel)) assertTrue(rel, removed.contains(rel))
        }
        List<String> others = removed.findAll {
            !policy.isSourceMap(it) && !policy.isDebugPage(it) && !policy.isInDebugFolder(it) &&
                    !policy.isUnusedFile(it)
        }.toList()
        others.each { String chunk ->
            assertTrue("not a debug entry chunk: $chunk", entryChunks.contains(chunk))
            String name = policy.baseName(chunk)
            all.findAll { !removed.contains(it) && policy.isText(it) }.each { String rel ->
                assertFalse("$rel names $chunk", new File(assets, rel).getText('ISO-8859-1').contains(name))
            }
        }

        File into = tmp.newFolder()
        long started = System.nanoTime()
        List<String> copied = policy.copyStripped(assets, into)
        long millis = (System.nanoTime() - started).intdiv(1000000L)
        assertEquals(removed, copied as TreeSet)

        // An APK of the stripped assets passes the APK check; one of the
        // unstripped assets fails it.
        def asEntries = { File root -> policy.listFiles(root).collect { 'assets/' + it } + ['classes.dex'] }
        assertEquals([], policy.packagedProblems(asEntries(into)))
        assertEquals(removed.size() - others.size(), policy.packagedProblems(asEntries(assets)).size())
        println("synced bundle: ${policy.describe(assets, copied)}; dropped entry chunks: $others; " +
                "copy and check took $millis ms")
    }

    // ---- check-apk.sh ----------------------------------------------------------

    static final String CHECK_INDEX = '''<!doctype html><html><head>
    <link rel="icon" href="./favicon.ico" />
    <script type="module" crossorigin src="./assets/main-AAA.js"></script>
    <link rel=stylesheet href='/assets/index-CCC.css'>
    <SCRIPT SRC="assets/late-LLL.js?v=2#x"></SCRIPT>
    <link rel="preconnect" href="https://example.org">
    <a href="#top">top</a> <img src="data:image/png;base64,AAAA"> <a href="../outside.html">x</a>
    <link href="//cdn.example/x.css" rel="stylesheet"> <img src="">
    </head><body></body></html>'''

    static Map<String, String> checkApkEntries() {
        apkOf([
                'public/index.html'            : CHECK_INDEX,
                'public/favicon.ico'           : 'ico',
                'public/assets/main-AAA.js'    : 'x',
                'public/assets/index-CCC.css'  : 'x',
                'public/assets/late-LLL.js'    : 'x',
                'public/pdfjs/build/pdf.mjs'   : 'x',
                'chaquopy/notes.map'           : 'not a web asset',
        ])
    }

    /** Runs check-apk.sh on an APK made of entries: [exit code, output]. */
    List runCheckApk(Map<String, String> entries) {
        File script = new File(System.getProperty(
                'releaseWebAssets.checkApk', 'release-web-assets-test/check-apk.sh'))
        Assume.assumeTrue("no check-apk.sh at $script", script.isFile())
        Assume.assumeTrue('needs bash and unzip',
                ['/bin/bash', '/usr/bin/bash'].any { new File(it).canExecute() } &&
                        System.getenv('PATH').split(':').any { new File(it, 'unzip').canExecute() })
        Process p = new ProcessBuilder('bash', script.path, zip(entries).path)
                .redirectErrorStream(true).start()
        String out = p.inputStream.getText('UTF-8')
        [p.waitFor(), out]
    }

    @Test
    void checkApkPassesAStrippedApkWithEveryRefStyle() {
        def (int code, String out) = runCheckApk(checkApkEntries())
        assertEquals(out, 0, code)
        assertTrue(out, out.contains('OK:'))
        assertTrue(out, out.contains('source maps:            0'))
        assertFalse(out, out.contains('warning'))
    }

    @Test
    void checkApkFailsOnAMissingRefOfAnyQuoteStyleOrForm() {
        ['public/assets/index-CCC.css': "'/assets/index-CCC.css'",
         'public/assets/late-LLL.js'  : 'assets/late-LLL.js?v=2#x',
         'public/favicon.ico'         : './favicon.ico'].each { String rel, String ref ->
            Map<String, String> entries = checkApkEntries()
            entries.remove('assets/' + rel)
            def (int code, String out) = runCheckApk(entries)
            assertEquals(out, 1, code)
            String shown = ref.replace("'", '')
            assertTrue(out, out.contains("index.html loads $shown, which is not packaged"))
            assertEquals(out, 1, out.count('which is not packaged'))
        }
    }

    @Test
    void checkApkFailsOnMapsDebugPagesAndAMissingIndex() {
        Map<String, String> entries = checkApkEntries()
        entries['assets/public/assets/main-AAA.js.map'] = '{}'
        entries['assets/public/pdfjs/web/viewer.html'] = '<html></html>'
        def (int code, String out) = runCheckApk(entries)
        assertEquals(out, 1, code)
        assertTrue(out, out.contains('source maps:            1'))
        assertTrue(out, out.contains('debug pages and files:  1'))

        entries = checkApkEntries()
        entries['assets/public/pdfjs/build/pdf.sandbox.mjs'] = 'x'
        entries['assets/public/qort-coin-blue.png'] = 'x'
        (code, out) = runCheckApk(entries)
        assertEquals(out, 1, code)
        assertTrue(out, out.contains('debug pages and files:  2'))
        assertTrue(out, out.contains('assets/public/pdfjs/build/pdf.sandbox.mjs'))
        assertTrue(out, out.contains('assets/public/qort-coin-blue.png'))

        entries = checkApkEntries()
        entries.remove('assets/public/index.html')
        (code, out) = runCheckApk(entries)
        assertEquals(out, 1, code)
        assertTrue(out, out.contains('index.html:             MISSING'))
    }

    @Test
    void checkApkWarnsAboutAShippedDebugEntryChunk() {
        Map<String, String> entries = checkApkEntries()
        entries['assets/public/assets/qortinoDebug-DDD.js'] = 'x'
        def (int code, String out) = runCheckApk(entries)
        assertEquals(out, 0, code)
        assertTrue(out, out.contains('warning'))
        assertTrue(out, out.contains('assets/public/assets/qortinoDebug-DDD.js'))
    }
}

// ---- fakes with the same overloads as AGP's API ------------------------------

class FakeSelector {
    String buildType

    FakeSelector withBuildType(String type) {
        buildType = type
        this
    }
}

class FakeComponents {
    final FakeSelector selector = new FakeSelector()
    FakeSelector selected
    Action action
    int function1Calls = 0

    FakeSelector selector() { selector }

    void onVariants(FakeSelector s, Action a) {
        selected = s
        action = a
    }

    void onVariants(FakeSelector s, Function1 f) { function1Calls++ }
}

class FakeRegistration {
    Class type
    Action configure
    final Object provider = new Object()
}

class FakeTasks {
    final Map<String, FakeRegistration> registered = [:]
    final List<Action> configureEachActions = []

    Object register(String n, Class t) {
        registered[n] = new FakeRegistration(type: t)
        registered[n].provider
    }

    Object register(String n, Class t, Action a) {
        registered[n] = new FakeRegistration(type: t, configure: a)
        registered[n].provider
    }

    void configureEach(Action a) { configureEachActions << a }
}

class FakeTask {
    String name
    final List<Object> dependencies = []

    FakeTask dependsOn(Object... paths) {
        dependencies.addAll(paths)
        this
    }
}

class FakeProperty {
    Object value

    void set(Object v) { value = v }
}

class FakeVerifyTask {
    final FakeProperty apkFolder = new FakeProperty()
    final FakeProperty builtArtifactsLoader = new FakeProperty()
}

class FakeOperation {
    Object used
    Function1 input
    Function1 output
    Object target

    FakeOperation wiredWithDirectories(Function1 i, Function1 o) {
        input = i
        output = o
        this
    }

    void toTransform(Artifact.Single artifact) { target = artifact }
}

class FakeArtifacts {
    final FakeOperation op = new FakeOperation()
    final Object apkProvider = new Object()
    final Object builtArtifactsLoader = new Object()
    Object requested

    FakeOperation use(Object provider) {
        op.used = provider
        op
    }

    Object get(Artifact.Single artifact) {
        requested = artifact
        apkProvider
    }
}

class FakeVariant {
    final FakeArtifacts artifacts = new FakeArtifacts()

    String getName() { 'release' }
}
