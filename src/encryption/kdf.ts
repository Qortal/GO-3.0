// @ts-nocheck

import { bytes_to_base64 as bytesToBase64, Sha512 } from 'asmcrypto.js';
import utils from '../utils/utils';
import { crypto as crypto2 } from '../constants/decryptWallet';
// WASM bcrypt (hash-wasm): byte-for-byte identical output to the old
// bcryptjs worker (verified against the wallet KDF salt), but meaningfully
// faster on mobile JS engines where the pure-JS implementation crawls.
import BcryptWorker from './bcryptworkerwasm.worker.js?worker';
import {
  canUseNativeBcrypt,
  nativeBcryptHashBatch,
} from '../utils/nativeBcrypt';

const stringtoUTF8Array = (message) => {
  if (typeof message === 'string') {
    var s = unescape(encodeURIComponent(message)); // UTF-8
    message = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) {
      message[i] = s.charCodeAt(i) & 0xff;
    }
  }
  return message;
};

const buildKdfBcryptJob = (req) => {
  const { key, nonce, staticSalt, staticBcryptSalt } = req;
  const combinedBytes = utils.appendBuffer(
    new Uint8Array([]),
    stringToUTF8Array(`${staticSalt}${key}${nonce}`)
  );

  const sha512Hash = new Sha512().process(combinedBytes).finish().result;
  const sha512HashBase64 = bytesToBase64(sha512Hash);

  return {
    hashBase64: sha512HashBase64.substring(0, 72),
    salt: staticBcryptSalt,
  };
};

/** Reused worker pool — avoids WASM re-init on every unlock. */
let persistentWorkers = null;
let persistentPoolSize = 0;

function ensurePersistentWorkers(poolSize) {
  if (persistentWorkers && persistentPoolSize === poolSize) {
    return persistentWorkers;
  }
  for (const w of persistentWorkers || []) {
    try {
      w.terminate();
    } catch (e) {}
  }
  persistentWorkers = [];
  for (let i = 0; i < poolSize; i += 1) {
    persistentWorkers.push(new BcryptWorker());
  }
  persistentPoolSize = poolSize;
  return persistentWorkers;
}

/** Serialize bcrypt batches — concurrent prewarm + unlock corrupts shared workers. */
let bcryptBatchChain = Promise.resolve();

function runBcryptBatchInWorkers(jobs) {
  return new Promise((resolve, reject) => {
    const cores =
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const poolSize = Math.max(1, Math.min(jobs.length, cores));
    const workers = ensurePersistentWorkers(poolSize);
    const results = new Array(jobs.length);
    let nextJob = 0;
    let completed = 0;
    let failed = false;

    const fail = (error) => {
      if (failed) return;
      failed = true;
      reject(error);
    };

    const assign = (worker) => {
      if (failed) return;
      if (nextJob >= jobs.length) {
        return;
      }
      const jobIndex = nextJob;
      nextJob += 1;
      worker.onmessage = (e) => {
        const { result, error } = e.data;
        if (error) {
          fail(error);
          return;
        }
        results[jobIndex] = result;
        completed += 1;
        if (completed === jobs.length) {
          resolve(results);
        } else {
          assign(worker);
        }
      };
      worker.onerror = (err) => fail(err.message);
      worker.postMessage({
        hashBase64: jobs[jobIndex].hashBase64,
        salt: jobs[jobIndex].salt,
      });
    };

    workers.forEach(assign);
  });
}

/**
 * Runs a batch of bcrypt jobs on a worker pool sized to the device's cores.
 *
 * Workers are kept alive between unlocks so hash-wasm WASM stays loaded.
 */
const bcryptBatchInWorkers = (jobs) => {
  const batch = bcryptBatchChain.then(
    () => runBcryptBatchInWorkers(jobs),
    () => runBcryptBatchInWorkers(jobs)
  );
  bcryptBatchChain = batch.catch(() => {});
  return batch;
};

async function bcryptBatch(jobs) {
  if (canUseNativeBcrypt()) {
    try {
      const hashes = await nativeBcryptHashBatch(jobs);
      if (Array.isArray(hashes) && hashes.length === jobs.length) {
        return hashes;
      }
      console.warn(
        '[KDF] native bcrypt returned an incomplete batch, using WASM'
      );
    } catch (error) {
      console.warn('[KDF] native bcrypt failed, using WASM', error);
    }
  }
  return bcryptBatchInWorkers(jobs);
}

const stringToUTF8Array = (message) => {
  if (typeof message !== 'string') return message;
  const encoder = new TextEncoder();
  return encoder.encode(message);
};

export const doInitWorkers = (numberOfWorkers) => {
  const workers = [];

  try {
    for (let i = 0; i < numberOfWorkers; i++) {
      workers.push({});
    }
  } catch (e) {}

  return workers;
};

export const kdf = async (seed, salt, threads) => {
  const jobs = threads.map((worker, index) =>
    buildKdfBcryptJob({
      key: seed,
      nonce: index,
      staticSalt: crypto2.staticSalt,
      staticBcryptSalt: crypto2.staticBcryptSalt,
    })
  );

  const seedParts = await bcryptBatch(jobs);

  const result = new Sha512()
    .process(
      stringtoUTF8Array(crypto2.staticSalt + seedParts.reduce((a, c) => a + c))
    )
    .finish().result;

  return result;
};

/** Spawn bcrypt workers without running a hash (must stay instant for UI paths). */
export function prewarmKdfWorkers(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  ensurePersistentWorkers(1);
  return Promise.resolve();
}
