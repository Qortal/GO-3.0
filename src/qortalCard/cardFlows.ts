import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  cardAddress,
  cardKeyPairFromSeed,
  deriveCardSeed,
  equalBytes,
  findWalletKeyIndex,
  MAX_CARD_KEY_INDEX,
} from './cardKeys';
import {
  CardError,
  generateKey,
  importKey,
  readPublicKey,
  scanApplets,
  selectApplet,
  signOnCard,
  type ApduTransport,
  type CardApplet,
  type CardAppletKind,
} from './cardProtocol';
import {
  buildCardTxBytes,
  buildRegisterNameTxBytes,
  signedTxBase58,
  verifyCardSignature,
  type CardTxKind,
} from './cardTx';
import { nacl } from './cryptoDeps';

/**
 * What the Qortal Card screen does with a card. Everything that needs the
 * card in the field happens in one short burst; node lookups and sending come
 * after, once the card can be taken away.
 */

export interface CardFlowDeps {
  now: () => number;
  randomBytes: (length: number) => Uint8Array;
}

export const defaultCardFlowDeps: CardFlowDeps = {
  now: () => Date.now(),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
};

/** Signed by the card to prove it holds a key; can never be a transaction. */
const KEY_CHECK_PREFIX = utf8ToBytes('Qortal card check v1');

export interface CardInfo {
  applet: CardAppletKind;
  canImportKey: boolean;
  /** RFC 8032 public key, or null while the card has no key. */
  publicKey: Uint8Array | null;
  address: string | null;
  /** Which wallet card key this is, or null for a key made on the card. */
  walletKeyIndex: number | null;
}

/**
 * Reads a card: its applet, its key, and whether the key came from this
 * wallet (only when `mainPrivateKey` is given). A card with two applets (a
 * test card with Futako's and ours) answers with the one that has a key, so
 * the other one never gets a second key; with no key anywhere, our applet.
 */
export async function readCard(
  transport: ApduTransport,
  mainPrivateKey?: Uint8Array | null
): Promise<CardInfo> {
  const applets = await scanApplets(transport);
  const { applet, publicKey } =
    applets.find((entry) => entry.publicKey) ?? applets[0];
  return {
    applet: applet.kind,
    canImportKey: applet.canImportKey,
    publicKey,
    address: publicKey ? cardAddress(publicKey) : null,
    walletKeyIndex:
      publicKey && mainPrivateKey
        ? findWalletKeyIndex(mainPrivateKey, publicKey)
        : null,
  };
}

export interface SetUpOptions {
  /**
   * Overwrite a key already on the card. Off by default: the QORT on the
   * old key would be stranded.
   */
  replace?: boolean;
  /** The applet to set up (as readCard chose it); else the first one. */
  applet?: CardAppletKind;
}

async function refuseIfKeyed(
  transport: ApduTransport,
  applet: CardApplet,
  options: SetUpOptions
): Promise<void> {
  if (!options.replace && (await readPublicKey(transport, applet))) {
    throw new CardError('HAS_KEY');
  }
}

/**
 * Puts wallet card key `index` on the card, then checks the card signs
 * exactly as that key does (RFC 8032 signatures are deterministic).
 */
export async function loadWalletKey(
  transport: ApduTransport,
  mainPrivateKey: Uint8Array,
  index: number,
  deps: CardFlowDeps = defaultCardFlowDeps,
  options: SetUpOptions = {}
): Promise<CardInfo> {
  const applet = await selectApplet(transport, options.applet);
  if (!applet.canImportKey) throw new CardError('NO_IMPORT');
  await refuseIfKeyed(transport, applet, options);
  const seed = deriveCardSeed(mainPrivateKey, index);
  const pair = cardKeyPairFromSeed(seed);
  try {
    await importKey(transport, applet, seed, pair.publicKey);
    const onCard = await readPublicKey(transport, applet);
    if (!onCard || !equalBytes(onCard, pair.publicKey)) {
      throw new CardError('KEY_MISMATCH');
    }
    const check = concatBytes(KEY_CHECK_PREFIX, deps.randomBytes(32));
    const signature = await signOnCard(transport, applet, check);
    if (!equalBytes(signature, nacl.sign.detached(check, pair.privateKey))) {
      throw new CardError('KEY_MISMATCH');
    }
  } finally {
    seed.fill(0);
    pair.privateKey.fill(0);
  }
  return {
    applet: applet.kind,
    canImportKey: true,
    publicKey: pair.publicKey,
    address: cardAddress(pair.publicKey),
    walletKeyIndex: index,
  };
}

