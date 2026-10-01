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
import { recordUnlockTiming } from '../utils/unlockTimings';

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

/** Resolves `{ hashes, path }`; `path` says which engine ran, for timings. */
async function bcryptBatch(jobs) {
  let wasmReason = 'not native Android';
  if (canUseNativeBcrypt()) {
    try {
      const batch = await nativeBcryptHashBatch(jobs);
      const hashes = batch?.hashes;
      if (Array.isArray(hashes) && hashes.length === jobs.length) {
        const path = [
          'native',
          `batch ${Math.round(batch.elapsedMs ?? -1)} ms`,
          `pool ${batch.poolSize ?? '?'}`,
        ];
        if (batch.debuggable) path.push('debuggable');
        return { hashes, path: path.join(', ') };
      }
      console.warn(
        '[KDF] native bcrypt returned an incomplete batch, using WASM'
      );
      wasmReason = 'native batch incomplete';
    } catch (error) {
      console.warn('[KDF] native bcrypt failed, using WASM', error);
      wasmReason = `native failed: ${String(error?.message ?? error).slice(0, 60)}`;
    }
  }
  const hashes = await bcryptBatchInWorkers(jobs);
  return { hashes, path: `wasm (${wasmReason})` };
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

const runKdf = async (jobs) => {
  const { hashes: seedParts, path } = await bcryptBatch(jobs);

  const result = new Sha512()
    .process(
      stringtoUTF8Array(crypto2.staticSalt + seedParts.reduce((a, c) => a + c))
    )
    .finish().result;

  return { result, path };
};

/**
 * KDF batches in flight, keyed by job count and the first job's hash (never
 * the seed itself). The output depends only on the seed and the job count
 * (the salt argument is unused), so the fingerprint prewarm, the KDF during
 * the scan and a password unlock share one bcrypt batch instead of queueing
 * a second one behind it. Entries are dropped when they settle, so a retry
 * after a failure runs again.
 */
const inFlightKdf = new Map();

/**
 * `label` names the caller in the unlock timings ('prewarm', 'scan',
 * 'decrypt', 'seedphrase', ...).
 */
export const kdf = async (seed, salt, threads, label?: string) => {
  const started = performance.now();
  const jobs = threads.map((worker, index) =>
    buildKdfBcryptJob({
      key: seed,
      nonce: index,
      staticSalt: crypto2.staticSalt,
      staticBcryptSalt: crypto2.staticBcryptSalt,
    })
  );

  const flightKey = `${jobs.length}:${jobs[0]?.hashBase64 ?? ''}`;
  let run = inFlightKdf.get(flightKey);
  const joined = Boolean(run);
  if (!run) {
    run = runKdf(jobs);
    inFlightKdf.set(flightKey, run);
    const forget = () => {
      if (inFlightKdf.get(flightKey) === run) inFlightKdf.delete(flightKey);
    };
    run.then(forget, forget);
  }

  const timingDetail = (path) =>
    [path, `${jobs.length} jobs`, label].filter(Boolean).join(', ');
  try {
    const { result, path } = await run;
    recordUnlockTiming(
      'kdf',
      performance.now() - started,
      timingDetail(joined ? 'joined running KDF' : path)
    );
    // Each caller gets its own bytes; callers slice and cache them.
    return new Uint8Array(result);
  } catch (error) {
    recordUnlockTiming(
      'kdf',
      performance.now() - started,
      timingDetail(joined ? 'joined running KDF, failed' : 'failed')
    );
    throw error;
  }
};

/** Spawn bcrypt workers without running a hash (must stay instant for UI paths). */
export function prewarmKdfWorkers(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  ensurePersistentWorkers(1);
  return Promise.resolve();
}
