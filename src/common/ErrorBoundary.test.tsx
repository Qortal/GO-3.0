import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary, {
  ERROR_BOUNDARY_KEY_RESET_WINDOW_MS,
  ERROR_BOUNDARY_MAX_KEY_RESETS,
} from './ErrorBoundary';
import {
  clearAppErrorsForTests,
  getRecentAppErrors,
  recordAppError,
} from '../utils/appErrorRing';

// React 19 reports a render it redrew past through onRecoverableError; RTL's
// default would fail the run with "There was an error during concurrent
// rendering".
const ROOT_OPTIONS = { onRecoverableError: () => {} } as const;

/**
 * Steps fake time in 20 ms slices. One long act() would only flush the
 * boundary's 60 ms retries when its scope ends.
 */
const step = async (ms: number) => {
  for (let t = 0; t < ms; t += 20) {
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
  }
};

const Fallback = <span>FALLBACK</span>;

const Always = () => {
  throw new TypeError('always');
};

type Data = { bad: boolean | number };

/** Throws while data.bad is true, or for data.bad more draws when a number. */
const Bomb = ({ data }: { data: Data }) => {
  if (typeof data.bad === 'number') {
    if (data.bad > 0) {
      data.bad -= 1;
      throw new TypeError('bad data');
    }
  } else if (data.bad) {
    throw new TypeError('bad data');
  }
  return <span>GOOD</span>;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearAppErrorsForTests();
});