/** Makes a new key on the card, for cards that cannot take one from GO. */
export async function makeKeyOnCard(
  transport: ApduTransport,
  deps: CardFlowDeps = defaultCardFlowDeps,
  options: SetUpOptions = {}
): Promise<CardInfo> {
  const applet = await selectApplet(transport, options.applet);
  await refuseIfKeyed(transport, applet, options);
  const publicKey = await generateKey(transport, applet);
  const check = concatBytes(KEY_CHECK_PREFIX, deps.randomBytes(32));
  const signature = await signOnCard(transport, applet, check);
  if (!verifyCardSignature(check, signature, publicKey)) {
    throw new CardError('BAD_SIGNATURE');
  }
  return {
    applet: applet.kind,
    canImportKey: applet.canImportKey,
    publicKey,
    address: cardAddress(publicKey),
    walletKeyIndex: null,
  };
}

export type ConnectOutcome =
  /** The card already had a key; it is linked as it is. */
  | { kind: 'linked'; info: CardInfo }
  /** A blank card got its key in this same tap. */
  | { kind: 'set-up'; info: CardInfo }
  /** A blank card that can take a wallet key, but none was ready. */
  | { kind: 'needs-wallet'; info: CardInfo };

/** A wallet card key ready to go onto a blank card. */
export interface WalletKeyOffer {
  mainPrivateKey: Uint8Array;
  index: number;
  /** Called right before the key goes onto the card. */
  reserve: () => void;
}

/**
 * The offer itself, or a promise of it, asked for only when a blank card
 * needs it: the offer can be got ready while the card is on its way.
 */
export type WalletKeySource =
  | WalletKeyOffer
  | null
  | (() => Promise<WalletKeyOffer | null>);

/**
 * One tap: read the card, and set a blank one up in the same tap. A card that
 * can take a key gets the offered wallet key; a card that cannot (Futako's
 * applet) makes its own. A card with a key is only read, never changed.
 */
export async function connectCard(
  transport: ApduTransport,
  wallet: WalletKeySource,
  deps: CardFlowDeps = defaultCardFlowDeps
): Promise<ConnectOutcome> {
  const info = await readCard(transport);
  if (info.publicKey) return { kind: 'linked', info };
  if (!info.canImportKey) {
    return {
      kind: 'set-up',
      info: await makeKeyOnCard(transport, deps, { applet: info.applet }),
    };
  }
  const offer = typeof wallet === 'function' ? await wallet() : wallet;
  if (!offer) return { kind: 'needs-wallet', info };
  offer.reserve();
  return {
    kind: 'set-up',
    info: await loadWalletKey(
      transport,
      offer.mainPrivateKey,
      offer.index,
      deps,
      { applet: info.applet }
    ),
  };
}

export interface ChargeRequest {
  recipient: string;
  /** In 1e-8 units of the coin. */
  amount: bigint;
  /** In 1e-8 QORT. */
  fee: bigint;
  kind?: CardTxKind;
  assetId?: bigint;
  /** Only this card may pay (moving funds back from a known card). */
  expectedAddress?: string;
}

export interface SignedCharge {
  cardAddress: string;
  cardPublicKey: Uint8Array;
  txBytes: Uint8Array;
  signature: Uint8Array;
  signedBase58: string;
}

/** Unsigned transaction bytes for the given sender (the card's key). */
export type TxBuild = (senderPublicKey: Uint8Array) => Uint8Array;

/** A PAYMENT or TRANSFER_ASSET from the card to `request.recipient`. */
export const paymentTx =
  (
    request: Omit<ChargeRequest, 'expectedAddress'>,
    deps: CardFlowDeps = defaultCardFlowDeps
  ): TxBuild =>
  (senderPublicKey) =>
    buildCardTxBytes({
      kind: request.kind ?? 'payment',
      timestamp: deps.now(),
      reference: deps.randomBytes(64),
      senderPublicKey,
      recipient: request.recipient,
      amount: request.amount,
      fee: request.fee,
      assetId: request.assetId,
    });

