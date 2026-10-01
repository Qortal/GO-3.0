import { describe, expect, it } from 'vitest';
import {
  reticulumDisplayLabel,
  reticulumDisplayPhase,
} from './reticulumStatus';

describe('reticulumDisplayPhase', () => {
  it('shows connecting when transport is up but no peers', () => {
    expect(reticulumDisplayPhase('online', 0, true)).toBe('connecting');
    expect(
      reticulumDisplayLabel(reticulumDisplayPhase('online', 0, true))
    ).toBe('connecting');
  });

  it('shows online only after peers are reached', () => {
    expect(reticulumDisplayPhase('online', 3, true)).toBe('online');
    expect(
      reticulumDisplayLabel(reticulumDisplayPhase('online', 3, true))
    ).toBe('online');
  });

  it('shows offline when the phone has no network', () => {
    expect(reticulumDisplayPhase('online', 5, false)).toBe('offline');
    expect(reticulumDisplayPhase('connecting', 0, false)).toBe('offline');
    expect(
      reticulumDisplayLabel(reticulumDisplayPhase('online', 5, false))
    ).toBe('offline');
  });

  it('shows online when peers are live even if transport reports offline', () => {
    expect(reticulumDisplayPhase('offline', 4, true)).toBe('online');
  });
});

describe('chat engine readiness in the badge store', () => {
  it('ignores a stale replay and keeps the newer live state', async () => {
    const {
      applyChatEngineReadiness,
      subscribeReticulumStatus,
      chatEngineLabel,
    } = await import('./reticulumStatus');
    const seen: Array<string | null> = [];
    const off = subscribeReticulumStatus((s) => seen.push(s.chatEngineState));
    applyChatEngineReadiness({ state: 'starting', revision: 5, since: 1000 });
    applyChatEngineReadiness({ state: 'ready', revision: 6, since: 2000 });
    // A replay that was answered before the `ready` transition arrives late.
    applyChatEngineReadiness({ state: 'starting', revision: 5, since: 1000 });
    off();
    expect(seen[seen.length - 1]).toBe('ready');
    expect(
      chatEngineLabel({ chatEngineState: 'ready', chatEngineSince: 2000 }, 9000)
    ).toBe('ready');
  });

  it('counts up while starting and stays plain for the first seconds', async () => {
    const { chatEngineLabel } = await import('./reticulumStatus');
    const since = 10_000;
    expect(
      chatEngineLabel(
        { chatEngineState: 'starting', chatEngineSince: since },
        since + 2_000
      )
    ).toBe('starting');
    expect(
      chatEngineLabel(
        { chatEngineState: 'starting', chatEngineSince: since },
        since + 47_000
      )
    ).toBe('starting · 47 s');
    expect(
      chatEngineLabel({ chatEngineState: null, chatEngineSince: null })
    ).toBe('idle');
  });
});
