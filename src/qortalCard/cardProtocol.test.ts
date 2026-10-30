import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { describe, expect, it, vi } from 'vitest';

// Addresses need the real SHA-256 (the global test setup mocks asmcrypto).
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
import {
  buildApdu,
  CardError,
  exchange,
  generateKey,
  importKey,
  readPublicKey,
  selectApplet,
  signOnCard,
  type ApduTransport,
} from './cardProtocol';
import { SimulatedCard } from './testing/simulatedCard';
import { nacl } from './cryptoDeps';

describe('buildApdu', () => {
  it('builds the four short-APDU cases', () => {
    expect(bytesToHex(buildApdu(0x80, 0x10, 0))).toBe('80100000');
    expect(bytesToHex(buildApdu(0x80, 0x22, 0, undefined, true))).toBe(
      '8022000000'
    );
    expect(bytesToHex(buildApdu(0x00, 0xa4, 4, new Uint8Array([1, 2])))).toBe(
      '00a40400020102'
    );
    expect(
      bytesToHex(buildApdu(0x00, 0x20, 1, new Uint8Array([0xaf]), true))
    ).toBe('00200100' + '01af' + '00');
    expect(() => buildApdu(0, 0, 0, new Uint8Array(256))).toThrow(RangeError);
  });
});

describe('exchange', () => {
  it('follows 6Cxx (resend with that Le) and 61xx (get the rest)', async () => {
    const answers = [
      new Uint8Array([0x6c, 0x04]),
      new Uint8Array([1, 2, 0x61, 0x02]),
      new Uint8Array([3, 4, 0x90, 0x00]),
    ];
    const sent: string[] = [];
    const transport: ApduTransport = {
      transceive: async (apdu) => {
        sent.push(bytesToHex(apdu));
        return answers.shift();
      },
    };
    const answer = await exchange(
      transport,
      new Uint8Array([0, 0xca, 0, 0, 0])
    );
    expect(sent).toEqual(['00ca000000', '00ca000004', '00c0000002']);
    expect(Array.from(answer.data)).toEqual([1, 2, 3, 4]);
    expect(answer.sw).toBe(0x9000);
  });

  it('treats an answer without a status word as a broken read', async () => {
    const transport: ApduTransport = {
      transceive: async () => new Uint8Array([0x90]),
    };
    await expect(exchange(transport, buildApdu(0, 0, 0))).rejects.toMatchObject(
      { code: 'CARD_IO' }
    );
  });
});

describe('applets', () => {
  it('prefers the Qortal lab applet and falls back to Futako’s', async () => {
    expect((await selectApplet(new SimulatedCard())).kind).toBe('qortal-lab');
    expect((await selectApplet(new SimulatedCard(['futako-test']))).kind).toBe(
      'futako-test'
    );
    await expect(selectApplet(new SimulatedCard([]))).rejects.toBeInstanceOf(
      CardError
    );
  });

  it.each(['qortal-lab', 'futako-test'] as const)(
    '%s: no key, then a key in RFC 8032 byte order that signs pure Ed25519',
    async (kind) => {
      const card = new SimulatedCard([kind]);
      const applet = await selectApplet(card);
      expect(await readPublicKey(card, applet)).toBeNull();

      const publicKey = await generateKey(card, applet);
      expect(publicKey.length).toBe(32);
      expect(bytesToHex(await readPublicKey(card, applet))).toBe(
        bytesToHex(publicKey)
      );

      const message = new Uint8Array(153).fill(9);
      const signature = await signOnCard(card, applet, message);
      expect(nacl.sign.detached.verify(message, signature, publicKey)).toBe(
        true
      );
    }
  );

  it('imports a key on the lab applet only', async () => {
    const pair = nacl.sign.keyPair();
    const seed = pair.secretKey.slice(0, 32);
    const lab = new SimulatedCard(['qortal-lab']);
    const labApplet = await selectApplet(lab);
    await importKey(lab, labApplet, seed, pair.publicKey);
    expect(bytesToHex(await readPublicKey(lab, labApplet))).toBe(
      bytesToHex(pair.publicKey)
    );
    const message = new Uint8Array([1, 2, 3]);
    expect(bytesToHex(await signOnCard(lab, labApplet, message))).toBe(
      bytesToHex(nacl.sign.detached(message, pair.secretKey))
    );

    const futako = new SimulatedCard(['futako-test']);
    await expect(
      importKey(futako, await selectApplet(futako), seed, pair.publicKey)
    ).rejects.toMatchObject({ code: 'NO_IMPORT' });
  });

  it('reports a card error with its status word', async () => {
    const card = new SimulatedCard(['qortal-lab']);
    const applet = await selectApplet(card);
    await expect(
      signOnCard(card, applet, concatBytes(new Uint8Array([1])))
    ).rejects.toMatchObject({ code: 'CARD_STATUS', sw: 0x6602 });
  });
});

describe('picking the applet', () => {
  it('moves on only when an applet is clearly not on the card', async () => {
    const answers = [
      new Uint8Array([0x6f, 0x00]), // a glitch on the first SELECT
      new Uint8Array([0x90, 0x00]),
    ];
    const glitchy = { transceive: async () => answers.shift() };
    await expect(selectApplet(glitchy)).rejects.toThrow('CARD_STATUS');

    const notHere = [
      new Uint8Array([0x6a, 0x82]),
      new Uint8Array([0x90, 0x00]),
    ];
    const futakoOnly = { transceive: async () => notHere.shift() };
    expect((await selectApplet(futakoOnly)).kind).toBe('futako-test');
  });

  it('selects the applet asked for', async () => {
    const card = new SimulatedCard(['qortal-lab', 'futako-test']);
    expect((await selectApplet(card, 'futako-test')).kind).toBe('futako-test');
    await expect(
      selectApplet(new SimulatedCard(['qortal-lab']), 'futako-test')
    ).rejects.toThrow('NO_APPLET');
  });
});
