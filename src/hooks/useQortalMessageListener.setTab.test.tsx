import { renderHook } from '@testing-library/react';
import i18n from 'i18next';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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

import { useQortalMessageListener } from './useQortalMessageListener';

const APP_ORIGIN = 'http://node.test';

// Audit GO-21: SET_TAB used to spread the app's payload into the new tab, so a
// Q-App could set `url` + `isPreview` or a traversal path.
describe('SET_TAB from a Q-App', () => {
  let iframe: HTMLIFrameElement;
  let opened: unknown[];
  const onAddTab = (e: Event) => {
    opened.push((e as CustomEvent).detail?.data);
  };

  beforeAll(async () => {
    await i18n.init({
      lng: 'en',
      resources: {
        en: {
          auth: {
            message: { error: { invalid_qortal_link: 'invalid qortal link' } },
          },
        },
      },
    });
  });

  beforeEach(() => {
    opened = [];
    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    Object.defineProperty(iframe, 'src', {
      configurable: true,
      get: () => `${APP_ORIGIN}/render/APP/Some-App`,
    });
    document.addEventListener('addTab', onAddTab);
    renderHook(() =>
      useQortalMessageListener(
        window,
        { current: iframe },
        'tab-1',
        false,
        'Some-App',
        'APP',
        undefined
      )
    );
  });

  afterEach(() => {
    document.removeEventListener('addTab', onAddTab);
    iframe.remove();
  });

  // The app's end of the MessageChannel it sent with the request. jsdom has
  // no MessagePort, so the event gets a stand-in with the same postMessage.
  const sendSetTab = async (payload: unknown) => {
    const port = { postMessage: vi.fn() };
    const toApp = vi.spyOn(iframe.contentWindow as Window, 'postMessage');
    const event = new MessageEvent('message', {
      data: { action: 'SET_TAB', requestedHandler: 'UI', payload },
      origin: APP_ORIGIN,
      source: iframe.contentWindow,
    });
    Object.defineProperty(event, 'ports', { value: [port] });
    window.dispatchEvent(event);
    await Promise.resolve();
    const setTabSuccess = toApp.mock.calls.filter(
      ([message]) => message?.action === 'SET_TAB_SUCCESS'
    );
    toApp.mockRestore();
    return { port, setTabSuccess };
  };

  it('opens only service, name, identifier and path', async () => {
    const { port, setTabSuccess } = await sendSetTab({
      service: 'APP',
      name: 'Q-Tube',
      identifier: 'id-1',
      path: 'video/abc',
      url: 'https://evil.example/',
      isPreview: true,
      internal: 'q-chat',
    });
    expect(opened).toEqual([
      { service: 'APP', name: 'Q-Tube', identifier: 'id-1', path: 'video/abc' },
    ]);
    expect(setTabSuccess).toEqual([
      [
        {
          action: 'SET_TAB_SUCCESS',
          requestedHandler: 'UI',
          payload: { name: 'Q-Tube' },
        },
        APP_ORIGIN,
      ],
    ]);
    expect(port.postMessage).toHaveBeenCalledWith({
      result: true,
      error: null,
    });
  });

  it.each([
    { service: 'APP', name: 'Q-Wallets', path: '../../../render/APP/Evil' },
    {
      service: 'APP',
      name: 'Q-Wallets',
      path: '%2e%2e/%2e%2e/render/APP/Evil',
    },
    { service: 'APP', name: 'Q-Wallets', path: '..\\..\\render\\APP\\Evil' },
    { service: 'APP', name: '..', path: 'render/APP/Evil' },
    { service: 'APP', name: 'Q-Wallets', path: '%c0%ae%c0%ae/render/APP/Evil' },
    { service: 'APP', name: 'Q-Wallets', path: '%252e%252e/render/APP/Evil' },
    { url: 'https://evil.example/', isPreview: true, name: 'Q-Wallets' },
  ])('refuses %j and tells the app', async (payload) => {
    const { port, setTabSuccess } = await sendSetTab(payload);
    expect(opened).toEqual([]);
    expect(setTabSuccess).toEqual([]);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith({
      result: null,
      error: 'invalid qortal link',
    });
  });

  it('ignores SET_TAB from a window that is not this app', async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'SET_TAB',
          requestedHandler: 'UI',
          payload: { service: 'APP', name: 'Q-Tube' },
        },
        origin: APP_ORIGIN,
        source: window,
      })
    );
    await Promise.resolve();
    expect(opened).toEqual([]);
  });
});
