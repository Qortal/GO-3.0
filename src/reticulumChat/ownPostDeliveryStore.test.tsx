import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyOwnPostDeliveryUpdates,
  getOwnPostDelivery,
  ownPostDeliverySubscribedIdCount,
  resetOwnPostDeliveryStoreForTests,
  startOwnPostDeliveryListener,
  subscribeOwnPostDelivery,
  useOwnPostDelivery,
} from './ownPostDeliveryStore';

type Listener = (payload: unknown) => void;
let engineListeners: Listener[];
let unsubscribed: number;

beforeEach(() => {
  engineListeners = [];
  unsubscribed = 0;
  (window as any).reticulumChat = {
    onOwnPostDelivery: vi.fn((cb: Listener) => {
      engineListeners.push(cb);
      return () => {
        unsubscribed += 1;
        engineListeners = engineListeners.filter((entry) => entry !== cb);
      };
    }),
  };
});

afterEach(() => {
  resetOwnPostDeliveryStoreForTests();
  delete (window as any).reticulumChat;
});

const fromEngine = (updates: unknown[]) => {
  for (const listener of engineListeners) listener({ updates });
};

describe('ownPostDeliveryStore', () => {
  it('only moves forward: a proof time is never cleared or replaced', () => {
    expect(
      applyOwnPostDeliveryUpdates({
        updates: [{ eventId: 'p1', scope: 'group', ownDeviceAt: 100 }],
      })
    ).toBe(1);
    expect(getOwnPostDelivery('p1')).toEqual({ ownDeviceAt: 100 });

    // A later or repeated own-device proof changes nothing.
    expect(
      applyOwnPostDeliveryUpdates({
        updates: [{ eventId: 'p1', scope: 'group', ownDeviceAt: 200 }],
      })
    ).toBe(0);
    // An update without a proof time takes nothing back.
    expect(
      applyOwnPostDeliveryUpdates({
        updates: [
          { eventId: 'p1', scope: 'group', ownDeviceAt: 0, memberAt: null },
        ],
      })
    ).toBe(0);
    expect(getOwnPostDelivery('p1')).toEqual({ ownDeviceAt: 100 });

    // A member proof adds to it.
    expect(
      applyOwnPostDeliveryUpdates({
        updates: [{ eventId: 'p1', scope: 'group', memberAt: 300 }],
      })
    ).toBe(1);
    expect(getOwnPostDelivery('p1')).toEqual({
      ownDeviceAt: 100,
      memberAt: 300,
    });
  });

  it('never records a member for a Saved Message', () => {
    applyOwnPostDeliveryUpdates({
      updates: [{ eventId: 's1', scope: 'self_dm', memberAt: 50 }],
    });
    expect(getOwnPostDelivery('s1')).toBeUndefined();
    applyOwnPostDeliveryUpdates({
      updates: [
        { eventId: 's1', scope: 'self_dm', ownDeviceAt: 60, memberAt: 70 },
      ],
    });
    expect(getOwnPostDelivery('s1')).toEqual({ ownDeviceAt: 60 });
  });

  it('ignores malformed payloads', () => {
    for (const payload of [
      null,
      undefined,
      {},
      { updates: 'x' },
      { updates: [null, { scope: 'group', ownDeviceAt: 1 }, { eventId: 7 }] },
    ]) {
      expect(applyOwnPostDeliveryUpdates(payload)).toBe(0);
    }
  });

  it('notifies only the subscribers of the posts that moved', () => {
    const one = vi.fn();
    const two = vi.fn();
    subscribeOwnPostDelivery('p1', one);
    const offTwo = subscribeOwnPostDelivery('p2', two);

    fromEngine([{ eventId: 'p1', scope: 'group', memberAt: 10 }]);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();

    // No change, no notify.
    fromEngine([{ eventId: 'p1', scope: 'group', memberAt: 11 }]);
    expect(one).toHaveBeenCalledTimes(1);

    offTwo();
    fromEngine([{ eventId: 'p2', scope: 'group', ownDeviceAt: 12 }]);
    expect(two).not.toHaveBeenCalled();
    expect(getOwnPostDelivery('p2')).toEqual({ ownDeviceAt: 12 });
  });

  it('starts one engine listener on the first subscriber and keeps it', () => {
    const api = (window as any).reticulumChat;
    expect(api.onOwnPostDelivery).not.toHaveBeenCalled();
    const offA = subscribeOwnPostDelivery('p1', () => {});
    const offB = subscribeOwnPostDelivery('p2', () => {});
    expect(api.onOwnPostDelivery).toHaveBeenCalledTimes(1);
    offA();
    offB();
    expect(ownPostDeliverySubscribedIdCount()).toBe(0);
    expect(unsubscribed).toBe(0);
    // A proof while no chat is open is still kept.
    fromEngine([{ eventId: 'p3', scope: 'group', memberAt: 5 }]);
    expect(getOwnPostDelivery('p3')).toEqual({ memberAt: 5 });
  });

  it('can start the engine listener before any glyph subscribes', () => {
    const api = (window as any).reticulumChat;
    startOwnPostDeliveryListener();
    startOwnPostDeliveryListener();
    subscribeOwnPostDelivery('p1', () => {});
    expect(api.onOwnPostDelivery).toHaveBeenCalledTimes(1);
    fromEngine([{ eventId: 'p9', scope: 'self_dm', ownDeviceAt: 9 }]);
    expect(getOwnPostDelivery('p9')).toEqual({ ownDeviceAt: 9 });
  });

  it('does nothing without the engine event (desktop)', () => {
    (window as any).reticulumChat = {};
    const off = subscribeOwnPostDelivery('p1', () => {});
    expect(getOwnPostDelivery('p1')).toBeUndefined();
    off();
    delete (window as any).reticulumChat;
    expect(() => subscribeOwnPostDelivery('p1', () => {})()).not.toThrow();
  });

  it('re-renders a reader when its post moves forward', () => {
    const seen: unknown[] = [];
    const Reader = ({ eventId }: { eventId: string }) => {
      seen.push(useOwnPostDelivery(eventId));
      return null;
    };
    render(<Reader eventId="p1" />);
    expect(seen).toEqual([undefined]);
    act(() => {
      fromEngine([{ eventId: 'other', scope: 'group', memberAt: 1 }]);
    });
    expect(seen).toHaveLength(1);
    act(() => {
      fromEngine([{ eventId: 'p1', scope: 'group', ownDeviceAt: 2 }]);
    });
    expect(seen[seen.length - 1]).toEqual({ ownDeviceAt: 2 });
  });
});
