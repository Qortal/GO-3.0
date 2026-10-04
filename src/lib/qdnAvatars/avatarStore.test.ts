import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createMemoryAvatarStore,
  openIndexedDbAvatarStore,
  openQdnAvatarStore,
  type QdnAvatarMeta,
  type QdnAvatarStore,
} from './avatarStore';

const meta = (key: string, extra: Partial<QdnAvatarMeta> = {}) =>
  ({
    key,
    size: 4,
    fetchedAt: 1,
    lastUsedAt: 1,
    useCount: 0,
    ...extra,
  }) satisfies QdnAvatarMeta;

const image = (key: string) => ({
  key,
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
  type: 'image/png',
});

async function exerciseStore(store: QdnAvatarStore) {
  const a = 'THUMBNAIL/alice/qortal_avatar';
  const b = 'THUMBNAIL/bob/qortal_avatar';
  await store.putEntry(meta(a), image(a));
  await store.putEntry(meta(b, { size: 0, missing: true }), null);

  expect((await store.loadAllMeta()).map((row) => row.key).sort()).toEqual([
    a,
    b,
  ]);
  const images = await store.loadImages([a, b]);
  expect(Array.from(images.keys())).toEqual([a]);
  expect(new Uint8Array(images.get(a)!.bytes)[0]).toBe(0x89);

  await store.putMetas([meta(a, { useCount: 5 })]);
  expect(
    (await store.loadAllMeta()).find((row) => row.key === a)?.useCount
  ).toBe(5);
  // A metadata-only write keeps the image.
  expect((await store.loadImages([a])).has(a)).toBe(true);

  await store.deleteEntries([a]);
  expect((await store.loadImages([a])).size).toBe(0);
  expect((await store.loadAllMeta()).map((row) => row.key)).toEqual([b]);

  await store.clear();
  expect(await store.loadAllMeta()).toEqual([]);
}

describe('avatar stores', () => {
  it('memory store keeps records and images', async () => {
    await exerciseStore(createMemoryAvatarStore());
  });

  it('IndexedDB store keeps records and images', async () => {
    const store = await openIndexedDbAvatarStore({
      factory: new IDBFactory(),
      name: 'avatar-store-test',
    });
    expect(store?.kind).toBe('indexeddb');
    await exerciseStore(store!);
  });

  it('IndexedDB data survives reopening', async () => {
    const factory = new IDBFactory();
    const first = await openIndexedDbAvatarStore({ factory, name: 'reopen' });
    const key = 'THUMBNAIL/carol/qortal_avatar';
    await first!.putEntry(meta(key), image(key));
    const second = await openIndexedDbAvatarStore({ factory, name: 'reopen' });
    expect((await second!.loadAllMeta())[0].key).toBe(key);
    expect((await second!.loadImages([key])).get(key)?.type).toBe('image/png');
  });

  it('falls back to memory without IndexedDB or when it fails to open', async () => {
    expect(await openIndexedDbAvatarStore({ factory: null })).toBeNull();
    expect((await openQdnAvatarStore({ factory: null })).kind).toBe('memory');
    const broken = {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    expect((await openQdnAvatarStore({ factory: broken })).kind).toBe('memory');
  });
});
