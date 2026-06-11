import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeBcryptPlugin {
  hashPassword(options: {
    password: string;
    salt: string;
  }): Promise<{ hash: string }>;
  hashPasswordBatch(options: {
    jobs: Array<{ password: string; salt: string }>;
  }): Promise<{ hashes: string[] }>;
}

const NativeBcrypt = registerPlugin<NativeBcryptPlugin>('NativeBcrypt');

export function canUseNativeBcrypt(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
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
): Promise<string[]> {
  const { hashes } = await NativeBcrypt.hashPasswordBatch({
    jobs: jobs.map((job) => ({
      password: job.hashBase64,
      salt: job.salt,
    })),
  });
  return hashes;
}
