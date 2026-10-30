import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Addresses need the real SHA-256 (the global test setup mocks asmcrypto).
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);

const nfc = vi.hoisted(() => ({
  device: null as unknown,
  onRead: null as null | (() => void),
  stop: vi.fn(),
  putOut: vi.fn(),
}));
const node = vi.hoisted(() => ({
  balance: 500000000n,
  name: null as string | null,
  payments: [] as Array<{
    signature: string;
    from: string;
    amount: bigint;
    timestamp: number;
  }>,
  broadcast: vi.fn(
    async (
      _signed: string
    ): Promise<
      { ok: true; signature: string } | { ok: false; message: string }
    > => ({ ok: true, signature: 'sig' })
  ),
}));
const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));
const wallet = vi.hoisted(() => ({ key: null as Uint8Array | null }));
const files = vi.hoisted(() => ({
  save: vi.fn(async (_data: unknown, _address: string) => true),
  backup: vi.fn(async () => ({ backup: 'file' })),
}));

vi.mock('../../qortalCard/qortalNfc', () => ({
  readNfcCapabilities: async () => ({ state: 'on', canRequest: true }),
  openNfcSettings: vi.fn(),
  waitForCard: async () => ({
    transceive: (apdu: Uint8Array) =>
      (
        nfc.device as { transceive(a: Uint8Array): Promise<Uint8Array> }
      ).transceive(apdu),
    close: async () => undefined,
  }),
  putOutTapRequest: async (
    payload: Uint8Array,
    ttlMs: number,
    onRead: () => void
  ) => {
    nfc.putOut(payload, ttlMs);
    nfc.onRead = onRead;
    return nfc.stop;
  },
}));
vi.mock('../../qortalCard/cardNode', async (importOriginal) => ({
  NodeError: (
    await importOriginal<typeof import('../../qortalCard/cardNode')>()
  ).NodeError,
  fetchQortBalance: async () => node.balance,
  fetchUnitFee: async (kind: string) =>
    kind === 'register-name' ? 125000000n : 1000000n,
  fetchPrimaryName: async () => node.name,
  isNameFree: async () => true,
  uploadAvatarForSigning: vi.fn(),
  convertForSigning: vi.fn(),
  isAddressUsed: async () => false,
  listIncomingPayments: async () => node.payments,
  broadcastSignedTx: node.broadcast,
}));
vi.mock('../../qortalCard/cardBackup', () => ({
  buildCardBackup: files.backup,
}));
vi.mock(
  '../../utils/generateWallet/generateWallet',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../utils/generateWallet/generateWallet')
    >()),
    saveFileToDisk: files.save,
  })
);
vi.mock('../../qortalCard/mainKey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../qortalCard/mainKey')>()),
  loadMainPrivateKey: async () => wallet.key.slice(),
}));
vi.mock('../../utils/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/events')>()),
  executeEvent: events.executeEvent,
}));

import '../../i18n/i18n';
import {
  cardKeyIndexesUsedAtom,
  linkedCardsAtom,
  openQortalCardWindow,
  pendingTopUpAtom,
  qortalCardWindowAtom,
  type LinkedCard,
} from '../../atoms/qortalCard';
import {
  cardAddress,
  cardKeyPairFromSeed,
  deriveCardSeed,
} from '../../qortalCard/cardKeys';
import {
  loadWalletKey,
  makeKeyOnCard,
  readCard,
} from '../../qortalCard/cardFlows';
import { Base58, nacl } from '../../qortalCard/cryptoDeps';
import { SimulatedCard } from '../../qortalCard/testing/simulatedCard';
import {
  decodeTapRequest,
  encodeTapRequest,
} from '../../qortalCard/tapRequest';
import { QortalCardWindow } from './QortalCardWindow';

const store = getDefaultStore();
const SHOP = 'QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoA';

/** A card set up with wallet key 0, already in the list. */
async function linkWalletCard(): Promise<LinkedCard> {
  const info = await loadWalletKey(
    new SimulatedCard(['qortal-lab']),
    wallet.key,
    0
  );
  const card: LinkedCard = {
    address: info.address,
    publicKey: Base58.encode(info.publicKey),
    applet: 'qortal-lab',
    walletKeyIndex: 0,
    linkedAt: 1,
  };
  store.set(linkedCardsAtom, { [SHOP]: [card] });
  return card;
}

