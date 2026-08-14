import { Component, ReactNode } from 'react';

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
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack?: string;
}

const MAX_AUTO_RECOVERIES = 5;

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  private recoveryAttempts = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptResetTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true, error: _ };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({
      componentStack: errorInfo.componentStack,
      error,
    });
    console.error('Error caught in ErrorBoundary:', error, errorInfo);
    try {
      this.props.onCatch?.(error, errorInfo.componentStack ?? undefined);
    } catch {
      /* reporting must never mask the original error */
    }

    const recoverable = this.props.isRecoverable?.(error) ?? false;
    if (recoverable && this.recoveryAttempts < MAX_AUTO_RECOVERIES) {
      this.recoveryAttempts += 1;
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      // Re-render children shortly after the transient fault has passed.
      this.recoveryTimer = setTimeout(() => {
        this.setState({
          hasError: false,
          error: null,
          componentStack: undefined,
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

  componentWillUnmount(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    if (this.attemptResetTimer) clearTimeout(this.attemptResetTimer);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
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
