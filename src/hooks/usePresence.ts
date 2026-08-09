import { useCallback, useEffect, useRef } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { extStateAtom, userInfoAtom } from '../atoms/global';
import {
  appLockedAtom,
  isIdleAtom,
  isOnlineAtomFamily,
  myStatusAtom,
  onlineAddressesAtom,
  SelectableStatus,
  statusAtomFamily,
  statusMapAtom,
  UserStatus,
} from '../atoms/presence';
import { QortalBackground } from '../plugins/QortalBackground';
import { isCapacitor } from '../utils/platform';
import {
  createCompactWireId,
  createRouteBoundId,
  routeBoundIdMatchesDestination,
} from '../lib/reticulum/routeBoundId';

// ── Constants ─────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 25_000;
/** Retry a failed announce this often until it succeeds (transport may still be booting). */
const ANNOUNCE_RETRY_MS = 15_000;
/** Consecutive heartbeat publish failures before falling back to a fresh announce. */
const HEARTBEAT_FAIL_REANNOUNCE_THRESHOLD = 2;
const IDLE_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 60_000; // check once per minute
const CLIENT_VERSION = '1.0.0';
/** Wait for outbound Reticulum hubs (excludes local mesh listen) before first announce. */
const REMOTE_RETICULUM_HUB_MIN_ONLINE = 2;
const REMOTE_RETICULUM_HUB_POLL_MS = 500;
const REMOTE_RETICULUM_HUB_MAX_WAIT_MS = 90_000;
// Repeat an explicit offline envelope across most of the 95-second presence
// liveness window so temporary route loss cannot leave a stale online session.
const OFFLINE_PROPAGATION_RETRY_DELAYS_MS = [2_000, 10_000, 30_000, 70_000];

// ── Helpers ───────────────────────────────────────────────────────────────────

type RemoteHubWaitResult = 'ready' | 'cancelled' | 'timeout';

/**
 * Blocks until `onlineRemoteHubInterfaces >= REMOTE_RETICULUM_HUB_MIN_ONLINE` or timeout.
 * Skipped when not in Electron.
 * @returns `cancelled` if `shouldCancel` is true before announcing; `timeout` if hubs never came up.
 */
async function waitForOnlineRemoteReticulumHub(
  shouldCancel: () => boolean
): Promise<RemoteHubWaitResult> {
  const getStatus = window.electronAPI?.reticulumGetStatus;
  if (typeof getStatus !== 'function') {
    return 'ready';
  }
  const deadline = Date.now() + REMOTE_RETICULUM_HUB_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (shouldCancel()) return 'cancelled';
    try {
      const status = await getStatus();
      const n = status.onlineRemoteHubInterfaces ?? 0;
      if (n >= REMOTE_RETICULUM_HUB_MIN_ONLINE) return 'ready';
    } catch {
      // Bridge may be warming up; retry.
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, REMOTE_RETICULUM_HUB_POLL_MS);
    });
  }
  console.warn(
    `[Presence] Timed out waiting for ${REMOTE_RETICULUM_HUB_MIN_ONLINE} remote Reticulum hubs; announcing presence anyway.`
  );
  return 'timeout';
}

/**
 * Local Reticulum destination hash, used to bind the presence session to the
 * route peers will answer on. Desktop exposes it over `electronAPI`; mobile
 * deliberately leaves that bridge undefined and caches the value the python
 * bridge reports on its `ready` frame instead.
 */
async function resolveLocalDestinationHash(): Promise<string | null> {
  const getLocalDestinationHash =
    window.electronAPI?.reticulumGetLocalDestinationHash;
  if (typeof getLocalDestinationHash === 'function') {
    const result = await getLocalDestinationHash();
    return result?.destinationHash ?? null;
  }
  return window.__qortalMobileReticulum?.destinationHash ?? null;
}

async function signPresenceFields(
  fields: Record<string, unknown>
): Promise<string> {
  const result = await (window as any).sendMessage(
    'signPresenceMessage',
    fields,
    10_000
  );
  if (result?.error) throw new Error(result.error);
  return result.signature as string;
}

function buildEnvelope(
  type: PresenceEnvelope['type'],
  payload: PresenceEnvelope['payload'],
  timestamp: number,
  signature: string
): PresenceEnvelope {
  return {
    id: createCompactWireId(),
    type,
    senderAddress: payload.address,
    timestamp,
    payload,
    signature,
  };
}

