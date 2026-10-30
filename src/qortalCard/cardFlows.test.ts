import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it, vi } from 'vitest';

// Addresses need the real SHA-256 (the global test setup mocks asmcrypto).
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
import { cardAddress, cardKeyPairFromSeed, deriveCardSeed } from './cardKeys';
import {
  connectCard,
  loadWalletKey,
  makeKeyOnCard,
  pickWalletKeyIndex,
  readCard,
  registerNameTx,
  signChargeOnCard,
  signTxOnCard,
  signTxWithWalletKey,
  signWithWalletCardKey,
  type CardFlowDeps,
} from './cardFlows';
import { readPublicKey, selectApplet } from './cardProtocol';
import { verifyCardSignature } from './cardTx';
import { SimulatedCard } from './simulatedCard';
import { nacl } from './cryptoDeps';

const MAIN = nacl.sign.keyPair().secretKey;
const SHOP = 'QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoA';

/** Fixed time and "random" bytes, so two signers can be compared. */
const fixedDeps = (): CardFlowDeps => ({
  now: () => 1791891597022,
  randomBytes: (length) => new Uint8Array(length).fill(5),
});

describe('connecting a card', () => {
  it('reads a blank card, loads wallet key 2, then recognises it', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    const blank = await readCard(card, MAIN);
    expect(blank).toMatchObject({
      applet: 'qortal-lab',
      canImportKey: true,
      publicKey: null,
      address: null,
      walletKeyIndex: null,
    });

    const loaded = await loadWalletKey(card, MAIN, 2, fixedDeps());
    const expected = cardKeyPairFromSeed(deriveCardSeed(MAIN, 2));
    expect(bytesToHex(loaded.publicKey)).toBe(bytesToHex(expected.publicKey));
    expect(loaded.address).toBe(cardAddress(expected.publicKey));
    expect(loaded.walletKeyIndex).toBe(2);

    const again = await readCard(card, MAIN);
    expect(again.walletKeyIndex).toBe(2);
    expect(again.address).toBe(loaded.address);
    // Without the wallet key GO cannot tell whose key it is.
    expect((await readCard(card)).walletKeyIndex).toBeNull();
  });

  it('never overwrites a key already on the card unless asked to', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    const first = await makeKeyOnCard(card);
    await expect(makeKeyOnCard(card)).rejects.toMatchObject({
      code: 'HAS_KEY',
    });
    await expect(loadWalletKey(card, MAIN, 0)).rejects.toMatchObject({
      code: 'HAS_KEY',
    });
    expect((await readCard(card)).address).toBe(first.address);

    const replaced = await loadWalletKey(card, MAIN, 0, undefined, {
      replace: true,
    });
    expect(replaced.walletKeyIndex).toBe(0);
    expect(replaced.address).not.toBe(first.address);
  });

  it('refuses a card that does not sign with the key it was given', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    card.lie = true;
    await expect(loadWalletKey(card, MAIN, 0)).rejects.toMatchObject({
      code: 'KEY_MISMATCH',
    });
  });

  it('cannot load a key into Futako’s applet, but can make one there', async () => {
    const card = new SimulatedCard(['futako-test']);
    await expect(loadWalletKey(card, MAIN, 0)).rejects.toMatchObject({
      code: 'NO_IMPORT',
    });
    const made = await makeKeyOnCard(card);
    expect(made.applet).toBe('futako-test');
    expect(made.walletKeyIndex).toBeNull();
    expect((await readCard(card, MAIN)).address).toBe(made.address);
  });

  it('never hands out a key index used before, here or on chain', async () => {
    const onChain = new Set([
      cardAddress(cardKeyPairFromSeed(deriveCardSeed(MAIN, 1)).publicKey),
    ]);
    const used = async (address: string) => onChain.has(address);
    expect(await pickWalletKeyIndex(MAIN, [], used)).toBe(0);
    expect(await pickWalletKeyIndex(MAIN, [0], used)).toBe(2);
    expect(await pickWalletKeyIndex(MAIN, [0, 2, 3], used)).toBe(4);
    await expect(pickWalletKeyIndex(MAIN, [0], used, 1)).rejects.toThrow();
  });
});

