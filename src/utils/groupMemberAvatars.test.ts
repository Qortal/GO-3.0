import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./globalApi', () => ({
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  getBaseApiReactForAvatar: () => 'http://node:12391',
}));

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('group member avatar presence', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports true, false or unknown per name', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => [{ name: 'Alice' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { ensureAvatarPresence, getAvatarPresence } =
      await import('./groupMemberAvatars');

    expect(getAvatarPresence('Alice')).toBeUndefined();
    const onResolved = vi.fn();
    ensureAvatarPresence(['Alice', 'bob', 'alice', null], onResolved);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('name=Alice&name=bob');
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(getAvatarPresence('ALICE')).toBe(true);
    expect(getAvatarPresence('alice')).toBe(true);
    expect(getAvatarPresence('Bob')).toBe(false);
    expect(getAvatarPresence('carol')).toBeUndefined();
    expect(getAvatarPresence('')).toBeUndefined();
  });

  it('leaves names unknown when the lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const { ensureAvatarPresence, getAvatarPresence } =
      await import('./groupMemberAvatars');
    ensureAvatarPresence(['Dave']);
    await flush();
    expect(getAvatarPresence('Dave')).toBeUndefined();
  });
});
