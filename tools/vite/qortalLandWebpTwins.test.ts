import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pngsWithoutWebpTwin,
  QORTAL_LAND_SOURCE_DIR,
  qortalLandWebpTwinsPlugin,
  webpTwinOf,
} from './qortalLandWebpTwins';

const repoRoot = resolve(__dirname, '../..');
const pluginFile = resolve(__dirname, 'qortalLandWebpTwins.ts');

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

/** A throwaway project: path -> contents. Pictures need not be real images. */
const project = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'qortal-land-twins-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

const SOURCE = 'src/assets/qortalland/source';

// The same two globs as QortalLand.tsx, plus a PNG outside the folder.
const ENTRY = `
import logo from './other/logo.png';
const png = import.meta.glob('./assets/qortalland/source/**/*.png', { eager: true, import: 'default' });
const webp = import.meta.glob('./assets/qortalland/source/**/*.webp', { eager: true, import: 'default' });
globalThis.fixture = { png, webp, logo };
`;

const config = (root: string) => `
import { qortalLandWebpTwinsPlugin } from ${JSON.stringify(pluginFile)};
export default {
  base: '/',
  logLevel: 'silent',
  plugins: [qortalLandWebpTwinsPlugin()],
  build: {
    write: false,
    minify: false,
    assetsInlineLimit: 0,
    rollupOptions: { input: ${JSON.stringify(join(root, 'src/main.js'))} },
  },
};
`;

// Runs in a child Node: vitest's jsdom globals stop esbuild (inside Vite)
// from loading in this process.
const BUILD = `
const { build } = await import('vite');
try {
  const out = await build({ root: process.env.FIXTURE_ROOT });
  const items = (Array.isArray(out) ? out[0] : out).output;
  process.stdout.write(JSON.stringify({
    assets: items.filter((i) => i.type === 'asset').map((i) => i.fileName).sort(),
    code: items.find((i) => i.type === 'chunk').code,
  }));
} catch (err) {
  process.stdout.write(JSON.stringify({ error: String(err?.message ?? err) }));
}
`;

const twinProject = (extra: Record<string, string> = {}) => {
  const root = project({
    'src/main.js': ENTRY,
    'src/other/logo.png': 'logo png',
    [`${SOURCE}/furniture/sofa.png`]: 'sofa png master',
    [`${SOURCE}/furniture/sofa.webp`]: 'sofa webp',
    [`${SOURCE}/technology/dj_booth.png`]: 'booth png master',
    [`${SOURCE}/technology/dj_booth.webp`]: 'booth webp',
    ...extra,
  });
  writeFileSync(join(root, 'vite.config.mjs'), config(root));
  return root;
};

type Built = {
  assets?: string[];
  fixture?: {
    png: Record<string, string>;
    webp: Record<string, string>;
    logo: string;
  };
  error?: string;
};

const viteBuild = (root: string): Built => {
  const env: NodeJS.ProcessEnv = { ...process.env, FIXTURE_ROOT: root };
  delete env.VITEST;
  delete env.NODE_ENV;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', BUILD],
    { cwd: repoRoot, env, encoding: 'utf8', timeout: 60_000 }
  );
  expect(child.status, child.stderr).toBe(0);
  const out = JSON.parse(child.stdout) as {
    assets?: string[];
    code?: string;
    error?: string;
  };
  if (out.error !== undefined) return { error: out.error };
  const scope: { fixture?: Built['fixture'] } = {};
  new Function('globalThis', out.code!)(scope);
  return { assets: out.assets, fixture: scope.fixture };
};

describe('qortalLandWebpTwins', () => {
  it('finds a webp twin for every QortalLand PNG in the repo', () => {
    const dir = resolve(repoRoot, QORTAL_LAND_SOURCE_DIR);
    expect(existsSync(dir)).toBe(true);
    expect(pngsWithoutWebpTwin(dir)).toEqual([]);
  });

  it('relies on QortalLand.tsx drawing the twin whenever there is one', () => {
    // If a Hub merge changes these lines, check again that QortalLand never
    // loads a PNG URL before keeping the plugin.
    const source = readFileSync(
      resolve(repoRoot, 'src/components/QortalLand/QortalLand.tsx'),
      'utf8'
    );
    expect(source).toContain("'../../assets/qortalland/source/**/*.png'");
    expect(source).toContain("'../../assets/qortalland/source/**/*.webp'");
    expect(source).toMatch(/url:\s*optimizedUrl\s*\?\?\s*url,/);
  });

  it('names the twin of a PNG inside the folder only', () => {
    const dir = '/app/src/assets/qortalland/source';
    expect(webpTwinOf(`${dir}/furniture/sofa.png`, dir)).toBe(
      `${dir}/furniture/sofa.webp`
    );
    expect(webpTwinOf(`${dir}/lamp.PNG`, dir)).toBe(`${dir}/lamp.webp`);
    expect(webpTwinOf(`${dir}/furniture/sofa.webp`, dir)).toBeNull();
    expect(webpTwinOf('/app/src/assets/qortalland/lamp.png', dir)).toBeNull();
    expect(
      webpTwinOf('/app/src/assets/qortalland/source2/x.png', dir)
    ).toBeNull();
    expect(webpTwinOf(`${dir}/x.png?url`, dir)).toBeNull();
  });

  it('lists the PNGs that have no twin', () => {
    const root = project({
      'a.png': 'x',
      'a.webp': 'x',
      'deep/b.png': 'x',
      'deep/c.png': 'x',
      'deep/c.webp': 'x',
      'readme.md': 'x',
    });
    expect(pngsWithoutWebpTwin(root)).toEqual(['deep/b.png']);
    expect(pngsWithoutWebpTwin(join(root, 'missing'))).toEqual([]);
  });

  it('builds without a QortalLand PNG, each mapped to its twin', () => {
    const { assets, fixture, error } = viteBuild(twinProject());
    expect(error).toBeUndefined();

    expect(assets!.filter((name) => name.endsWith('.webp'))).toHaveLength(2);
    expect(assets!.filter((name) => name.endsWith('.png'))).toEqual([
      expect.stringMatching(/^assets\/logo-[\w-]+\.png$/),
    ]);
    const dir = './assets/qortalland/source/';
    expect(Object.keys(fixture!.png).sort()).toEqual([
      `${dir}furniture/sofa.png`,
      `${dir}technology/dj_booth.png`,
    ]);
    expect(fixture!.png[`${dir}furniture/sofa.png`]).toMatch(
      /^\/assets\/sofa-[\w-]+\.webp$/
    );
    expect(fixture!.png[`${dir}furniture/sofa.png`]).toBe(
      fixture!.webp[`${dir}furniture/sofa.webp`]
    );
    expect(fixture!.png[`${dir}technology/dj_booth.png`]).toBe(
      fixture!.webp[`${dir}technology/dj_booth.webp`]
    );
    expect(fixture!.logo).toMatch(/^\/assets\/logo-[\w-]+\.png$/);
  }, 60_000);

  it('fails the build when a PNG there has no twin', () => {
    const root = twinProject({ [`${SOURCE}/plants/fern.png`]: 'fern png' });
    expect(viteBuild(root).error).toMatch(
      /no \.webp twin for plants\/fern\.png/
    );
  }, 60_000);

  it('leaves the dev server alone', () => {
    expect(qortalLandWebpTwinsPlugin().apply).toBe('build');
  });
});
