import { act, render } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://127.0.0.1:12391';

vi.mock('../../../App', () => ({ getBaseApiReact: () => NODE }));
vi.mock('react-frame-component', () => ({
  useFrame: () => ({ window }),
}));
vi.mock('../../../hooks/useQortalMessageListener', () => ({
  useQortalMessageListener: () => ({
    changeCurrentIndex: vi.fn(),
    history: { currentIndex: -1, customQDNHistoryPaths: [] },
    path: '',
    resetHistory: vi.fn(),
  }),
}));
vi.mock('../../Theme/ThemeContext', () => ({
  useThemeContext: () => ({ themeMode: 'dark' }),
}));
vi.mock('../../Desktop/CustomTitleBar', () => ({ appHeighOffsetPx: '0px' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (k: string) => k }),
}));
vi.mock('../../../atoms/global', async () => {
  const { atom } = await import('jotai');
  return {
    infoSnackGlobalAtom: atom(null),
    openSnackGlobalAtom: atom(false),
  };
});

import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../../../atoms/global';
import { AppViewer } from '../AppViewer';

const store = getDefaultStore();
const INVALID_LINK = 'auth:message.error.invalid_qortal_link';

const renderViewer = (app: Record<string, unknown>) => {
  const ref = createRef<HTMLIFrameElement>();
  const view = render(
    <AppViewer
      app={{ tabId: 't1', ...app }}
      hide={false}
      isDevMode={false}
      ref={ref}
    />
  );
  return { ...view, iframe: () => ref.current as HTMLIFrameElement };
};

// Audit GO-21: AppViewer is where every tab becomes a node /render URL.
describe('AppViewer render URL', () => {
  beforeEach(() => {
    store.set(infoSnackGlobalAtom, null);
    store.set(openSnackGlobalAtom, false);
  });

  it('loads an ordinary app exactly as before', () => {
    const { iframe } = renderViewer({
      service: 'APP',
      name: 'Q-Tube',
      path: 'video/abc',
    });
    expect(iframe().getAttribute('src')).toBe(
      `${NODE}/render/APP/Q-Tube/video/abc?theme=dark&lang=en&identifier=`
    );
    expect(store.get(openSnackGlobalAtom)).toBe(false);
  });

  it('encodes the name and the identifier', () => {
    const { iframe } = renderViewer({
      service: 'APP',
      name: 'Q Tube',
      identifier: 'a&b',
    });
    expect(iframe().getAttribute('src')).toBe(
      `${NODE}/render/APP/Q%20Tube?theme=dark&lang=en&identifier=a%26b`
    );
  });

  it.each([
    '../../../render/APP/Evil',
    '..\\..\\..\\render\\APP/Evil',
    '%2e%2e/%2e%2e/%2e%2e/render/APP/Evil',
    '..;/..;/render/APP/Evil',
    '%c0%ae%c0%ae/render/APP/Evil',
    '%252e%252e/%252e%252e/render/APP/Evil',
  ])('does not load another app through the path %j', (path) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { iframe } = renderViewer({
      service: 'APP',
      name: 'Q-Wallets',
      path,
    });
    expect(iframe().getAttribute('src') || '').not.toContain('/render/');
    expect(store.get(openSnackGlobalAtom)).toBe(true);
    expect(store.get(infoSnackGlobalAtom)).toEqual({
      type: 'error',
      message: INVALID_LINK,
    });
    warn.mockRestore();
  });

  it('does not load anything for a dot-segment name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { iframe } = renderViewer({ service: 'APP', name: '..', path: 'x' });
    expect(iframe().getAttribute('src') || '').toBe('');
    expect(store.get(openSnackGlobalAtom)).toBe(true);
    expect(store.get(infoSnackGlobalAtom)).toMatchObject({
      message: INVALID_LINK,
    });
    warn.mockRestore();
  });

  it('refuses a traversal path when falling back from NAVIGATE_TO_PATH', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { iframe } = renderViewer({ service: 'APP', name: 'Q-Wallets' });
    const before = iframe().getAttribute('src');
    const post = vi.spyOn(
      iframe().contentWindow as Window,
      'postMessage'
    ) as unknown as ReturnType<typeof vi.fn>;
    act(() => {
      document.dispatchEvent(
        new CustomEvent('navigateToPath-t1', {
          detail: { path: '../../render/APP/Evil' },
        })
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(iframe().getAttribute('src')).toBe(before);
    expect(post).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('still navigates an open app to an ordinary path', async () => {
    vi.useFakeTimers();
    const { iframe } = renderViewer({ service: 'APP', name: 'Q-Tube' });
    const post = vi.spyOn(
      iframe().contentWindow as Window,
      'postMessage'
    ) as unknown as ReturnType<typeof vi.fn>;
    act(() => {
      document.dispatchEvent(
        new CustomEvent('navigateToPath-t1', {
          detail: { path: 'video/abc' },
        })
      );
    });
    expect(post).toHaveBeenCalledWith(
      { action: 'NAVIGATE_TO_PATH', path: 'video/abc', requestedHandler: 'UI' },
      NODE
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(iframe().getAttribute('src')).toMatch(
      new RegExp(`^${NODE}/render/APP/Q-Tube/video/abc\\?theme=dark&lang=en`)
    );
    vi.useRealTimers();
  });
});
