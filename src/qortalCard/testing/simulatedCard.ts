import { sha512 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import {
  CARD_APPLETS,
  type ApduTransport,
  type CardAppletKind,
} from '../cardProtocol';
import { nacl } from '../cryptoDeps';

/**
 * A card in software, for tests: Qortal's lab applet or Futako's TestEdDSA
 * (or both, like test card 2), answering APDUs the way the real J3R452 cards
 * did on 13 October 2026.
 * Not used by the app.
 */
export class SimulatedCard implements ApduTransport {
  readonly applets: CardAppletKind[];
  readonly sent: Uint8Array[] = [];
  /** Signs with another key than the one it reports (a lying card). */
  lie = false;
  private selected: CardAppletKind | null = null;
  /** Each applet keeps its own key, as on a real card. */
  private readonly keys = new Map<
    CardAppletKind,
    { seed: Uint8Array | null; publicKey: Uint8Array | null }
  >();

  private slot() {
    const kind = this.selected ?? 'qortal-lab';
    let slot = this.keys.get(kind);
    if (!slot) {
      slot = { seed: null, publicKey: null };
      this.keys.set(kind, slot);
    }
    return slot;
  }

  private get seed(): Uint8Array | null {
    return this.slot().seed;
  }

  private set seed(value: Uint8Array | null) {
    this.slot().seed = value;
  }

  private get publicKey(): Uint8Array | null {
    return this.slot().publicKey;
  }

  private set publicKey(value: Uint8Array | null) {
    this.slot().publicKey = value;
  }

  constructor(applets: CardAppletKind[] = ['qortal-lab', 'futako-test']) {
    this.applets = applets;
  }

  async transceive(apdu: Uint8Array): Promise<Uint8Array> {
    this.sent.push(apdu.slice());
    const [cla, ins, p1] = apdu;
    const data =
      apdu.length > 5 ? apdu.slice(5, 5 + apdu[4]) : new Uint8Array(0);
    if (cla === 0x00 && ins === 0xa4) {
      const found = CARD_APPLETS.find(
        (applet) =>
          this.applets.includes(applet.kind) &&
          applet.aid.length === data.length &&
          applet.aid.every((byte, i) => byte === data[i])
      );
      if (found) {
        this.selected = found.kind;
        return sw(0x9000);
      }
      // As on the real cards: Java Card hands a SELECT that matches no applet
      // to the applet already selected, as an ordinary command. With none
      // selected, the card manager answers "not found".
      if (!this.selected) return sw(0x6a82);
    }
    if (this.selected === 'qortal-lab') return this.lab(cla, ins, data);
    if (this.selected === 'futako-test') return this.futako(ins, p1, data);
    return sw(0x6e00);
  }

  private lab(cla: number, ins: number, data: Uint8Array): Uint8Array {
    if (cla !== 0x80) return sw(0x6e00);
    switch (ins) {
      case 0x10:
        this.generate();
        return sw(0x9000);
      case 0x12:
        if (data.length !== 32 && data.length !== 64) return sw(0x6700);
        if (!this.seed) this.generate();
        this.seed = data.slice(0, 32);
        // As on the real card: the seed alone leaves the old public key.
        if (data.length === 64) this.publicKey = data.slice(32);
        return sw(0x9000);
      case 0x20:
        if (!this.seed) return sw(0x6602);
        return answer(this.sign(data));
      case 0x22:
        if (!this.publicKey) return sw(0x6602);
        return answer(this.publicKey);
      case 0x40:
        return answer(
          new Uint8Array([this.seed ? 1 : 0, this.publicKey ? 1 : 0])
        );
      default:
        return sw(0x6d00);
    }
  }

  private futako(ins: number, p1: number, data: Uint8Array): Uint8Array {
    switch (ins) {
      case 0x10:
        this.generate();
        return sw(0x9000);
      case 0x20: {
        if (!this.seed) return sw(0x6f00);
        if (p1 !== 0x00 && p1 !== 0x01) return sw(0x6b00);
        const signature = this.sign(p1 === 0x00 ? sha512(data) : data);
        return answer(
          concatBytes(
            signature.slice(0, 32).reverse(),
            signature.slice(32).reverse()
          )
        );
      }
      case 0x42:
        if (!this.publicKey) return sw(0x6f00);
        return answer(this.publicKey.slice().reverse());
      default:
        return sw(0x6d00);
    }
  }

  private generate(): void {
    const pair = nacl.sign.keyPair();
    this.seed = pair.secretKey.slice(0, 32);
    this.publicKey = pair.publicKey;
  }

  private sign(message: Uint8Array): Uint8Array {
    const seed = this.lie ? new Uint8Array(32).fill(7) : this.seed;
    return nacl.sign.detached(
      message,
      nacl.sign.keyPair.fromSeed(seed).secretKey
    );
  }
}

const sw = (word: number): Uint8Array =>
  new Uint8Array([word >> 8, word & 0xff]);

const answer = (data: Uint8Array): Uint8Array => concatBytes(data, sw(0x9000));
