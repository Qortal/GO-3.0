import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortal/get', () => ({ saveFile: vi.fn() }));
vi.mock('../utils/mobileFileSave', () => ({
  isSilentSaveFile: vi.fn(() => false),
  mobileSaveLocationLabelFor: vi.fn(() => ''),
  saveBlobToMobileDocuments: vi.fn(),
}));
vi.mock('../utils/qdnDownloadNotifications', () => ({
  beginQdnSaveNotification: vi.fn(),
  cancelQdnSaveNotification: vi.fn(),
  claimQappFetchForSave: vi.fn(() => null),
  continueQdnSaveNotification: vi.fn(),
  declineQdnSave: vi.fn(),
  failQdnSaveNotification: vi.fn(),
  finishQdnSaveNotification: vi.fn(),
  reportQdnTransferProgress: vi.fn(),
}));
vi.mock('../atoms/global', async () => {
  const { atom } = await import('jotai');
  return {
    infoSnackGlobalAtom: atom(null),
    navigationControllerAtom: atom({}),
    openSnackGlobalAtom: atom(false),
  };
});
const back = vi.hoisted(() => ({
  handlers: [] as Array<{ handler: () => boolean; enabled: boolean }>,
}));
vi.mock('../utils/androidBack', () => ({
  BACK_PRIORITY: { overlay: 70 },
  useAndroidBack: (handler: () => boolean, options?: { enabled?: boolean }) => {
    back.handlers.push({ handler, enabled: options?.enabled ?? true });
  },
}));

import { useQortalMessageListener } from './useQortalMessageListener';
import { qappFullScreenTabAtom } from '../components/Mobile/mobileQappFrame';

const APP_ORIGIN = 'http://node.test';

describe('SET_FULL_SCREEN from a Q-App', () => {
  let iframe: HTMLIFrameElement;
  let store: ReturnType<typeof createStore>;
  let unmount: () => void;

  beforeEach(() => {
    back.handlers = [];
    store = createStore();
    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    Object.defineProperty(iframe, 'src', {
      configurable: true,
      get: () => `${APP_ORIGIN}/render/APP/Torq`,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    ({ unmount } = renderHook(
      () =>
        useQortalMessageListener(
          window,
          { current: iframe },
          'tab-torq',
          false,
          'Torq',
          'APP',
          undefined
        ),
      { wrapper }
    ));
  });

  afterEach(() => {
    iframe.remove();
  });

  const send = async (data: Record<string, unknown>) => {
    const port = { postMessage: vi.fn() };
    const event = new MessageEvent('message', {
      data: { action: 'SET_FULL_SCREEN', requestedHandler: 'UI', ...data },
      origin: APP_ORIGIN,
      source: iframe.contentWindow,
    });
    Object.defineProperty(event, 'ports', { value: [port] });
    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
    });
    return port;
  };

  it('takes the screen for this tab and answers', async () => {
    const port = await send({ enabled: true });
    expect(store.get(qappFullScreenTabAtom)).toBe('tab-torq');
    expect(port.postMessage).toHaveBeenCalledWith({
      result: true,
      error: null,
    });
  });

  it('gives it back, and tells the app it ended', async () => {
    await send({ enabled: true });
    const toApp = vi.spyOn(iframe.contentWindow as Window, 'postMessage');
    const port = await send({ enabled: false });
    expect(store.get(qappFullScreenTabAtom)).toBeNull();
    expect(port.postMessage).toHaveBeenCalledWith({
      result: true,
      error: null,
    });
    expect(toApp).toHaveBeenCalledWith(
      {
        action: 'FULL_SCREEN_CHANGED',
        requestedHandler: 'UI',
        payload: { enabled: false },
      },
      APP_ORIGIN
    );
    toApp.mockRestore();
  });

  it('reads enabled from a payload too', async () => {
    await send({ payload: { enabled: true } });
    expect(store.get(qappFullScreenTabAtom)).toBe('tab-torq');
  });

  it('Android back ends it', async () => {
    await send({ enabled: true });
    const live = back.handlers.filter((h) => h.enabled).slice(-1)[0];
    expect(live).toBeDefined();
    act(() => {
      expect(live?.handler()).toBe(true);
    });
    expect(store.get(qappFullScreenTabAtom)).toBeNull();
  });

  it('closing the tab ends it', async () => {
    await send({ enabled: true });
    unmount();
    expect(store.get(qappFullScreenTabAtom)).toBeNull();
  });
});
