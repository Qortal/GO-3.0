import { Component, ReactNode } from 'react';
import { noteAppErrorHealed } from '../utils/appErrorRing';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback:
    | ReactNode
    | ((args: { error: Error | null; componentStack?: string }) => ReactNode);
  /**
   * Optional predicate. When it returns true for a caught error, the boundary
   * treats the error as transient/benign and automatically re-renders its
   * children instead of getting stuck on the fallback. Used for non-fatal
   * faults (e.g. a ProseMirror selection-sync hiccup) that would otherwise
   * dead-end the whole authenticated shell.
   */
  isRecoverable?: (error: Error | null) => boolean;
  /** Notified for every caught error, before any auto-recovery is attempted. */
  onCatch?: (error: Error, componentStack?: string) => void;
  /**
   * The values the children are drawn from. When one changes while the
   * fallback shows, the children are drawn again, at most
   * ERROR_BOUNDARY_MAX_KEY_RESETS times per ERROR_BOUNDARY_KEY_RESET_WINDOW_MS.
   * Values compare with Object.is; two plain objects or arrays compare by
   * their own values one level deep, so a wrapper rebuilt around the same
   * data on every render is not a change. A throw right after such a redraw
   * gets no timed retry: the new data is what breaks, so the boundary waits
   * for the next change.
   */
  resetKeys?: readonly unknown[];
  /**
   * Drawn instead of `fallback` while a timed retry is pending, so a fault
   * the retry draws past never shows the fallback (ChatList passes an empty
   * box of the row's height). The fallback shows once the retries are used
   * up. Without it the fallback shows at once, as before.
   */
  retryFallback?: ReactNode;
  /** Names the boundary in Copy diagnostics ("chat-row", "root"). Drawing ignores it. */
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack?: string;
  /** A timed retry is scheduled (see retryFallback). */
  retrying?: boolean;
}

const MAX_AUTO_RECOVERIES = 5;
export const ERROR_BOUNDARY_MAX_KEY_RESETS = 3;
export const ERROR_BOUNDARY_KEY_RESET_WINDOW_MS = 60_000;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Object.is, or own values one level deep for two plain objects/arrays. */
const sameResetKey = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key])
  );
};

const resetKeysChanged = (
  prev?: readonly unknown[],
  next?: readonly unknown[]
): boolean => {
  if (!prev || !next || prev === next) return false;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i += 1) {
    if (!sameResetKey(prev[i], next[i])) return true;
  }
  return false;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  private recoveryAttempts = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptResetTimer: ReturnType<typeof setTimeout> | null = null;
  private keyResetTimes: number[] = [];
  private skipTimerRetry = false;

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true, error: _ };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Error caught in ErrorBoundary:', error, errorInfo);
    try {
      this.props.onCatch?.(error, errorInfo.componentStack ?? undefined);
    } catch {
      /* reporting must never mask the original error */
    }

    // A throw straight after a key reset comes from the new data itself:
    // drawing the same data again 60 ms later would only throw again.
    const afterKeyReset = this.skipTimerRetry;
    this.skipTimerRetry = false;
    const recoverable =
      !afterKeyReset && (this.props.isRecoverable?.(error) ?? false);
    const willRetry =
      recoverable && this.recoveryAttempts < MAX_AUTO_RECOVERIES;
    // An update from componentDidCatch is drawn before the browser paints,
    // so with retryFallback the fallback never reaches the screen while a
    // retry is pending.
    this.setState({
      componentStack: errorInfo.componentStack,
      error,
      retrying: willRetry,
    });
    if (willRetry) {
      this.recoveryAttempts += 1;
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      // Re-render children shortly after the transient fault has passed.
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        this.setState({
          hasError: false,
          error: null,
          componentStack: undefined,
          retrying: false,
        });
      }, 60);
      // After a quiet period, forget the attempt count so a later, unrelated
      // transient fault still gets a fresh set of recovery attempts.
      if (this.attemptResetTimer) clearTimeout(this.attemptResetTimer);
      this.attemptResetTimer = setTimeout(() => {
        this.recoveryAttempts = 0;
      }, 5000);
    }
  }

  componentDidUpdate(
    prevProps: ErrorBoundaryProps,
    prevState: ErrorBoundaryState
  ): void {
    if (!this.state.hasError) {
      this.skipTimerRetry = false;
      // The children drew again after a fault: a retry or a key reset worked.
      if (prevState.hasError && prevState.error) {
        noteAppErrorHealed(prevState.error);
      }
      return;
    }
    // Only a boundary already on its fallback before this update. The update
    // that caught the error may carry the new keys itself; resetting on those
    // would just throw again (react-error-boundary uses the same rule).
    if (!prevState.hasError) return;
    if (!resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) return;
    const now = Date.now();
    this.keyResetTimes = this.keyResetTimes.filter(
      (at) => now - at < ERROR_BOUNDARY_KEY_RESET_WINDOW_MS
    );
    if (this.keyResetTimes.length >= ERROR_BOUNDARY_MAX_KEY_RESETS) return;
    this.keyResetTimes.push(now);
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.skipTimerRetry = true;
    this.setState({
      hasError: false,
      error: null,
      componentStack: undefined,
      retrying: false,
    });
  }

  componentWillUnmount(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    if (this.attemptResetTimer) clearTimeout(this.attemptResetTimer);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.state.retrying && this.props.retryFallback !== undefined) {
        return this.props.retryFallback;
      }
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error: this.state.error,
          componentStack: this.state.componentStack,
        });
      }

      return this.props.fallback;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
