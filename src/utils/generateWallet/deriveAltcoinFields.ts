export type AltcoinKeyFields = {
  ltcPrivateKey: string;
  ltcPublicKey: string;
  ltcAddress: string;
  arrrSeed58: string;
  btcAddress: string;
  btcPublicKey: string;
  btcPrivateKey: string;
  dogeAddress: string;
  dogePublicKey: string;
  dogePrivateKey: string;
  dgbAddress: string;
  dgbPublicKey: string;
  dgbPrivateKey: string;
  rvnAddress: string;
  rvnPublicKey: string;
  rvnPrivateKey: string;
};

export function deriveAltcoinFieldsInWorker(
  seed: Uint8Array,
  walletVersion: number
): Promise<AltcoinKeyFields> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./altcoinHd.worker.ts', import.meta.url),
      { type: 'module', name: 'altcoin-hd' }
    );
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Altcoin HD timed out'));
    }, 120_000);
    worker.onmessage = (event: MessageEvent) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (event.data?.ok && event.data.fields) {
        resolve(event.data.fields as AltcoinKeyFields);
        return;
      }
      reject(new Error(event.data?.error || 'Altcoin HD failed'));
    };
    worker.onerror = (error) => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(error.message ? new Error(error.message) : error);
    };
    const copy = seed.slice();
    worker.postMessage(
      { seed: copy.buffer, walletVersion },
      [copy.buffer]
    );
  });
}
