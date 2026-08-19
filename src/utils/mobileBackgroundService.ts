import { Preferences } from '@capacitor/preferences';
import { QortalBackground } from '../plugins/QortalBackground';
import {
  getMobileReticulumStatus,
  onMobileReticulumStatus,
} from '../bridge/capacitorBridge';
import {
  getDeviceOnline,
  reticulumDisplayPhase,
  subscribeDeviceOnline,
  subscribeReticulumStatus,
  type ReticulumPhase,
} from '../components/Reticulum/reticulumStatus';
import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../constants/constants';
import { isCapacitor } from './platform';

const BATTERY_PROMPT_DISMISSED_KEY = 'hub_mobile_battery_prompt_dismissed';

export type ReticulumStatusKind = 'starting' | 'online' | 'offline';

export type PersistentStatusSnapshot = {
  reticulumLabel: string;
  reticulumKind: ReticulumStatusKind;
  onlineCount: number;
  nodeLabel: string;
  syncLabel: string;
  peersLabel: string;
};

export type PersistentStatusExtras = Omit<
  PersistentStatusSnapshot,
  'reticulumLabel' | 'reticulumKind'
>;

export const buildNodeLabel = (
  selectedNode: { url?: string } | null | undefined
): string => {
  const url = selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK;
  if (isLocalNodeUrl(url)) return 'Private node';
  if (url === HTTPS_EXT_NODE_QORTAL_LINK) return 'Public node';
  return 'Custom node';
};

export const buildSyncLabel = (
  nodeInfos: Record<string, unknown> | null | undefined
): string => {
  const isSynchronizing = Boolean(nodeInfos?.isSynchronizing);
  const syncPercent =
    typeof nodeInfos?.syncPercent === 'number' ? nodeInfos.syncPercent : 0;

  if (isSynchronizing && syncPercent !== 100) {
    return `Synchronizing ${Math.round(syncPercent)}%`;
  }
  if (syncPercent === 100) return 'Synchronized';
  if (syncPercent > 0) return `Synchronizing ${Math.round(syncPercent)}%`;
  return 'Sync status unknown';
};

export const buildPeersLabel = (onlineCount: number): string => {
  const overlayPeers = getMobileReticulumStatus()?.p2pActiveOverlayPeers ?? 0;
  const peerWord = overlayPeers === 1 ? 'peer' : 'peers';
  return `${overlayPeers} connected ${peerWord} · ${onlineCount} online`;
};

export const buildPersistentStatusPayload = ({
  reticulumLabel,
  reticulumKind,
  onlineCount,
  nodeLabel,
  syncLabel,
  peersLabel,
}: PersistentStatusSnapshot) => ({
  title: 'GO 3.0',
  detail:
    reticulumKind === 'online'
      ? `${reticulumLabel} · ${onlineCount} online`
      : reticulumLabel,
  nodeLabel,
  syncLabel,
  peersLabel,
  statusKind: reticulumKind,
});

export const startMobilePersistentStatus = async (
  snapshot: PersistentStatusSnapshot
): Promise<void> => {
  if (!isCapacitor()) return;

  try {
    await QortalBackground.startPersistentStatus(
      buildPersistentStatusPayload(snapshot)
    );
  } catch (error) {
    console.error('[mobileBackgroundService] Failed to start persistent status', error);
  }
};

// Presence/status subscribers fire many times per second while peers churn
// (measured: ~1450 native calls in 3.5 min, mostly identical payloads). Every
// call crosses the Capacitor bridge and rebuilds the foreground notification,
// so dedupe identical payloads and rate-limit the rest (trailing-edge flush
// keeps the final state accurate).
const PERSISTENT_STATUS_MIN_INTERVAL_MS = 5_000;
let lastSentStatusJson = '';
let lastSentStatusAt = 0;
let pendingStatusPayload: ReturnType<typeof buildPersistentStatusPayload> | null =
  null;
let pendingStatusTimer: ReturnType<typeof setTimeout> | null = null;

const sendPersistentStatusNow = async (
  payload: ReturnType<typeof buildPersistentStatusPayload>,
  payloadJson: string
): Promise<void> => {
  lastSentStatusJson = payloadJson;
  lastSentStatusAt = Date.now();
  try {
    await QortalBackground.updatePersistentStatus(payload);
  } catch (error) {
    console.error('[mobileBackgroundService] Failed to update persistent status', error);
  }
};

