import type { SelectableStatus } from '../atoms/presence';

/**
 * The status the user picks (Online / Busy / Offline) follows the account
 * across its own devices, GO and Hub, through the chat engine's signed
 * device-state records (the same `ds1` sync the notification settings use).
 * Only a pick in the status picker is published; the automatic Idle stays
 * per device, and the presence network already shows an account with its
 * most available device.
 */
export const PRESENCE_STATUS_STATE_KEY = 'presence.status';

/** Event the status pickers fire when the user picks a status. */
export const PRESENCE_STATUS_CHOSEN_EVENT = 'presence-status-chosen';

const RETRY_MS = 5_000;
const MAX_ATTEMPTS = 12;
const READINESS_POLL_MS = 5_000;

export function parsePresenceStatusValue(
  value: string | null | undefined
): SelectableStatus | null {
  return value === 'online' || value === 'busy' || value === 'offline'
    ? value
    : null;
}

type ReadinessState = 'idle' | 'starting' | 'ready' | 'failed';

export type PresenceStatusSyncChat = {
  getReadinessStatus: () => Promise<{
    state: ReadinessState;
    revision: number;
  }>;
  onReadinessChanged?: (
    cb: (status: { state: ReadinessState; revision: number }) => void
  ) => () => void;
  setDeviceState: (
    ownerAddress: string,
    key: string,
    value: string | null
  ) => Promise<{ success: boolean; error?: string }>;
  getDeviceStates: (
    ownerAddress: string,
    keyPrefix?: string
  ) => Promise<Array<{ key: string; value: string | null }>>;
  onDeviceStateChanged: (
    cb: (payload: {
      ownerAddress: string;
      key: string;
      value: string | null;
      source: 'local' | 'remote';
    }) => void
  ) => () => void;
};

export type PresenceStatusSyncOptions = {
  address: string;
  chat: PresenceStatusSyncChat;
  getStatus: () => SelectableStatus;
  applyStatus: (status: SelectableStatus) => void;
};

/**
 * Keeps this device's chosen status and the account's synced one together.
 * A pick made here before the engine is ready is published once it is, and
 * then wins over what the engine held (the engine signs local writes newer
 * than anything it has seen).
 */
export class PresenceStatusSyncController {
  private readonly options: PresenceStatusSyncOptions;
  private disposed = false;
  private ready = false;
  /** Newest readiness seen; the engine bumps it on every state change. */
  private latestRevision = -1;
  private hydratedRevision: number | null = null;
  /** A local pick the engine has not accepted yet. */
  private unsynced: SelectableStatus | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(options: PresenceStatusSyncOptions) {
    this.options = options;
  }

  start(): void {
    const { chat, address } = this.options;
    this.unsubscribers.push(
      chat.onDeviceStateChanged((payload) => {
        if (this.disposed || payload.source !== 'remote') return;
        if (payload.ownerAddress !== address) return;
        if (payload.key !== PRESENCE_STATUS_STATE_KEY) return;
        // Our own pick is about to be published and will win anyway.
        if (this.unsynced) return;
        this.applyRemote(payload.value);
      })
    );
    const unsubscribeReadiness = chat.onReadinessChanged?.((status) =>
      this.onReadiness(status)
    );
    if (unsubscribeReadiness) this.unsubscribers.push(unsubscribeReadiness);
    this.pollTimer = setInterval(
      () => void this.pollReadiness(),
      READINESS_POLL_MS
    );
    void this.pollReadiness();
  }

  /** The user picked `status` on this device. */
  onLocalChoice(status: SelectableStatus): void {
    if (this.disposed) return;
    this.unsynced = status;
    this.attempts = 0;
    this.clearRetry();
    if (this.ready) void this.publish();
  }

  dispose(): void {
    this.disposed = true;
    this.clearRetry();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
  }

  private async pollReadiness(): Promise<void> {
    try {
      this.onReadiness(await this.options.chat.getReadinessStatus());
    } catch {
      // Engine not reachable yet; the next poll tries again.
    }
  }

  private onReadiness(status: { state: ReadinessState; revision: number }) {
    if (this.disposed) return;
    // A poll sent before the last push can answer after it.
    if (status.revision < this.latestRevision) return;
    this.latestRevision = status.revision;
    this.ready = status.state === 'ready';
    if (!this.ready) return;
    // Hydrate once per engine start.
    if (this.hydratedRevision === status.revision) return;
    this.hydratedRevision = status.revision;
    void this.hydrate();
  }

  private async hydrate(): Promise<void> {
    if (this.unsynced) {
      await this.publish();
      return;
    }
    try {
      const { chat, address } = this.options;
      const records = await chat.getDeviceStates(
        address,
        PRESENCE_STATUS_STATE_KEY
      );
      if (this.disposed || this.unsynced) return;
      const record = records.find(
        (entry) => entry.key === PRESENCE_STATUS_STATE_KEY
      );
      if (record) this.applyRemote(record.value);
    } catch {
      // Hydrated again on the next engine start.
      this.hydratedRevision = null;
    }
  }

  private applyRemote(value: string | null): void {
    const status = parsePresenceStatusValue(value);
    if (!status || status === this.options.getStatus()) return;
    this.options.applyStatus(status);
  }

  private async publish(): Promise<void> {
    const status = this.unsynced;
    if (!status || this.disposed) return;
    this.attempts += 1;
    let success = false;
    try {
      const { chat, address } = this.options;
      const result = await chat.setDeviceState(
        address,
        PRESENCE_STATUS_STATE_KEY,
        status
      );
      success = result?.success === true;
    } catch {
      success = false;
    }
    if (this.disposed || this.unsynced !== status) return;
    if (success) {
      this.unsynced = null;
      return;
    }
    if (this.attempts >= MAX_ATTEMPTS) {
      // Keep the pick on this device; the next pick tries again, and a pick
      // on another device applies here again.
      this.unsynced = null;
      return;
    }
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.publish();
    }, RETRY_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
