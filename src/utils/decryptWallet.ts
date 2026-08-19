// @ts-nocheck

import { crypto } from '../constants/decryptWallet';
import Base58 from '../encryption/Base58';
import { AES_CBC, HmacSha512 } from 'asmcrypto.js';
import { doInitWorkers, kdf } from '../encryption/kdf';
import i18n from 'i18next';
import {
  getWalletErrorMessage,
  validateStoredWalletForDecrypt,
} from './walletErrorMessages';
import {
  getCachedWalletKdfKey,
  setCachedWalletKdfKey,
} from './walletKdfSessionCache';

/** Run KDF only and cache the derived key (used during biometric scan). */
export async function precomputeWalletKdfKey(password, wallet) {
  const walletAddress = wallet?.address0?.trim();
  if (walletAddress && getCachedWalletKdfKey(walletAddress, password)) {
    return;
  }

  validateStoredWalletForDecrypt(wallet);

  let salt;
  try {
    salt = Base58.decode(wallet.salt);
  } catch (error) {
    throw new Error(getWalletErrorMessage(error));
  }

  const threads = doInitWorkers(wallet.kdfThreads ?? crypto.kdfThreads);
  const key = await kdf(password, salt, threads);
  if (walletAddress) {
    setCachedWalletKdfKey(walletAddress, password, key);
  }
}

export const decryptStoredWallet = async (password, wallet, threadCount) => {
  validateStoredWalletForDecrypt(wallet);

  const threads = doInitWorkers(threadCount ?? crypto.kdfThreads);
  let encryptedSeedBytes;
  let iv;
  let salt;

  try {
    encryptedSeedBytes = Base58.decode(wallet.encryptedSeed);
    iv = Base58.decode(wallet.iv);
    salt = Base58.decode(wallet.salt);
  } catch (error) {
    throw new Error(getWalletErrorMessage(error));
  }

  const walletAddress = wallet.address0?.trim();
  let key =
    walletAddress && getCachedWalletKdfKey(walletAddress, password);
  if (!key) {
    const kdfStarted = performance.now();
    key = await kdf(password, salt, threads);
    console.info(
      `[Unlock] KDF ${Math.round(performance.now() - kdfStarted)}ms (${threads.length} jobs)`
    );
  } else {
    console.info('[Unlock] KDF cache hit');
  }
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63);
  const mac = new HmacSha512(macKey)
    .process(encryptedSeedBytes)
    .finish().result;
  if (Base58.encode(mac) !== wallet.mac) {
    throw new Error(i18n.t('auth:message.error.incorrect_password'));
  }
  if (walletAddress) {
    setCachedWalletKdfKey(walletAddress, password, key);
  }
  const decryptedBytes = AES_CBC.decrypt(
    encryptedSeedBytes,
    encryptionKey,
    false,
    iv
  );
  return decryptedBytes;
};

export const decryptStoredWalletFromSeedPhrase = async (password) => {
  const threads = doInitWorkers(crypto.kdfThreads);
  const salt = new Uint8Array(void 0);

  const seed = await kdf(password, salt, threads);
  return seed;
};
