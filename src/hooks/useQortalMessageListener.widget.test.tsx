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
import type { QappWidgetPolicy } from '../components/Mobile/widgets/widgetRequests';

const APP_ORIGIN = 'http://node.test';

describe('a GO widget frame', () => {
  let iframe: HTMLIFrameElement;
  let store: ReturnType<typeof createStore>;
  let onScreen: boolean;
  let answer: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    back.handlers = [];
    store = createStore();
    onScreen = true;
    answer = vi.fn(() => ({ widget: true }));
    sendMessage = vi.fn(async () => ({ address: 'Qme' }));
    (window as unknown as { sendMessage: unknown }).sendMessage = sendMessage;
    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    Object.defineProperty(iframe, 'src', {
      configurable: true,
      get: () => `${APP_ORIGIN}/render/APP/Torq?identifier=go-widget-news`,
    });
    const widget: QappWidgetPolicy = {
      isOnScreen: () => onScreen,
      answer: answer as unknown as QappWidgetPolicy['answer'],
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    renderHook(
      () =>
        useQortalMessageListener(
          window,
          { current: iframe },
          'go-widget:Torq:go-widget-news',
          false,
          'Torq',
          'APP',
          'go-widget-news',
          widget
        ),
      { wrapper }
    );
  });

  afterEach(() => {
    iframe.remove();
  });

  const send = async (data: Record<string, unknown>) => {
    const port = { postMessage: vi.fn() };
    const event = new MessageEvent('message', {
      data: { requestedHandler: 'UI', ...data },
      origin: APP_ORIGIN,
      source: iframe.contentWindow,
    });
    Object.defineProperty(event, 'ports', { value: [port] });
    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
      await Promise.resolve();
    });
    return port;
  };

  it.each([
    'SEND_COIN',
    'PUBLISH_QDN_RESOURCE',
    'SIGN_TRANSACTION',
    'DECRYPT_DATA',
    'SAVE_FILE',
    'SEND_CHAT_MESSAGE',
    'NOTIFICATION_ADD',
    'GET_USER_WALLET',
    'SOMETHING_NEW',
  ])('refuses %s, and never asks GO for it', async (action) => {
    const port = await send({ action });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith({
      result: null,
      error: expect.objectContaining({
        message: expect.stringContaining('Not available in GO widgets'),
      }),
    });
  });

  it('never takes the whole screen', async () => {
    const port = await send({ action: 'SET_FULL_SCREEN', enabled: true });
    expect(store.get(qappFullScreenTabAtom)).toBeNull();
    expect(port.postMessage.mock.calls[0][0].error).toBeTruthy();
  });

  it('passes an allowed request on, as its own tab', async () => {
    const port = await send({ action: 'GET_USER_ACCOUNT' });
    expect(sendMessage).toHaveBeenCalledWith(
      'GET_USER_ACCOUNT',
      expect.anything(),
      expect.any(Number),
      true,
      { name: 'Torq', service: 'APP', tabId: 'go-widget:Torq:go-widget-news' }
    );
    expect(port.postMessage).toHaveBeenCalledWith({
      result: { address: 'Qme' },
      error: null,
    });
  });

  it('takes asking and opening requests only while its screen shows', async () => {
    onScreen = false;
    for (const action of ['GET_USER_ACCOUNT', 'OPEN_NEW_TAB', 'SET_TAB']) {
      const port = await send({ action });
      expect(port.postMessage.mock.calls[0][0].error.message).toBe(
        'The widgets screen is not showing.'
      );
    }
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('answers its own GO_WIDGET_* requests through the screen', async () => {
    const port = await send({ action: 'GO_WIDGET_INFO' });
    expect(answer).toHaveBeenCalledWith(
      'GO_WIDGET_INFO',
      expect.objectContaining({ action: 'GO_WIDGET_INFO' })
    );
    expect(port.postMessage).toHaveBeenCalledWith({
      result: { widget: true },
      error: null,
    });
    // Even off screen: it only reports, it opens nothing.
    onScreen = false;
    await send({ action: 'GO_WIDGET_SET_SIZE', height: 180 });
    expect(answer).toHaveBeenLastCalledWith(
      'GO_WIDGET_SET_SIZE',
      expect.objectContaining({ height: 180 })
    );
  });

  it('ignores messages from anything but its own frame', async () => {
    const port = { postMessage: vi.fn() };
    const event = new MessageEvent('message', {
      data: { action: 'GO_WIDGET_INFO', requestedHandler: 'UI' },
      origin: 'http://evil.test',
      source: iframe.contentWindow,
    });
    Object.defineProperty(event, 'ports', { value: [port] });
    await act(async () => {
      window.dispatchEvent(event);
    });
    expect(answer).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});
