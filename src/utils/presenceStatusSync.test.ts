import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectableStatus } from '../atoms/presence';
import {
  PRESENCE_STATUS_STATE_KEY,
  parsePresenceStatusValue,
  PresenceStatusSyncController,
  type PresenceStatusSyncChat,
} from './presenceStatusSync';

type Changed = Parameters<
  Parameters<PresenceStatusSyncChat['onDeviceStateChanged']>[0]
>[0];

function fakeChat(initial: Record<string, string | null> = {}) {
  const store = new Map(Object.entries(initial));
  let readiness = { state: 'starting' as const, revision: 1 } as {
    state: 'idle' | 'starting' | 'ready' | 'failed';
    revision: number;
  };
  const changedCbs = new Set<(payload: Changed) => void>();
  const readinessCbs = new Set<(status: typeof readiness) => void>();
  const setResults: boolean[] = [];
  const chat: PresenceStatusSyncChat = {
    getReadinessStatus: vi.fn(async () => readiness),
    onReadinessChanged: (cb) => {
      readinessCbs.add(cb);
      return () => readinessCbs.delete(cb);
    },
    setDeviceState: vi.fn(async (_owner, key, value) => {
      const success = setResults.length ? setResults.shift()! : true;
      if (success) store.set(key, value);
      return { success };
    }),
    getDeviceStates: vi.fn(async (_owner, prefix = '') =>
      [...store]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }))
    ),
    onDeviceStateChanged: (cb) => {
      changedCbs.add(cb);
      return () => changedCbs.delete(cb);
    },
  };
  return {
    chat,
    store,
    setResults,
    becomeReady: (revision = 2) => {
      readiness = { state: 'ready', revision };
      readinessCbs.forEach((cb) => cb(readiness));
    },
    remote: (value: string | null, owner = 'QMe') =>
      changedCbs.forEach((cb) =>
        cb({
          ownerAddress: owner,
          key: PRESENCE_STATUS_STATE_KEY,
          value,
          source: 'remote',
        })
      ),
  };
}

function setup(chat: PresenceStatusSyncChat, initial: SelectableStatus) {
  let status = initial;
  const applied: SelectableStatus[] = [];
  const controller = new PresenceStatusSyncController({
    address: 'QMe',
    chat,
    getStatus: () => status,
    applyStatus: (next) => {
      status = next;
      applied.push(next);
    },
  });
  controller.start();
  return {
    controller,
    applied,
    pick: (next: SelectableStatus) => {
      status = next;
      controller.onLocalChoice(next);
    },
  };
}

describe('presence status sync', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
  });

  it('parses only the pickable statuses', () => {
    expect(parsePresenceStatusValue('busy')).toBe('busy');
    expect(parsePresenceStatusValue('offline')).toBe('offline');
    expect(parsePresenceStatusValue('idle')).toBeNull();
    expect(parsePresenceStatusValue(null)).toBeNull();
  });

  it('takes the account status the other device picked once the engine is ready', async () => {
    const fake = fakeChat({ [PRESENCE_STATUS_STATE_KEY]: 'busy' });
    const { controller, applied } = setup(fake.chat, 'online');
    dispose = () => controller.dispose();

    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual([]);

    fake.becomeReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual(['busy']);
  });

  it('publishes a pick made before the engine was ready, and it wins', async () => {
    const fake = fakeChat({ [PRESENCE_STATUS_STATE_KEY]: 'busy' });
    const { controller, applied, pick } = setup(fake.chat, 'online');
    dispose = () => controller.dispose();

    pick('offline');
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.chat.setDeviceState).not.toHaveBeenCalled();

    fake.becomeReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.store.get(PRESENCE_STATUS_STATE_KEY)).toBe('offline');
    expect(applied).toEqual([]);
  });

  it('applies picks from the other device and ignores other accounts', async () => {
    const fake = fakeChat();
    const { controller, applied } = setup(fake.chat, 'online');
    dispose = () => controller.dispose();
    fake.becomeReady();
    await vi.advanceTimersByTimeAsync(0);

    fake.remote('busy');
    fake.remote('offline', 'QSomeoneElse');
    fake.remote('idle');
    expect(applied).toEqual(['busy']);
  });

  it('retries a pick the engine could not sign yet', async () => {
    const fake = fakeChat();
    const { controller, pick } = setup(fake.chat, 'online');
    dispose = () => controller.dispose();
    fake.becomeReady();
    await vi.advanceTimersByTimeAsync(0);

    fake.setResults.push(false);
    pick('busy');
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.store.get(PRESENCE_STATUS_STATE_KEY)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.store.get(PRESENCE_STATUS_STATE_KEY)).toBe('busy');
  });
});