/** A lab card that made its own key, already in the list. */
async function linkOwnKeyCard(): Promise<{
  card: SimulatedCard;
  linked: LinkedCard;
}> {
  const card = new SimulatedCard(['qortal-lab']);
  const info = await makeKeyOnCard(card);
  const linked: LinkedCard = {
    address: info.address,
    publicKey: Base58.encode(info.publicKey),
    applet: 'qortal-lab',
    walletKeyIndex: null,
    linkedAt: 1,
    name: 'Card 2 test card',
  };
  store.set(linkedCardsAtom, { [SHOP]: [linked] });
  nfc.device = card;
  return { card, linked };
}

const sentTx = (call: number) =>
  Base58.decode(node.broadcast.mock.calls[call][0]);

describe('Qortal Card window', () => {
  beforeEach(() => {
    wallet.key = nacl.sign.keyPair().secretKey;
    node.balance = 500000000n;
    node.name = null;
    node.payments = [];
    node.broadcast.mockReset();
    node.broadcast.mockImplementation(async () => ({
      ok: true,
      signature: 'sig',
    }));
    files.save.mockClear();
    files.backup.mockClear();
    store.set(pendingTopUpAtom, { address: '', sent: false });
    store.set(cardKeyIndexesUsedAtom, {});
    events.executeEvent.mockClear();
    nfc.putOut.mockClear();
    nfc.stop.mockClear();
    store.set(linkedCardsAtom, {});
  });
  afterEach(() => {
    act(() => store.set(qortalCardWindowAtom, { open: false, tab: 'card' }));
  });

  it('sets a blank card up with a wallet key in one tap', async () => {
    nfc.device = new SimulatedCard(['qortal-lab']);
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    expect(screen.getByText(/Testing only/)).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect a card' })
    );

    expect(await screen.findByText('Card ready.')).toBeInTheDocument();
    expect(screen.getByText(/Key GO can restore/)).toBeInTheDocument();
    const [linked] = store.get(linkedCardsAtom)[SHOP];
    expect(linked.walletKeyIndex).toBe(0);
    expect(screen.getByText(linked.address)).toBeInTheDocument();
  });

  it('takes a payment from a card and sends what the card signed', async () => {
    const card = new SimulatedCard(['futako-test']);
    const { address, publicKey } = await makeKeyOnCard(card);
    nfc.device = card;
    act(() => openQortalCardWindow('pay'));
    render(<QortalCardWindow address={SHOP} />);

    fireEvent.change(await screen.findByLabelText('Amount'), {
      target: { value: '1,5' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Charge 1.5 QORT' })
    );

    expect(await screen.findByText('Paid 1.5 QORT')).toBeInTheDocument();
    expect(node.broadcast).toHaveBeenCalledTimes(1);
    const signed = sentTx(0);
    const [tx, signature] = [signed.slice(0, 153), signed.slice(153)];
    expect(nacl.sign.detached.verify(tx, signature, publicKey)).toBe(true);
    expect(Base58.encode(tx.slice(112, 137))).toBe(SHOP);
    expect(cardAddress(tx.slice(80, 112))).toBe(address);
  });

  it('sends nothing when the card is short of QORT', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    await makeKeyOnCard(card);
    nfc.device = card;
    node.balance = 100000000n;
    act(() => openQortalCardWindow('pay'));
    render(<QortalCardWindow address={SHOP} />);

    fireEvent.change(await screen.findByLabelText('Amount'), {
      target: { value: '1' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Charge 1 QORT' })
    );

    expect(
      await screen.findByText(/The card has only 1 QORT/)
    ).toBeInTheDocument();
    expect(node.broadcast).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Use another card' })
    ).toBeInTheDocument();
  });

  it('sends the very same payment again when the node did not take it', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    await makeKeyOnCard(card);
    nfc.device = card;
    node.broadcast.mockImplementationOnce(async () => ({
      ok: false,
      message: 'busy',
    }));
    act(() => openQortalCardWindow('pay'));
    render(<QortalCardWindow address={SHOP} />);

    fireEvent.change(await screen.findByLabelText('Amount'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Charge 2 QORT' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send again' }));

    expect(await screen.findByText('Paid 2 QORT')).toBeInTheDocument();
    expect(node.broadcast).toHaveBeenCalledTimes(2);
    expect(node.broadcast.mock.calls[1][0]).toBe(
      node.broadcast.mock.calls[0][0]
    );
    expect(screen.getByText('2.99 QORT left on the card')).toBeInTheDocument();
  });

  it('asks another GO phone for QORT and shows it arriving', async () => {
    act(() => openQortalCardWindow('pay'));
    render(<QortalCardWindow address={SHOP} />);

    fireEvent.click(await screen.findByRole('radio', { name: 'GO phone' }));
    fireEvent.change(screen.getByLabelText('Amount (optional)'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask for 2 QORT' }));

    await waitFor(() => expect(nfc.putOut).toHaveBeenCalled());
    expect(decodeTapRequest(nfc.putOut.mock.calls[0][0])).toEqual({
      address: SHOP,
      amount: 200000000n,
    });
    act(() => nfc.onRead?.());
    expect(
      await screen.findByText(/The other phone has your request/)
    ).toBeInTheDocument();

    node.payments = [
      { signature: 'new', from: SHOP, amount: 200000000n, timestamp: 1 },
    ];
    expect(
      await screen.findByText('Received 2 QORT', {}, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(nfc.stop).toHaveBeenCalled();
  });

  it('reads another phone’s request and opens Send QORT with it', async () => {
    const request = encodeTapRequest({ address: SHOP, amount: 250000000n });
    nfc.device = {
      transceive: async () => Uint8Array.from([...request, 0x90, 0x00]),
    };
    act(() => openQortalCardWindow('send'));
    render(<QortalCardWindow address={SHOP} />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Tap the other phone' })
    );

    await waitFor(() =>
      expect(events.executeEvent).toHaveBeenCalledWith('openPaymentInternal', {
        address: SHOP,
        amount: '2.5',
      })
    );
    expect(store.get(qortalCardWindowAtom).open).toBe(false);
  });
});

describe('My card', () => {
  beforeEach(() => {
    wallet.key = nacl.sign.keyPair().secretKey;
    node.balance = 500000000n;
    node.name = null;
    node.broadcast.mockReset();
    node.broadcast.mockImplementation(async () => ({
      ok: true,
      signature: 'sig',
    }));
    files.save.mockClear();
    files.backup.mockClear();
    events.executeEvent.mockClear();
    store.set(pendingTopUpAtom, { address: '', sent: false });
    store.set(cardKeyIndexesUsedAtom, {});
  });
  afterEach(() => {
    act(() => store.set(qortalCardWindowAtom, { open: false, tab: 'card' }));
    store.set(linkedCardsAtom, {});
  });

  const openMenu = async (item: string) => {
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
  };

  it('renames a card on this phone', async () => {
    await linkWalletCard();
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    await openMenu('Rename');
    fireEvent.change(screen.getByLabelText('Card name'), {
      target: { value: 'Blue card' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Blue card')).toBeInTheDocument();
    expect(store.get(linkedCardsAtom)[SHOP][0].name).toBe('Blue card');
  });

  it('moves a share of the QORT back, signed by GO without the card', async () => {
    const card = await linkWalletCard();
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Move back' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Percent' }));
    fireEvent.click(screen.getByRole('button', { name: '25%' }));
    // 5 QORT less the 0.01 fee, a quarter of it.
    fireEvent.click(
      screen.getByRole('button', { name: 'Move 1.2475 QORT back' })
    );

    expect(
      await screen.findByText(/1.2475 QORT is on its way back/)
    ).toBeInTheDocument();
    const signed = sentTx(0);
    const tx = signed.slice(0, 153);
    expect(Base58.encode(tx.slice(112, 137))).toBe(SHOP);
    expect(new DataView(tx.buffer).getBigInt64(137)).toBe(124750000n);
    expect(
      nacl.sign.detached.verify(
        tx,
        signed.slice(153),
        Base58.decode(card.publicKey)
      )
    ).toBe(true);
  });

  it('will not move more than the card holds', async () => {
    await linkWalletCard();
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Move back' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Amount' }));
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '5' },
    });

    expect(
      screen.getByText('The card can move up to 4.99 QORT.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move back' })).toBeDisabled();
  });

  it('registers a name on chain for the card', async () => {
    const card = await linkWalletCard();
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    await openMenu('Name on chain');
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Simon Card' },
    });
    expect(
      await screen.findByText('That name is free.', {}, { timeout: 3000 })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Register name' }));

    expect(
      await screen.findByText(/Simon Card is on its way/)
    ).toBeInTheDocument();
    const signed = sentTx(0);
    const tx = signed.slice(0, signed.length - 64);
    expect(new DataView(tx.buffer).getInt32(0)).toBe(3);
    expect(new TextDecoder().decode(tx.slice(116, 126))).toBe('Simon Card');
    expect(
      nacl.sign.detached.verify(
        tx,
        signed.slice(-64),
        Base58.decode(card.publicKey)
      )
    ).toBe(true);
  });

  it('saves a backup file of a wallet-key card', async () => {
    const card = await linkWalletCard();
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    await openMenu('Save backup file');
    fireEvent.change(screen.getByLabelText('Password for the file'), {
      target: { value: 'pass phrase' },
    });
    fireEvent.change(screen.getByLabelText('Repeat the password'), {
      target: { value: 'pass phrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save backup file' }));

    expect(
      await screen.findByText('Card backup saved to Documents/Qortal Go.')
    ).toBeInTheDocument();
    expect(files.backup).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      0,
      'pass phrase',
      card.address
    );
    expect(files.save).toHaveBeenCalledWith({ backup: 'file' }, card.address);
  });

  it('comes back after a top up and watches the balance', async () => {
    const card = await linkWalletCard();
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Top up' }));
    expect(events.executeEvent).toHaveBeenCalledWith('openPaymentInternal', {
      address: card.address,
    });
    expect(store.get(qortalCardWindowAtom).open).toBe(false);

    act(() => {
      document.dispatchEvent(
        new CustomEvent('sendQortFinished', { detail: { sent: true } })
      );
    });
    expect(store.get(qortalCardWindowAtom)).toEqual({
      open: true,
      tab: 'card',
    });
    expect(await screen.findByText(/Top up sent/)).toBeInTheDocument();
    expect(await screen.findByText('Updating…')).toBeInTheDocument();
  });

  it('switches a card with its own key to a wallet key, keeping its name', async () => {
    const { card, linked } = await linkOwnKeyCard();
    node.balance = 0n;
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    await openMenu('Save backup file');
    expect(screen.getByText(/This card made its own key/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to a key GO can restore' })
    );
    expect(
      await screen.findByText(/The old address is empty/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load the new key' }));

    expect(
      await screen.findByText(/The card now has a key GO can restore/)
    ).toBeInTheDocument();
    const [switched] = store.get(linkedCardsAtom)[SHOP];
    const expected = cardKeyPairFromSeed(deriveCardSeed(wallet.key, 0));
    expect(switched).toMatchObject({
      address: cardAddress(expected.publicKey),
      walletKeyIndex: 0,
      name: 'Card 2 test card',
    });
    expect(switched.address).not.toBe(linked.address);
    expect((await readCard(card)).address).toBe(switched.address);
  });

  it('moves the QORT back before it switches the key', async () => {
    const { linked } = await linkOwnKeyCard();
    node.balance = 49000000n;
    act(() => openQortalCardWindow('card'));
    render(<QortalCardWindow address={SHOP} />);

    await openMenu('Save backup file');
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to a key GO can restore' })
    );
    expect(
      await screen.findByText(/First GO moves 0.48 QORT back/)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Move back and switch' })
    );

    expect(
      await screen.findByText(/Waiting for the move back to confirm/)
    ).toBeInTheDocument();
    const signed = sentTx(0);
    const tx = signed.slice(0, 153);
    expect(Base58.encode(tx.slice(112, 137))).toBe(SHOP);
    expect(new DataView(tx.buffer).getBigInt64(137)).toBe(48000000n);
    expect(
      nacl.sign.detached.verify(
        tx,
        signed.slice(153),
        Base58.decode(linked.publicKey)
      )
    ).toBe(true);
    // The old key is still on the card: nothing was switched yet.
    expect(store.get(linkedCardsAtom)[SHOP][0].address).toBe(linked.address);
  });
});
