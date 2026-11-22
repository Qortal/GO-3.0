import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prefs = vi.hoisted(() => new Map<string, unknown>());
const storage = vi.hoisted(() => ({
  failWrites: false,
  reads: 0,
  /** Holds reads until released, when set. */
  gate: null as Promise<void> | null,
}));

vi.mock('../../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) => {
    storage.reads += 1;
    const value = prefs.has(key) ? structuredClone(prefs.get(key)) : null;
    if (storage.gate) await storage.gate;
    return value;
  }),
  storeData: vi.fn(async (key: string, value: unknown) => {
    if (storage.failWrites) throw new Error('vault unavailable');
    prefs.set(key, structuredClone(value));
    return 'Data saved successfully';
  }),
}));

import {
  goSavedAppsStorage,
  goSavedAppsWritesDone,
  loadGoSavedAppsKeys,
  resetGoSavedAppsStorage,
} from './goSavedAppsStorage';

const KEY = 'ext_saved_apps:QPhone';

beforeEach(() => {
  prefs.clear();
  storage.failWrites = false;
  storage.reads = 0;
  storage.gate = null;
  resetGoSavedAppsStorage();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the saved apps' records in GO's encrypted storage", () => {
  it('reads a key once, then answers from memory', async () => {
    prefs.set(KEY, '{"seen":5}');

    await loadGoSavedAppsKeys([KEY]);
    await loadGoSavedAppsKeys([KEY]);

    expect(goSavedAppsStorage.getItem(KEY)).toBe('{"seen":5}');
    expect(storage.reads).toBe(1);
  });

  it('answers none for a key that is missing or not read yet', async () => {
    expect(goSavedAppsStorage.getItem(KEY)).toBeNull();

    await loadGoSavedAppsKeys([KEY]);

    expect(goSavedAppsStorage.getItem(KEY)).toBeNull();
  });

  it('writes behind, one write after another, and a new run reads the last', async () => {
    goSavedAppsStorage.setItem(KEY, '{"seen":1}');
    goSavedAppsStorage.setItem(KEY, '{"seen":2}');
    expect(goSavedAppsStorage.getItem(KEY)).toBe('{"seen":2}');

    await goSavedAppsWritesDone();
    expect(prefs.get(KEY)).toBe('{"seen":2}');
    // Nothing of it in plain localStorage.
    expect(localStorage.getItem(KEY)).toBeNull();

    resetGoSavedAppsStorage();
    await loadGoSavedAppsKeys([KEY]);
    expect(goSavedAppsStorage.getItem(KEY)).toBe('{"seen":2}');
  });

  it('keeps a write made while the key was being read', async () => {
    prefs.set(KEY, '{"seen":1}');
    let release = () => {};
    storage.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const loading = loadGoSavedAppsKeys([KEY]);
    goSavedAppsStorage.setItem(KEY, '{"seen":2}');
    release();
    await loading;

    expect(goSavedAppsStorage.getItem(KEY)).toBe('{"seen":2}');
  });

  it('keeps a value it could not store, for this run', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.failWrites = true;

    goSavedAppsStorage.setItem(KEY, '{"seen":3}');
    await goSavedAppsWritesDone();

    expect(goSavedAppsStorage.getItem(KEY)).toBe('{"seen":3}');
    expect(error).toHaveBeenCalled();
    // The next write still goes.
    storage.failWrites = false;
    goSavedAppsStorage.setItem(KEY, '{"seen":4}');
    await goSavedAppsWritesDone();
    expect(prefs.get(KEY)).toBe('{"seen":4}');
  });
});
