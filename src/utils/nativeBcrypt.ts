import { registerPlugin } from '@capacitor/core';
import { isAndroidApp } from './androidApp';

/** Build and Java speed facts from the plugin, for Copy diagnostics. */
export type NativeBcryptRuntimeInfo = {
  debuggable: boolean;
  /** Threads in the KDF pool (cores - 1, at least 2). */
  poolSize: number;
  cores: number;
  /** One bcrypt hash at cost 6: a few ms compiled, ~80 ms interpreted. */
  probeMs: number;
  /**
   * GrapheneOS's "WebView JIT" exploit protection for GO: true = JIT off
   * (all JS and wasm interpreted), false = allowed. Null when the OS has no
   * such flag (stock Android, GrapheneOS before 2026050400); undefined from
   * an older app.
   */
  webViewJitRestricted?: boolean | null;
  /** WebView provider, e.g. `app.vanadium.webview` / `com.google.android.webview`. */
  webViewPackage?: string;
  webViewVersion?: string;
};

type NativeBcryptBatchResult = {
  hashes: string[];
  /** Batch wall time in Java. */
  elapsedMs?: number;
  poolSize?: number;
  debuggable?: boolean;
};

interface NativeBcryptPlugin {
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
  return isAndroidApp();
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
    const out: NativeBcryptRuntimeInfo = {
      debuggable: info.debuggable,
      poolSize: Number(info.poolSize),
      cores: Number(info.cores),
      probeMs: Number(info.probeMs),
    };
    if (typeof info.webViewJitRestricted === 'boolean') {
      out.webViewJitRestricted = info.webViewJitRestricted;
    } else if (info.webViewJitRestricted === null) {
      out.webViewJitRestricted = null;
    }
    if (typeof info.webViewPackage === 'string' && info.webViewPackage) {
      out.webViewPackage = info.webViewPackage;
    }
    if (typeof info.webViewVersion === 'string' && info.webViewVersion) {
      out.webViewVersion = info.webViewVersion;
    }
    return out;
  } catch {
    return null;
  }
}
