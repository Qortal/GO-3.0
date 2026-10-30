import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { plugin, shown } = vi.hoisted(() => {
  // Every text the notification was given, start and updates in order.
  const shown: string[] = [];
  return {
    shown,
    plugin: {
      startPersistentStatus: vi.fn((payload: { detail: string }) => {
        shown.push(payload.detail);
        return Promise.resolve();
      }),
      updatePersistentStatus: vi.fn((payload: { detail: string }) => {
        shown.push(payload.detail);
        return Promise.resolve();
      }),
    },
  };
});

vi.mock('../plugins/QortalBackground', () => ({ QortalBackground: plugin }));
vi.mock('./platform', () => ({ isCapacitor: () => true }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('../bridge/capacitorBridge', () => ({
  getMobileReticulumStatus: () => null,
  onMobileReticulumStatus: () => () => {},
}));
vi.mock('../components/Reticulum/reticulumStatus', () => ({
  getDeviceOnline: () => true,
  reticulumDisplayPhase: () => 'online',
  subscribeDeviceOnline: () => () => {},
  subscribeReticulumStatus: () => () => {},
}));

const snapshot = (onlineCount: number) => ({
  reticulumLabel: 'Reticulum online',
  reticulumKind: 'online' as const,
  onlineCount,
  nodeLabel: 'Public node',
  syncLabel: 'Synchronized',
  peersLabel: `0 connected peers · ${onlineCount} online`,
});

describe('status notification rate limit', () => {
  beforeEach(() => {
    plugin.startPersistentStatus.mockClear();
    plugin.updatePersistentStatus.mockClear();
    shown.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a waiting change once the state is back to what is shown', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { updateMobilePersistentStatus } =
      await import('./mobileBackgroundService');

    await updateMobilePersistentStatus(snapshot(5));
    vi.advanceTimersByTime(1_000);
    await updateMobilePersistentStatus(snapshot(6));
    vi.advanceTimersByTime(1_000);
    await updateMobilePersistentStatus(snapshot(5));
    vi.advanceTimersByTime(10_000);

    expect(
      plugin.updatePersistentStatus.mock.calls.map(
        ([payload]) => payload.detail
      )
    ).toEqual(['Reticulum online · 5 online']);
  });

  it('compares later updates with the text the start put up', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { startMobilePersistentStatus, updateMobilePersistentStatus } =
      await import('./mobileBackgroundService');

    await updateMobilePersistentStatus(snapshot(5));
    await startMobilePersistentStatus({
      ...snapshot(5),
      reticulumLabel: 'Reticulum starting',
      reticulumKind: 'starting',
    });
    vi.advanceTimersByTime(500);
    await updateMobilePersistentStatus(snapshot(6));
    vi.advanceTimersByTime(500);
    await updateMobilePersistentStatus(snapshot(5));
    vi.advanceTimersByTime(10_000);

    expect(shown[shown.length - 1]).toBe('Reticulum online · 5 online');
  });
});
