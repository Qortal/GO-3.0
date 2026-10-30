import { concatBytes } from '@noble/hashes/utils.js';
import {
  cardAddress,
  cardKeyPairFromSeed,
  deriveCardSeed,
  equalBytes,
} from './cardKeys';
import {
  broadcastSignedTx,
  convertForSigning,
  NodeError,
  uploadAvatarForSigning,
  type BroadcastResult,
} from './cardNode';
import { CardError } from './cardProtocol';
import { TX_CREATOR_KEY_OFFSET, txCreatorPublicKey } from './cardTx';
import { Base58, nacl } from './cryptoDeps';

export const ARBITRARY_TX_TYPE = 10;

/** Type, timestamp, group, reference and creator key: the same in both forms. */
const TX_HEAD_BYTES = TX_CREATOR_KEY_OFFSET + 32;

export interface AvatarNode {
  upload: (name: string, base64: string, fee: bigint) => Promise<string>;
  convert: (unsignedBase58: string) => Promise<string>;
  broadcast: (signedBase58: string) => Promise<BroadcastResult>;
}

const defaultAvatarNode: AvatarNode = {
  upload: uploadAvatarForSigning,
  convert: convertForSigning,
  broadcast: broadcastSignedTx,
};

interface CardAvatarRequest {
  mainPrivateKey: Uint8Array;
  /** The card's wallet card-key index. */
  index: number;
  /** The card's address: the key must open it. */
  address: string;
  /** The card's name on chain. */
  name: string;
  /** The picture, Base64 without a data: prefix. */
  base64: string;
  /** In 1e-8 QORT, paid from the card. */
  fee: bigint;
}

/**
 * Publishes a picture as the avatar of a wallet-key card's name, the way Hub
 * publishes the account's own avatar (THUMBNAIL / qortal_avatar), except GO
 * signs with the card key rebuilt from the wallet. Before signing it checks
 * the node made the transaction out to this card. Cards with a key of their
 * own cannot do this: the transaction is longer than a card signs.
 */
export async function publishCardAvatar(
  request: CardAvatarRequest,
  node: AvatarNode = defaultAvatarNode
): Promise<void> {
  const unsigned = Base58.decode(
    await node.upload(request.name, request.base64, request.fee)
  );
  const forSigning = Base58.decode(await node.convert(Base58.encode(unsigned)));
  const seed = deriveCardSeed(request.mainPrivateKey, request.index);
  const pair = cardKeyPairFromSeed(seed);
  try {
    if (cardAddress(pair.publicKey) !== request.address) {
      throw new CardError('KEY_MISMATCH');
    }
    const view = new DataView(
      unsigned.buffer,
      unsigned.byteOffset,
      unsigned.byteLength
    );
    if (
      unsigned.length <= TX_HEAD_BYTES ||
      view.getInt32(0) !== ARBITRARY_TX_TYPE ||
      !equalBytes(txCreatorPublicKey(unsigned), pair.publicKey) ||
      !equalBytes(
        forSigning.slice(0, TX_HEAD_BYTES),
        unsigned.slice(0, TX_HEAD_BYTES)
      )
    ) {
      throw new CardError('KEY_MISMATCH');
    }
    const signature = nacl.sign.detached(forSigning, pair.privateKey);
    const result = await node.broadcast(
      Base58.encode(concatBytes(unsigned, signature))
    );
    if (result.ok === false) throw new NodeError(result.message);
  } finally {
    seed.fill(0);
    pair.privateKey.fill(0);
  }
}