describe('one-tap connect', () => {
  const offer = (index: number) => {
    const reserve = vi.fn();
    return { offer: { mainPrivateKey: MAIN, index, reserve }, reserve };
  };

  it('puts the offered wallet key on a blank card in the same tap', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    const { offer: wallet, reserve } = offer(5);
    const outcome = await connectCard(card, wallet, fixedDeps());
    expect(outcome.kind).toBe('set-up');
    expect(outcome.info.walletKeyIndex).toBe(5);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect((await readCard(card, MAIN)).walletKeyIndex).toBe(5);
  });

  it('leaves a blank card alone when no wallet key is ready', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    const outcome = await connectCard(card, null);
    expect(outcome.kind).toBe('needs-wallet');
    expect((await readCard(card)).publicKey).toBeNull();
  });

  it('lets a card that cannot import make its own key', async () => {
    const card = new SimulatedCard(['futako-test']);
    const outcome = await connectCard(card, null);
    expect(outcome).toMatchObject({
      kind: 'set-up',
      info: { applet: 'futako-test', walletKeyIndex: null },
    });
  });

  it('only reads a card that already has a key', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    const made = await makeKeyOnCard(card);
    const { offer: wallet, reserve } = offer(0);
    const outcome = await connectCard(card, wallet);
    expect(outcome.kind).toBe('linked');
    expect(outcome.info.address).toBe(made.address);
    expect(reserve).not.toHaveBeenCalled();
  });
});

describe('taking a payment', () => {
  it.each(['qortal-lab', 'futako-test'] as const)(
    '%s: signs a PAYMENT the node will accept',
    async (kind) => {
      const card = new SimulatedCard([kind]);
      const { address } = await makeKeyOnCard(card);
      const charge = await signChargeOnCard(card, {
        recipient: SHOP,
        amount: 150000000n,
        fee: 1000000n,
      });
      expect(charge.cardAddress).toBe(address);
      expect(charge.txBytes.length).toBe(153);
      expect(
        verifyCardSignature(
          charge.txBytes,
          charge.signature,
          charge.cardPublicKey
        )
      ).toBe(true);
    }
  );

  it('signs a Q-Asset transfer too', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    await makeKeyOnCard(card);
    const charge = await signChargeOnCard(card, {
      recipient: SHOP,
      amount: 3n,
      fee: 1000000n,
      kind: 'asset',
      assetId: 1n,
    });
    expect(charge.txBytes.length).toBe(161);
  });

  it('needs a key, and the expected card when one is named', async () => {
    const blank = new SimulatedCard(['qortal-lab']);
    await expect(
      signChargeOnCard(blank, { recipient: SHOP, amount: 1n, fee: 1n })
    ).rejects.toMatchObject({ code: 'NO_KEY' });

    const card = new SimulatedCard(['qortal-lab']);
    await makeKeyOnCard(card);
    await expect(
      signChargeOnCard(card, {
        recipient: SHOP,
        amount: 1n,
        fee: 1n,
        expectedAddress: SHOP,
      })
    ).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
  });

  it('refuses a card whose signature does not check out', async () => {
    const card = new SimulatedCard(['futako-test']);
    await makeKeyOnCard(card);
    card.lie = true;
    await expect(
      signChargeOnCard(card, { recipient: SHOP, amount: 1n, fee: 1n })
    ).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
  });
});

describe('moving funds back without the card', () => {
  it('GO signs exactly what the card would sign', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    await loadWalletKey(card, MAIN, 4, fixedDeps());
    const request = { recipient: SHOP, amount: 99000000n, fee: 1000000n };
    const byCard = await signChargeOnCard(card, request, fixedDeps());
    const byGo = signWithWalletCardKey(MAIN, 4, request, fixedDeps());
    expect(byGo.cardAddress).toBe(byCard.cardAddress);
    expect(byGo.signedBase58).toBe(byCard.signedBase58);
  });
});

describe('a name on chain for the card', () => {
  it('has a card with its own key sign REGISTER_NAME', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    const { address, publicKey } = await makeKeyOnCard(card);
    const signed = await signTxOnCard(
      card,
      registerNameTx('Simon Card', 125000000n, fixedDeps()),
      address
    );
    expect(signed.cardAddress).toBe(address);
    expect(new DataView(signed.txBytes.buffer).getInt32(0)).toBe(3);
    expect(new TextDecoder().decode(signed.txBytes.slice(116, 126))).toBe(
      'Simon Card'
    );
    expect(
      verifyCardSignature(signed.txBytes, signed.signature, publicKey)
    ).toBe(true);
  });

  it('signs the same name for a wallet-key card without the card', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    const loaded = await loadWalletKey(card, MAIN, 1, fixedDeps());
    const onCard = await signTxOnCard(
      card,
      registerNameTx('Simon Card', 125000000n, fixedDeps())
    );
    const byGo = signTxWithWalletKey(
      MAIN,
      1,
      registerNameTx('Simon Card', 125000000n, fixedDeps()),
      loaded.address
    );
    expect(bytesToHex(byGo.signature)).toBe(bytesToHex(onCard.signature));
    expect(() =>
      signTxWithWalletKey(
        MAIN,
        2,
        registerNameTx('Simon Card', 125000000n, fixedDeps()),
        loaded.address
      )
    ).toThrow('KEY_MISMATCH');
  });
});

