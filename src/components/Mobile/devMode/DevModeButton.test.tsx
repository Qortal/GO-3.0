import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../../../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';

const host = vi.hoisted(() => ({
  buildPrivateAppOnDevice: vi.fn(),
}));

vi.mock('../../../plugins/PrivateQappHost', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../plugins/PrivateQappHost')
  >()),
  buildPrivateAppOnDevice: host.buildPrivateAppOnDevice,
  canBuildPrivateAppsOnDevice: () => true,
}));

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'https://node.example',
}));

import { DevModeButton } from './DevModeButton';
import { DevModeSetting } from './DevModeSetting';
import { goDevModeEnabledAtom } from './devModeApp';

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const pick = (file: File) =>
  fireEvent.change(screen.getByTestId('dev-mode-zip-input'), {
    target: { files: [file] },
  });

describe('Dev Mode', () => {
  const events: Record<string, any[]> = {};
  const listeners: Record<string, (e: CustomEvent) => void> = {};

  beforeEach(() => {
    host.buildPrivateAppOnDevice.mockReset();
    for (const name of ['addTab', 'updateAppUrl', 'refreshApp']) {
      events[name] = [];
      listeners[name] = (e) => events[name].push(e.detail);
      subscribeToEvent(name, listeners[name]);
    }
  });

  afterEach(() => {
    for (const name of Object.keys(listeners)) {
      unsubscribeFromEvent(name, listeners[name]);
    }
    window.localStorage.removeItem('go_dev_mode_enabled');
  });

  it('is a System switch, off until turned on', () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <DevModeSetting />
      </Provider>
    );
    const toggle = screen.getByRole('checkbox', { name: 'Dev Mode' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(store.get(goDevModeEnabledAtom)).toBe(true);
    expect(window.localStorage.getItem('go_dev_mode_enabled')).toBe('true');
  });

  it('opens a picked zip in a tab, and Refresh reads it again', async () => {
    host.buildPrivateAppOnDevice
      .mockResolvedValueOnce({
        id: 'a',
        url: 'https://node.example/render/hash/a',
      })
      .mockResolvedValueOnce({
        id: 'b',
        url: 'https://node.example/render/hash/b',
      });
    const store = createStore();
    render(
      <Provider store={store}>
        <DevModeButton />
      </Provider>
    );
    expect(screen.getByRole('button', { name: 'Dev Mode' })).toBeVisible();
    expect(screen.getByTestId('dev-mode-zip-input')).toHaveAttribute(
      'accept',
      expect.stringContaining('.zip')
    );

    pick(new File([ZIP], 'my-app.zip', { type: 'application/zip' }));

    await waitFor(() => expect(events.addTab).toHaveLength(1));
    const tab = events.addTab[0].data;
    expect(tab).toMatchObject({
      url: 'https://node.example/render/hash/a',
      isPreview: true,
      isDevZip: true,
      service: 'APP',
      name: 'Dev: my-app',
      label: 'my-app',
    });
    expect(tab.identifier).toBeUndefined();
    expect(tab.privateAppProperties).toBeUndefined();
    expect(store.get(openSnackGlobalAtom)).toBe(false);

    await act(async () => {
      tab.refreshFunc('tab-1');
    });
    await waitFor(() => expect(events.updateAppUrl).toHaveLength(1));
    expect(events.updateAppUrl[0]).toEqual({
      tabId: 'tab-1',
      url: 'https://node.example/render/hash/b',
    });
  });

  it('says so when the file is not a zip, and opens nothing', async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <DevModeButton />
      </Provider>
    );

    pick(new File(['<html></html>'], 'index.html'));

    await waitFor(() =>
      expect(store.get(infoSnackGlobalAtom)).toMatchObject({
        type: 'error',
        message: 'That file is not a .zip',
      })
    );
    expect(events.addTab).toHaveLength(0);
    expect(host.buildPrivateAppOnDevice).not.toHaveBeenCalled();
  });

  it('reloads the last copy when a refreshed zip no longer builds', async () => {
    host.buildPrivateAppOnDevice
      .mockResolvedValueOnce({
        id: 'a',
        url: 'https://node.example/render/hash/a',
      })
      .mockRejectedValueOnce(new Error('invalid app'));
    const store = createStore();
    render(
      <Provider store={store}>
        <DevModeButton />
      </Provider>
    );
    pick(new File([ZIP], 'app.zip'));
    await waitFor(() => expect(events.addTab).toHaveLength(1));

    await act(async () => {
      events.addTab[0].data.refreshFunc('tab-1');
    });
    await waitFor(() => expect(events.refreshApp).toHaveLength(1));
    expect(events.refreshApp[0]).toEqual({ tabId: 'tab-1' });
    expect(events.updateAppUrl).toHaveLength(0);
    expect(store.get(infoSnackGlobalAtom)).toMatchObject({ type: 'error' });
  });
});
