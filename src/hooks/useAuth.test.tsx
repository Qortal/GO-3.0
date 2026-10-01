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
  rawWalletAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
} from '../atoms/global';
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

type FetchRoute = 'hang' | string;

/**
 * fetch stub keyed by path. 'hang' never answers but rejects like a real
 * fetch when its AbortSignal fires.
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
    return Promise.resolve({
      ok: true,
      text: async () => route,
      json: async () => JSON.parse(route),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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

describe('useAuth', () => {
  beforeEach(() => {
    resetUnlockTimingsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as any).sendMessage;
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
      const { result, store } = renderUseAuth({ address0: 'Qtest' });

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
});
