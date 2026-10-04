import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { AuthenticatedLockScreen } from './AuthenticatedLockScreen';
import { APP_LOCK_SCREEN_Z_INDEX } from '../../lib/appLock';

type AppLockLayerProps = {
  accountLabel?: string | null;
  walletAddress?: string | null;
  onUnlock: (password: string) => Promise<void>;
};

const LAYER_ATTRIBUTE = 'data-app-lock-layer';
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'META']);
const HIDING_ATTRIBUTES = ['inert', 'aria-hidden'] as const;

let layerContainer: HTMLDivElement | null = null;

/** The body-level element the lock screen is portalled into. */
export function getAppLockLayerContainer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (!layerContainer) {
    layerContainer = document.createElement('div');
    layerContainer.setAttribute(LAYER_ATTRIBUTE, '');
  }
  if (!layerContainer.isConnected) document.body.appendChild(layerContainer);
  return layerContainer;
}

/**
 * Theme for the lock screen only: its modal is portalled into our own layer
 * element (so it can be told apart from everything else) and stacks above
 * every other dialog. `AuthenticatedLockScreen` sets its z-index as
 * `zIndex.modal + 1000`.
 */
export function createAppLockLayerTheme(
  outer: Theme,
  container: HTMLElement | null
): Theme {
  const muiModal = outer.components?.MuiModal;
  return {
    ...outer,
    zIndex: { ...outer.zIndex, modal: APP_LOCK_SCREEN_Z_INDEX - 1000 },
    components: {
      ...outer.components,
      MuiModal: {
        ...muiModal,
        defaultProps: {
          ...muiModal?.defaultProps,
          ...(container ? { container } : {}),
        },
      },
    },
  };
}

/**
 * Makes every other top-level element of the page `inert` (and aria-hidden)
 * while the lock is up: the app itself (Q-App frames included) and any dialog
 * portalled to the body, whether it was open before the lock or opens behind
 * it. Inert content takes no taps, no keyboard focus and is hidden from
 * TalkBack, so the lock screen really is the only thing usable. Returns the
 * undo function, which only clears what this call set.
 *
 * Nothing is made inert until the lock screen has rendered into `container`.
 * The container itself is never made inert or hidden, and when someone else
 * hides it (MUI's modal manager puts aria-hidden on every other body child
 * when a dialog opens, the lock included) that is taken off again, so TalkBack
 * always reaches the lock screen.
 */
export function isolateAppLockLayer(
  container: HTMLElement,
  doc: Document = document
): () => void {
  // Each attribute is undone only where this call added it. aria-hidden as
  // well, for WebViews too old to know `inert`.
  const applied: Record<'inert' | 'aria-hidden', Set<Element>> = {
    inert: new Set(),
    'aria-hidden': new Set(),
  };
  const holdsLock = (el: Element) => el === container || el.contains(container);
  const mark = (el: Element, name: 'inert' | 'aria-hidden', value: string) => {
    if (el.hasAttribute(name)) return;
    el.setAttribute(name, value);
    applied[name].add(el);
  };

  const apply = () => {
    for (const name of HIDING_ATTRIBUTES) {
      if (container.hasAttribute(name)) container.removeAttribute(name);
    }
    if (!container.isConnected || !container.firstElementChild) return;
    for (const child of Array.from(doc.body.children)) {
      if (SKIPPED_TAGS.has(child.tagName) || holdsLock(child)) continue;
      mark(child, 'inert', '');
      mark(child, 'aria-hidden', 'true');
    }
  };

  apply();
  // New body children, and the lock rendering into its layer.
  const observer = new MutationObserver(apply);
  observer.observe(doc.body, { childList: true });
  observer.observe(container, { childList: true });
  // Someone hiding the lock, or un-hiding what was hidden here.
  const attributeObserver = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.target === container || record.target.parentNode === doc.body
      )
    ) {
      apply();
    }
  });
  attributeObserver.observe(doc.body, {
    subtree: true,
    attributes: true,
    attributeFilter: [...HIDING_ATTRIBUTES],
  });
  return () => {
    observer.disconnect();
    attributeObserver.disconnect();
    (Object.keys(applied) as Array<keyof typeof applied>).forEach((name) => {
      applied[name].forEach((el) => el.removeAttribute(name));
      applied[name].clear();
    });
  };
}

/**
 * The app lock screen, above everything else in GO. Rendered by App whenever
 * the lock is up; see `lib/appLock.ts` for when that is.
 */
export function AppLockLayer({
  accountLabel,
  walletAddress,
  onUnlock,
}: AppLockLayerProps) {
  const [container] = useState(getAppLockLayerContainer);

  useLayoutEffect(() => {
    if (!container) return undefined;
    if (!container.isConnected) document.body.appendChild(container);
    return () => {
      container.remove();
    };
  }, [container]);

  useEffect(() => {
    if (!container) return undefined;
    return isolateAppLockLayer(container);
  }, [container]);

  const theme = useCallback(
    (outer: Theme) => createAppLockLayerTheme(outer, container),
    [container]
  );

  return (
    <ThemeProvider theme={theme}>
      <AuthenticatedLockScreen
        accountLabel={accountLabel}
        walletAddress={walletAddress}
        onUnlock={onUnlock}
      />
    </ThemeProvider>
  );
}