describe('ErrorBoundary', () => {
  it('exports the key reset budget', () => {
    expect(ERROR_BOUNDARY_MAX_KEY_RESETS).toBe(3);
    expect(ERROR_BOUNDARY_KEY_RESET_WINDOW_MS).toBe(60_000);
  });

  it('retries a recoverable fault five times, then stays on the fallback', async () => {
    const onCatch = vi.fn();
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ErrorBoundary
          fallback={Fallback}
          isRecoverable={() => true}
          onCatch={onCatch}
        >
          <Always />
        </ErrorBoundary>,
        ROOT_OPTIONS
      );
    });
    await step(1000);
    expect(onCatch).toHaveBeenCalledTimes(6);
    expect(view!.container.textContent).toBe('FALLBACK');
    await step(5500);
    expect(onCatch).toHaveBeenCalledTimes(6);
    expect(view!.container.textContent).toBe('FALLBACK');
  });

  it('never retries without isRecoverable, even when keys change', async () => {
    const onCatch = vi.fn();
    const tree = (data: Data) => (
      <ErrorBoundary fallback={Fallback} onCatch={onCatch}>
        <Bomb data={data} />
      </ErrorBoundary>
    );
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(tree({ bad: true }), ROOT_OPTIONS);
    });
    await step(500);
    await act(async () => {
      view.rerender(tree({ bad: false }));
    });
    await step(100);
    expect(onCatch).toHaveBeenCalledTimes(1);
    expect(view!.container.textContent).toBe('FALLBACK');
  });

  it('draws the children again when a reset key changes after the data heals', async () => {
    const onCatch = vi.fn();
    const tree = (data: Data) => (
      <ErrorBoundary
        fallback={Fallback}
        isRecoverable={() => true}
        onCatch={onCatch}
        resetKeys={[data]}
      >
        <Bomb data={data} />
      </ErrorBoundary>
    );
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(tree({ bad: true }), ROOT_OPTIONS);
    });
    await step(800);
    expect(view!.container.textContent).toBe('FALLBACK');
    await act(async () => {
      view.rerender(tree({ bad: false }));
    });
    await step(50);
    expect(view!.container.textContent).toBe('GOOD');
  });

  it('compares reset keys element by element', async () => {
    const onCatch = vi.fn();
    const data: Data = { bad: true };
    const tree = () => (
      <ErrorBoundary
        fallback={Fallback}
        onCatch={onCatch}
        resetKeys={[data, 'same']}
      >
        <Bomb data={data} />
      </ErrorBoundary>
    );
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(tree(), ROOT_OPTIONS);
    });
    data.bad = false;
    // A fresh array with the same elements is not a change.
    await act(async () => {
      view.rerender(tree());
    });
    await step(100);
    expect(view!.container.textContent).toBe('FALLBACK');
  });

  it('does not reset in the update that threw', async () => {
    const onCatch = vi.fn();
    const tree = (data: Data) => (
      <ErrorBoundary fallback={Fallback} onCatch={onCatch} resetKeys={[data]}>
        <Bomb data={data} />
      </ErrorBoundary>
    );
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(tree({ bad: false }), ROOT_OPTIONS);
    });
    expect(view!.container.textContent).toBe('GOOD');
    await act(async () => {
      view.rerender(tree({ bad: true }));
    });
    await step(200);
    expect(onCatch).toHaveBeenCalledTimes(1);
    expect(view!.container.textContent).toBe('FALLBACK');
  });

  it('resets at most 3 times a minute, with no timed retry after a key reset', async () => {
    const onCatch = vi.fn();
    const tree = (n: number) => (
      <ErrorBoundary
        fallback={Fallback}
        isRecoverable={() => true}
        onCatch={onCatch}
        resetKeys={[{ n }]}
      >
        <Always />
      </ErrorBoundary>
    );
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(tree(0), ROOT_OPTIONS);
    });
    await step(800);
    expect(onCatch).toHaveBeenCalledTimes(6);
    let n = 1;
    for (; n <= 8; n += 1) {
      await act(async () => {
        view.rerender(tree(n));
      });
      await step(100);
    }
    expect(onCatch).toHaveBeenCalledTimes(9);
    await step(5500);
    for (; n <= 12; n += 1) {
      await act(async () => {
        view.rerender(tree(n));
      });
      await step(100);
    }
    expect(onCatch).toHaveBeenCalledTimes(9);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    for (; n <= 16; n += 1) {
      await act(async () => {
        view.rerender(tree(n));
      });
      await step(100);
    }
    expect(onCatch).toHaveBeenCalledTimes(12);
    expect(view!.container.textContent).toBe('FALLBACK');
  });

  it('a working key reset gives a later fault its timed retry back', async () => {
    const onCatch = vi.fn();
    const tree = (data: Data) => (
      <ErrorBoundary
        fallback={Fallback}
        isRecoverable={() => true}
        onCatch={onCatch}
        resetKeys={[data]}
      >
        <Bomb data={data} />
      </ErrorBoundary>
    );
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(tree({ bad: true }), ROOT_OPTIONS);
    });
    await step(800);
    await act(async () => {
      view.rerender(tree({ bad: false }));
    });
    await step(50);
    expect(view!.container.textContent).toBe('GOOD');
    await step(6000);
    // Three throws: React's own synchronous retry absorbs two, the boundary
    // sees one, and its timed retry draws the row again.
    const catchesBefore = onCatch.mock.calls.length;
    await act(async () => {
      view.rerender(tree({ bad: 3 }));
    });
    await step(500);
    expect(onCatch.mock.calls.length).toBe(catchesBefore + 1);
    expect(view!.container.textContent).toBe('GOOD');
  });

  it('reports a heal to the app error ring', async () => {
    const data: Data = { bad: 3 };
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ErrorBoundary
          fallback={Fallback}
          isRecoverable={() => true}
          onCatch={(error) =>
            recordAppError({ kind: 'caught', error, boundary: 't' })
          }
        >
          <Bomb data={data} />
        </ErrorBoundary>,
        ROOT_OPTIONS
      );
    });
    await step(500);
    expect(view!.container.textContent).toBe('GOOD');
    const entries = getRecentAppErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'caught',
      boundary: 't',
      name: 'TypeError',
      healed: 1,
    });
  });

  it('keeps calling onCatch when it throws', async () => {
    const onCatch = vi.fn(() => {
      throw new Error('reporting failed');
    });
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ErrorBoundary fallback={Fallback} onCatch={onCatch} name="t">
          <Always />
        </ErrorBoundary>,
        ROOT_OPTIONS
      );
    });
    expect(onCatch).toHaveBeenCalledTimes(1);
    expect(view!.container.textContent).toBe('FALLBACK');
  });

  it('a wrapper rebuilt around the same data is not a reset key change', async () => {
    const onCatch = vi.fn();
    const source = { signature: 'r1', images: ['a'] };
    // Like ChatList: `reply` is `{ ...messages[i] }`, `replyExpiredMeta`
    // a fresh `{ missing: true }`, on every recompute.
    const tree = (data: Data) => (
      <ErrorBoundary
        fallback={Fallback}
        isRecoverable={() => true}
        onCatch={onCatch}
        resetKeys={[data, { ...source }, { missing: true }, [1, 'x'], false]}
      >
        <Bomb data={data} />
      </ErrorBoundary>
    );
    const broken: Data = { bad: true };
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(tree(broken), ROOT_OPTIONS);
    });
    await step(800);
    expect(onCatch).toHaveBeenCalledTimes(6);
    // Unrelated chat updates redraw the list with the same broken row.
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        view.rerender(tree(broken));
      });
      await step(40);
    }
    expect(onCatch).toHaveBeenCalledTimes(6);
    // The fix arrives: the reset budget is still there for it.
    await act(async () => {
      view.rerender(tree({ bad: false }));
    });
    await step(50);
    expect(view!.container.textContent).toBe('GOOD');
  });

  it('a changed value inside a rebuilt wrapper is a change', async () => {
    const onCatch = vi.fn();
    const tree = (images: string[]) => (
      <ErrorBoundary
        fallback={Fallback}
        onCatch={onCatch}
        resetKeys={[{ signature: 'r1', images }]}
      >
        <Bomb data={{ bad: images.length === 0 }} />
      </ErrorBoundary>
    );
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(tree([]), ROOT_OPTIONS);
    });
    expect(view!.container.textContent).toBe('FALLBACK');
    await act(async () => {
      view.rerender(tree(['a']));
    });
    await step(50);
    expect(view!.container.textContent).toBe('GOOD');
  });

  it('draws retryFallback while a timed retry is pending, the fallback after', async () => {
    const onCatch = vi.fn();
    const seen: string[] = [];
    const Probe = ({ label }: { label: string }) => {
      seen.push(label);
      return <span>{label}</span>;
    };
    // Three throws: React's own synchronous retry absorbs two, the boundary
    // sees one and schedules its timed retry.
    const data: Data = { bad: 3 };
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ErrorBoundary
          fallback={<Probe label="FALLBACK" />}
          retryFallback={<Probe label="WAIT" />}
          isRecoverable={() => true}
          onCatch={onCatch}
        >
          <Bomb data={data} />
        </ErrorBoundary>,
        ROOT_OPTIONS
      );
    });
    expect(onCatch).toHaveBeenCalledTimes(1);
    expect(view!.container.textContent).toBe('WAIT');
    await step(100);
    expect(view!.container.textContent).toBe('GOOD');

    // A fault that never heals ends on the fallback.
    seen.length = 0;
    await act(async () => {
      view.rerender(
        <ErrorBoundary
          fallback={<Probe label="FALLBACK" />}
          retryFallback={<Probe label="WAIT" />}
          isRecoverable={() => true}
          onCatch={onCatch}
        >
          <Always />
        </ErrorBoundary>
      );
    });
    expect(view!.container.textContent).toBe('WAIT');
    await step(1000);
    expect(view!.container.textContent).toBe('FALLBACK');
    expect(seen.filter((s) => s === 'WAIT').length).toBeGreaterThan(0);
  });
});
