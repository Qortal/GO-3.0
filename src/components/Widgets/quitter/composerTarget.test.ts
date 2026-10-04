import { beforeEach, describe, expect, it, vi } from 'vitest';

const setShareTarget = vi.fn(async (_target: string) => undefined);
vi.mock('../../../plugins/ShareReceiver', () => ({
  ShareReceiver: { setShareTarget: (target: string) => setShareTarget(target) },
}));

import { getDefaultStore } from 'jotai';
import {
  composerTargetAtom,
  composerTargetOrder,
  readComposerTarget,
  setComposerTarget,
  substituteComposerApp,
  syncComposerShareTarget,
} from './composerTarget';

beforeEach(() => {
  localStorage.clear();
  setShareTarget.mockClear();
  getDefaultStore().set(composerTargetAtom, 'quitter');
});

describe('composer target', () => {
  it('puts the chosen app first in the switch', () => {
    expect(composerTargetOrder('quitter')).toEqual(['quitter', 'torq']);
    expect(composerTargetOrder('torq')).toEqual(['torq', 'quitter']);
  });

  it('swaps Quitter for Torq in app lists only when Torq is chosen', () => {
    const apps = ['Q-Tube', 'Quitter', 'Q-Mail'] as const;
    expect(substituteComposerApp(apps, 'quitter')).toEqual([
      'Q-Tube',
      'Quitter',
      'Q-Mail',
    ]);
    expect(substituteComposerApp(apps, 'torq')).toEqual([
      'Q-Tube',
      'Torq',
      'Q-Mail',
    ]);
  });

  it('remembers the choice, shares it with Home and renames the share entry', () => {
    setComposerTarget('torq');
    expect(readComposerTarget()).toBe('torq');
    expect(getDefaultStore().get(composerTargetAtom)).toBe('torq');
    expect(setShareTarget).toHaveBeenLastCalledWith('torq');

    setComposerTarget('quitter');
    expect(readComposerTarget()).toBe('quitter');
    expect(setShareTarget).toHaveBeenLastCalledWith('quitter');
  });

  it('re-applies the stored choice to the share sheet at boot', () => {
    getDefaultStore().set(composerTargetAtom, 'torq');
    syncComposerShareTarget();
    expect(setShareTarget).toHaveBeenCalledWith('torq');
  });
});
