import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticatePasswordAtom,
  extStateAtom,
  isLoadingAuthenticateAtom,
  isOpenCoreSetup,
  isOpenDialogCustomApikey,
  isOpenDialogResetApikey,
  isOpenSyncingDialogAtom,
  isOpenUrlInvalidAtom,
  isPublicNodeUnavailableAtom,
  rawWalletAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
} from '../atoms/global';
import { HTTPS_EXT_NODE_QORTAL_LINK } from '../constants/constants';
import {
  getUnlockTimingSnapshot,
  resetUnlockTimingsForTests,
} from '../utils/unlockTimings';
import { useAuth } from './useAuth';

vi.mock('../App', () => ({
  handleSetGlobalApikey: vi.fn(),
}));

vi.mock('../background/background-cases', () => ({
  getLocalApiKeyNotElectronCase: vi.fn(async () => ''),
  setLocalApiKeyNotElectronCase: vi.fn(),
}));

const REMOTE_NODE = { url: 'http://10.0.0.5:12391', apikey: 'test-key' };
// e.g. an SSH tunnel forwarded to 127.0.0.1:12391 on the phone.
const LOCAL_NODE = { url: 'http://127.0.0.1:12391', apikey: '' };
const PUBLIC_NODE = { url: HTTPS_EXT_NODE_QORTAL_LINK, apikey: '' };
// A private Core reached over an SSH tunnel on another port (a custom node).
const TUNNEL_NODE = { url: 'http://127.0.0.1:12398', apikey: 'test-key' };
// A private Core on the home network, with no key saved in GO yet.
const LAN_NODE = { url: 'http://192.168.1.20:12391', apikey: '' };
// What Core answers a wrong key with.
const KEY_REFUSED = {
  status: 403,
  body: '{"error":4,"message":"API key invalid"}',
};
// What Core answers a call with no key from outside loopback with.
const KEY_MISSING = {
  status: 401,
  body: `{"error":4,"message":"Missing 'X-API-KEY' header"}`,
};
// What nginx in front of a busy or restarting node answers with.
const BAD_GATEWAY = {
  status: 502,
  body: '<html><head><title>502 Bad Gateway</title></head></html>',
};

type FetchRoute = 'hang' | string | { status: number; body: string };

/**
 * fetch stub keyed by path. 'hang' never answers but rejects like a real
 * fetch when its AbortSignal fires; { status, body } answers with that HTTP
 * status, a plain string with 200.
 */
