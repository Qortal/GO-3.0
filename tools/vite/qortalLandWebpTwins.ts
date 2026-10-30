import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * QortalLand keeps each prop picture twice under src/assets/qortalland/source:
 * a PNG master and a smaller .webp twin with the same name. QortalLand.tsx
 * globs both eagerly and draws the twin whenever there is one
 * (`url: optimizedUrl ?? url`), so no PNG URL is ever loaded, yet every build
 * emitted all the PNGs (37 files, 31 MB of the APK and of the desktop app).
 *
 * In builds, each of those PNG imports resolves to its webp twin instead. The
 * glob keeps its PNG paths as keys (QortalLand's asset ids), both maps point
 * at the same webp URL, and no PNG is emitted. A PNG there without a twin
 * fails the build: add the .webp next to it.
 *
 * Build only: the dev server emits nothing and the page only fetches what it
 * draws (the webp), and a new PNG without a twin keeps working there while it
 * is prototyped (source/README.md). Imports with a query (`x.png?url`) are
 * left alone.
 */

export const QORTAL_LAND_SOURCE_DIR = 'src/assets/qortalland/source';

const PNG = /\.png$/i;

/** The webp twin of a PNG inside sourceDir, or null for any other file. */
export function webpTwinOf(file: string, sourceDir: string): string | null {
  if (!PNG.test(file)) return null;
  const rel = relative(sourceDir, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return file.replace(PNG, '.webp');
}

/** PNGs under dir ('/'-separated, relative to dir, sorted) that have no webp twin. */
export function pngsWithoutWebpTwin(dir: string): string[] {
  const missing: string[] = [];
  const walk = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      const file = join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(file, rel + '/');
      } else if (
        PNG.test(entry.name) &&
        !existsSync(file.replace(PNG, '.webp'))
      ) {
        missing.push(rel);
      }
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return missing.sort();
}

const missingTwinMessage = (files: string[]): string =>
  `${QORTAL_LAND_SOURCE_DIR}: no .webp twin for ${files.join(', ')}. ` +
  'Builds ship the webp twin in place of each PNG there ' +
  '(tools/vite/qortalLandWebpTwins.ts): add one with the same name, and ' +
  'when it is smaller than the PNG, also add its sizes to ' +
  'QORTAL_LAND_OPTIMIZED_ASSET_DIMENSIONS ' +
  '(src/components/QortalLand/qortalLandOptimizedAssets.ts) ' +
  'so it draws at the same size.';

export function qortalLandWebpTwinsPlugin(): Plugin {
  let sourceDir = '';
  return {
    name: 'qortal-land-webp-twins',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      // Real path: Vite resolves module ids through symlinks.
      const dir = resolve(config.root, QORTAL_LAND_SOURCE_DIR);
      sourceDir = existsSync(dir) ? realpathSync(dir) : dir;
    },
    buildStart() {
      const missing = pngsWithoutWebpTwin(sourceDir);
      if (missing.length > 0) this.error(missingTwinMessage(missing));
    },
    async resolveId(source, importer, options) {
      if (!PNG.test(source)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved || resolved.external) return null;
      const twin = webpTwinOf(resolved.id, sourceDir);
      if (twin === null) return null;
      if (!existsSync(twin)) {
        this.error(missingTwinMessage([relative(sourceDir, resolved.id)]));
      }
      return twin;
    },
  };
}
