import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, unknown>();
let lastAuthenticated = '';

vi.mock('./chromeStorage', () => ({
  getData: vi.fn(async (key: string) =>
    storage.has(key) ? structuredClone(storage.get(key)) : null
  ),
  storeData: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, structuredClone(value));
    return 'Data saved successfully';
  }),
}));
vi.mock('./lastAuthenticatedWallet', () => ({
  getLastAuthenticatedWalletAddress: () => lastAuthenticated,
}));

import { storeData } from './chromeStorage';
import {
  forgetWalletPrimaryName,
  forgetWalletPrimaryNames,
  getCachedWalletPrimaryNames,
  isLoopbackNodeUrl,
  isOwnWalletAddress,
  primaryNamesFromAvatarCache,
  refreshWalletPrimaryNamesFromOwnNode,
  registerDeviceWalletAddresses,
  rememberWalletPrimaryName,
  resetWalletPrimaryNameCacheForTests,
  staleWalletAddresses,
} from './walletPrimaryNameCache';

const A = 'QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG';
const B = 'QM8eUjZLNTQS9wosWJbcvPEtAUeMkcEraS';
const C = 'Qc436qUreT8v42qUbxWh2U2QJD6SZzXTNg';

beforeEach(() => {
  storage.clear();
  lastAuthenticated = '';
  resetWalletPrimaryNameCacheForTests();
  vi.mocked(storeData).mockClear();
});

describe('walletPrimaryNameCache', () => {
  it('returns only remembered names, including "has no name"', async () => {
    await rememberWalletPrimaryName(A, ' Alice ');
    await rememberWalletPrimaryName(B, '');
    expect(await getCachedWalletPrimaryNames([A, B, C])).toEqual({
      [A]: 'Alice',
      [B]: '',
    });
  });

  it('keeps every concurrent write and skips unchanged ones', async () => {
    await Promise.all([
      rememberWalletPrimaryName(A, 'Alice'),
      rememberWalletPrimaryName(B, 'Bob'),
      rememberWalletPrimaryName(C, 'Carol'),
    ]);
    expect(await getCachedWalletPrimaryNames([A, B, C])).toEqual({
      [A]: 'Alice',
      [B]: 'Bob',
      [C]: 'Carol',
    });
    vi.mocked(storeData).mockClear();
    await rememberWalletPrimaryName(A, 'Alice');
    expect(storeData).not.toHaveBeenCalled();
    await rememberWalletPrimaryName(A, 'Alice2');
    expect((await getCachedWalletPrimaryNames([A]))[A]).toBe('Alice2');
  });

  it('reads names stored with cached avatars', () => {
    expect(
      primaryNamesFromAvatarCache(
        {
          [A]: { dataUrl: 'data:image/png;base64,AA', primaryName: 'Alice' },
          [B]: { dataUrl: 'data:image/png;base64,BB', primaryName: '' },
          [C]: { dataUrl: 'data:image/png;base64,CC', primaryName: 'Carol' },
        },
        [A, B]
      )
    ).toEqual({ [A]: 'Alice' });
  });

  it('treats only this device’s wallets and the signed-in one as own', () => {
    expect(isOwnWalletAddress(A)).toBe(false);
    registerDeviceWalletAddresses([A, ` ${B} `]);
    expect(isOwnWalletAddress(A)).toBe(true);
    expect(isOwnWalletAddress(B)).toBe(true);
    expect(isOwnWalletAddress(C)).toBe(false);
    lastAuthenticated = C;
    expect(isOwnWalletAddress(C)).toBe(true);
    expect(isOwnWalletAddress('')).toBe(false);
  });

  it('replaces the device list, so a removed wallet stops counting as own', () => {
    registerDeviceWalletAddresses([A, B]);
    registerDeviceWalletAddresses([A]);
    expect(isOwnWalletAddress(A)).toBe(true);
    expect(isOwnWalletAddress(B)).toBe(false);
    // An empty list (not loaded yet) leaves the last one in place.
    registerDeviceWalletAddresses([]);
    expect(isOwnWalletAddress(A)).toBe(true);
  });

  it('forgets the names of wallets no longer on the device', async () => {
    await rememberWalletPrimaryName(A, 'Alice');
    await rememberWalletPrimaryName(B, 'Bob');
    await rememberWalletPrimaryName(C, 'Carol');
    lastAuthenticated = C;
    expect(await forgetWalletPrimaryNames([A])).toEqual([B]);
    expect(await getCachedWalletPrimaryNames([A, B, C])).toEqual({
      [A]: 'Alice',
      [C]: 'Carol',
    });
    vi.mocked(storeData).mockClear();
    expect(await forgetWalletPrimaryNames([A])).toEqual([]);
    expect(storeData).not.toHaveBeenCalled();

    registerDeviceWalletAddresses([A]);
    await forgetWalletPrimaryName(A);
    expect(await getCachedWalletPrimaryNames([A])).toEqual({});
    expect(isOwnWalletAddress(A)).toBe(false);
  });

  it('lists stale cache entries, keeping the wallet signed in last', () => {
    lastAuthenticated = C;
    expect(staleWalletAddresses([A, B, C], [` ${A} `])).toEqual([B]);
  });

  it('treats only a node on this device as the user’s own', () => {
    for (const url of [
      'http://127.0.0.1:12391',
      'https://127.0.0.1:12391',
      'http://localhost:12391',
      'http://node.localhost:12391',
      'http://[::1]:12391',
    ]) {
      expect(isLoopbackNodeUrl(url)).toBe(true);
    }
    for (const url of [
      'https://ext-node.qortal.link',
      'http://192.168.1.20:12391',
      'http://127.0.0.1.example.com:12391',
      'http://localhost.example.com',
      'not a url',
      '',
      null,
      undefined,
    ]) {
      expect(isLoopbackNodeUrl(url)).toBe(false);
    }
  });

  it('remembers what the user’s own node says about every wallet', async () => {
    const lookup = vi.fn(async () => ({ [A]: 'Alice', [B]: '' }));
    const names = await refreshWalletPrimaryNamesFromOwnNode(
      [A, B, C, A],
      lookup
    );
    expect(lookup).toHaveBeenCalledWith([A, B, C]);
    expect(names).toEqual({ [A]: 'Alice', [B]: '', [C]: '' });
    expect(await getCachedWalletPrimaryNames([A, B, C])).toEqual(names);
  });
});