function stubFetch(routes: Record<string, FetchRoute>) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    const route = routes[path];
    if (route === undefined) {
      return Promise.reject(new TypeError(`unexpected fetch ${path}`));
    }
    if (route === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    const { status, body } =
      typeof route === 'string' ? { status: 200, body: route } : route;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      json: async () => JSON.parse(body),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** What the device reports in navigator.onLine (jsdom says online). */
function setDeviceOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

/** Online, but every request fails, as when the chosen node is down. */
function stubNodeDown() {
  const fetchMock = vi.fn(() =>
    Promise.reject(new TypeError('Failed to fetch'))
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** No network at all: the device says offline and every request fails. */
function stubOffline() {
  setDeviceOnline(false);
  return stubNodeDown();
}

/** GO: the Capacitor app, without the desktop's coreSetup. */
function runAsGo() {
  (window as any).Capacitor = { isNativePlatform: () => true };
}

/** The Electron desktop: coreSetup (and Capacitor, which it also runs). */
function runAsDesktop(coreSetup: Record<string, unknown> = {}) {
  (window as any).Capacitor = { isNativePlatform: () => true };
  (window as any).coreSetup = {
    isCoreRunning: vi.fn(async () => false),
    getApiKey: vi.fn(async () => ''),
    ...coreSetup,
  };
}

function stubSendMessage(responses: Record<string, unknown> = {}) {
  const sendMessage = vi.fn(async (action: string) =>
    action in responses ? responses[action] : {}
  );
  (window as any).sendMessage = sendMessage;
  return sendMessage;
}

function renderUseAuth(wallet?: { address0: string }, node = REMOTE_NODE) {
  const store = createStore();
  store.set(selectedNodeInfoAtom, { ...node });
  if (wallet) store.set(rawWalletAtom, wallet);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { result } = renderHook(() => useAuth(), { wrapper });
  return { result, store };
}

function timingSteps() {
  return getUnlockTimingSnapshot().events.map((e) => [e.step, e.detail]);
}

/**
 * App.authenticateWallet's password unlock: the node check, then the
 * decrypt when the check lets the unlock go on.
 */
async function passwordUnlock(
  result: ReturnType<typeof renderUseAuth>['result']
) {
  let unlocked = false;
  await act(async () => {
    const mayUnlock = await result.current.checkNodeBeforeUnlock({
      refreshUserInfo: false,
    });
    unlocked = mayUnlock ? await result.current.authenticate() : false;
  });
  return unlocked;
}

describe('useAuth', () => {
  beforeEach(() => {
    resetUnlockTimingsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as any).sendMessage;
    delete (window as any).Capacitor;
    delete (window as any).coreSetup;
    // Back to jsdom's own navigator.onLine getter.
    delete (window.navigator as any).onLine;
  });

  describe('validateApiKey timeouts', () => {
    it('gives up on a silent localAuthBypassEnabled like a network error', async () => {
      vi.useFakeTimers();
      const fetchMock = stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'hang',
      });
      const { result, store } = renderUseAuth();

      const pending = result.current.validateApiKey({ ...REMOTE_NODE });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      await expect(pending).resolves.toMatchObject({ isValid: false });
      // Same outcome as a thrown fetch: no API key test, no key dialog.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(store.get(isOpenDialogCustomApikey)).toBe(false);
    });

    it('gives up on a silent apikey/test and asks for the key as before', async () => {
      vi.useFakeTimers();
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'hang',
      });
      const { result, store } = renderUseAuth();

      const pending = result.current.validateApiKey({ ...REMOTE_NODE });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      await expect(pending).resolves.toMatchObject({ isValid: false });
      expect(store.get(isOpenDialogCustomApikey)).toBe(true);
    });

    it('still accepts a node that answers in time', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'true',
      });
      const { result } = renderUseAuth();

      await expect(
        result.current.validateApiKey({ ...REMOTE_NODE })
      ).resolves.toMatchObject({ isValid: true });
    });
  });

  describe('isNodeValid', () => {
    beforeEach(() => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'true',
      });
    });

    it('refreshes user info by default', async () => {
      const sendMessage = stubSendMessage({ userInfo: { name: 'alice' } });
      const { result, store } = renderUseAuth();

      let valid = false;
      await act(async () => {
        valid = await result.current.isNodeValid();
      });

      expect(valid).toBe(true);
      expect(sendMessage.mock.calls.map(([action]) => action)).toEqual([
        'setApiKey',
        'userInfo',
      ]);
      expect(store.get(userInfoAtom)).toEqual({ name: 'alice' });
      expect(timingSteps()).toEqual([['node-check', 'ok, remote node']]);
    });

    it('skips the user info refresh when asked to', async () => {
      const sendMessage = stubSendMessage({ userInfo: { name: 'alice' } });
      const { result, store } = renderUseAuth();

      let valid = false;
      await act(async () => {
        valid = await result.current.isNodeValid({ refreshUserInfo: false });
      });

      expect(valid).toBe(true);
      expect(sendMessage.mock.calls.map(([action]) => action)).toEqual([
        'setApiKey',
      ]);
      expect(store.get(userInfoAtom)).toBeNull();
    });

    it('records a failed check', async () => {
      stubFetch({ '/admin/status': 'hang' });
      vi.useFakeTimers();
      stubSendMessage();
      const { result } = renderUseAuth();

      let valid = true;
      await act(async () => {
        const pending = result.current.isNodeValid({ refreshUserInfo: false });
        await vi.advanceTimersByTimeAsync(5000);
        valid = await pending;
      });

      expect(valid).toBe(false);
      expect(timingSteps()).toEqual([['node-check', 'failed, remote node']]);
    });

    it('gives up on a silent local node like a stopped one', async () => {
      vi.useFakeTimers();
      stubFetch({ '/admin/status': 'hang' });
      stubSendMessage();
      const { result, store } = renderUseAuth(undefined, LOCAL_NODE);

      let valid = true;
      await act(async () => {
        const pending = result.current.isNodeValid({ refreshUserInfo: false });
        await vi.advanceTimersByTimeAsync(5000);
        valid = await pending;
      });

      expect(valid).toBe(false);
      expect(store.get(isOpenCoreSetup)).toBe(true);
      expect(timingSteps()).toEqual([['node-check', 'failed, local node']]);
    });

    it('gives up on a silent apikey/generate and asks to reset the key', async () => {
      vi.useFakeTimers();
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'false',
        '/admin/apikey/generate': 'hang',
      });
      stubSendMessage();
      const { result, store } = renderUseAuth(undefined, LOCAL_NODE);

      let valid = true;
      await act(async () => {
        const pending = result.current.isNodeValid({ refreshUserInfo: false });
        await vi.advanceTimersByTimeAsync(5000);
        valid = await pending;
      });

      expect(valid).toBe(false);
      expect(store.get(isOpenDialogResetApikey)).toBe(true);
    });
  });

  describe('authenticate on a local node', () => {
    it('gives up on a silent sync check without starting the decrypt', async () => {
      vi.useFakeTimers();
      stubFetch({ '/admin/status': 'hang' });
      const sendMessage = stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        LOCAL_NODE
      );

      let unlocked = true;
      await act(async () => {
        const pending = result.current.authenticate();
        await vi.advanceTimersByTimeAsync(5000);
        unlocked = await pending;
      });

      expect(unlocked).toBe(false);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(store.get(isLoadingAuthenticateAtom)).toBe(false);

      // The next attempt is not blocked by the one that timed out.
      stubFetch({ '/admin/status': '{"syncPercent":100}' });
      await act(async () => {
        unlocked = await result.current.authenticate();
      });
      expect(unlocked).toBe(true);
    });
  });

  describe('authenticate timings', () => {
    it('records the decrypt and the password unlock', async () => {
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth({ address0: 'Qtest' });
      store.set(authenticatePasswordAtom, 'pw');

      let unlocked = false;
      await act(async () => {
        unlocked = await result.current.authenticate();
      });

      expect(unlocked).toBe(true);
      expect(store.get(extStateAtom)).toBe('authenticated');
      expect(store.get(isLoadingAuthenticateAtom)).toBe(false);
      expect(timingSteps()).toEqual([
        ['decrypt', 'ok'],
        ['unlock', 'password'],
      ]);
    });

    it('records a failed decrypt without an unlock', async () => {
      stubSendMessage({ decryptWallet: { error: 'bad password' } });
      const { result, store } = renderUseAuth({ address0: 'Qtest' });

      await act(async () => {
        await result.current.authenticate();
      });

      expect(store.get(extStateAtom)).toBe('not-authenticated');
      expect(timingSteps()).toEqual([['decrypt', 'failed']]);
    });

    it('labels fingerprint and resumed-session unlocks', async () => {
      stubSendMessage({
        tryResumeWalletSession: { ok: false },
        decryptWallet: true,
      });
      const { result } = renderUseAuth({ address0: 'Qtest' });

      await act(async () => {
        await result.current.authenticate(undefined, true);
      });
      stubSendMessage({ tryResumeWalletSession: { ok: true } });
      await act(async () => {
        await result.current.authenticate(undefined, true);
      });

      expect(timingSteps()).toEqual([
        ['decrypt', 'ok'],
        ['unlock', 'fingerprint'],
        ['unlock', 'resumed session'],
      ]);
    });
  });

  describe('checkNode', () => {
    it('says a node that does not answer is unreachable', async () => {
      stubOffline();
      stubSendMessage();
      const { result } = renderUseAuth();

      let check;
      await act(async () => {
        check = await result.current.checkNode({ refreshUserInfo: false });
      });

      expect(check).toEqual({ ok: false, failure: 'unreachable' });
    });

    it('says a node that answers but refuses the key rejected it', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'false',
      });
      stubSendMessage();
      const { result } = renderUseAuth();

      let check;
      await act(async () => {
        check = await result.current.checkNode({ refreshUserInfo: false });
      });

      expect(check).toEqual({ ok: false, failure: 'key-rejected' });
    });
  });

  describe('password unlock on GO', () => {
    beforeEach(() => {
      runAsGo();
    });

    it.each([
      ['the public node', PUBLIC_NODE, 'public node'],
      ['a private node over a tunnel', TUNNEL_NODE, 'remote node'],
      ['a local node', LOCAL_NODE, 'local node'],
    ])(
      'unlocks offline on %s like the fingerprint, with no Core window',
      async (_label, node, kind) => {
        stubOffline();
        const sendMessage = stubSendMessage({ decryptWallet: true });
        const { result, store } = renderUseAuth({ address0: 'Qtest' }, node);
        store.set(authenticatePasswordAtom, 'pw');

        expect(await passwordUnlock(result)).toBe(true);

        expect(store.get(extStateAtom)).toBe('authenticated');
        expect(store.get(isOpenCoreSetup)).toBe(false);
        expect(store.get(isOpenUrlInvalidAtom)).toBe(false);
        expect(store.get(isPublicNodeUnavailableAtom)).toBe(false);
        expect(store.get(isOpenDialogCustomApikey)).toBe(false);
        expect(store.get(isOpenDialogResetApikey)).toBe(false);
        // The unreachable node is kept as it was, not saved again.
        expect(sendMessage.mock.calls.map(([action]) => action)).not.toContain(
          'setApiKey'
        );
        expect(store.get(selectedNodeInfoAtom)).toEqual(node);
        expect(timingSteps()[0]).toEqual([
          'node-check',
          `failed (unreachable), ${kind}`,
        ]);
      }
    );

    it('unlocks when a tunnel accepts but never answers', async () => {
      vi.useFakeTimers();
      stubFetch({ '/admin/status': 'hang' });
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        LOCAL_NODE
      );

      let unlocked = false;
      await act(async () => {
        const pending = passwordUnlock(result);
        await vi.advanceTimersByTimeAsync(10_000);
        unlocked = await pending;
      });

      expect(unlocked).toBe(true);
      expect(store.get(isOpenCoreSetup)).toBe(false);
      // Online, so the tunnel being down is not hidden.
      expect(store.get(isOpenUrlInvalidAtom)).toBe(true);
    });

    it.each([
      ['a private node over a tunnel', TUNNEL_NODE],
      ['a local node', LOCAL_NODE],
      ['a custom node', REMOTE_NODE],
    ])(
      'online, unlocks on %s that is down and says the url is invalid',
      async (_label, node) => {
        stubNodeDown();
        stubSendMessage({ decryptWallet: true });
        const { result, store } = renderUseAuth({ address0: 'Qtest' }, node);
        store.set(authenticatePasswordAtom, 'pw');

        expect(await passwordUnlock(result)).toBe(true);

        expect(store.get(extStateAtom)).toBe('authenticated');
        expect(store.get(isOpenUrlInvalidAtom)).toBe(true);
        expect(store.get(isOpenCoreSetup)).toBe(false);
        expect(store.get(isPublicNodeUnavailableAtom)).toBe(false);
        expect(store.get(isOpenDialogCustomApikey)).toBe(false);
        expect(store.get(isOpenDialogResetApikey)).toBe(false);
      }
    );

    it('online, unlocks with no dialog when the public node is down', async () => {
      stubNodeDown();
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        PUBLIC_NODE
      );
      store.set(authenticatePasswordAtom, 'pw');

      expect(await passwordUnlock(result)).toBe(true);

      expect(store.get(isOpenUrlInvalidAtom)).toBe(false);
      expect(store.get(isOpenCoreSetup)).toBe(false);
      expect(store.get(isPublicNodeUnavailableAtom)).toBe(false);
    });

    it('unlocks without a key dialog when the key test gets no answer', async () => {
      vi.useFakeTimers();
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'hang',
      });
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth({ address0: 'Qtest' });

      let unlocked = false;
      await act(async () => {
        const pending = passwordUnlock(result);
        await vi.advanceTimersByTimeAsync(5000);
        unlocked = await pending;
      });

      expect(unlocked).toBe(true);
      expect(store.get(isOpenDialogCustomApikey)).toBe(false);
    });

    it('unlocks on the public node with no key dialog when it answers with an error page', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': BAD_GATEWAY,
        '/admin/apikey/test': BAD_GATEWAY,
      });
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        PUBLIC_NODE
      );
      store.set(authenticatePasswordAtom, 'pw');

      expect(await passwordUnlock(result)).toBe(true);

      expect(store.get(extStateAtom)).toBe('authenticated');
      expect(store.get(isOpenDialogCustomApikey)).toBe(false);
      expect(timingSteps()[0]).toEqual([
        'node-check',
        'failed (unreachable), public node',
      ]);
    });

    it('unlocks on the public node with no key dialog even when it refuses', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': KEY_REFUSED,
      });
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        PUBLIC_NODE
      );
      store.set(authenticatePasswordAtom, 'pw');

      expect(await passwordUnlock(result)).toBe(true);

      expect(store.get(extStateAtom)).toBe('authenticated');
      expect(store.get(isOpenDialogCustomApikey)).toBe(false);
      expect(timingSteps()[0]).toEqual([
        'node-check',
        'failed (key-rejected), public node',
      ]);
    });

    it('unlocks without a key dialog when a node answers the key test with a server error', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': { status: 503, body: 'Service Unavailable' },
      });
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth({ address0: 'Qtest' });

      expect(await passwordUnlock(result)).toBe(true);

      expect(store.get(isOpenDialogCustomApikey)).toBe(false);
      expect(timingSteps()[0]).toEqual([
        'node-check',
        'failed (unreachable), remote node',
      ]);
    });

    it('still asks for the key when the node refuses it with 403', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': KEY_REFUSED,
      });
      const sendMessage = stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth({ address0: 'Qtest' });

      expect(await passwordUnlock(result)).toBe(false);

      expect(store.get(isOpenDialogCustomApikey)).toBe(true);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('still asks for the key when the node rejects it', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'false',
      });
      const sendMessage = stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth({ address0: 'Qtest' });

      expect(await passwordUnlock(result)).toBe(false);

      expect(store.get(isOpenDialogCustomApikey)).toBe(true);
      expect(store.get(isOpenCoreSetup)).toBe(false);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(store.get(extStateAtom)).toBe('not-authenticated');
    });

    it('still asks to reset a local key the node rejects', async () => {
      vi.useFakeTimers();
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'false',
        '/admin/apikey/generate': 'hang',
      });
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        LOCAL_NODE
      );

      let unlocked = true;
      await act(async () => {
        const pending = passwordUnlock(result);
        await vi.advanceTimersByTimeAsync(5000);
        unlocked = await pending;
      });

      expect(unlocked).toBe(false);
      expect(store.get(isOpenDialogResetApikey)).toBe(true);
      expect(store.get(isOpenCoreSetup)).toBe(false);
    });

    it('saves a node that works, as before', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'false',
        '/admin/apikey/test': 'true',
      });
      const sendMessage = stubSendMessage({ decryptWallet: true });
      const { result } = renderUseAuth({ address0: 'Qtest' });

      expect(await passwordUnlock(result)).toBe(true);

      expect(sendMessage.mock.calls[0]).toEqual(['setApiKey', REMOTE_NODE]);
    });

    it('still waits for a local node that answers but is syncing', async () => {
      stubFetch({ '/admin/status': '{"syncPercent":50}' });
      const sendMessage = stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        LOCAL_NODE
      );

      let unlocked = true;
      await act(async () => {
        unlocked = await result.current.authenticate();
      });

      expect(unlocked).toBe(false);
      expect(store.get(isOpenSyncingDialogAtom)).toBe(true);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  // Core's local auth bypass only covers requests from a loopback address: a
  // node further away with it on still refuses keyless writes (a publish).
  describe('local auth bypass', () => {
    const fetchedPaths = (fetchMock: ReturnType<typeof stubFetch>) =>
      fetchMock.mock.calls.map(([input]) => new URL(input).pathname);

    it('asks for the key on a LAN node with the bypass on and no key', async () => {
      runAsGo();
      const fetchMock = stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'true',
        '/admin/apikey/test': KEY_MISSING,
      });
      const sendMessage = stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth({ address0: 'Qtest' }, LAN_NODE);

      expect(await passwordUnlock(result)).toBe(false);

      expect(fetchedPaths(fetchMock)).toContain('/admin/apikey/test');
      expect(store.get(isOpenDialogCustomApikey)).toBe(true);
      // Not saved as a node that works.
      expect(sendMessage).not.toHaveBeenCalled();
      expect(timingSteps()[0]).toEqual([
        'node-check',
        'failed (key-rejected), remote node',
      ]);
    });

    it('asks for the key on the desktop too', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'true',
        '/admin/apikey/test': KEY_MISSING,
      });
      const { result, store } = renderUseAuth(undefined, LAN_NODE);

      await expect(
        result.current.validateApiKey({ ...LAN_NODE })
      ).resolves.toMatchObject({ isValid: false, failure: 'key-rejected' });
      expect(store.get(isOpenDialogCustomApikey)).toBe(true);
    });

    it('accepts a LAN node with the bypass on once its key works', async () => {
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'true',
        '/admin/apikey/test': 'true',
      });
      const { result, store } = renderUseAuth(undefined, REMOTE_NODE);

      await expect(
        result.current.validateApiKey({ ...REMOTE_NODE })
      ).resolves.toMatchObject({ isValid: true });
      expect(store.get(isOpenDialogCustomApikey)).toBe(false);
    });

    it.each([
      ['an SSH tunnel on 127.0.0.1', 'http://127.0.0.1:12398'],
      ['localhost', 'http://localhost:12391'],
      ['::1', 'http://[::1]:12391'],
    ])(
      'still trusts the bypass on %s, with no key test',
      async (_label, url) => {
        const fetchMock = stubFetch({
          '/admin/status': '{}',
          '/admin/settings/localAuthBypassEnabled': 'true',
        });
        const node = { url, apikey: '' };
        const { result, store } = renderUseAuth(undefined, node);

        await expect(
          result.current.validateApiKey({ ...node })
        ).resolves.toMatchObject({ isValid: true });
        expect(fetchedPaths(fetchMock)).not.toContain('/admin/apikey/test');
        expect(store.get(isOpenDialogCustomApikey)).toBe(false);
      }
    );

    it('never asks for a key on the public node, bypass or not', async () => {
      runAsGo();
      stubFetch({
        '/admin/status': '{}',
        '/admin/settings/localAuthBypassEnabled': 'true',
        '/admin/apikey/test': KEY_MISSING,
      });
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        PUBLIC_NODE
      );
      store.set(authenticatePasswordAtom, 'pw');

      expect(await passwordUnlock(result)).toBe(true);

      expect(store.get(extStateAtom)).toBe('authenticated');
      expect(store.get(isOpenDialogCustomApikey)).toBe(false);
    });
  });

  describe('password unlock on the desktop', () => {
    it('opens Core setup when the public node cannot be reached, as before', async () => {
      runAsDesktop();
      stubOffline();
      const sendMessage = stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        PUBLIC_NODE
      );

      expect(await passwordUnlock(result)).toBe(false);

      expect(store.get(isOpenCoreSetup)).toBe(true);
      expect(store.get(isPublicNodeUnavailableAtom)).toBe(true);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(timingSteps()).toEqual([['node-check', 'failed, remote node']]);
    });

    it('opens Core setup when the local Core is not running, as before', async () => {
      runAsDesktop({ isCoreRunning: vi.fn(async () => false) });
      stubOffline();
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth(
        { address0: 'Qtest' },
        { url: 'https://127.0.0.1:12391', apikey: '' }
      );

      expect(await passwordUnlock(result)).toBe(false);

      expect(store.get(isOpenCoreSetup)).toBe(true);
    });

    it('says a custom node that cannot be reached is invalid, as before', async () => {
      runAsDesktop();
      stubOffline();
      stubSendMessage({ decryptWallet: true });
      const { result, store } = renderUseAuth({ address0: 'Qtest' });

      expect(await passwordUnlock(result)).toBe(false);

      expect(store.get(isOpenUrlInvalidAtom)).toBe(true);
      expect(store.get(isOpenCoreSetup)).toBe(false);
    });
  });
});
