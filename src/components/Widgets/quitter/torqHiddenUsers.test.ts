import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  fetchTorqHiddenUsers,
  hiddenUserKey,
  parseTorqHiddenUsers,
  resetTorqHiddenUsersCache,
  torqSettingsIdentifier,
} from './torqHiddenUsers';
import { QUITTER_PUBLIC_SALT } from './quitterIdentity';

const settingsJson = (hiddenUsers: string[]) =>
  JSON.stringify({ version: 1, hiddenUsers, hiddenWords: [] });

beforeEach(() => {
  resetTorqHiddenUsersCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Torq hidden users', () => {
  it('finds the settings document where Torq publishes it', async () => {
    // qapp-core: safe base64 of SHA-256(publicSalt + "settings"), 14 chars.
    const expected = createHash('sha256')
      .update(QUITTER_PUBLIC_SALT + 'settings')
      .digest('base64')
      .replace(/\+/g, '.')
      .replace(/\//g, '~')
      .replace(/_/g, '!')
      .replace(/=+$/, '')
      .slice(0, 14);
    expect(await torqSettingsIdentifier()).toBe(expected);
  });

  it('reads the list from every shape Torq accepts', () => {
    expect(
      parseTorqHiddenUsers(settingsJson(['@Bob', ' Carol  Dee ']))
    ).toEqual(['Bob', 'Carol Dee']);
    expect(parseTorqHiddenUsers(btoa(settingsJson(['Bob'])))).toEqual(['Bob']);
    expect(
      parseTorqHiddenUsers({ data: btoa(settingsJson(['Bob', 'bob'])) })
    ).toEqual(['Bob']);
    expect(parseTorqHiddenUsers('not json')).toEqual([]);
    expect(parseTorqHiddenUsers({ uiTheme: 'hub' })).toEqual([]);
  });

  it('compares names the way Torq does', () => {
    expect(hiddenUserKey('@Carol   Dee ')).toBe(hiddenUserKey('carol dee'));
  });

  it('fetches once, caches, and refreshes on demand', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      text: async () => settingsJson(['Bob']),
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchTorqHiddenUsers('Alice Smith')).toEqual(['Bob']);
    expect(await fetchTorqHiddenUsers('Alice Smith')).toEqual(['Bob']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const identifier = await torqSettingsIdentifier();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://node.test/arbitrary/DOCUMENT/Alice%20Smith/${encodeURIComponent(identifier)}`
    );

    await fetchTorqHiddenUsers('Alice Smith', { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows everyone when nothing was saved, and keeps the last list offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }))
    );
    expect(await fetchTorqHiddenUsers('Alice')).toEqual([]);
    // Core may answer a missing resource with 400 instead.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, text: async () => '' }))
    );
    expect(await fetchTorqHiddenUsers('Alice', { force: true })).toEqual([]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => settingsJson(['Bob']),
      }))
    );
    expect(await fetchTorqHiddenUsers('Alice', { force: true })).toEqual([
      'Bob',
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    expect(await fetchTorqHiddenUsers('Alice', { force: true })).toEqual([
      'Bob',
    ]);
    // A failed fetch is not repeated on every feed load.
    const retry = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => settingsJson(['Bob']),
    }));
    vi.stubGlobal('fetch', retry);
    await fetchTorqHiddenUsers('Alice');
    expect(retry).not.toHaveBeenCalled();
  });
});
