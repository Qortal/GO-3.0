/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
// Import path module for resolving file paths
import fixReactVirtualized from 'esbuild-plugin-react-virtualized';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { inlineResizeImageIconsPlugin } from './tools/vite/inlineResizeImageIcons';

/**
 * Swap the chat engine's Node worker-thread pools for the mobile inline pools.
 * Relative-specifier aliases are unreliable in Vite, so match by resolved id
 * suffix in a resolveId hook instead. Skipped under VITEST (desktop tests use
 * the real modules).
 */
function mobileChatWorkerPoolPlugin() {
  const map: Record<string, string> = {
    'reticulum-chat-worker-pool': resolve(
      __dirname,
      'src/reticulumChat/mobile/shims/chat-worker-pool.ts'
    ),
    'reticulum-resource-worker-pool': resolve(
      __dirname,
      'src/reticulumChat/mobile/shims/resource-worker-pool.ts'
    ),
    // The chat engine only needs four pure helpers from presence.ts; the real
    // module drags in the whole RNS presence manager + verify worker pool.
    presence: resolve(
      __dirname,
      'src/reticulumChat/mobile/shims/presence-slim.ts'
    ),
    // Desktop logger writes to userData via module/util/fs; forward to console.
    logger: resolve(__dirname, 'src/reticulumChat/mobile/shims/logger.ts'),
  };
  return {
    name: 'mobile-chat-worker-pools',
    enforce: 'pre' as const,
    resolveId(source: string) {
      if (process.env.VITEST === 'true') return null;
      // Only relative specifiers — these names are unique to electron/src and
      // never collide with the app's own modules.
      if (!source.startsWith('./')) return null;
      const base = source.replace(/^\.\//, '').replace(/\.(ts|js)$/, '');
      return map[base] ?? null;
    },
  };
}

/**
 * Measurement builds only (VITE_GO_PERF=1): put the React commit inspector
 * (tools/perf/goPerfHook.js) in the page before any module runs.
 */
const goPerfHookPlugin = () => ({
  name: 'go-perf-hook',
  transformIndexHtml(html: string) {
    if (process.env.VITE_GO_PERF !== '1') return html;
    const hook = readFileSync(
      resolve(__dirname, 'tools/perf/goPerfHook.js'),
      'utf8'
    );
    return html.replace('<head>', `<head><script>${hook}</script>`);
  },
});

export default defineConfig({
  server: {
    host: true,
    allowedHosts: true,
  },
  resolve: {
    alias:
      process.env.VITEST === 'true'
        ? {
            '@silentbot1/nat-api': resolve(
              __dirname,
              'src/test/mocks/natApi.ts'
            ),
            'better-sqlite3': resolve(
              __dirname,
              'src/test/mocks/betterSqlite3.ts'
            ),
            electron: resolve(__dirname, 'src/test/mocks/electron.ts'),
            'electron-serve': resolve(
              __dirname,
              'src/test/mocks/electronServe.ts'
            ),
            'electron-unhandled': resolve(
              __dirname,
              'src/test/mocks/electronUnhandled.ts'
            ),
            'electron-updater': resolve(
              __dirname,
              'src/test/mocks/electronUpdater.ts'
            ),
            'electron-window-state': resolve(
              __dirname,
              'src/test/mocks/electronWindowState.ts'
            ),
            selfsigned: resolve(__dirname, 'src/test/mocks/selfsigned.ts'),
          }
        : {
            // Mobile chat engine: the Hub 2.0 chat modules (electron/src/*)
            // are bundled into the engine worker and expect Node built-ins.
            // Map each to a browser/OPFS-backed shim. These specifiers never
            // appear in the renderer otherwise, so aliasing globally is safe.
            'better-sqlite3': resolve(
              __dirname,
              'src/reticulumChat/mobile/shims/better-sqlite3.ts'
            ),
            electron: resolve(
              __dirname,
              'src/reticulumChat/mobile/shims/electron.ts'
            ),
            crypto: resolve(
              __dirname,
              'src/reticulumChat/mobile/shims/crypto.ts'
            ),
            fs: resolve(__dirname, 'src/reticulumChat/mobile/shims/fs.ts'),
            os: resolve(__dirname, 'src/reticulumChat/mobile/shims/os.ts'),
            perf_hooks: resolve(
              __dirname,
              'src/reticulumChat/mobile/shims/perf_hooks.ts'
            ),
            worker_threads: resolve(
              __dirname,
              'src/reticulumChat/mobile/shims/worker_threads.ts'
            ),
            zlib: resolve(__dirname, 'src/reticulumChat/mobile/shims/zlib.ts'),
            path: 'path-browserify',
            // Measurement builds only (VITE_GO_PERF=1): React's profiling
            // build, so the PerfProfiler wrappers report render timings.
            ...(process.env.VITE_GO_PERF === '1'
              ? { 'react-dom/client': 'react-dom/profiling' }
              : {}),
          },
  },
  // Capacitor serves the bundle from the WebView's local http origin, so relative
  // asset URLs are the most robust. Single entry (the desktop-only audio-surface
  // window is dropped on mobile).
  base: './',
  build: {
    // Emit sourcemaps so runtime crashes inside the Android WebView can be
    // mapped back to exact source locations during the mobile bring-up.
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        qortinoDebug: resolve(__dirname, 'qortino-debug.html'),
        audioSurface: resolve(__dirname, 'audio-surface.html'),
      },
      output: {
        // Split only phaser (QortalLand's game engine, multi-MB, lazily used)
        // into its own chunk; everything else keeps Rollup's default
        // dynamic-import chunking so mobile first paint stays lean (no
        // eager blanket "vendor" chunk).
        manualChunks(id: string) {
          if (id.includes('/node_modules/phaser/')) {
            return 'phaser';
          }
          return undefined;
        },
      },
      // No blanket "vendor" chunk: it forced every node_modules dependency —
      // including ones only used by lazily-loaded views (editor, virtualized
      // lists, emoji data, ...) — into one eager multi-MB file parsed before
      // first paint. Rollup's default chunking follows the dynamic-import
      // boundaries (e.g. AuthenticatedShell) instead.
    },
  },
  // The audio-decrypt worker dynamically imports `libsodium-wrappers-sumo` (WASM) to
  // split the ~180 KB payload off first paint. Rollup only allows worker code-splitting
  // with the ES module format; the default `iife` worker output rejects dynamic imports.
  worker: {
    format: 'es',
    // Worker builds use a separate plugin set: re-apply the engine module
    // redirects (logger/presence/worker-pools) and wasm/TLA (sqlite-wasm).
    plugins: () => [mobileChatWorkerPoolPlugin(), wasm(), topLevelAwait()],
  },
  test: {
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.idea/**',
      '**/.git/**',
      '**/.cache/**',
      'electron/build/**',
      '.emsdk/**',
    ],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'electron/src/**/*.test.ts',
      'tools/vite/**/*.test.ts',
    ],
    environmentMatchGlobs: [['electron/**', 'node']],
  } as any,
  assetsInclude: ['**/*.wasm'],
  plugins: [
    goPerfHookPlugin(),
    inlineResizeImageIconsPlugin(),
    mobileChatWorkerPoolPlugin(),
    react(),
    wasm(),
    topLevelAwait(),
  ],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [fixReactVirtualized],
    },
    // Pre-bundled deps skip plugin transforms; serve this one through the
    // pipeline so the dev server gets the inline icons too.
    exclude: ['tiptap-extension-resize-image'],
  },
});
