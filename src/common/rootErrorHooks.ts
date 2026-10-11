import type { RootOptions } from 'react-dom/client';
import { recordAppError } from '../utils/appErrorRing';
import { recordFatalError } from './fatalErrorLog';

const boundaryName = (boundary: unknown): string => {
  const name = (boundary as { props?: { name?: unknown } } | null | undefined)
    ?.props?.name;
  return typeof name === 'string' ? name : '';
};

/**
 * React 19 hands every render error to these root hooks. They keep a
 * scrubbed record for Copy diagnostics (src/utils/appErrorRing.ts).
 */
export const rootErrorHooks: Pick<
  RootOptions,
  'onCaughtError' | 'onUncaughtError' | 'onRecoverableError'
> = {
  // A boundary caught it (a chat row's "Invalid Data", the shell). React's
  // default only logs it; keep that log.
  onCaughtError(error, errorInfo) {
    recordAppError({
      kind: 'caught',
      error,
      componentStack: errorInfo?.componentStack,
      boundary: boundaryName(errorInfo?.errorBoundary),
    });
    console.error(error);
  },
  // Nothing caught it and React unmounted the tree. React's default reports
  // it as a window error, which fatalErrorLog saved; this hook replaces that,
  // so save it here.
  onUncaughtError(error, errorInfo) {
    recordAppError({
      kind: 'uncaught',
      error,
      componentStack: errorInfo?.componentStack,
    });
    recordFatalError('render', error, errorInfo?.componentStack ?? undefined);
    console.error('Uncaught render error:', error);
  },
  // A concurrent render threw and React drew the tree again synchronously
  // without the error. React's default reports error #520 as a window error,
  // which made App.tsx show the full-screen "GO runtime error" and saved it
  // to the crash log without the real cause. Keep the cause in the ring.
  onRecoverableError(error, errorInfo) {
    const cause =
      error &&
      typeof error === 'object' &&
      (error as { cause?: unknown }).cause != null
        ? (error as { cause: unknown }).cause
        : error;
    recordAppError({
      kind: 'recovered',
      error: cause,
      componentStack: errorInfo?.componentStack,
    });
    console.warn('React redrew past a render error:', cause);
  },
};
