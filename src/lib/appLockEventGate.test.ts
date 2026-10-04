import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_LOCK_EVENT_TTL_MS,
  createAppLockEventGate,
  type AppLockEventGate,
} from './appLockEventGate';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';

let uninstall: (() => void) | null = null;
const listeners: Array<[string, EventListener]> = [];

const listen = (name: string) => {
  const listener = vi.fn();
  subscribeToEvent(name, listener);
  listeners.push([name, listener]);
  return listener;
};

const setup = (options: { locked: boolean; now?: () => number }) => {
  const state = { locked: options.locked };
  const gate: AppLockEventGate = createAppLockEventGate({
    isLocked: () => state.locked,
    now: options.now,
  });
  uninstall = gate.install();
  return { gate, state };
};

afterEach(() => {
  uninstall?.();
  uninstall = null;
  listeners.splice(0).forEach(([name, l]) => unsubscribeFromEvent(name, l));
});

describe('app lock event gate', () => {
  it('lets events through while unlocked', () => {
    setup({ locked: false });
    const addTab = listen('addTab');
    executeEvent('addTab', { data: { name: 'Q-Tube' } });
    expect(addTab).toHaveBeenCalledTimes(1);
  });

  it('holds a deep-linked tab while locked and opens it after unlock', () => {
    const { gate, state } = setup({ locked: true });
    const addTab = listen('addTab');
    const appsMode = listen('open-apps-mode');
    const data = { service: 'APP', name: 'Evil' };
    executeEvent('addTab', { data });
    executeEvent('open-apps-mode', {});
    expect(addTab).not.toHaveBeenCalled();
    expect(appsMode).not.toHaveBeenCalled();
    expect(gate.size()).toBe(2);

    state.locked = false;
    expect(gate.flush()).toBe(2);
    expect(addTab).toHaveBeenCalledTimes(1);
    expect((addTab.mock.calls[0][0] as CustomEvent).detail).toEqual({ data });
    expect(appsMode).toHaveBeenCalledTimes(1);
    expect(gate.size()).toBe(0);
  });

  it('holds Q-App PDF and profile viewers too', () => {
    setup({ locked: true });
    const pdf = listen('openPdf');
    const profile = listen('openUserLookupDrawer');
    executeEvent('openPdf', { blob: 'x' });
    executeEvent('openUserLookupDrawer', { addressOrName: 'x' });
    expect(pdf).not.toHaveBeenCalled();
    expect(profile).not.toHaveBeenCalled();
  });

  it('does not touch other events', () => {
    setup({ locked: true });
    const other = listen('openGroupMessage');
    executeEvent('openGroupMessage', {});
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('drops held events that went stale', () => {
    let now = 0;
    const { gate, state } = setup({ locked: true, now: () => now });
    const addTab = listen('addTab');
    executeEvent('addTab', { data: { name: 'old' } });
    now = APP_LOCK_EVENT_TTL_MS + 1;
    executeEvent('addTab', { data: { name: 'new' } });
    state.locked = false;
    expect(gate.flush()).toBe(1);
    expect((addTab.mock.calls[0][0] as CustomEvent).detail).toEqual({
      data: { name: 'new' },
    });
  });

  it('keeps only the newest events when flooded', () => {
    const { gate } = setup({ locked: true });
    for (let i = 0; i < 20; i += 1) executeEvent('addTab', { data: { i } });
    expect(gate.size()).toBe(8);
  });

  it('forgets held events on clear (logout)', () => {
    const { gate, state } = setup({ locked: true });
    const addTab = listen('addTab');
    executeEvent('addTab', { data: {} });
    gate.clear();
    state.locked = false;
    expect(gate.flush()).toBe(0);
    expect(addTab).not.toHaveBeenCalled();
  });

  it('stops listening once uninstalled', () => {
    setup({ locked: true });
    uninstall?.();
    uninstall = null;
    const addTab = listen('addTab');
    executeEvent('addTab', { data: {} });
    expect(addTab).toHaveBeenCalledTimes(1);
  });
});
