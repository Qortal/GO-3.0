import { Preferences } from '@capacitor/preferences';
import i18n from '../i18n/i18n';
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
/** Epoch ms until which 'Not now' keeps the boot battery prompt away. */
const BATTERY_PROMPT_SNOOZED_UNTIL_KEY =
  'hub_mobile_battery_prompt_snoozed_until';
export const BATTERY_PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

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

  installNativeLocalizedStrings();
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
  if (payloadJson === lastSentStatusJson) {
    // Back to what the notification shows: a change still waiting for the
    // rate limit is out of date now and must not be sent after it.
    if (pendingStatusTimer) {
      clearTimeout(pendingStatusTimer);
      pendingStatusTimer = null;
    }
    pendingStatusPayload = null;
    return;
  }

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

export const shouldShowBatteryOptimizationPrompt = async (
  now: number = Date.now()
): Promise<boolean> => {
  if (!isCapacitor()) return false;

  try {
    const dismissed = await Preferences.get({
      key: BATTERY_PROMPT_DISMISSED_KEY,
    });
    if (dismissed.value === '1') return false;
    const snoozed = await Preferences.get({
      key: BATTERY_PROMPT_SNOOZED_UNTIL_KEY,
    });
    const until = Number(snoozed.value);
    // A clock set back by more than the snooze must not hide it for good.
    if (
      snoozed.value &&
      Number.isFinite(until) &&
      now < until &&
      until - now <= BATTERY_PROMPT_SNOOZE_MS
    ) {
      return false;
    }
  } catch {
    // Unreadable preferences: fall through to the exemption check.
  }

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

/** 'Not now': keep the boot prompt away for 14 days, not just this start. */
export const snoozeBatteryOptimizationPrompt = async (
  now: number = Date.now()
): Promise<void> => {
  try {
    await Preferences.set({
      key: BATTERY_PROMPT_SNOOZED_UNTIL_KEY,
      value: String(now + BATTERY_PROMPT_SNOOZE_MS),
    });
  } catch (error) {
    console.warn(
      '[mobileBackgroundService] Could not snooze battery prompt',
      error
    );
  }
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

// Texts the native side draws on its own (the status notification while the
// page is frozen, the 'GO paused' notice after Android's time limit or GO's
// own 6 h battery limit): native key -> i18n key.
const NATIVE_TEXT_KEYS = {
  status_paused_title: 'core:background_sync.native.status_paused_title',
  status_paused_text: 'core:background_sync.native.status_paused_text',
  status_waiting_text: 'core:background_sync.native.status_waiting_text',
  status_waiting_short: 'core:background_sync.native.status_waiting_short',
  fgs_timeout_title: 'core:background_sync.native.fgs_timeout_title',
  fgs_timeout_text: 'core:background_sync.native.fgs_timeout_text',
  battery_pause_text: 'core:background_sync.native.battery_pause_text',
  status_syncing_background:
    'core:background_sync.native.status_syncing_background',
} as const;

/** Current-language texts; `{{count}}` stays literal for native to fill. */
export const buildNativeLocalizedStrings = (): Record<string, string> => {
  const strings: Record<string, string> = {};
  for (const [nativeKey, key] of Object.entries(NATIVE_TEXT_KEYS)) {
    // i18next returns the bare key path (no namespace) for a missing key, so
    // test presence explicitly; never hand a raw key to a system notification.
    if (!i18n.exists(key)) continue;
    const value = i18n.t(key, { skipInterpolation: true } as never);
    if (typeof value === 'string' && value) {
      strings[nativeKey] = value;
    }
  }
  return strings;
};

let lastNativeStringsJson = '';
let nativeStringsInstalled = false;

/** Push the texts when they differ from the last push. Native only. */
export const pushNativeLocalizedStrings = (): void => {
  if (!isCapacitor()) return;
  const strings = buildNativeLocalizedStrings();
  const json = JSON.stringify(strings);
  if (json === lastNativeStringsJson) return;
  lastNativeStringsJson = json;
  // An older APK lacks the method (or rejects it); native keeps English.
  if (typeof QortalBackground.setLocalizedStrings !== 'function') return;
  try {
    void Promise.resolve(
      QortalBackground.setLocalizedStrings({ strings })
    ).catch((error) => {
      console.warn(
        '[mobileBackgroundService] setLocalizedStrings failed',
        error
      );
    });
  } catch (error) {
    console.warn('[mobileBackgroundService] setLocalizedStrings failed', error);
  }
};

/**
 * Push the native texts now and again on every language switch. A language
 * whose bundle is still loading resolves to English first; its 'added' event
 * pushes the real texts. Idempotent. Native only.
 */
export const installNativeLocalizedStrings = (): void => {
  if (!isCapacitor() || nativeStringsInstalled) return;
  nativeStringsInstalled = true;
  i18n.on('languageChanged', () => pushNativeLocalizedStrings());
  i18n.store?.on('added', (lng: string, ns: string) => {
    const current = (i18n.language || '').split('-')[0];
    if (ns === 'core' && lng === current) pushNativeLocalizedStrings();
  });
  pushNativeLocalizedStrings();
};

let outboxCountReported: number | null = null;
let outboxCountChain: Promise<void> = Promise.resolve();

/**
 * Own messages waiting to send, for the native status text. Changes only,
 * in order; harmless on an APK without the method. Native only.
 */
export const reportOwnOutboxCount = (count: number): void => {
  if (!isCapacitor()) return;
  const next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (next === outboxCountReported) return;
  outboxCountReported = next;
  installNativeLocalizedStrings();
  if (typeof QortalBackground.setOutboxCount !== 'function') return;
  outboxCountChain = outboxCountChain
    .then(() => QortalBackground.setOutboxCount({ count: next }))
    .then(() => undefined)
    .catch((error) => {
      console.warn('[mobileBackgroundService] setOutboxCount failed', error);
    });
};
