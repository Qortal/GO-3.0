#!/usr/bin/env node
/**
 * Refreshes the bundled ("presaved") Q-App avatars in
 * src/assets/qdnAvatarSeeds/ and regenerates its manifest.ts.
 *
 * Each icon is the public QDN resource THUMBNAIL/<name>/qortal_avatar,
 * downloaded from a Qortal node, shrunk to fit 96x96 (never enlarged) and
 * saved as WebP. GO shows these until the live icon has loaded from the node,
 * so the Home and Q-Apps lists keep their icons on a slow node or offline.
 *
 * Usage (from the repo root):
 *   node tools/qdnAvatarSeeds/refresh-seeds.mjs
 *   node tools/qdnAvatarSeeds/refresh-seeds.mjs --node http://127.0.0.1:12391
 *
 * Nodes are tried in order: --node, the local node, then ext-node.qortal.link
 * (--only-node uses just --node). Every icon is downloaded and converted into
 * a temporary folder first; the bundled files and manifest.ts are replaced
 * only when all of them worked. A name without an image on any node fails
 * the run (exit 1, nothing changed) unless --allow-missing is given, which
 * ships the others. --out <dir> writes somewhere else (for trying it out).
 * Only app/website names belong here: never bundle user avatars.
 */
/* global process, Buffer */
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};
const ALLOW_MISSING = process.argv.includes('--allow-missing');
const OUT_DIR = resolve(
  argValue('--out') ?? resolve(HERE, '../../src/assets/qdnAvatarSeeds')
);
/** Formats sharp may decode from a QDN thumbnail. */
const IMAGE_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp', 'avif', 'heif']);
const SIZE = 96;
const MAX_TOTAL_BYTES = 300 * 1024;
const TIMEOUT_MS = 40_000;

/**
 * Names whose avatar ships in the APK. Sources (Oct 2026):
 * - Home "Featured Q-Apps" (Q-Chat is GO's own and has no QDN icon)
 * - src/components/Apps/config/officialApps.ts
 * - src/qortinoAgent/qAppCatalog.ts
 * - the best rated apps from GET /polls/apps/ratings (the Community Featured
 *   carousel, src/utils/appRatingScore.ts), plus Torq (Home composer)
 */
const SEED_NAMES = [
  // Home Featured Q-Apps
  'Q-Tube',
  'Quitter',
  'Q-Mail',
  'SubWire',
  'Q-Trade',
  // Official apps
  'Q-Blog',
  'Q-Wallets',
  'Names',
  'Q-Assets',
  'Q-Follow',
  'Q-Fund',
  'Q-Manager',
  'Q-Mintership',
  'Q-Node',
  'Q-Search',
  'Q-Share',
  'Q-Shop',
  'Q-Support',
  // Qortino catalog
  'Ear-Bump',
  'Q-Minter',
  'Welcome to Qortal',
  'Subscriptions',
  'QWB',
  'Q-Charts',
  // Most rated (Community Featured) and Torq
  'Q-Podcasts',
  'Dodgers',
  'FreeChat',
  'qombo',
  'qgit',
  'Q-Bazaar',
  'Q Lottery',
  'Groups',
  'Discussion_Boards',
  'QDNES',
  'Q-Music',
  'Torq',
];

const argNode = argValue('--node');

const NODES = (
  process.argv.includes('--only-node')
    ? [argNode]
    : [argNode, 'http://127.0.0.1:12391', 'https://ext-node.qortal.link']
).filter(Boolean);

const slugFor = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const identFor = (slug) =>
  'seed' +
  slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** A single-quoted JS string literal (any name is safe in the manifest). */
const quote = (value) =>
  `'${JSON.stringify(String(value))
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/'/g, "\\'")}'`;

/** True when sharp can decode `bytes` as an image (not an HTML error page). */
async function isImage(bytes) {
  try {
    const { format, width, height } = await sharp(bytes).metadata();
    return IMAGE_FORMATS.has(format) && width > 0 && height > 0;
  } catch {
    return false;
  }
}

async function download(name) {
  for (const node of NODES) {
    const url = `${node.replace(/\/$/, '')}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 0 && (await isImage(bytes))) return { bytes, node };
      console.warn(`${name}: ${node} sent something that is not an image`);
    } catch {
      // try the next node
    }
  }
  return null;
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), 'qdn-avatar-seeds-'));
  try {
    const seeds = [];
    const missing = [];
    const slugs = new Set();
    let total = 0;
    for (const name of SEED_NAMES) {
      const slug = slugFor(name);
      if (!slug || slugs.has(slug)) {
        throw new Error(`${name}: file name "${slug}" is empty or taken`);
      }
      slugs.add(slug);
      const result = await download(name);
      if (!result) {
        console.warn(`${name}: no avatar on any node`);
        missing.push(name);
        continue;
      }
      const webp = await sharp(result.bytes, { animated: false })
        .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, alphaQuality: 90, effort: 6 })
        .toBuffer();
      await writeFile(join(work, `${slug}.webp`), webp);
      total += webp.length;
      seeds.push({ name, slug, ident: identFor(slug) });
      console.log(`${name}: ${webp.length} B (from ${result.node})`);
    }

    if (missing.length && !ALLOW_MISSING) {
      throw new Error(
        `No avatar for ${missing.join(', ')}; nothing was changed. ` +
          'Run again later, or with --allow-missing to ship the others.'
      );
    }
    if (!seeds.length)
      throw new Error('No avatars downloaded; nothing changed');
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`Seeds total ${total} B, over ${MAX_TOTAL_BYTES} B`);
    }

    const capturedAt = new Date().toISOString().slice(0, 10);
    const manifest = `// Generated by tools/qdnAvatarSeeds/refresh-seeds.mjs. Do not edit by hand:
// change the name list there and run it again.
//
// Bundled QDN avatars (THUMBNAIL/<name>/qortal_avatar, 96x96 WebP) for the
// most used Q-Apps. GO shows them until the live icon has loaded from the
// node, so lists keep their icons on a slow node and offline. \`?no-inline\`
// keeps each icon a separate file, out of the JS bundle.
${seeds
  .map((seed) => `import ${seed.ident} from './${seed.slug}.webp?no-inline';`)
  .join('\n')}

/** Day the bundled icons were downloaded from QDN (YYYY-MM-DD). */
export const QDN_AVATAR_SEEDS_CAPTURED_AT = '${capturedAt}';

export type QdnAvatarSeed = {
  /** Registered Qortal name the avatar belongs to. */
  name: string;
  /** Asset URL of the bundled icon. */
  url: string;
};

export const QDN_AVATAR_SEEDS: readonly QdnAvatarSeed[] = [
${seeds.map((seed) => `  { name: ${quote(seed.name)}, url: ${seed.ident} },`).join('\n')}
];
`;
    await writeFile(join(work, 'manifest.ts'), manifest);

    // Everything worked: swap the bundled files and the manifest.
    await mkdir(OUT_DIR, { recursive: true });
    for (const file of await readdir(OUT_DIR)) {
      if (file.endsWith('.webp')) await rm(join(OUT_DIR, file));
    }
    for (const seed of seeds) {
      const file = `${seed.slug}.webp`;
      await copyFile(join(work, file), join(OUT_DIR, file));
    }
    await copyFile(join(work, 'manifest.ts'), join(OUT_DIR, 'manifest.ts'));
    console.log(
      `${seeds.length} seeds, ${total} B total, captured ${capturedAt}` +
        (missing.length ? ` (missing: ${missing.join(', ')})` : '')
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
