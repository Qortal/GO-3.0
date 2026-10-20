import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A ring beside a running call (useNativeSideRing), on "GO" with the native
// call module and the QortalCall plugin faked.
const native = vi.hoisted(() => ({
  show: vi.fn(async (_o: Record<string, unknown>) => undefined),
  cancel: vi.fn(async (_id: string, _reason?: string) => undefined),
  silence: vi.fn(async (_id?: string | null) => undefined),
  avatar: vi.fn(async (_url: string | null | undefined) => 'data:image/png;x'),
  listeners: [] as Array<(event: { action?: string; callId?: string }) => void>,
  removed: 0,
}));

vi.mock('../../../utils/platform', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../utils/platform')>();
  return { ...actual, isCapacitor: () => true };
});
vi.mock('../../../bridge/nativeCallSession', () => ({
  // Not used here (the session hook has its own tests).
  useNativeCallSession: undefined,
  setNativeCallStrings: undefined,
  nativeShowIncomingCall: native.show,
  nativeCancelIncomingCall: native.cancel,
  nativeSilenceRing: native.silence,
  avatarDataUrlFor: native.avatar,
}));
vi.mock('../../../plugins/QortalCall', () => ({
  QortalCall: {
    addListener: vi.fn(
      async (
        _event: string,
        cb: (event: { action?: string; callId?: string }) => void
      ) => {
        native.listeners.push(cb);
        return {
          remove: () => {
            native.removed += 1;
            native.listeners = native.listeners.filter((l) => l !== cb);
          },
        };
      }
    ),
  },
}));

import { useNativeSideRing } from './callBridgeAdapters';

const flush = () => act(async () => {});

beforeEach(() => {
  native.show.mockClear();
  native.cancel.mockClear();
  native.silence.mockClear();
  native.avatar.mockClear();
  native.listeners = [];
  native.removed = 0;
});

describe('useNativeSideRing', () => {
  const base = {
    callId: 'c1',
    fromAddress: 'QBob',
    fromName: 'bob',
    avatarUrl: 'http://node/avatar',
  };

  it('posts the ring, handles its own notification buttons, cancels at the end', async () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) =>
        useNativeSideRing({ ...base, ...props, onAccept, onDecline }),
      { initialProps: { enabled: true } }
    );
    await flush();
    expect(native.show).toHaveBeenCalled();
    expect(
      native.show.mock.calls[native.show.mock.calls.length - 1]?.[0]
    ).toEqual({
      callId: 'c1',
      fromAddress: 'QBob',
      fromName: 'bob',
      avatarDataUrl: 'data:image/png;x',
      kind: 'dm',
    });

    // Another call's action (the running group call) is not for this ring.
    act(() =>
      native.listeners.forEach((l) =>
        l({ action: 'accept', callId: 'gcall-qortal-1' })
      )
    );
    expect(onAccept).not.toHaveBeenCalled();
    act(() =>
      native.listeners.forEach((l) => l({ action: 'accept', callId: 'c1' }))
    );
    expect(onAccept).toHaveBeenCalledTimes(1);
    act(() =>
      native.listeners.forEach((l) => l({ action: 'decline', callId: 'c1' }))
    );
    expect(onDecline).toHaveBeenCalledTimes(1);

    act(() => result.current.silence());
    expect(native.silence).toHaveBeenCalledWith('c1');

    rerender({ enabled: false });
    await flush();
    expect(native.cancel).toHaveBeenCalledWith('c1', 'page-ring-ended');
    expect(native.listeners).toHaveLength(0);
  });

  it('does nothing while disabled', async () => {
    const { result } = renderHook(() =>
      useNativeSideRing({
        ...base,
        enabled: false,
        onAccept: vi.fn(),
        onDecline: vi.fn(),
      })
    );
    await flush();
    act(() => result.current.silence());
    expect(native.show).not.toHaveBeenCalled();
    expect(native.silence).not.toHaveBeenCalled();
    expect(native.listeners).toHaveLength(0);
  });
});
