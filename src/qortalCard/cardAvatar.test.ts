import { concatBytes } from '@noble/hashes/utils.js';
import { describe, expect, it, vi } from 'vitest';

// Addresses need the real SHA-256 (the global test setup mocks asmcrypto).
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../background/background', () => ({
  createEndpoint: async (path: string) => `http://node${path}`,
  processTransactionVersion2: vi.fn(),
}));

import {
  ARBITRARY_TX_TYPE,
  publishCardAvatar,
  type AvatarNode,
} from './cardAvatar';
import { cardAddress, cardKeyPairFromSeed, deriveCardSeed } from './cardKeys';
import { NodeError } from './cardNode';
import { Base58, nacl } from './cryptoDeps';

const MAIN = nacl.sign.keyPair().secretKey;
const INDEX = 4;
const CARD = cardKeyPairFromSeed(deriveCardSeed(MAIN, INDEX));
const CARD_ADDRESS = cardAddress(CARD.publicKey);

/** An ARBITRARY transaction the way the node hands it out, made out to `creator`. */
function unsignedArbitrary(creator: Uint8Array): Uint8Array {
  const head = new Uint8Array(80);
  new DataView(head.buffer).setInt32(0, ARBITRARY_TX_TYPE);
  return concatBytes(
    head,
    creator,
    Uint8Array.from({ length: 160 }, (_, i) => i)
  );
}

function fakeNode(creator: Uint8Array, accepted = true) {
  const unsigned = unsignedArbitrary(creator);
  // The signing form differs only after the head (raw data swapped for its hash).
  const forSigning = concatBytes(
    unsigned.slice(0, 112),
    new Uint8Array(32).fill(9)
  );
  const node = {
    upload: vi.fn(async () => Base58.encode(unsigned)),
    convert: vi.fn(async () => Base58.encode(forSigning)),
    broadcast: vi.fn(async (_signed: string) =>
      accepted
        ? { ok: true as const, signature: 'sig' }
        : { ok: false as const, message: 'NAME_UNKNOWN' }
    ),
  } satisfies AvatarNode;
  return { node, unsigned, forSigning };
}

const request = {
  mainPrivateKey: MAIN,
  index: INDEX,
  address: CARD_ADDRESS,
  name: 'Simon Card',
  base64: 'aGVsbG8=',
  fee: 1000000n,
};

describe('publishing a card avatar', () => {
  it('signs what the node made out to the card, with the card key', async () => {
    const { node, unsigned, forSigning } = fakeNode(CARD.publicKey);
    await publishCardAvatar(request, node);

    expect(node.upload).toHaveBeenCalledWith(
      'Simon Card',
      'aGVsbG8=',
      1000000n
    );
    const sent = Base58.decode(node.broadcast.mock.calls[0][0]);
    expect(sent.slice(0, unsigned.length)).toEqual(unsigned);
    const signature = sent.slice(unsigned.length);
    expect(
      nacl.sign.detached.verify(forSigning, signature, CARD.publicKey)
    ).toBe(true);
  });

  it('signs nothing the node made out to someone else', async () => {
    const other = nacl.sign.keyPair().publicKey;
    const { node } = fakeNode(other);
    await expect(publishCardAvatar(request, node)).rejects.toThrow(
      'KEY_MISMATCH'
    );
    expect(node.broadcast).not.toHaveBeenCalled();
  });

  it('refuses a key that does not open the card', async () => {
    const { node } = fakeNode(CARD.publicKey);
    await expect(
      publishCardAvatar({ ...request, index: INDEX + 1 }, node)
    ).rejects.toThrow('KEY_MISMATCH');
    expect(node.broadcast).not.toHaveBeenCalled();
  });

  it('passes on the node’s own reason when it says no', async () => {
    const { node } = fakeNode(CARD.publicKey, false);
    const failure = publishCardAvatar(request, node);
    await expect(failure).rejects.toBeInstanceOf(NodeError);
    await expect(failure).rejects.toThrow('NAME_UNKNOWN');
  });
});
