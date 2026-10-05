import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real background-cases.ts with storage and background.ts replaced: a
// stored session key must be the account's own before a session resumes.

const storage = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) => {
    if (key in storage.values) return storage.values[key];
    throw new Error(`No ${key} in storage`);
  }),
  storeData: vi.fn(async (key: string, value: unknown) => {
    storage.values[key] = value;
  }),
}));
vi.mock('../background', () => ({
  getKeyPair: vi.fn(async () => {
    if (storage.values.keyPair) return storage.values.keyPair;
    throw new Error('Wallet not authenticated');
  }),
}));

import Base58Untyped from '../../encryption/Base58';
import naclUntyped from '../../encryption/nacl-fast';
import publicKeyToAddressUntyped from '../../utils/generateWallet/publicKeyToAddress';
import {
  getWalletInfoCase,
  tryResumeWalletSessionCase,
} from '../background-cases';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function account(fill: number) {
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(fill));
  return {
    address: String(publicKeyToAddress(pair.publicKey)),
    keyPair: {
      publicKey: Base58.encode(pair.publicKey) as string,
      privateKey: Base58.encode(pair.secretKey) as string,
    },
  };
}

const me = account(1);
const someoneElse = account(2);

async function ask(
  handler: (request: unknown, event: unknown) => Promise<void>,
  payload?: unknown
) {
  const postMessage = vi.fn();
  await handler(
    { requestId: 'r1', payload },
    { source: { postMessage }, origin: 'http://localhost' }
  );
  expect(postMessage).toHaveBeenCalledTimes(1);
  return postMessage.mock.calls[0][0].payload;
}

beforeEach(() => {
  storage.values = {};
});

describe('tryResumeWalletSessionCase', () => {
  it("resumes a session whose key is the account's own", async () => {
    storage.values.keyPair = me.keyPair;
    storage.values.walletInfo = { address0: me.address };
    await expect(
      ask(tryResumeWalletSessionCase, { address: me.address })
    ).resolves.toMatchObject({ ok: true, address: me.address });
  });

  it("refuses a session holding another account's key", async () => {
    storage.values.keyPair = someoneElse.keyPair;
    storage.values.walletInfo = { address0: me.address };
    await expect(
      ask(tryResumeWalletSessionCase, { address: me.address })
    ).resolves.toMatchObject({ ok: false });
    // Nothing is deleted: the normal unlock takes over.
    expect(storage.values.keyPair).toBe(someoneElse.keyPair);
    expect(storage.values.walletInfo).toEqual({ address0: me.address });
  });

  it('refuses a session without an account address', async () => {
    storage.values.keyPair = me.keyPair;
    storage.values.walletInfo = { address0: '' };
    await expect(ask(tryResumeWalletSessionCase, {})).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe('getWalletInfoCase', () => {
  it("reports a usable key only when it is the account's own", async () => {
    storage.values.keyPair = me.keyPair;
    storage.values.walletInfo = { address0: me.address };
    await expect(ask(getWalletInfoCase)).resolves.toMatchObject({
      hasKeyPair: true,
      walletInfo: { address0: me.address },
    });

    storage.values.keyPair = someoneElse.keyPair;
    await expect(ask(getWalletInfoCase)).resolves.toMatchObject({
      hasKeyPair: false,
      walletInfo: { address0: me.address },
    });
  });
});
