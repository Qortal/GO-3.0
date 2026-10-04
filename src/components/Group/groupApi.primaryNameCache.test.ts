import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getArbitrarySearchSimpleEndpointReact: () =>
    '/arbitrary/resources/searchsimple',
  getBaseApiReact: () => 'http://127.0.0.1:12391',
  getBaseApiReactForPrimaryName: () => 'http://127.0.0.1:12391',
}));
vi.mock('./groupQueues', () => ({
  requestQueueAdminMemberNames: { enqueue: vi.fn() },
  requestQueueMemberNames: { enqueue: vi.fn() },
}));
vi.mock('../../utils/walletPrimaryNameCache', () => ({
  isOwnWalletAddress: vi.fn((address: string) => address === OWN),
  rememberWalletPrimaryName: vi.fn(async () => undefined),
}));

import { getPrimaryNameForAvatar } from './groupApi';
import { rememberWalletPrimaryName } from '../../utils/walletPrimaryNameCache';

const OWN = 'QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG';
const PEER = 'QM8eUjZLNTQS9wosWJbcvPEtAUeMkcEraS';

const answer = (status: number, body: unknown) =>
  vi.fn(async (_url: string) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));

beforeEach(() => {
  vi.mocked(rememberWalletPrimaryName).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getPrimaryNameForAvatar', () => {
  it('remembers the name of one of this device’s wallets', async () => {
    const fetchMock = answer(200, { name: 'Alice', owner: OWN });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getPrimaryNameForAvatar(OWN)).resolves.toBe('Alice');
    expect(rememberWalletPrimaryName).toHaveBeenCalledWith(OWN, 'Alice');
    // One address per request, never a list.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `http://127.0.0.1:12391/names/primary/${OWN}`
    );
  });

  it('remembers that an own wallet has no name', async () => {
    vi.stubGlobal('fetch', answer(200, {}));
    await expect(getPrimaryNameForAvatar(OWN)).resolves.toBe('');
    expect(rememberWalletPrimaryName).toHaveBeenCalledWith(OWN, '');
  });

  it('never stores names of other people or failed lookups', async () => {
    vi.stubGlobal('fetch', answer(200, { name: 'Bob' }));
    await expect(getPrimaryNameForAvatar(PEER)).resolves.toBe('Bob');
    vi.stubGlobal('fetch', answer(500, { error: 'boom' }));
    await expect(getPrimaryNameForAvatar(OWN)).resolves.toBe('');
    vi.stubGlobal('fetch', answer(200, { error: 401, message: 'x' }));
    await expect(getPrimaryNameForAvatar(OWN)).resolves.toBe('');
    expect(rememberWalletPrimaryName).not.toHaveBeenCalled();
  });
});
