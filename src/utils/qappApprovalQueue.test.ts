import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModal } from '../hooks/useModal';
import {
  acceptedPermissionResult,
  isApprovalAcceptable,
  type ApprovalDecision,
} from './qappApproval';
import {
  DECLINE_ALL_MUTE_MS,
  INTERNAL_APP_GROUP,
  MAX_REQUESTS_PER_APP,
  UNKNOWN_APP_GROUP,
  approvalDedupeKey,
  approvalGroupKey,
  createApprovalMuteList,
  requestQappApproval,
  type PermissionResult,
} from './qappApprovalQueue';

const NOW = new Date('2026-10-02T03:00:00Z').getTime();
const WALLETS = { name: 'Q-Wallets', service: 'APP' };
const OTHER = { name: 'Other-App', service: 'APP' };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type Modal = ReturnType<typeof useModal>;

/** A permission request as get.ts posts it. */
const request = (
  payload: Record<string, unknown>,
  appInfo: unknown = WALLETS
) => ({
  payload,
  appInfo,
  expiresAt: NOW + 60_000,
});

/** Sends a request through the glue and records its answer. */
function ask(
  modal: { current: Modal },
  message: ReturnType<typeof request>,
  answers: PermissionResult[],
  muteList = createApprovalMuteList()
) {
  return requestQappApproval({
    message,
    show: modal.current.show,
    respond: (result) => answers.push(result),
    now: NOW,
    muteList,
  });
}

/** What App.tsx does on Accept. */
function accept(
  modal: { current: Modal },
  decision: Partial<ApprovalDecision>
) {
  const full: ApprovalDecision = {
    requestId: modal.current.requestId,
    confirmed: false,
    ...decision,
  };
  if (
    !isApprovalAcceptable(modal.current.message, modal.current.requestId, full)
  ) {
    return false;
  }
  modal.current.okRequest(
    modal.current.requestId!,
    acceptedPermissionResult(modal.current.message, full)
  );
  return true;
}

describe('approvalGroupKey', () => {
  it('groups by the app GO named, never by the payload', () => {
    expect(approvalGroupKey({ requestingApp: WALLETS })).toBe(
      'app:APP:Q-Wallets'
    );
    expect(approvalGroupKey({ requestingApp: null, appName: 'X' })).toBe(
      UNKNOWN_APP_GROUP
    );
    expect(
      approvalGroupKey({
        requestingApp: { name: '', service: null, internal: true },
      })
    ).toBe(INTERNAL_APP_GROUP);
    expect(approvalGroupKey(null)).toBe(UNKNOWN_APP_GROUP);
  });
});

describe('approvalDedupeKey', () => {
  it('coalesces only requests that need the tick, ignoring the deadline', () => {
    const pay = {
      text1: 'Send',
      confirmCheckbox: true,
      requestingApp: WALLETS,
    };
    expect(approvalDedupeKey({ ...pay, expiresAt: 1 })).toBe(
      approvalDedupeKey({ ...pay, expiresAt: 2 })
    );
    expect(approvalDedupeKey({ ...pay, requestingApp: OTHER })).not.toBe(
      approvalDedupeKey(pay)
    );
    expect(approvalDedupeKey({ text1: 'Sign in' })).toBeNull();
  });
});

describe('createApprovalMuteList', () => {
  it('mutes a group until the given time', () => {
    const list = createApprovalMuteList();
    list.mute('app:A', NOW + 1000);
    expect(list.isMuted('app:A', NOW)).toBe(true);
    expect(list.isMuted('app:B', NOW)).toBe(false);
    expect(list.isMuted('app:A', NOW + 1000)).toBe(false);
  });
});