describe('a wallet key made ready while the card is on its way', () => {
  it('is only waited for when a blank card needs it', async () => {
    const keyed = new SimulatedCard(['qortal-lab']);
    await makeKeyOnCard(keyed);
    const notNeeded = vi.fn(async () => null);
    expect((await connectCard(keyed, notNeeded)).kind).toBe('linked');
    expect(notNeeded).not.toHaveBeenCalled();

    const blank = new SimulatedCard(['qortal-lab']);
    const reserve = vi.fn();
    const outcome = await connectCard(
      blank,
      async () => ({ mainPrivateKey: MAIN, index: 3, reserve }),
      fixedDeps()
    );
    expect(outcome.kind).toBe('set-up');
    expect(outcome.info.walletKeyIndex).toBe(3);
    expect(reserve).toHaveBeenCalledTimes(1);
  });
});

describe('a card with both applets, like test card 2', () => {
  const keyIn = async (
    card: SimulatedCard,
    kind: 'qortal-lab' | 'futako-test'
  ) => makeKeyOnCard(card, fixedDeps(), { applet: kind });

  it('links the applet that has a key and never makes a second one', async () => {
    const card = new SimulatedCard(['qortal-lab', 'futako-test']);
    const lab = await keyIn(card, 'qortal-lab');
    const reserve = vi.fn();
    const outcome = await connectCard(card, {
      mainPrivateKey: MAIN,
      index: 0,
      reserve,
    });
    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(outcome.info.address).toBe(lab.address);
    expect(reserve).not.toHaveBeenCalled();
    // Futako's applet on the same card is still blank.
    const futako = await selectApplet(card, 'futako-test');
    expect(await readPublicKey(card, futako)).toBeNull();
  });

  it('links a key in Futako’s applet instead of loading ours beside it', async () => {
    const card = new SimulatedCard(['qortal-lab', 'futako-test']);
    const futako = await keyIn(card, 'futako-test');
    const outcome = await connectCard(card, {
      mainPrivateKey: MAIN,
      index: 0,
      reserve: vi.fn(),
    });
    expect(outcome.kind).toBe('linked');
    expect(outcome.info).toMatchObject({
      applet: 'futako-test',
      address: futako.address,
    });
    const lab = await selectApplet(card, 'qortal-lab');
    expect(await readPublicKey(card, lab)).toBeNull();
  });

  it('puts the wallet key in our applet when neither has a key', async () => {
    const card = new SimulatedCard(['qortal-lab', 'futako-test']);
    const outcome = await connectCard(
      card,
      { mainPrivateKey: MAIN, index: 1, reserve: vi.fn() },
      fixedDeps()
    );
    expect(outcome.kind).toBe('set-up');
    expect(outcome.info).toMatchObject({
      applet: 'qortal-lab',
      walletKeyIndex: 1,
    });
    const futako = await selectApplet(card, 'futako-test');
    expect(await readPublicKey(card, futako)).toBeNull();
  });

  it('signs with the applet whose key is asked for', async () => {
    const card = new SimulatedCard(['qortal-lab', 'futako-test']);
    const lab = await keyIn(card, 'qortal-lab');
    const futako = await keyIn(card, 'futako-test');
    const pay = { recipient: SHOP, amount: 100000000n, fee: 1000000n };
    const fromFutako = await signChargeOnCard(
      card,
      { ...pay, expectedAddress: futako.address },
      fixedDeps()
    );
    expect(fromFutako.cardAddress).toBe(futako.address);
    expect(
      verifyCardSignature(
        fromFutako.txBytes,
        fromFutako.signature,
        futako.publicKey
      )
    ).toBe(true);
    // No address given (a shop's charge): the first key, ours.
    expect((await signChargeOnCard(card, pay, fixedDeps())).cardAddress).toBe(
      lab.address
    );
  });
});
