import {
  act,
  cleanup,
  render,
  type RenderOptions,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';
import { rootErrorHooks } from './rootErrorHooks';
import { readFatalErrors } from './fatalErrorLog';
import {
  clearAppErrorsForTests,
  getRecentAppErrors,
  recordAppError,
} from '../utils/appErrorRing';

// RTL 16.3 forwards these root options to createRoot; its types still say
// `never` for onCaughtError.
const CAUGHT_OPTIONS = {
  onCaughtError: rootErrorHooks.onCaughtError,
  onRecoverableError: () => {},
} as unknown as RenderOptions;

const Bomb = () => {
  throw new TypeError("Cannot read properties of null (reading 'map')");
};

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearAppErrorsForTests();
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('rootErrorHooks', () => {
  it("records a caught error with the boundary's name", async () => {
    await act(async () => {
      render(
        <ErrorBoundary name="chat-row" fallback={<span>F</span>}>
          <Bomb />
        </ErrorBoundary>,
        CAUGHT_OPTIONS
      );
    });
    const entries = getRecentAppErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'caught',
      boundary: 'chat-row',
      name: 'TypeError',
      message: "Cannot read properties of null (reading 'map')",
      count: 1,
    });
    // React's default log for a caught error is kept.
    expect(errorSpy).toHaveBeenCalledWith(expect.any(TypeError));
  });

  it("merges the boundary's own report into the same entry", async () => {
    await act(async () => {
      render(
        <ErrorBoundary
          name="chat-row"
          fallback={<span>F</span>}
          onCatch={(error, componentStack) =>
            recordAppError({
              kind: 'caught',
              error,
              componentStack,
              boundary: 'chat-row',
              shape: 'surface:group last:yes',
            })
          }
        >
          <Bomb />
        </ErrorBoundary>,
        CAUGHT_OPTIONS
      );
    });
    const entries = getRecentAppErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      count: 1,
      boundary: 'chat-row',
      shape: 'surface:group last:yes',
    });
  });

  it('records a nameless boundary without a name', async () => {
    await act(async () => {
      render(
        <ErrorBoundary fallback={<span>F</span>}>
          <Bomb />
        </ErrorBoundary>,
        CAUGHT_OPTIONS
      );
    });
    expect(getRecentAppErrors()[0]).toMatchObject({
      kind: 'caught',
      boundary: '',
    });
  });

  it('keeps the cause of an error React redrew past, without a window error', async () => {
    let left = 1;
    const Once = () => {
      if (left > 0) {
        left -= 1;
        throw new Error('once');
      }
      return <span>GOOD</span>;
    };
    const windowError = vi.fn();
    window.addEventListener('error', windowError);
    try {
      let view: ReturnType<typeof render>;
      await act(async () => {
        view = render(
          <ErrorBoundary fallback={<span>F</span>}>
            <Once />
          </ErrorBoundary>,
          { onRecoverableError: rootErrorHooks.onRecoverableError }
        );
      });
      expect(view!.container.textContent).toBe('GOOD');
    } finally {
      window.removeEventListener('error', windowError);
    }
    const entries = getRecentAppErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'recovered',
      name: 'Error',
      message: 'once',
    });
    expect(windowError).not.toHaveBeenCalled();
    expect(readFatalErrors()).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('saves an uncaught error', () => {
    rootErrorHooks.onUncaughtError!(new Error('boom'), {
      componentStack: '\n    at Root',
    });
    expect(getRecentAppErrors()[0]).toMatchObject({
      kind: 'uncaught',
      message: 'boom',
      components: ['Root'],
    });
    expect(readFatalErrors()[0]).toMatchObject({
      kind: 'render',
      message: 'boom',
    });
  });

  it('never throws on odd input', () => {
    expect(() =>
      rootErrorHooks.onRecoverableError!(null, {} as never)
    ).not.toThrow();
    expect(() =>
      rootErrorHooks.onCaughtError!('text', {
        componentStack: '',
        errorBoundary: null,
      } as never)
    ).not.toThrow();
  });
});
