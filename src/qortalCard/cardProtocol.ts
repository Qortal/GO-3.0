import { concatBytes, hexToBytes } from '@noble/hashes/utils.js';

/**
 * Qortal Card APDUs. Two card applets exist while the cards are in testing:
 *
 * - Qortal's lab applet (`nfc-band/applet-lab`): Ed25519 through suut's
 *   Curve25519 library, RFC 8032 byte order, and it can take a key from GO.
 * - Futako's TestEdDSA, preinstalled on the J3R452 cards: NXP's raw API, which
 *   answers big-endian (the public key and both signature halves come back
 *   byte-reversed), and keys can only be made on the card.
 *
 * Both sign pure Ed25519 over the bytes they are given, which is what Qortal
 * checks (core Crypto.verify), so a card can sign a real transaction.
 */

/** Sends one APDU and returns the card's answer: data, then SW1 SW2. */
export interface ApduTransport {
  transceive(apdu: Uint8Array): Promise<Uint8Array>;
}

export type CardErrorCode =
  | 'NO_APPLET'
  | 'NO_KEY'
  | 'HAS_KEY'
  | 'NO_IMPORT'
  | 'KEY_MISMATCH'
  | 'BAD_SIGNATURE'
  | 'CARD_STATUS'
  | 'CARD_LOST'
  | 'CARD_IO'
  | 'CANCELLED'
  | 'NFC_OFF'
  | 'NFC_UNSUPPORTED'
  /** Phone to phone: the tapped device is not a GO phone asking for QORT. */
  | 'NO_REQUEST'
  /** Phone to phone: a GO phone, but its request is not out right now. */
  | 'REQUEST_NOT_READY'
  /** Phone to phone: the request did not read as a valid one. */
  | 'BAD_REQUEST';

export class CardError extends Error {
  readonly code: CardErrorCode;
  /** The card's status word, when it answered with an error. */
  readonly sw?: number;

  constructor(code: CardErrorCode, sw?: number) {
    super(sw === undefined ? code : `${code} ${formatSw(sw)}`);
    this.name = 'CardError';
    this.code = code;
    this.sw = sw;
  }
}

export const formatSw = (sw: number): string =>
  sw.toString(16).toUpperCase().padStart(4, '0');

export type CardAppletKind = 'qortal-lab' | 'futako-test';

export interface CardApplet {
  kind: CardAppletKind;
  aid: Uint8Array;
  canImportKey: boolean;
  /** NXP's raw API: the public key and R, S each come back byte-reversed. */
  reversed: boolean;
  cla: number;
  generate: number;
  sign: number;
  signP1: number;
  publicKey: number;
  importKey?: number;
  /** Answers [private key set, public key set]. */
  status?: number;
}

export const CARD_APPLETS: readonly CardApplet[] = [
  {
    kind: 'qortal-lab',
    aid: hexToBytes('f0514f5254414c01'),
    canImportKey: true,
    reversed: false,
    cla: 0x80,
    generate: 0x10,
    importKey: 0x12,
    sign: 0x20,
    signP1: 0x00,
    publicKey: 0x22,
    status: 0x40,
  },
  {
    kind: 'futako-test',
    aid: hexToBytes('4d647661436172644f5304'),
    canImportKey: false,
    reversed: true,
    cla: 0x00,
    generate: 0x10,
    sign: 0x20,
    // P1=01 hands the raw bytes to NXP's signer: pure Ed25519.
    signP1: 0x01,
    publicKey: 0x42,
  },
];

const SW_OK = 0x9000;
const SW_UNCAUGHT = 0x6f00;
/** SELECT answers that mean "no such applet here" (not found, refused). */
const SW_NOT_HERE = new Set([0x6a82, 0x6999]);

const EMPTY = new Uint8Array(0);

/** A short APDU (CLA INS P1 00 [Lc data] [Le]). */
export function buildApdu(
  cla: number,
  ins: number,
  p1: number,
  data: Uint8Array = EMPTY,
  expectData = false
): Uint8Array {
  if (data.length > 255) throw new RangeError('APDU data over 255 bytes');
  return concatBytes(
    new Uint8Array([cla, ins, p1, 0x00]),
    data.length ? concatBytes(new Uint8Array([data.length]), data) : EMPTY,
    expectData ? new Uint8Array([0x00]) : EMPTY
  );
}

export interface CardAnswer {
  data: Uint8Array;
  sw: number;
}

function splitAnswer(raw: Uint8Array): CardAnswer {
  if (!raw || raw.length < 2) throw new CardError('CARD_IO');
  return {
    data: raw.slice(0, raw.length - 2),
    sw: (raw[raw.length - 2] << 8) | raw[raw.length - 1],
  };
}

/**
 * One command, following the card's "use this Le" (6Cxx) and "more data"
 * (61xx) answers, which some cards still send over contacts and NFC.
 */
