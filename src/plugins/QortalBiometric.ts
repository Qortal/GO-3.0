import { Capacitor, registerPlugin } from '@capacitor/core';

export interface QortalBiometricPlugin {
  isAvailable(): Promise<{ isAvailable: boolean; errorCode?: number }>;
  warmUp(): Promise<void>;
  verify(options?: {
    title?: string;
    subtitle?: string;
    description?: string;
    negativeButtonText?: string;
  }): Promise<void>;
  hasStoredSecret(options: { address: string }): Promise<{ hasSecret: boolean }>;
  storeWalletSecret(options: {
    address: string;
    secret: string;
  }): Promise<void>;
  deleteStoredSecret(options: { address: string }): Promise<void>;
  setAutoPrompt(options: { enabled: boolean }): Promise<void>;
  getEarlyPromptState(): Promise<{ state: 'success' | 'cancelled' | 'none' }>;
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

export async function warmUpQortalBiometric(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await QortalBiometric.warmUp();
  } catch {
    /* best-effort */
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

/** Toggle the native launch-time fingerprint prompt for future cold starts. */
export async function setQortalBiometricAutoPrompt(
  enabled: boolean
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await QortalBiometric.setAutoPrompt({ enabled });
  } catch {
    /* older native shell without the method */
  }
}

/** Result of the launch-time prompt shown before the WebView booted. */
export async function getQortalBiometricEarlyPromptState(): Promise<
  'success' | 'cancelled' | 'none'
> {
  if (!Capacitor.isNativePlatform()) return 'none';
  try {
    const { state } = await QortalBiometric.getEarlyPromptState();
    return state ?? 'none';
  } catch {
    return 'none';
  }
}

export async function hasQortalBiometricSecret(address: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { hasSecret } = await QortalBiometric.hasStoredSecret({ address });
    return Boolean(hasSecret);
  } catch {
    return false;
  }
}

export async function storeQortalBiometricSecret(
  address: string,
  secret: string
): Promise<void> {
  await QortalBiometric.storeWalletSecret({ address, secret });
}

export async function deleteQortalBiometricSecret(
  address: string
): Promise<void> {
  await QortalBiometric.deleteStoredSecret({ address });
}
