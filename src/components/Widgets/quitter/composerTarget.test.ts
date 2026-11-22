import { beforeEach, describe, expect, it, vi } from 'vitest';

const setShareTarget = vi.fn(async (_target: string) => undefined);
vi.mock('../../../plugins/ShareReceiver', () => ({
  ShareReceiver: { setShareTarget: (target: string) => setShareTarget(target) },
}));

import { HOME_POST_APP, syncComposerShareTarget } from './composerTarget';

beforeEach(() => {
  localStorage.clear();
  setShareTarget.mockClear();
});

describe('Home posts to Torq', () => {
  it('names Torq as the app Home posts to and shows', () => {
    expect(HOME_POST_APP).toBe('Torq');
  });

  it('points the share sheet at Torq at boot', () => {
    syncComposerShareTarget();
    expect(setShareTarget).toHaveBeenCalledTimes(1);
    expect(setShareTarget).toHaveBeenCalledWith('torq');
  });

  it('moves a phone that had chosen Quitter to Torq', () => {
    localStorage.setItem('go-home-composer-target', 'quitter');
    syncComposerShareTarget();
    expect(setShareTarget).toHaveBeenCalledWith('torq');
    expect(setShareTarget).not.toHaveBeenCalledWith('quitter');
    expect(localStorage.getItem('go-home-composer-target')).toBeNull();
  });
});