export async function exchange(
  transport: ApduTransport,
  apdu: Uint8Array
): Promise<CardAnswer> {
  let answer = splitAnswer(await transport.transceive(apdu));
  if (answer.sw >> 8 === 0x6c && apdu.length >= 5) {
    const retry = apdu.slice();
    retry[retry.length - 1] = answer.sw & 0xff;
    answer = splitAnswer(await transport.transceive(retry));
  }
  let data = answer.data;
  for (let rounds = 0; answer.sw >> 8 === 0x61 && rounds < 16; rounds++) {
    answer = splitAnswer(
      await transport.transceive(
        new Uint8Array([0x00, 0xc0, 0x00, 0x00, answer.sw & 0xff])
      )
    );
    data = concatBytes(data, answer.data);
  }
  return { data, sw: answer.sw };
}

/**
 * Selects a Qortal Card applet: `kind`, or else the first one the card has.
 * Only a clear "not here" moves on to the next applet; any other answer is an
 * error, so a glitch can never land on an applet nobody asked for.
 */
export async function selectApplet(
  transport: ApduTransport,
  kind?: CardAppletKind
): Promise<CardApplet> {
  for (const applet of CARD_APPLETS) {
    if (kind && applet.kind !== kind) continue;
    const { sw } = await exchange(
      transport,
      buildApdu(0x00, 0xa4, 0x04, applet.aid)
    );
    if (sw === SW_OK) return applet;
    if (!SW_NOT_HERE.has(sw)) throw new CardError('CARD_STATUS', sw);
  }
  throw new CardError('NO_APPLET');
}

export interface AppletKey {
  applet: CardApplet;
  /** RFC 8032 public key, or null while that applet has no key. */
  publicKey: Uint8Array | null;
}

/**
 * Every Qortal Card applet on the card with its key. A test card can carry
 * two (Futako's and ours), each with its own key or none.
 */
export async function scanApplets(
  transport: ApduTransport
): Promise<AppletKey[]> {
  const found: AppletKey[] = [];
  for (const applet of CARD_APPLETS) {
    const { sw } = await exchange(
      transport,
      buildApdu(0x00, 0xa4, 0x04, applet.aid)
    );
    if (SW_NOT_HERE.has(sw)) continue;
    if (sw !== SW_OK) throw new CardError('CARD_STATUS', sw);
    found.push({ applet, publicKey: await readPublicKey(transport, applet) });
  }
  if (!found.length) throw new CardError('NO_APPLET');
  return found;
}

/** The card's Ed25519 public key (RFC 8032 form), or null when it has none. */
export async function readPublicKey(
  transport: ApduTransport,
  applet: CardApplet
): Promise<Uint8Array | null> {
  if (applet.status !== undefined) {
    const { data, sw } = await exchange(
      transport,
      buildApdu(applet.cla, applet.status, 0x00, EMPTY, true)
    );
    if (sw === SW_OK && data.length >= 2 && (data[0] !== 1 || data[1] !== 1)) {
      return null;
    }
  }
  const { data, sw } = await exchange(
    transport,
    buildApdu(applet.cla, applet.publicKey, 0x00, EMPTY, true)
  );
  // No key yet: TestEdDSA dies with 6F00, the lab applet answers 66 02.
  if (sw === SW_UNCAUGHT || sw >> 8 === 0x66) return null;
  if (sw !== SW_OK || data.length !== 32)
    throw new CardError('CARD_STATUS', sw);
  return applet.reversed ? data.slice().reverse() : data;
}

/** Makes a new key pair on the card and returns its public key. */
export async function generateKey(
  transport: ApduTransport,
  applet: CardApplet
): Promise<Uint8Array> {
  const { sw } = await exchange(
    transport,
    buildApdu(applet.cla, applet.generate, 0x00)
  );
  if (sw !== SW_OK) throw new CardError('CARD_STATUS', sw);
  const key = await readPublicKey(transport, applet);
  if (!key) throw new CardError('NO_KEY');
  return key;
}

/**
 * Loads a 32-byte Ed25519 seed and its public key. The card does not work
 * the public key out itself, so both go in, and the caller checks the card
 * signs like the key it was given.
 */
export async function importKey(
  transport: ApduTransport,
  applet: CardApplet,
  seed: Uint8Array,
  publicKey: Uint8Array
): Promise<void> {
  if (!applet.canImportKey || applet.importKey === undefined) {
    throw new CardError('NO_IMPORT');
  }
  if (seed.length !== 32 || publicKey.length !== 32) {
    throw new RangeError('Ed25519 seed and public key are 32 bytes');
  }
  const { sw } = await exchange(
    transport,
    buildApdu(applet.cla, applet.importKey, 0x00, concatBytes(seed, publicKey))
  );
  if (sw !== SW_OK) throw new CardError('CARD_STATUS', sw);
}

/** Pure Ed25519 signature over `message`, in RFC 8032 byte order. */
export async function signOnCard(
  transport: ApduTransport,
  applet: CardApplet,
  message: Uint8Array
): Promise<Uint8Array> {
  if (message.length === 0) throw new RangeError('Nothing to sign');
  const { data, sw } = await exchange(
    transport,
    buildApdu(applet.cla, applet.sign, applet.signP1, message, true)
  );
  if (sw !== SW_OK || data.length !== 64)
    throw new CardError('CARD_STATUS', sw);
  if (!applet.reversed) return data;
  return concatBytes(data.slice(0, 32).reverse(), data.slice(32).reverse());
}
