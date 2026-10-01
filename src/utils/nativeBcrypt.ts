import { Capacitor, registerPlugin } from '@capacitor/core';

/** Build and Java speed facts from the plugin, for Copy diagnostics. */
export type NativeBcryptRuntimeInfo = {
  debuggable: boolean;
  /** Threads in the KDF pool (cores - 1, at least 2). */
  poolSize: number;
  cores: number;
  /** One bcrypt hash at cost 6: a few ms compiled, ~80 ms interpreted. */
  probeMs: number;
};

export type NativeBcryptBatchResult = {
  hashes: string[];
  /** Batch wall time in Java. */
  elapsedMs?: number;
  poolSize?: number;
  debuggable?: boolean;
};

export interface NativeBcryptPlugin {
  hashPassword(options: {
    password: string;
    salt: string;
  }): Promise<{ hash: string }>;
  hashPasswordBatch(options: {
    jobs: Array<{ password: string; salt: string }>;
  }): Promise<NativeBcryptBatchResult>;
  runtimeInfo(): Promise<NativeBcryptRuntimeInfo>;
}

const NativeBcrypt = registerPlugin<NativeBcryptPlugin>('NativeBcrypt');

export function canUseNativeBcrypt(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    );
  } catch {
    return false;
  }
}

export async function nativeBcryptHash(
  password: string,
  salt: string
): Promise<string> {
  const { hash } = await NativeBcrypt.hashPassword({ password, salt });
  return hash;
}

export async function nativeBcryptHashBatch(
  jobs: Array<{ hashBase64: string; salt: string }>
): Promise<NativeBcryptBatchResult> {
  return NativeBcrypt.hashPasswordBatch({
    jobs: jobs.map((job) => ({
      password: job.hashBase64,
      salt: job.salt,
    })),
  });
}

/** Null off native Android or when the plugin call fails. */
export async function getNativeBcryptRuntimeInfo(): Promise<NativeBcryptRuntimeInfo | null> {
  if (!canUseNativeBcrypt()) return null;
  try {
    const info = await NativeBcrypt.runtimeInfo();
    if (!info || typeof info.debuggable !== 'boolean') return null;
    return {
      debuggable: info.debuggable,
      poolSize: Number(info.poolSize),
      cores: Number(info.cores),
      probeMs: Number(info.probeMs),
    };
  } catch {
    return null;
  }
}
