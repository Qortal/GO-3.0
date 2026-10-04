import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/qdnAvatars', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/qdnAvatars')>()),
  refreshQdnAvatar: vi.fn(),
}));

import { refreshQdnAvatar } from '../lib/qdnAvatars';
import {
  markOwnQdnAvatarChecked,
  refreshOwnQdnAvatarOnce,
  resetOwnQdnAvatarRefreshForTests,
} from './useOwnQdnAvatarRefresh';

beforeEach(() => {
  vi.mocked(refreshQdnAvatar).mockClear();
});

afterEach(() => {
  resetOwnQdnAvatarRefreshForTests();
});

describe('refreshOwnQdnAvatarOnce', () => {
  it('refreshes once per session after the cache answered', () => {
    expect(refreshOwnQdnAvatarOnce('Alice', 'loading')).toBe(false);
    expect(refreshOwnQdnAvatarOnce(' Alice ', 'ready')).toBe(true);
    expect(refreshOwnQdnAvatarOnce('alice', 'ready')).toBe(false);
    expect(refreshOwnQdnAvatarOnce('alice', 'missing')).toBe(false);
    expect(refreshQdnAvatar).toHaveBeenCalledTimes(1);
    expect(refreshQdnAvatar).toHaveBeenCalledWith('Alice');
  });

  it('leaves failures and empty names to the cache', () => {
    expect(refreshOwnQdnAvatarOnce('Bob', 'failed')).toBe(false);
    expect(refreshOwnQdnAvatarOnce('Bob', 'idle')).toBe(false);
    expect(refreshOwnQdnAvatarOnce('', 'ready')).toBe(false);
    expect(refreshOwnQdnAvatarOnce(null, 'missing')).toBe(false);
    expect(refreshQdnAvatar).not.toHaveBeenCalled();
  });

  it('skips the refresh after a publish put the new avatar in the cache', () => {
    markOwnQdnAvatarChecked('Carol');
    expect(refreshOwnQdnAvatarOnce('Carol', 'ready')).toBe(false);
    expect(refreshQdnAvatar).not.toHaveBeenCalled();
  });
});
