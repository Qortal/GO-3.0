import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../background/background', () => ({
  createEndpoint: async (path: string) => `http://node${path}`,
}));

import {
  listPublishedBuilds,
  lookUpLatestPublishedBuild,
  qShareSharePath,
  versionFromFilename,
} from './qdnAppUpdate';

const NAME = 'GO%203.0';

const share = (tag: string, created: number) => ({
  created,
  identifier: `qshare_file_go-30-${tag}_metadata`,
  service: 'DOCUMENT',
  size: 900,
});

const shareDoc = (version: string, extra: Record<string, unknown> = {}) => ({
  htmlDescription: `<p>Changes in ${version}</p>`,
  title: `GO 3.0 v${version}`,
  files: [
    {
      filename: `GO 3.0 v${version}.apk`,
      identifier: `qshare_file_go-30-${version}_file`,
      service: 'FILE',
      size: 128_000_000,
    },
  ],
  ...extra,
});

/** Routes a fake node: path -> JSON body, or a status for a failure. */
const serve = (routes: Record<string, unknown>) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace('http://node', '');
      if (!(path in routes)) return { ok: false, json: async () => null };
      const body = routes[path];
      if (body instanceof Error) throw body;
      return { ok: true, json: async () => body };
    })
  );
};

const listPath = `/arbitrary/resources?service=DOCUMENT&name=${NAME}&limit=100&includemetadata=true`;
const docPath = (id: string) => `/arbitrary/DOCUMENT/${NAME}/${id}`;

describe('GO 3.0 builds on QDN', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the version from the last dotted number in the filename', () => {
    expect(versionFromFilename('GO 3.0 v0.0.12.apk')).toBe('0.0.12');
    expect(versionFromFilename('notes.txt')).toBeNull();
  });

  it('lists every build newest first, one per version, with its share', async () => {
    const v12 = share('v0012_WAT6bz', 3000);
    const v11 = share('v0011_2wN9Vn', 2000);
    const v11again = share('v0011_Zzzzzz', 2500);
    const v9 = share('v009_yjlRBY', 1000);
    const notes = share('readme_aaaaaa', 500);
    serve({
      [listPath]: [
        v9,
        v11,
        v12,
        v11again,
        notes,
        { identifier: 'qortal_avatar', created: 9 },
      ],
      [docPath(v12.identifier)]: shareDoc('0.0.12'),
      [docPath(v11.identifier)]: shareDoc('0.0.11', { title: 'old' }),
      [docPath(v11again.identifier)]: shareDoc('0.0.11', { title: 'again' }),
      [docPath(v9.identifier)]: shareDoc('0.0.9'),
      [docPath(notes.identifier)]: {
        files: [{ filename: 'README.txt', identifier: 'x' }],
      },
    });

    const seen: string[][] = [];
    const result = await listPublishedBuilds((releases) =>
      seen.push(releases.map((release) => release.version))
    );

    expect(result.reachable).toBe(true);
    expect(result.missing).toBe(0);
    expect(result.releases.map((release) => release.version)).toEqual([
      '0.0.12',
      '0.0.11',
      '0.0.9',
    ]);
    // The later publish of the same version wins.
    expect(result.releases[1].title).toBe('again');
    expect(result.releases[0]).toMatchObject({
      filename: 'GO 3.0 v0.0.12.apk',
      notesHtml: '<p>Changes in 0.0.12</p>',
      publishedAt: 3000,
      shareIdentifier: v12.identifier,
    });
    // Reported as each document landed, always sorted.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toEqual(['0.0.12', '0.0.11', '0.0.9']);
  });

  it('counts shares the node could not deliver and tells a silent node apart', async () => {
    const v12 = share('v0012_WAT6bz', 3000);
    const v11 = share('v0011_2wN9Vn', 2000);
    serve({
      [listPath]: [v12, v11],
      [docPath(v11.identifier)]: shareDoc('0.0.11'),
    });
    const partial = await listPublishedBuilds();
    expect(partial).toMatchObject({ missing: 1, reachable: true });
    expect(partial.releases.map((release) => release.version)).toEqual([
      '0.0.11',
    ]);

    // The newest share is unavailable, so the latest known build is older.
    expect(await lookUpLatestPublishedBuild()).toMatchObject({
      reachable: true,
      release: { version: '0.0.11' },
    });

    serve({});
    expect(await listPublishedBuilds()).toEqual({
      missing: 0,
      reachable: false,
      releases: [],
    });
    expect(await lookUpLatestPublishedBuild()).toEqual({
      reachable: false,
      release: null,
    });
  });

  it('builds the Q-Share share path for a build', () => {
    expect(
      qShareSharePath({
        shareIdentifier: 'qshare_file_go-30-v0012_WAT6bz_metadata',
      })
    ).toBe('share/GO%203.0/qshare_file_go-30-v0012_WAT6bz_metadata');
    expect(qShareSharePath({ shareIdentifier: '' })).toBeNull();
  });
});
