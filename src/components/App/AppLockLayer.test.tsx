import { act, render, screen } from '@testing-library/react';
import { Dialog } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppLockLayer,
  createAppLockLayerTheme,
  isolateAppLockLayer,
} from './AppLockLayer';
import { APP_LOCK_SCREEN_Z_INDEX } from '../../lib/appLock';

vi.mock('../../utils/platform', () => ({ isCapacitor: () => false }));

// The theme this app ships: every MUI modal at 50000 (theme-common.ts).
const appTheme = () =>
  createTheme({
    components: { MuiModal: { styleOverrides: { root: { zIndex: 50000 } } } },
  });

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createAppLockLayerTheme', () => {
  it('raises the lock above every dialog and portals it into the layer', () => {
    const outer = appTheme();
    const container = document.createElement('div');
    const theme = createAppLockLayerTheme(outer, container);
    expect(theme.zIndex.modal + 1000).toBe(APP_LOCK_SCREEN_Z_INDEX);
    expect(theme.components?.MuiModal?.defaultProps?.container).toBe(container);
    // Everything else is the app's own theme.
    expect(theme.palette).toBe(outer.palette);
    expect(theme.components?.MuiModal?.styleOverrides).toBe(
      outer.components?.MuiModal?.styleOverrides
    );
    expect(outer.zIndex.modal).toBe(1300);
  });
});

describe('isolateAppLockLayer', () => {
  it('makes everything but the lock inert, and undoes only its own marks', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    const dialog = document.createElement('div');
    const alreadyInert = document.createElement('div');
    alreadyInert.setAttribute('inert', '');
    const style = document.createElement('style');
    const layer = document.createElement('div');
    layer.appendChild(document.createElement('div'));
    document.body.append(root, dialog, alreadyInert, style, layer);

    const undo = isolateAppLockLayer(layer);
    expect(root.hasAttribute('inert')).toBe(true);
    expect(dialog.hasAttribute('inert')).toBe(true);
    expect(style.hasAttribute('inert')).toBe(false);
    expect(layer.hasAttribute('inert')).toBe(false);

    // A dialog that opens behind the lock is made inert as well.
    const late = document.createElement('div');
    document.body.appendChild(late);
    await flush();
    expect(late.hasAttribute('inert')).toBe(true);

    // Hidden from TalkBack too, also on WebViews without `inert`.
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(alreadyInert.getAttribute('aria-hidden')).toBe('true');

    undo();
    expect(root.hasAttribute('inert')).toBe(false);
    expect(root.hasAttribute('aria-hidden')).toBe(false);
    expect(dialog.hasAttribute('inert')).toBe(false);
    expect(late.hasAttribute('inert')).toBe(false);
    expect(alreadyInert.hasAttribute('inert')).toBe(true);
    expect(alreadyInert.hasAttribute('aria-hidden')).toBe(false);
  });

  it('spares only its own layer, whatever ids other content carries', () => {
    const root = document.createElement('div');
    // Anything outside the layer that happens to carry the lock's title id
    // (rendered content, another component) is still made inert.
    const lookalike = document.createElement('div');
    const title = document.createElement('h2');
    title.id = 'app-lock-title';
    lookalike.appendChild(title);
    const layer = document.createElement('div');
    layer.appendChild(document.createElement('div'));
    document.body.append(root, lookalike, layer);
    const undo = isolateAppLockLayer(layer);
    expect(root.hasAttribute('inert')).toBe(true);
    expect(lookalike.hasAttribute('inert')).toBe(true);
    expect(lookalike.getAttribute('aria-hidden')).toBe('true');
    expect(layer.hasAttribute('inert')).toBe(false);
    undo();
  });

  it('takes aria-hidden and inert off the lock when someone else sets them', async () => {
    const root = document.createElement('div');
    const layer = document.createElement('div');
    layer.appendChild(document.createElement('div'));
    document.body.append(root, layer);
    const undo = isolateAppLockLayer(layer);
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('inert', '');
    await flush();
    expect(layer.hasAttribute('aria-hidden')).toBe(false);
    expect(layer.hasAttribute('inert')).toBe(false);

    // And what was hidden here stays hidden if someone un-hides it.
    root.removeAttribute('aria-hidden');
    await flush();
    expect(root.getAttribute('aria-hidden')).toBe('true');
    undo();
    expect(root.hasAttribute('aria-hidden')).toBe(false);
  });

  it('isolates nothing until the lock has rendered into the layer', () => {
    const root = document.createElement('div');
    const layer = document.createElement('div');
    document.body.append(root, layer);
    const undo = isolateAppLockLayer(layer);
    expect(root.hasAttribute('inert')).toBe(false);
    undo();
  });
});