/**
 * Maps a UserStatus (or null) to a presence-badge dot colour.
 * Exported so all components share the same colour scheme.
 * `null` and `'offline'` render as Discord-style grey offline indicators.
 */
export function statusDotColor(status: string | null): string {
  if (status === null || status === 'offline') return '#80848e';
  if (status === 'busy') return '#f23f43';
  if (status === 'idle') return '#f0b232';
  return '#23a55a'; // online or any non-null fallback
}

export function buildPresenceSnapshot(sessions: PresenceSession[]): {
  onlineAddresses: Set<string>;
  statusMap: Map<string, UserStatus>;
} {
  const onlineAddresses = new Set<string>();
  const latestStatusByAddress = new Map<
    string,
    { status: UserStatus; lastSeen: number }
  >();

  for (const session of sessions) {
    onlineAddresses.add(session.address);
    const nextStatus = session.status as UserStatus;
    const previous = latestStatusByAddress.get(session.address);
    if (!previous || session.lastSeen > previous.lastSeen) {
      latestStatusByAddress.set(session.address, {
        status: nextStatus,
        lastSeen: session.lastSeen,
      });
    }
  }

  const statusMap = new Map<string, UserStatus>();
  for (const [address, value] of latestStatusByAddress.entries()) {
    statusMap.set(address, value.status);
  }

  return { onlineAddresses, statusMap };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages the full presence lifecycle for the authenticated local user:
 *   • Announces presence after login once at least two remote Reticulum hubs are up
 *     (waits up to 90s, then announces anyway).
 *   • Sends a heartbeat every 25 s to keep the session alive.
 *   • Sends an offline notice when the user logs out, the component unmounts,
 *     or the user explicitly picks "Offline" in the status picker.
 *   • Re-announces when the user switches back from "Offline".
 *   • Automatically switches to `'idle'` status after 30 minutes of no input,
 *     and reverts the moment any input event is detected.
 *   • Subscribes to presence updates from the network and keeps
 *     `onlineAddressesAtom` and `statusMapAtom` in sync.
 *
 * Call this once at the App level.
 */
export function usePresence(): {
  sendOfflineBeforeLogout: () => Promise<void>;
} {
  const extState = useAtomValue(extStateAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const setOnlineAddresses = useSetAtom(onlineAddressesAtom);
  const setStatusMap = useSetAtom(statusMapAtom);
  const [myStatus, setMyStatus] = useAtom(myStatusAtom);
  const setIsIdle = useSetAtom(isIdleAtom);
  const appLocked = useAtomValue(appLockedAtom);

  const sessionIdRef = useRef<string | null>(null);
  const heartbeatActiveRef = useRef(false);
  const idleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingPresenceBootstrapRef = useRef<Promise<boolean> | null>(null);
  const hasAnnouncedRef = useRef(false);
  const heartbeatInFlightRef = useRef(false);
  const offlinePropagationTimersRef = useRef<
    Array<ReturnType<typeof setTimeout>>
  >([]);
  // Ref-only idle tracking — no state, no re-renders for the timer itself.
  const lastActivityRef = useRef<number>(Date.now());
  // When the last heartbeat actually went out — lets the native presence tick
  // skip redundant sends while the in-page interval is still running.
  const lastHeartbeatAtRef = useRef<number>(0);
  // Announce retry machinery: a failed announce (transport still booting,
  // signing busy, bridge command rejected, …) must never silently kill
  // outbound presence for the rest of the session.
  const announceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ensureAnnouncedRef = useRef<() => void>(() => {});
  const heartbeatFailStreakRef = useRef(0);
  const isIdleRef = useRef<boolean>(false);
  const appLockedRef = useRef<boolean>(appLocked);
  // Stable refs so all callbacks always read current values.
  const userInfoRef = useRef(userInfo);
  const myStatusRef = useRef<SelectableStatus>(myStatus);
  const isAuthenticatedRef = useRef(false);
  const isAppearedOfflineRef = useRef(false);

  const isAuthenticated = extState === 'authenticated';

  useEffect(() => {
    userInfoRef.current = userInfo;
  }, [userInfo]);
  useEffect(() => {
    myStatusRef.current = myStatus;
  }, [myStatus]);
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);
  useEffect(() => {
    appLockedRef.current = appLocked;
  }, [appLocked]);

  // ── Effective status ──────────────────────────────────────────────────────
  //
  // Returns the status that should be put on the wire right now.
  // Priority: offline > idle (automatic) > user's chosen status.

  const getEffectiveStatus = useCallback((): UserStatus | 'offline' => {
    const chosen = myStatusRef.current;
    if (chosen === 'offline') return 'offline';
    if (isIdleRef.current) return 'idle';
    return chosen as UserStatus;
  }, []);

  // ── Stable helpers ────────────────────────────────────────────────────────

  const stopHeartbeat = useCallback(() => {
    if (heartbeatActiveRef.current) {
      heartbeatActiveRef.current = false;
      window.presence?.stopHeartbeatScheduler?.().catch(() => {});
    }
  }, []);

  const clearOfflinePropagationRetries = useCallback(() => {
    for (const timer of offlinePropagationTimersRef.current) {
      clearTimeout(timer);
    }
    offlinePropagationTimersRef.current = [];
  }, []);

  const ensureRouteBoundSessionId = useCallback(async (): Promise<
    string | null
  > => {
    try {
      const destinationHash = (await resolveLocalDestinationHash())
        ?.trim()
        .toLowerCase();
      if (!destinationHash || !/^[0-9a-f]{32}$/.test(destinationHash)) {
        return null;
      }
      const current = sessionIdRef.current;
      if (
        current &&
        routeBoundIdMatchesDestination('presence', current, destinationHash)
      ) {
        return current;
      }
      const next = createRouteBoundId('presence', destinationHash);
      if (!next) return null;
      sessionIdRef.current = next;
      hasAnnouncedRef.current = false;
      return next;
    } catch {
      return null;
    }
  }, []);

  const sendOfflineCallback = useCallback(async (): Promise<void> => {
    const ui = userInfoRef.current;
    const sessionId = sessionIdRef.current;
    if (!ui?.address || !ui?.publicKey || !sessionId || !window.presence) {
      return;
    }
    try {
      const timestamp = Date.now();
      const signedFields = {
        address: ui.address,
        publicKey: ui.publicKey,
        sessionId,
        timestamp,
        type: 'PRESENCE_OFFLINE',
      };
      const signature = await signPresenceFields(signedFields);
      const payload: PresenceOfflinePayload = {
        address: ui.address,
        publicKey: ui.publicKey,
        sessionId,
        status: 'offline',
      };
      const result = await window.presence.offline(
        buildEnvelope('PRESENCE_OFFLINE', payload, timestamp, signature)
      );
      if (result?.success !== true) {
        console.warn('[Presence] Offline propagation was not accepted.');
      }
    } catch {
      // best-effort
    }
  }, []);

  const scheduleOfflinePropagationRetries = useCallback(() => {
    clearOfflinePropagationRetries();
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    offlinePropagationTimersRef.current =
      OFFLINE_PROPAGATION_RETRY_DELAYS_MS.map((delayMs) =>
        setTimeout(() => {
          if (
            !isAuthenticatedRef.current ||
            myStatusRef.current !== 'offline' ||
            sessionIdRef.current !== sessionId
          ) {
            return;
          }
          void sendOfflineCallback();
        }, delayMs)
      );
  }, [clearOfflinePropagationRetries, sendOfflineCallback]);

  const sendAnnounce = useCallback(async (): Promise<boolean> => {
    const ui = userInfoRef.current;
    const sessionId = await ensureRouteBoundSessionId();
    const statusVal = getEffectiveStatus();
    if (statusVal === 'offline') return false;
    if (!ui?.address || !ui?.publicKey || !sessionId || !window.presence) {
      // Capacitor's console bridge flattens objects to "[object Object]", so
      // the individual flags have to be inlined to survive the trip to logcat.
      console.warn(
        `[Presence] Announce preconditions unmet address=${Boolean(ui?.address)} publicKey=${Boolean(ui?.publicKey)} sessionId=${Boolean(sessionId)} bridge=${Boolean(window.presence)}`
      );
      return false;
    }
    const status = statusVal;
    try {
      const timestamp = Date.now();
      const signedFields = {
        address: ui.address,
        clientVersion: CLIENT_VERSION,
        publicKey: ui.publicKey,
        sessionId,
        status,
        timestamp,
        type: 'PRESENCE_ANNOUNCE',
      };
      const signature = await signPresenceFields(signedFields);
      const payload: PresenceAnnouncePayload = {
        address: ui.address,
        clientVersion: CLIENT_VERSION,
        publicKey: ui.publicKey,
        sessionId,
        status,
      };
      const result = await window.presence?.announce(
        buildEnvelope('PRESENCE_ANNOUNCE', payload, timestamp, signature)
      );
      // The bridge swallows transport errors and reports { success: false } —
      // treat that as a real failure so the retry loop can re-announce.
      if (!result?.success) {
        console.warn('[Presence] Announce publish reported failure');
        return false;
      }
      hasAnnouncedRef.current = true;
      heartbeatFailStreakRef.current = 0;
      return true;
    } catch (err) {
      console.error('[Presence] Announce failed:', err);
      return false;
    }
  }, [ensureRouteBoundSessionId, getEffectiveStatus]);

  const sendHeartbeat = useCallback(async (): Promise<boolean> => {
    if (heartbeatInFlightRef.current) return false;
    const ui = userInfoRef.current;
    const sessionId = await ensureRouteBoundSessionId();
    const statusVal = getEffectiveStatus();
    if (statusVal === 'offline') return false;
    if (!hasAnnouncedRef.current) {
      // Before the initial bootstrap, status/lock effects must not bypass the
      // remote-hub readiness wait. Once the scheduler is active, however, a
      // changed local Reticulum destination needs a fresh signed announce.
      return heartbeatActiveRef.current ? sendAnnounce() : false;
    }
    if (!ui?.address || !ui?.publicKey || !sessionId || !window.presence)
      return false;
    const status = statusVal;
    heartbeatInFlightRef.current = true;
    try {
      const timestamp = Date.now();
      const signedFields = {
        address: ui.address,
        publicKey: ui.publicKey,
        sessionId,
        status,
        timestamp,
        type: 'PRESENCE_HEARTBEAT',
      };
      const signature = await signPresenceFields(signedFields);
      const payload: PresenceHeartbeatPayload = {
        address: ui.address,
        publicKey: ui.publicKey,
        sessionId,
        status,
      };
      const result = await window.presence.heartbeat(
        buildEnvelope('PRESENCE_HEARTBEAT', payload, timestamp, signature)
      );
      if (!result?.success) {
        heartbeatFailStreakRef.current += 1;
        console.warn(
          `[Presence] Heartbeat publish reported failure (streak=${heartbeatFailStreakRef.current})`
        );
        if (heartbeatFailStreakRef.current >= HEARTBEAT_FAIL_REANNOUNCE_THRESHOLD) {
          // The transport is rejecting publishes — drop back to the announce
          // path so the retry loop can re-establish the session end to end.
          hasAnnouncedRef.current = false;
          stopHeartbeat();
          ensureAnnouncedRef.current();
        }
        return false;
      }
      heartbeatFailStreakRef.current = 0;
      lastHeartbeatAtRef.current = Date.now();
      return true;
    } catch (err) {
      console.error('[Presence] Heartbeat failed:', err);
      return false;
    } finally {
      heartbeatInFlightRef.current = false;
    }
  }, [ensureRouteBoundSessionId, getEffectiveStatus, sendAnnounce]);

  const announceWhenRemoteHubsReady = useCallback(
    (shouldCancel: () => boolean): Promise<boolean> => {
      if (heartbeatActiveRef.current && getEffectiveStatus() !== 'offline') {
        return Promise.resolve(true);
      }
      const pending = pendingPresenceBootstrapRef.current;
      if (pending) return pending;

      const task = (async (): Promise<boolean> => {
        const hubWait = await waitForOnlineRemoteReticulumHub(shouldCancel);
        if (hubWait === 'cancelled') return false;
        if (shouldCancel()) return false;
        const announced = await sendAnnounce();
        if (!announced) return false;
        stopHeartbeat();
        const startScheduler = window.presence?.startHeartbeatScheduler;
        if (typeof startScheduler !== 'function') {
          // Mobile has no main-process scheduler: the native `presenceTick`
          // listener below drives heartbeats instead, so the bootstrap is
          // complete once the announce lands.
          if (isCapacitor()) {
            heartbeatActiveRef.current = true;
            return true;
          }
          console.error('[Presence] Heartbeat scheduler API is unavailable.');
          heartbeatActiveRef.current = false;
          return false;
        }
        const schedulerResult = await startScheduler();
        if (!schedulerResult?.success) {
          console.error(
            '[Presence] Heartbeat scheduler failed to start:',
            schedulerResult
          );
          heartbeatActiveRef.current = false;
          return false;
        }
        heartbeatActiveRef.current = true;
        return true;
      })();

      pendingPresenceBootstrapRef.current = task;
      void task.finally(() => {
        if (pendingPresenceBootstrapRef.current === task) {
          pendingPresenceBootstrapRef.current = null;
        }
      });
      return task;
    },
    [getEffectiveStatus, sendAnnounce, sendHeartbeat, stopHeartbeat]
  );

  const clearAnnounceRetry = useCallback(() => {
    if (announceRetryTimerRef.current !== null) {
      clearTimeout(announceRetryTimerRef.current);
      announceRetryTimerRef.current = null;
    }
  }, []);

  /**
   * Announce with retries. A single failed announce (Reticulum bridge still
   * booting, signing worker busy right after unlock, native command rejected)
   * used to permanently disable outbound presence for the whole session —
   * peers could see us only if the very first attempt happened to succeed.
   * Keep retrying every ANNOUNCE_RETRY_MS until it works or we log out.
   */
  const ensureAnnounced = useCallback((): void => {
    if (!isAuthenticatedRef.current) return;
    if (hasAnnouncedRef.current) return;
    if (myStatusRef.current === 'offline') return;
    void (async () => {
      const ok = await announceWhenRemoteHubsReady(
        () => !isAuthenticatedRef.current || myStatusRef.current === 'offline'
      );
      if (ok || !isAuthenticatedRef.current || myStatusRef.current === 'offline') {
        return;
      }
      console.warn(
        `[Presence] Announce attempt failed; retrying in ${ANNOUNCE_RETRY_MS / 1000}s`
      );
      clearAnnounceRetry();
      announceRetryTimerRef.current = setTimeout(() => {
        announceRetryTimerRef.current = null;
        ensureAnnouncedRef.current();
      }, ANNOUNCE_RETRY_MS);
    })();
  }, [announceWhenRemoteHubsReady, clearAnnounceRetry]);

  useEffect(() => {
    ensureAnnouncedRef.current = ensureAnnounced;
  }, [ensureAnnounced]);
  useEffect(() => {
    if (!window.presence?.onHeartbeatRequested) return;
    return window.presence.onHeartbeatRequested(() => {
      console.log('[Presence] Heartbeat requested by main scheduler.');
      void sendHeartbeat();
    });
  }, [sendHeartbeat]);

  // ── Idle detection ────────────────────────────────────────────────────────
  //
  // All work happens in refs — only the atom write (on idle transition) causes
  // a React re-render, keeping this completely free of spurious updates.

  const onActivity = useCallback(() => {
    if (appLockedRef.current) {
      // Activity on the password screen must never wake or unlock the session.
      lastActivityRef.current = Date.now();
      return;
    }
    if (isIdleRef.current) {
      // Returning from idle: update timestamp and wake up.
      lastActivityRef.current = Date.now();
      isIdleRef.current = false;
      setIsIdle(false);
      if (isAuthenticatedRef.current) sendHeartbeat();
    } else {
      // Hot path (fires hundreds of times/s from mousemove): only write the
      // ref every 5 s. Precision needed is ~30 min, so 5 s is more than enough.
      const now = Date.now();
      if (now - lastActivityRef.current > 5_000) {
        lastActivityRef.current = now;
      }
    }
  }, [sendHeartbeat, setIsIdle]);

  // Locking forces the public presence to Idle. Unlocking starts a fresh idle
  // period and restores the user's chosen Online/Busy presence.
  useEffect(() => {
    appLockedRef.current = appLocked;
    if (!isAuthenticated || myStatusRef.current === 'offline') return;

    lastActivityRef.current = Date.now();
    if (appLocked) {
      if (!isIdleRef.current) {
        isIdleRef.current = true;
        setIsIdle(true);
      }
    } else if (isIdleRef.current) {
      isIdleRef.current = false;
      setIsIdle(false);
    }
    void sendHeartbeat();
  }, [appLocked, isAuthenticated, sendHeartbeat, setIsIdle]);

  // DOM activity listeners — always active so we catch pre-auth activity too.
  useEffect(() => {
    const EVENTS = [
      'mousemove',
      'keydown',
      'click',
      'touchstart',
      'wheel',
    ] as const;
    EVENTS.forEach((e) =>
      document.addEventListener(e, onActivity, { passive: true })
    );
    return () => {
      EVENTS.forEach((e) => document.removeEventListener(e, onActivity));
    };
  }, [onActivity]);

  // Idle check interval — only runs while authenticated, stops otherwise.
  useEffect(() => {
    if (!isAuthenticated) {
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current);
        idleCheckRef.current = null;
      }
      if (isIdleRef.current) {
        isIdleRef.current = false;
        setIsIdle(false);
      }
      return;
    }

    idleCheckRef.current = setInterval(() => {
      if (isIdleRef.current) return; // already idle
      if (myStatusRef.current === 'offline') return; // appearing offline
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        isIdleRef.current = true;
        setIsIdle(true);
        sendHeartbeat(); // broadcasts 'idle' to the network
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current);
        idleCheckRef.current = null;
      }
    };
  }, [isAuthenticated, sendHeartbeat, setIsIdle]);

  // ── Native presence tick (Android) ────────────────────────────────────────
  //
  // Android throttles WebView timers while the app is backgrounded, which
  // starves the 25 s heartbeat interval and makes this account go stale for
  // remote peers ("inbound still works, outbound presence dies"). The
  // foreground service emits a reliable native tick every 25 s; re-send the
  // heartbeat from it whenever the in-page interval has fallen behind.
  useEffect(() => {
    if (!isAuthenticated || !isCapacitor()) return undefined;
    const handlePromise = QortalBackground.addListener('presenceTick', () => {
      if (!isAuthenticatedRef.current) return;
      if (!hasAnnouncedRef.current) {
        // Announce never succeeded (or was demoted after repeated heartbeat
        // failures) — use the reliable native tick to keep retrying it.
        ensureAnnouncedRef.current();
        return;
      }
      if (Date.now() - lastHeartbeatAtRef.current < HEARTBEAT_INTERVAL_MS - 5_000) {
        return;
      }
      void sendHeartbeat();
    });
    return () => {
      void handlePromise.then((handle) => handle.remove()).catch(() => {});
    };
  }, [isAuthenticated, sendHeartbeat]);

  // ── Announce / offline lifecycle ──────────────────────────────────────────

  useEffect(() => {
    if (
      !isAuthenticated ||
      !userInfo?.address ||
      !userInfo?.publicKey ||
      !window.presence
    ) {
      // On logout, reset the atom to 'online' so the next login starts clean.
      // The status-change effect guards against sending an announce because
      // isAuthenticatedRef.current is already false by the time that effect runs.
      if (!isAuthenticated) {
        setMyStatus('online');
        myStatusRef.current = 'online';
        isAppearedOfflineRef.current = false;
        hasAnnouncedRef.current = false;
      }
      return;
    }

    sessionIdRef.current = null;
    hasAnnouncedRef.current = false;
    let cancelled = false;
    let staggerTimer: ReturnType<typeof setTimeout> | null = null;

    // Read any persisted 'offline' preference for this address before deciding
    // whether to announce.  All other statuses are ephemeral and default back
    // to 'online' on next login.
    (async () => {
      const stored = window.appStorage
        ? await window.appStorage.get(`presence-status:${userInfo.address}`)
        : null;
      if (cancelled) return;

      if (stored === 'offline') {
        // Set the flag BEFORE updating the atom so the status-change effect
        // (which watches `myStatus`) sees isAppearedOfflineRef=true and skips
        // sending an unnecessary OFFLINE message.
        isAppearedOfflineRef.current = true;
        hasAnnouncedRef.current = false;
        setMyStatus('offline');
        myStatusRef.current = 'offline';
        return;
      }

      // Non-offline path — proceed with announce + heartbeat.
      if (myStatusRef.current === 'offline') {
        isAppearedOfflineRef.current = true;
        hasAnnouncedRef.current = false;
        return;
      }

      isAppearedOfflineRef.current = false;
      // Stagger the first announce: it boots the embedded Python/RNS presence
      // bridge, and doing that at the same instant as the Kotlin transport
      // cold-boot (allowReticulumStart fires +400ms after auth) saturates the
      // CPU/JS bridge on mid-range devices — a cause of the first-launch ANR /
      // "stuck at splash" reports. Give the Kotlin transport a head start.
      staggerTimer = window.setTimeout(() => {
        staggerTimer = null;
        if (cancelled) return;
        ensureAnnounced();
      }, 2000);
    })();

    return () => {
      cancelled = true;
      if (staggerTimer) {
        window.clearTimeout(staggerTimer);
        staggerTimer = null;
      }
      clearAnnounceRetry();
      stopHeartbeat();
      clearOfflinePropagationRetries();
      void sendOfflineCallback();
    };
  }, [isAuthenticated, userInfo?.address, userInfo?.publicKey]);

  // ── React to explicit status changes from the picker ─────────────────────

  useEffect(() => {
    if (!isAuthenticatedRef.current) return;

    if (myStatus === 'offline') {
      if (!isAppearedOfflineRef.current) {
        isAppearedOfflineRef.current = true;
        hasAnnouncedRef.current = false;
        clearAnnounceRetry();
        stopHeartbeat();
        void sendOfflineCallback();
        scheduleOfflinePropagationRetries();
      }
    } else if (isAppearedOfflineRef.current) {
      clearOfflinePropagationRetries();
      void (async () => {
        const announced = await announceWhenRemoteHubsReady(
          () => !isAuthenticatedRef.current || myStatusRef.current === 'offline'
        );
        if (!announced) return;
        isAppearedOfflineRef.current = false;
      })();
    } else {
      clearOfflinePropagationRetries();
      const timer = setTimeout(sendHeartbeat, 300);
      return () => clearTimeout(timer);
    }
  }, [myStatus]);

  // ── Persist / clear 'offline' status keyed by address ────────────────────
  //
  // Only 'offline' is persisted — all other statuses are ephemeral and restore
  // to 'online' on next login.  Written/deleted whenever the authenticated
  // user changes their status.

  useEffect(() => {
    if (!isAuthenticated || !userInfo?.address) return;
    const key = `presence-status:${userInfo.address}`;
    if (myStatus === 'offline') {
      window.appStorage?.set(key, 'offline');
    } else {
      window.appStorage?.delete(key);
    }
  }, [myStatus, isAuthenticated, userInfo?.address]);

  // ── Subscribe to network presence updates ────────────────────────────────

  useEffect(() => {
    if (!window.presence) return;

    window.presence.getAllOnline().then((sessions) => {
      const snapshot = buildPresenceSnapshot(sessions);
      setOnlineAddresses(snapshot.onlineAddresses);
      setStatusMap(snapshot.statusMap);
    });

    const applyPresenceUpdates = (
      updates: Array<{
        address: string;
        online: boolean;
        status: UserStatus | null;
      }>
    ) => {
      if (updates.length === 0) return;
      unstable_batchedUpdates(() => {
        setOnlineAddresses((prev) => {
          const next = new Set(prev);
          for (const { address, online } of updates) {
            if (online) next.add(address);
            else next.delete(address);
          }
          return next;
        });
        setStatusMap((prev) => {
          const next = new Map(prev);
          for (const { address, online, status } of updates) {
            if (online && status) next.set(address, status);
            else next.delete(address);
          }
          return next;
        });
      });
    };

    const unsubscribe = window.presence.onUpdateBatch
      ? window.presence.onUpdateBatch(applyPresenceUpdates)
      : window.presence.onUpdate((payload) => {
          applyPresenceUpdates([payload]);
        });

    const unsubscribeCleared = window.presence.onCleared?.(() => {
      unstable_batchedUpdates(() => {
        setOnlineAddresses(new Set());
        setStatusMap(new Map());
      });
    });

    const unsubscribeStarted = window.presence.onStarted?.(() => {
      if (!isAuthenticatedRef.current) return;
      void announceWhenRemoteHubsReady(
        () => !isAuthenticatedRef.current || myStatusRef.current === 'offline'
      );
    });

    return () => {
      unsubscribe();
      unsubscribeCleared?.();
      unsubscribeStarted?.();
    };
  }, []);

  return { sendOfflineBeforeLogout: sendOfflineCallback };
}

// ── Component-level helpers ───────────────────────────────────────────────────

export function useIsOnline(address: string | null | undefined): boolean {
  const atom = isOnlineAtomFamily(address ?? '');
  const isOnline = useAtomValue(atom);
  if (!address) return false;
  return isOnline;
}

export function useStatus(
  address: string | null | undefined
): UserStatus | null {
  const atom = statusAtomFamily(address ?? '');
  const status = useAtomValue(atom);
  if (!address) return null;
  return status;
}

export function useOnlineAddresses(): Set<string> {
  return useAtomValue(onlineAddressesAtom);
}

export function useMyStatus(): [
  SelectableStatus,
  (s: SelectableStatus) => void,
] {
  return useAtom(myStatusAtom);
}
