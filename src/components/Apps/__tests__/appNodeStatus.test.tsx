import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../background/background', () => ({
  createEndpoint: async (path: string) => `http://node${path}`,
}));

import {
  classifyNodeStatus,
  getAppAvailability,
  invalidateAppNodeStatuses,
  isAppProbablyOnNode,
  resetAppNodeStatusForTests,
  useAppNodeStatus,
  watchAppNodeStatus,
} from '../appNodeStatus';

const app = (name: string, listed?: string) => ({
  name,
  service: 'APP',
  status: listed ? { status: listed } : undefined,
});

/** Node answers by app name; each call is recorded. */
let liveStatus: Record<string, any> = {};
let fetchMock: ReturnType<typeof vi.fn>;

const respond = (body: any, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

beforeEach(() => {
  vi.useFakeTimers();
  resetAppNodeStatusForTests();
  liveStatus = {};
  fetchMock = vi.fn((url: string) => {
    const name = decodeURIComponent(url.split('/').pop()!);
    const body = liveStatus[name];
    if (body === 'ERROR') return respond({}, false);
    return respond(body ?? { status: 'PUBLISHED' });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  resetAppNodeStatusForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const settle = async (ms = 400) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('classifyNodeStatus', () => {
  it('counts anything with the data on the node as ready', () => {
    expect(classifyNodeStatus('READY')).toBe('ready');
    expect(classifyNodeStatus('DOWNLOADED')).toBe('ready');
    expect(classifyNodeStatus('BUILDING')).toBe('ready');
    expect(classifyNodeStatus('DOWNLOADING')).toBe('downloading');
    expect(classifyNodeStatus('PUBLISHED')).toBe('not_on_node');
    expect(classifyNodeStatus('MISSING_DATA')).toBe('not_on_node');
    expect(classifyNodeStatus(undefined)).toBe('checking');
  });
});

describe('useAppNodeStatus', () => {
  it('does not trust a listed READY until the node confirms it', async () => {
    liveStatus.Stale = { status: 'PUBLISHED' };
    const { result } = renderHook(() =>
      useAppNodeStatus(app('Stale', 'READY'))
    );

    expect(result.current.availability).toBe('checking');
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://node/arbitrary/resource/status/APP/Stale'
    );
    expect(result.current.availability).toBe('not_on_node');
  });

  it('shows Open for an app the list calls BUILDING but the node has', async () => {
    liveStatus.Built = { status: 'DOWNLOADED' };
    const { result } = renderHook(() =>
      useAppNodeStatus(app('Built', 'BUILDING'))
    );
    await settle();

    expect(result.current.availability).toBe('ready');
  });

  it('shows a listed PUBLISHED as not on the node straight away', () => {
    const { result } = renderHook(() =>
      useAppNodeStatus(app('Fresh', 'PUBLISHED'))
    );
    expect(result.current.availability).toBe('not_on_node');
  });

  it('reports download progress from the chunk counts', async () => {
    liveStatus.Busy = {
      localChunkCount: 3,
      status: 'DOWNLOADING',
      totalChunkCount: 4,
    };
    const { result } = renderHook(() => useAppNodeStatus(app('Busy')));
    await settle();

    expect(result.current).toEqual({
      availability: 'downloading',
      percent: 75,
    });
  });

  it('falls back to the list when the node will not answer', async () => {
    liveStatus.Locked = 'ERROR';
    const { result } = renderHook(() =>
      useAppNodeStatus(app('Locked', 'READY'))
    );
    await settle();

    expect(result.current.availability).toBe('ready');
  });

  it('never asks about rows that were only scrolled past', async () => {
    const { unmount } = renderHook(() => useAppNodeStatus(app('Flung')));
    await settle(100);
    unmount();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks at most four at a time', async () => {
    let open = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      open++;
      peak = Math.max(peak, open);
      await new Promise((resolve) => setTimeout(resolve, 50));
      open--;
      return respond({ status: 'READY' });
    });
    for (let i = 0; i < 8; i++) {
      renderHook(() => useAppNodeStatus(app(`App${i}`)));
    }
    await settle(1000);

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(peak).toBe(4);
  });

  it('asks again after a manual refresh', async () => {
    renderHook(() => useAppNodeStatus(app('Again')));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => invalidateAppNodeStatuses());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('watchAppNodeStatus', () => {
  it('keeps checking an opened app until the node has it', async () => {
    liveStatus.Opened = { status: 'PUBLISHED' };
    const { result } = renderHook(() => useAppNodeStatus(app('Opened')));
    await settle();
    expect(result.current.availability).toBe('not_on_node');

    act(() => watchAppNodeStatus('APP', 'Opened'));
    liveStatus.Opened = {
      localChunkCount: 1,
      status: 'DOWNLOADING',
      totalChunkCount: 2,
    };
    await settle(2_000);
    expect(result.current).toEqual({
      availability: 'downloading',
      percent: 50,
    });

    liveStatus.Opened = { status: 'DOWNLOADED' };
    await settle(3_000);
    expect(result.current.availability).toBe('ready');

    const calls = fetchMock.mock.calls.length;
    await settle(30_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe('isAppProbablyOnNode', () => {
  it('uses the list generously until the node has answered', async () => {
    expect(isAppProbablyOnNode(app('Hint', 'DOWNLOADED'))).toBe(true);
    expect(getAppAvailability(app('Hint', 'DOWNLOADED'))).toBe('checking');

    liveStatus.Hint = { status: 'PUBLISHED' };
    renderHook(() => useAppNodeStatus(app('Hint', 'DOWNLOADED')));
    await settle();

    expect(isAppProbablyOnNode(app('Hint', 'DOWNLOADED'))).toBe(false);
  });
});