describe('AppLockLayer', () => {
  const renderLayer = (withOpenDialog = false) => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    return render(
      <ThemeProvider theme={appTheme()}>
        {withOpenDialog ? (
          <Dialog open>
            <button type="button">Accept</button>
          </Dialog>
        ) : null}
        <AppLockLayer
          accountLabel="Simon"
          walletAddress="QgB7zMfujQMLkisp1Lc8PBkVYs75sYB3vV"
          onUnlock={vi.fn(async () => {})}
        />
      </ThemeProvider>,
      { container: root }
    );
  };

  it('renders the lock screen in its own layer, above every dialog', async () => {
    const { unmount } = renderLayer(true);
    await flush();
    const layer = document.querySelector('[data-app-lock-layer]');
    expect(layer).not.toBeNull();
    expect(layer?.parentElement).toBe(document.body);
    const title = document.getElementById('app-lock-title');
    expect(title).not.toBeNull();
    expect(layer?.contains(title)).toBe(true);
    expect(title?.closest('[inert]')).toBeNull();

    const lockRoot = layer?.firstElementChild as HTMLElement;
    expect(Number(window.getComputedStyle(lockRoot).zIndex)).toBe(
      APP_LOCK_SCREEN_Z_INDEX
    );

    // The open approval dialog and the app are inert under the lock.
    const accept = screen.getByText('Accept');
    const dialogRoot = Array.from(document.body.children).find((el) =>
      el.contains(accept)
    );
    expect(dialogRoot?.hasAttribute('inert')).toBe(true);
    expect(Number(window.getComputedStyle(dialogRoot!).zIndex)).toBeLessThan(
      APP_LOCK_SCREEN_Z_INDEX
    );
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true);

    unmount();
    expect(document.querySelector('[data-app-lock-layer]')).toBeNull();
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false);
  });

  it('stays reachable for TalkBack when a dialog opens behind it', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    const view = (dialogOpen: boolean) => (
      <ThemeProvider theme={appTheme()}>
        <Dialog open={dialogOpen}>
          <button type="button">Late</button>
        </Dialog>
        <AppLockLayer
          accountLabel="Simon"
          walletAddress="QgB7zMfujQMLkisp1Lc8PBkVYs75sYB3vV"
          onUnlock={vi.fn(async () => {})}
        />
      </ThemeProvider>
    );
    const { rerender, unmount } = render(view(false), { container: root });
    await flush();
    const layer = document.querySelector('[data-app-lock-layer]');
    expect(layer?.hasAttribute('aria-hidden')).toBe(false);

    // A dialog started by a timer or a background event while locked: MUI
    // hides every other body child, the lock layer included.
    rerender(view(true));
    await flush();
    const late = screen.getByText('Late');
    const lateRoot = Array.from(document.body.children).find((el) =>
      el.contains(late)
    );
    expect(lateRoot?.hasAttribute('inert')).toBe(true);
    expect(layer?.hasAttribute('aria-hidden')).toBe(false);
    expect(layer?.hasAttribute('inert')).toBe(false);
    unmount();
  });
});
