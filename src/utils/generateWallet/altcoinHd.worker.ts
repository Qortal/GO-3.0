// @ts-nocheck
/**
 * Derives BTC/LTC/DOGE/DGB/RVN/ARRR HD wallets off the UI thread so first-session
 * Reticulum subscribe/sign is not starved after a fast QORT unlock.
 */
import PhraseWallet from './phrase-wallet';

self.onmessage = (event) => {
  try {
    const seed = event.data?.seed;
    const walletVersion = event.data?.walletVersion;
    if (!(seed instanceof ArrayBuffer) && !ArrayBuffer.isView(seed)) {
      self.postMessage({ ok: false, error: 'Missing seed' });
      return;
    }
    const bytes = seed instanceof ArrayBuffer ? new Uint8Array(seed) : new Uint8Array(seed);
    const wallet = new PhraseWallet(bytes, walletVersion, { qortOnly: true });
    wallet.ensureAltcoinWallets();
    const addr = wallet._addresses[0];
    if (!addr?.btcWallet) {
      self.postMessage({ ok: false, error: 'Altcoin HD produced no wallets' });
      return;
    }
    self.postMessage({
      ok: true,
      fields: {
        ltcPrivateKey: addr.ltcWallet.derivedMasterPrivateKey,
        ltcPublicKey: addr.ltcWallet.derivedMasterPublicKey,
        ltcAddress: addr.ltcWallet.address,
        arrrSeed58: addr.arrrWallet.seed58,
        btcAddress: addr.btcWallet.address,
        btcPublicKey: addr.btcWallet.derivedMasterPublicKey,
        btcPrivateKey: addr.btcWallet.derivedMasterPrivateKey,
        dogeAddress: addr.dogeWallet.address,
        dogePublicKey: addr.dogeWallet.derivedMasterPublicKey,
        dogePrivateKey: addr.dogeWallet.derivedMasterPrivateKey,
        dgbAddress: addr.dgbWallet.address,
        dgbPublicKey: addr.dgbWallet.derivedMasterPublicKey,
        dgbPrivateKey: addr.dgbWallet.derivedMasterPrivateKey,
        rvnAddress: addr.rvnWallet.address,
        rvnPublicKey: addr.rvnWallet.derivedMasterPublicKey,
        rvnPrivateKey: addr.rvnWallet.derivedMasterPrivateKey,
      },
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
