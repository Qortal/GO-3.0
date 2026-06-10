import { Capacitor, registerPlugin } from '@capacitor/core';

export interface QortalBiometricPlugin {
  isAvailable(): Promise<{ isAvailable: boolean; errorCode?: number }>;
  verify(options?: {
    title?: string;
    subtitle?: string;
    description?: string;
    negativeButtonText?: string;
  }): Promise<void>;
}

const QortalBiometric = registerPlugin<QortalBiometricPlugin>('QortalBiometric');

export async function isQortalBiometricHardwareAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { isAvailable } = await QortalBiometric.isAvailable();
    return Boolean(isAvailable);
  } catch {
    return false;
  }
}

export async function verifyQortalBiometric(options?: {
  title?: string;
  subtitle?: string;
  description?: string;
}): Promise<void> {
  try {
  await QortalBiometric.verify({
    ...(options ?? {}),
    negativeButtonText: 'Cancel',
  });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err ?? 'Biometric failed');
    if (message.toLowerCase().includes('cancel')) {
      throw new Error('cancelled');
    }
    throw err instanceof Error ? err : new Error(message);
  }
}