/** REGISTER_NAME: gives the card's account a name on chain. */
export const registerNameTx =
  (
    name: string,
    fee: bigint,
    deps: CardFlowDeps = defaultCardFlowDeps
  ): TxBuild =>
  (senderPublicKey) =>
    buildRegisterNameTxBytes({
      timestamp: deps.now(),
      reference: deps.randomBytes(64),
      senderPublicKey,
      name,
      fee,
    });

/**
 * The card's part of a transaction: build it from the card's own public
 * key, have the card sign it, and check the signature before anything is
 * sent. Nothing here talks to the node.
 */
export async function signTxOnCard(
  transport: ApduTransport,
  build: TxBuild,
  expectedAddress?: string
): Promise<SignedCharge> {
  // The applet holding the expected key, or else the first key on the card.
  const keyed = (await scanApplets(transport)).filter(
    (entry) => entry.publicKey
  );
  if (!keyed.length) throw new CardError('NO_KEY');
  const chosen = expectedAddress
    ? keyed.find((entry) => cardAddress(entry.publicKey) === expectedAddress)
    : keyed[0];
  if (!chosen) throw new CardError('KEY_MISMATCH');
  const cardPublicKey = chosen.publicKey;
  const address = cardAddress(cardPublicKey);
  const applet = await selectApplet(transport, chosen.applet.kind);
  const txBytes = build(cardPublicKey);
  const signature = await signOnCard(transport, applet, txBytes);
  if (!verifyCardSignature(txBytes, signature, cardPublicKey)) {
    throw new CardError('BAD_SIGNATURE');
  }
  return {
    cardAddress: address,
    cardPublicKey,
    txBytes,
    signature,
    signedBase58: signedTxBase58(txBytes, signature),
  };
}

/** The card's part of a payment (see signTxOnCard). */
export function signChargeOnCard(
  transport: ApduTransport,
  request: ChargeRequest,
  deps: CardFlowDeps = defaultCardFlowDeps
): Promise<SignedCharge> {
  return signTxOnCard(
    transport,
    paymentTx(request, deps),
    request.expectedAddress
  );
}

/**
 * Signs for a wallet-key card without the card: GO rebuilds the card key
 * from the wallet. Refuses when the key would not be `expectedAddress`.
 */
export function signTxWithWalletKey(
  mainPrivateKey: Uint8Array,
  index: number,
  build: TxBuild,
  expectedAddress?: string
): SignedCharge {
  const seed = deriveCardSeed(mainPrivateKey, index);
  const pair = cardKeyPairFromSeed(seed);
  try {
    const address = cardAddress(pair.publicKey);
    if (expectedAddress && expectedAddress !== address) {
      throw new CardError('KEY_MISMATCH');
    }
    const txBytes = build(pair.publicKey);
    const signature = nacl.sign.detached(txBytes, pair.privateKey);
    return {
      cardAddress: address,
      cardPublicKey: pair.publicKey,
      txBytes,
      signature,
      signedBase58: signedTxBase58(txBytes, signature),
    };
  } finally {
    seed.fill(0);
    pair.privateKey.fill(0);
  }
}

/** Moves QORT off a wallet-key card without the card (see above). */
export function signWithWalletCardKey(
  mainPrivateKey: Uint8Array,
  index: number,
  request: Omit<ChargeRequest, 'expectedAddress'>,
  deps: CardFlowDeps = defaultCardFlowDeps
): SignedCharge {
  return signTxWithWalletKey(mainPrivateKey, index, paymentTx(request, deps));
}

/**
 * A wallet card-key index for a new card: never one this phone handed out
 * before (a lost card keeps its key), and never one whose address already
 * has history on chain (handed out by another phone).
 */
export async function pickWalletKeyIndex(
  mainPrivateKey: Uint8Array,
  everUsed: number[],
  isAddressUsed: (address: string) => Promise<boolean>,
  maxIndex = MAX_CARD_KEY_INDEX
): Promise<number> {
  const taken = new Set(everUsed);
  for (let index = 0; index <= maxIndex; index++) {
    if (taken.has(index)) continue;
    const seed = deriveCardSeed(mainPrivateKey, index);
    const pair = cardKeyPairFromSeed(seed);
    seed.fill(0);
    pair.privateKey.fill(0);
    if (!(await isAddressUsed(cardAddress(pair.publicKey)))) return index;
  }
  throw new Error('No free card key left');
}
