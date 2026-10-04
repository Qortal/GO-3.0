import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useModal } from './useModal';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useModal request queue (GO-28)', () => {
  it('shows a request and resolves it with the Accept payload', async () => {
    const { result } = renderHook(() => useModal());
    let answer: unknown;
    act(() => {
      result.current.show({ text1: 'A' }).then((value) => (answer = value));
    });
    expect(result.current.isShow).toBe(true);
    expect(result.current.message).toEqual({ text1: 'A' });
    expect(result.current.requestId).toBe(1);
    expect(result.current.pendingCount).toBe(0);

    act(() => result.current.onOk({ accepted: true }));
    await settle();
    expect(answer).toEqual({ accepted: true });
    expect(result.current.isShow).toBe(false);
    expect(result.current.requestId).toBeNull();
    expect(result.current.message).toEqual({ publishFee: '', message: '' });
  });

  it('queues a second request instead of replacing the open one', async () => {
    const { result } = renderHook(() => useModal());
    const answers: string[] = [];
    act(() => {
      result.current.show({ text1: 'A' }).then(() => answers.push('A ok'));
      result.current
        .show({ text1: 'B' })
        .then(() => answers.push('B ok'))
        .catch(() => answers.push('B declined'));
    });
    // A stays on screen; B waits.
    expect(result.current.message).toEqual({ text1: 'A' });
    expect(result.current.requestId).toBe(1);
    expect(result.current.pendingCount).toBe(1);

    act(() => result.current.onOk('yes'));
    await settle();
    expect(answers).toEqual(['A ok']);
    expect(result.current.message).toEqual({ text1: 'B' });
    expect(result.current.requestId).toBe(2);
    expect(result.current.pendingCount).toBe(0);

    act(() => result.current.onCancel());
    await settle();
    expect(answers).toEqual(['A ok', 'B declined']);
    expect(result.current.isShow).toBe(false);
  });

  it('answers by id only the request with that id', async () => {
    const { result } = renderHook(() => useModal());
    const answers: string[] = [];
    act(() => {
      result.current.show('A').then((v) => answers.push(`A ${v}`));
      result.current.show('B').then((v) => answers.push(`B ${v}`));
    });

    // An Accept meant for A arrives twice: the second must not answer B.
    act(() => result.current.okRequest(1, 'yes'));
    act(() => result.current.okRequest(1, 'yes'));
    await settle();
    expect(answers).toEqual(['A yes']);
    expect(result.current.requestId).toBe(2);

    // A stale decline (e.g. A's countdown) leaves B alone as well.
    act(() => result.current.cancelRequest(1));
    expect(result.current.requestId).toBe(2);
    act(() => result.current.cancelRequest(null as unknown as number));
    expect(result.current.requestId).toBe(2);

    act(() => result.current.okRequest(2, 'yes'));
    await settle();
    expect(answers).toEqual(['A yes', 'B yes']);
  });

  it('ignores the click event that onClick={onCancel} passes', async () => {
    const { result } = renderHook(() => useModal());
    let declined = false;
    act(() => {
      result.current.show('A').catch(() => (declined = true));
    });
    act(() => result.current.onCancel({ type: 'click' }));
    await settle();
    expect(declined).toBe(true);
  });

  it('declines everything at once', async () => {
    const { result } = renderHook(() => useModal());
    const answers: string[] = [];
    act(() => {
      ['A', 'B', 'C'].forEach((name) =>
        result.current
          .show(name)
          .catch((reason) => answers.push(`${name} ${reason.isCanceled}`))
      );
    });
    expect(result.current.pendingCount).toBe(2);
    act(() => result.current.cancelAll());
    await settle();
    expect(answers).toEqual(['A true', 'B true', 'C true']);
    expect(result.current.isShow).toBe(false);
    expect(result.current.pendingCount).toBe(0);
  });

  it('gives every request a new id, also after the queue empties', () => {
    const { result } = renderHook(() => useModal());
    act(() => {
      result.current.show('A').catch(() => undefined);
    });
    act(() => result.current.onCancel());
    act(() => {
      result.current.show('B').catch(() => undefined);
    });
    expect(result.current.requestId).toBe(2);
  });

  it('declines a second show() with the same data instead of queueing it', async () => {
    // A double tap on Send: one confirmation, and the second caller gets the
    // answer to Decline (so the same payment cannot go out twice).
    const { result } = renderHook(() => useModal());
    const answers: string[] = [];
    const payment = { message: 'Send 1 QORT to Alice', paymentFee: '0.01' };
    act(() => {
      result.current
        .show({ ...payment })
        .then(() => answers.push('first ok'))
        .catch(() => answers.push('first declined'));
      result.current
        .show({ ...payment })
        .then(() => answers.push('second ok'))
        .catch((reason) => answers.push(`second ${reason.isCanceled}`));
    });
    await settle();
    expect(answers).toEqual(['second true']);
    expect(result.current.requestId).toBe(1);
    expect(result.current.pendingCount).toBe(0);

    act(() => result.current.okRequest(1));
    await settle();
    expect(answers).toEqual(['second true', 'first ok']);
    expect(result.current.isShow).toBe(false);
  });

  it('also coalesces with a queued request, and not after it is answered', async () => {
    const { result } = renderHook(() => useModal());
    const answers: string[] = [];
    act(() => {
      result.current.show('A').catch(() => undefined);
      result.current.show('B').catch(() => undefined);
      result.current.show('B').catch(() => answers.push('B again declined'));
    });
    await settle();
    expect(answers).toEqual(['B again declined']);
    expect(result.current.pendingCount).toBe(1);

    act(() => result.current.okRequest(1));
    act(() => result.current.okRequest(2));
    act(() => {
      result.current.show('B').catch(() => answers.push('B later declined'));
    });
    await settle();
    // B was answered, so the same data later is a new request.
    expect(answers).toEqual(['B again declined']);
    expect(result.current.requestId).toBe(3);
  });

  it('queues equal data when told not to coalesce', async () => {
    const { result } = renderHook(() =>
      useModal({ coalesceDuplicates: false })
    );
    act(() => {
      result.current.show('A').catch(() => undefined);
      result.current.show('A').catch(() => undefined);
    });
    expect(result.current.pendingCount).toBe(1);

    const perCall = renderHook(() => useModal());
    act(() => {
      perCall.result.current.show('A', { dedupeKey: null }).catch(() => {});
      perCall.result.current.show('A', { dedupeKey: null }).catch(() => {});
    });
    expect(perCall.result.current.pendingCount).toBe(1);
  });

  it('coalesces by an explicit key, whatever the data', async () => {
    const { result } = renderHook(() => useModal());
    let declined = false;
    act(() => {
      result.current.show({ at: 1 }, { dedupeKey: 'pay' }).catch(() => {});
      result.current
        .show({ at: 2 }, { dedupeKey: 'pay' })
        .catch(() => (declined = true));
    });
    await settle();
    expect(declined).toBe(true);
    expect(result.current.pendingCount).toBe(0);
  });

  it('caps the requests of one group', async () => {
    const { result } = renderHook(() => useModal());
    const declined: string[] = [];
    act(() => {
      ['a1', 'a2', 'a3'].forEach((name) =>
        result.current
          .show(name, { groupKey: 'app:A', maxPerGroup: 2 })
          .catch(() => declined.push(name))
      );
      result.current
        .show('b1', { groupKey: 'app:B', maxPerGroup: 2 })
        .catch(() => declined.push('b1'));
    });
    await settle();
    expect(declined).toEqual(['a3']);
    expect(result.current.pendingCount).toBe(2);
    expect(result.current.groupKey).toBe('app:A');
    expect(result.current.sameGroupPendingCount).toBe(1);
  });

  it('declines a whole group at once and shows the next other request', async () => {
    const { result } = renderHook(() => useModal());
    const answers: string[] = [];
    act(() => {
      [
        ['a1', 'app:A'],
        ['b1', 'app:B'],
        ['a2', 'app:A'],
      ].forEach(([name, groupKey]) =>
        result.current
          .show(name, { groupKey })
          .then(() => answers.push(`${name} ok`))
          .catch(() => answers.push(`${name} declined`))
      );
    });
    expect(result.current.sameGroupPendingCount).toBe(1);

    let count = 0;
    act(() => {
      count = result.current.cancelWhere(
        (request) => request.groupKey === 'app:A'
      );
    });
    await settle();
    expect(count).toBe(2);
    expect(answers).toEqual(['a1 declined', 'a2 declined']);
    expect(result.current.message).toBe('b1');
    expect(result.current.groupKey).toBe('app:B');
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.sameGroupPendingCount).toBe(0);
  });

  it('keeps the request on screen when cancelWhere picks only queued ones', async () => {
    const { result } = renderHook(() => useModal());
    act(() => {
      result.current.show('a1', { groupKey: 'app:A' }).catch(() => {});
      result.current.show('b1', { groupKey: 'app:B' }).catch(() => {});
    });
    act(() => {
      result.current.cancelWhere((request) => request.groupKey === 'app:B');
    });
    await settle();
    expect(result.current.requestId).toBe(1);
    expect(result.current.pendingCount).toBe(0);
  });

  it('keeps stable functions across renders', () => {
    const { result, rerender } = renderHook(() => useModal());
    const first = result.current;
    rerender();
    expect(result.current.show).toBe(first.show);
    expect(result.current.onOk).toBe(first.onOk);
    expect(result.current.onCancel).toBe(first.onCancel);
    expect(result.current.okRequest).toBe(first.okRequest);
    expect(result.current.cancelRequest).toBe(first.cancelRequest);
    expect(result.current.cancelWhere).toBe(first.cancelWhere);
  });
});