describe('requestQappApproval (App.tsx glue, GO-28)', () => {
  it("answers Accept with the request's own checkbox", async () => {
    const { result: modal } = renderHook(() => useModal());
    const answers: PermissionResult[] = [];
    let done: Promise<void>;
    act(() => {
      done = ask(
        modal,
        request({
          text1: 'Sign in',
          checkbox1: { value: false, label: 'Always' },
        }),
        answers
      );
    });
    expect(modal.current.message.requestingApp).toEqual(WALLETS);
    act(() => {
      accept(modal, { checkbox1: true });
    });
    await act(() => done);
    expect(answers).toEqual([{ accepted: true, checkbox1: true }]);
  });

  it('answers Accept without a checkbox when the request has none', async () => {
    const { result: modal } = renderHook(() => useModal());
    const answers: PermissionResult[] = [];
    let done: Promise<void>;
    act(() => {
      done = ask(modal, request({ text1: 'Read balance' }), answers);
    });
    act(() => {
      accept(modal, { checkbox1: true });
    });
    await act(() => done);
    expect(answers).toEqual([{ accepted: true }]);
  });

  it('answers Decline and a timeout with accepted: false', async () => {
    const { result: modal } = renderHook(() => useModal());
    const answers: PermissionResult[] = [];
    let first: Promise<void>;
    let second: Promise<void>;
    act(() => {
      first = ask(modal, request({ text1: 'A' }), answers);
      second = ask(modal, request({ text1: 'B' }), answers);
    });
    act(() => modal.current.cancelRequest(modal.current.requestId!));
    await act(() => first);
    // B's countdown ran out.
    act(() => modal.current.cancelRequest(modal.current.requestId!));
    await act(() => second);
    expect(answers).toEqual([{ accepted: false }, { accepted: false }]);
  });

  it('queues a second request and gives each its own answer', async () => {
    const { result: modal } = renderHook(() => useModal());
    const first: PermissionResult[] = [];
    const second: PermissionResult[] = [];
    let doneFirst: Promise<void>;
    let doneSecond: Promise<void>;
    act(() => {
      doneFirst = ask(modal, request({ text1: 'Sign in' }), first);
      doneSecond = ask(
        modal,
        request({ text1: 'Send', confirmCheckbox: true }),
        second
      );
    });
    expect(modal.current.message.text1).toBe('Sign in');
    expect(modal.current.pendingCount).toBe(1);
    const firstId = modal.current.requestId;

    act(() => {
      accept(modal, {});
    });
    await act(() => doneFirst);
    expect(first).toEqual([{ accepted: true }]);
    expect(second).toEqual([]);

    // A late Accept for the first request does not answer the second.
    act(() => {
      expect(accept(modal, { requestId: firstId, confirmed: true })).toBe(
        false
      );
    });
    // Nor does an Accept without the tick.
    act(() => {
      expect(accept(modal, {})).toBe(false);
    });
    act(() => {
      expect(accept(modal, { confirmed: true })).toBe(true);
    });
    await act(() => doneSecond);
    expect(second).toEqual([{ accepted: true }]);
  });

  it('declines an equal value-moving request from the same app at once', async () => {
    const { result: modal } = renderHook(() => useModal());
    const answers: PermissionResult[] = [];
    const pay = { text1: 'Send 1 QORT', confirmCheckbox: true };
    let duplicate: Promise<void>;
    act(() => {
      ask(modal, request(pay), []);
      duplicate = ask(modal, request(pay), answers);
    });
    await act(() => duplicate);
    expect(answers).toEqual([{ accepted: false }]);
    expect(modal.current.pendingCount).toBe(0);

    // The same payment from another app is another request.
    act(() => {
      ask(modal, request(pay, OTHER), []);
    });
    expect(modal.current.pendingCount).toBe(1);
  });

  it('queues equal requests that move no value', async () => {
    const { result: modal } = renderHook(() => useModal());
    act(() => {
      ask(modal, request({ text1: 'Sign in' }), []);
      ask(modal, request({ text1: 'Sign in' }), []);
    });
    expect(modal.current.pendingCount).toBe(1);
  });

  it('declines requests over the per-app limit', async () => {
    const { result: modal } = renderHook(() => useModal());
    const answers: PermissionResult[] = [];
    let last: Promise<void>;
    act(() => {
      for (let i = 0; i < MAX_REQUESTS_PER_APP; i += 1) {
        ask(modal, request({ text1: `Read ${i}` }), []);
      }
      last = ask(modal, request({ text1: 'One too many' }), answers);
    });
    await act(() => last);
    expect(answers).toEqual([{ accepted: false }]);
    expect(modal.current.pendingCount).toBe(MAX_REQUESTS_PER_APP - 1);

    // Another app still gets through.
    act(() => {
      ask(modal, request({ text1: 'Other' }, OTHER), []);
    });
    expect(modal.current.pendingCount).toBe(MAX_REQUESTS_PER_APP);
  });

  it('declines a muted app without showing anything', async () => {
    const { result: modal } = renderHook(() => useModal());
    const muteList = createApprovalMuteList();
    muteList.mute('app:APP:Q-Wallets', NOW + DECLINE_ALL_MUTE_MS);
    const answers: PermissionResult[] = [];
    await act(() => ask(modal, request({ text1: 'Again' }), answers, muteList));
    expect(answers).toEqual([{ accepted: false }]);
    expect(modal.current.isShow).toBe(false);
  });

  it('answers once with accepted: false when the dialog fails', async () => {
    const respond = vi.fn();
    await requestQappApproval({
      message: request({ text1: 'A' }),
      show: () => Promise.reject(new Error('boom')),
      respond,
      now: NOW,
    });
    await settle();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({ accepted: false });
  });

  it('never accepts on an answer that is not a clear yes', async () => {
    const respond = vi.fn();
    await requestQappApproval({
      message: request({ text1: 'A' }),
      show: async () => ({ accepted: 'yes' }),
      respond,
      now: NOW,
    });
    expect(respond).toHaveBeenCalledWith({ accepted: false });
  });
});
