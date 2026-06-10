/**
 * Renderer-side verification of the Q-Chat Reticulum file-transfer link auth
 * (QCHAT_FILE_LINK_AUTH). Mirrors the desktop main-process logic in
 * electron/src/reticulum-daemon.ts (verifyQchatFileLinkAuth) so the mobile
 * sender can authorize/reject inbound download links with the same guarantees:
 *   1. The auth's downloader is the offer's allowed recipient.
 *   2. The auth's sender matches the pending transfer's sender.
 *   3. The timestamp is fresh.
 *   4. The Ed25519 signature is valid for the downloader's Qortal key, and the
 *      key derives the claimed downloader address.
 */

import Base58Untyped from '../encryption/Base58';
import naclUntyped from '../encryption/nacl-fast';
import publicKeyToAddressUntyped from './generateWallet/publicKeyToAddress';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const QCHAT_FILE_SIGNATURE_MAX_AGE_MS = 10 * 60 * 1000;
const QCHAT_FILE_SIGNATURE_MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

/** Sorted-keys JSON → UTF-8 bytes; must match electron presence.ts. */
const canonicalizeForSigning = (data: Record<string, unknown>): Uint8Array => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(data).sort()) {
    sorted[key] = data[key];
  }
  return new TextEncoder().encode(JSON.stringify(sorted));
};

export const buildQchatFileLinkAuthSignedFields = (payload: {
  transferId: string;
  senderAddress: string;
  downloaderAddress: string;
  downloaderPublicKey: string;
  downloaderReticulumDestinationHash: string;
  downloaderReticulumIdentityPublicKeyBase64: string;
  timestamp: number;
}): Record<string, unknown> => ({
  type: 'QCHAT_FILE_LINK_AUTH',
  transferId: payload.transferId,
  senderAddress: payload.senderAddress,
  downloaderAddress: payload.downloaderAddress,
  downloaderPublicKey: payload.downloaderPublicKey,
  downloaderReticulumDestinationHash:
    payload.downloaderReticulumDestinationHash,
  downloaderReticulumIdentityPublicKeyBase64:
    payload.downloaderReticulumIdentityPublicKeyBase64,
  timestamp: payload.timestamp,
});

const verifyAuthTimestamp = (timestamp: number): string | null => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'Missing Reticulum link auth timestamp';
  }
  const skew = Date.now() - timestamp;
  if (skew > QCHAT_FILE_SIGNATURE_MAX_AGE_MS) {
    return 'Reticulum link auth expired';
  }
  if (skew < -QCHAT_FILE_SIGNATURE_MAX_FUTURE_SKEW_MS) {
    return 'Reticulum link auth timestamp is in the future';
  }
  return null;
};

const verifyGcDetached = (
  fields: Record<string, unknown>,
  signature: string,
  fromPublicKey: string,
  fromAddress: string
): boolean => {
  try {
    const pkBytes = Base58.decode(fromPublicKey) as Uint8Array;
    const derived = String(publicKeyToAddress(pkBytes));
    if (derived !== fromAddress) return false;
    const sigBytes = Base58.decode(signature) as Uint8Array;
    const msgBytes = canonicalizeForSigning(fields);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes) === true;
  } catch {
    return false;
  }
};

/**
 * Returns null when the auth is valid, otherwise a human-readable reason
 * (used for the bridge's reject_qchat_file_resource and the failure event).
 */
export const verifyQchatFileLinkAuth = (
  auth: Record<string, unknown>,
  pending: {
    allowedRecipientAddress: string;
    senderAddress: string;
  }
): string | null => {
  const transferId = String(auth.transferId || '').trim();
  const senderAddress = String(auth.senderAddress || '').trim();
  const downloaderAddress = String(auth.downloaderAddress || '').trim();
  const downloaderPublicKey = String(auth.downloaderPublicKey || '').trim();
  const downloaderReticulumDestinationHash = String(
    auth.downloaderReticulumDestinationHash || ''
  )
    .trim()
    .toLowerCase();
  const downloaderReticulumIdentityPublicKeyBase64 = String(
    auth.downloaderReticulumIdentityPublicKeyBase64 || ''
  ).trim();
  const timestamp = Number(auth.timestamp || 0);
  const signature = String(auth.signature || '').trim();

  if (!transferId || !senderAddress || !downloaderAddress || !downloaderPublicKey) {
    return 'Missing Reticulum link auth identity fields';
  }
  if (downloaderAddress !== pending.allowedRecipientAddress) {
    return 'Reticulum link auth is not from the allowed downloader';
  }
  if (senderAddress !== pending.senderAddress) {
    return 'Reticulum link auth sender mismatch';
  }
  if (
    !downloaderReticulumDestinationHash ||
    !downloaderReticulumIdentityPublicKeyBase64 ||
    !signature
  ) {
    return 'Missing Reticulum link auth signature fields';
  }
  const timestampError = verifyAuthTimestamp(timestamp);
  if (timestampError) return timestampError;

  const ok = verifyGcDetached(
    buildQchatFileLinkAuthSignedFields({
      transferId,
      senderAddress,
      downloaderAddress,
      downloaderPublicKey,
      downloaderReticulumDestinationHash,
      downloaderReticulumIdentityPublicKeyBase64,
      timestamp,
    }),
    signature,
    downloaderPublicKey,
    downloaderAddress
  );
  return ok ? null : 'Invalid Reticulum link auth signature';
};
