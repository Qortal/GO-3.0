import QortinoLlm, {
  isQortinoLlmNativeAvailable,
  type QortinoDeviceTier,
} from '../plugins/QortinoLlm';
import type { QortinoAgentManifest, QortinoPackId } from './manifest';

export type DeviceTierDecision = {
  tier: QortinoDeviceTier;
  recommendedPack: QortinoPackId;
  allowedPacks: QortinoPackId[];
  reason: string;
};

export async function readDeviceTier(): Promise<QortinoDeviceTier> {
  if (!isQortinoLlmNativeAvailable()) {
    return {
      totalRamBytes: 8 * 1024 ** 3,
      availRamBytes: 4 * 1024 ** 3,
      availStorageBytes: 20 * 1024 ** 3,
      totalStorageBytes: 64 * 1024 ** 3,
      recommendedPack: 'small',
      lowMemory: false,
    };
  }
  return QortinoLlm.getDeviceTier();
}

export function decidePackForDevice(
  tier: QortinoDeviceTier,
  manifest: QortinoAgentManifest
): DeviceTierDecision {
  const small = manifest.packs.find((p) => p.id === 'small');
  const medium = manifest.packs.find((p) => p.id === 'medium');
  const allowed: QortinoPackId[] = [];

  if (small && tier.totalRamBytes >= small.minRamBytes * 0.85) {
    allowed.push('small');
  }
  if (
    medium &&
    tier.totalRamBytes >= medium.minRamBytes &&
    tier.availStorageBytes >= medium.approxDownloadBytes + 500 * 1024 ** 2
  ) {
    allowed.push('medium');
  }
  if (allowed.length === 0) {
    allowed.push('small');
  }

  let recommended: QortinoPackId =
    tier.recommendedPack === 'medium' && allowed.includes('medium')
      ? 'medium'
      : 'small';

  if (!allowed.includes(recommended)) {
    recommended = allowed[0] ?? 'small';
  }

  let reason = 'Balanced for this device.';
  if (recommended === 'small') {
    if (tier.totalRamBytes < 7 * 1024 ** 3) {
      reason = 'Lower RAM detected — Lite pack recommended.';
    } else if (tier.availStorageBytes < 3 * 1024 ** 3) {
      reason = 'Limited free storage — Lite pack recommended.';
    }
  } else {
    reason = 'Enough RAM and storage for the Standard pack.';
  }

  return {
    tier,
    recommendedPack: recommended,
    allowedPacks: allowed,
    reason,
  };
}
