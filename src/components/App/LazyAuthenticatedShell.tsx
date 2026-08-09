import { lazy } from 'react';

const loadAuthenticatedShell = () => import('./AuthenticatedShell');

export const LazyAuthenticatedShell = lazy(() =>
  loadAuthenticatedShell().then((m) => ({
    default: m.AuthenticatedShell,
  }))
);

/**
 * Warm the shell chunk once the login screen is idle so unlocking does not pay
 * for the fetch and parse. Failures are ignored — React.lazy retries on render.
 */
export function prefetchAuthenticatedShell(): void {
  const warm = () => {
    void loadAuthenticatedShell().catch(() => {});
  };
  const idle = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
    }
  ).requestIdleCallback;
  if (idle) idle(warm, { timeout: 3000 });
  else window.setTimeout(warm, 1200);
}