export const updateMobilePersistentStatus = async (
  snapshot: PersistentStatusSnapshot
): Promise<void> => {
  if (!isCapacitor()) return;

  const payload = buildPersistentStatusPayload(snapshot);
  const payloadJson = JSON.stringify(payload);
  if (payloadJson === lastSentStatusJson) return;

  const elapsed = Date.now() - lastSentStatusAt;
  if (elapsed >= PERSISTENT_STATUS_MIN_INTERVAL_MS) {
    if (pendingStatusTimer) {
      clearTimeout(pendingStatusTimer);
      pendingStatusTimer = null;
      pendingStatusPayload = null;
    }
    await sendPersistentStatusNow(payload, payloadJson);
    return;
  }

  pendingStatusPayload = payload;
  if (!pendingStatusTimer) {
    pendingStatusTimer = setTimeout(() => {
      pendingStatusTimer = null;
      const queued = pendingStatusPayload;
      pendingStatusPayload = null;
      if (!queued) return;
      const queuedJson = JSON.stringify(queued);
      if (queuedJson === lastSentStatusJson) return;
      void sendPersistentStatusNow(queued, queuedJson);
    }, PERSISTENT_STATUS_MIN_INTERVAL_MS - elapsed);
  }
};

export const stopMobilePersistentStatus = async (): Promise<void> => {
  if (!isCapacitor()) return;

  try {
    await QortalBackground.stopPersistentStatus();
  } catch (error) {
    console.error('[mobileBackgroundService] Failed to stop persistent status', error);
  }
};

export const shouldShowBatteryOptimizationPrompt = async (): Promise<boolean> => {
  if (!isCapacitor()) return false;

  const dismissed = await Preferences.get({ key: BATTERY_PROMPT_DISMISSED_KEY });
  if (dismissed.value === '1') return false;

  try {
    const { ignoring } = await QortalBackground.isIgnoringBatteryOptimizations();
    return !ignoring;
  } catch {
    return true;
  }
};

export const dismissBatteryOptimizationPrompt = async (): Promise<void> => {
  await Preferences.set({ key: BATTERY_PROMPT_DISMISSED_KEY, value: '1' });
};

export const requestIgnoreBatteryOptimizations = async (): Promise<void> => {
  await QortalBackground.requestIgnoreBatteryOptimizations();
};

export const openAppBatterySettings = async (): Promise<void> => {
  await QortalBackground.openAppBatterySettings();
};

export const reticulumStatusKind = (
  phase: ReticulumPhase,
  bridgeReady: boolean,
  onlineCount = 0,
  deviceOnline = true
): ReticulumStatusKind => {
  const display = reticulumDisplayPhase(phase, onlineCount, deviceOnline);
  if (display === 'error' || display === 'offline') return 'offline';
  if (display === 'online' && bridgeReady) return 'online';
  return 'starting';
};

export const reticulumPhaseLabel = (
  phase: ReticulumPhase,
  bridgeReady: boolean,
  onlineCount = 0,
  deviceOnline = true
): string => {
  if (!deviceOnline) return 'Reticulum offline';
  if (!bridgeReady) return 'Reticulum starting';
  const display = reticulumDisplayPhase(phase, onlineCount, deviceOnline);
  switch (display) {
    case 'online':
      return 'Reticulum online';
    case 'connecting':
      return 'Reticulum connecting';
    case 'starting':
      return 'Reticulum starting';
    case 'offline':
    case 'error':
      return 'Reticulum offline';
    default:
      return 'Reticulum starting';
  }
};

export const subscribeMobilePersistentStatusUpdates = (
  getExtras: () => PersistentStatusExtras,
  onUpdate: (snapshot: PersistentStatusSnapshot) => void
): { unsubscribe: () => void; publish: () => void } => {
  let bridgeReady = false;
  let reticulumPhase: ReticulumPhase = 'idle';
  let deviceOnline = getDeviceOnline();

  const publish = (): void => {
    const extras = getExtras();
    const label = reticulumPhaseLabel(
      reticulumPhase,
      bridgeReady,
      extras.onlineCount,
      deviceOnline
    );
    const kind = reticulumStatusKind(
      reticulumPhase,
      bridgeReady,
      extras.onlineCount,
      deviceOnline
    );
    onUpdate({
      reticulumLabel: label,
      reticulumKind: kind,
      ...extras,
    });
  };

  const unsubBridge = onMobileReticulumStatus((status) => {
    bridgeReady = status.bridgeState === 'ready';
    publish();
  });

  const unsubReticulum = subscribeReticulumStatus((state) => {
    reticulumPhase = state.phase;
    publish();
  });

  const unsubDevice = subscribeDeviceOnline((online) => {
    deviceOnline = online;
    publish();
  });

  publish();

  return {
    publish,
    unsubscribe: () => {
      unsubBridge();
      unsubReticulum();
      unsubDevice();
    },
  };
};
