/**
 * GO on the public node: notices when ext-node.qortal.link stops answering
 * and drives the "public node unavailable" window (PublicNodeDownWindow).
 *
 * Nothing polls while the node answers. GO's own traffic says how it is: the
 * node status socket's pongs (every 20 s on screen) and node fetches that
 * come back, against ones that fail with no answer or an nginx 502/503/504.
 * A sign of trouble is checked with /admin/status before anything is shown
 * (a quick failure is asked twice: ext-node gives a lone 502 now and then).
 * Once the node is down, GO asks every few seconds, only while on screen,
 * until it answers again.
 *
 * Opening a Q-App or website while the node is known to be down holds it:
 * the window names the app, and GO opens it when the node is back or the user
 * moves to another node. With no recent answer, the app opens at once and is
 * checked behind it; if the node is down, the window says so and GO reloads
 * the app when it is back.
 *
 * Kept free of React, jotai and background.ts so the avatar cache can report
 * through it; PublicNodeDownWindow configures it and shows the window.
 */
import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isPublicGatewayNodeUrl,
} from '../constants/constants';

type PublicNodeHealth = 'unknown' | 'up' | 'down';

interface PublicNodeApp {
  service: string;
  name: string;
  /** 'open': held, opens when the node is back; 'reload': opened, reloads. */
  kind: 'open' | 'reload';
}

export interface PublicNodeWindow {
  key: number;
  /** 'app': the user opened a Q-App or website; 'qdn': GO's own loading. */
  reason: 'app' | 'qdn';
  phase: 'down' | 'back';
  app: PublicNodeApp | null;
}

interface PublicNodeSnapshot {
  health: PublicNodeHealth;
  window: PublicNodeWindow | null;
  checking: boolean;
  /** When the next check runs while the node is down (ms epoch). */
  nextCheckAt: number | null;
}

type PublicNodeCheck = 'up' | 'down' | 'offline';

interface PublicNodeWatchConfig {
  /** The node GO uses now; null before GO knows. */
  nodeUrl: () => string | null | undefined;
  /** False when the phone has no network: that says nothing about the node. */
  deviceOnline: () => boolean;
  isVisible: () => boolean;
}

/** A node answer this recent lets a Q-App open without asking first. */
const ANSWER_FRESH_MS = 45_000;
const PROBE_TIMEOUT_MS = 8_000;
/** A quick failure is asked once more after this. */
export const CONFIRM_RETRY_MS = 800;
/** Failed loads ask the node at most this often. */
const TROUBLE_PROBE_GAP_MS = 15_000;
/** While the node is down: the waits between checks (the last one repeats). */
export const WATCH_INTERVALS_MS = [
  4_000, 6_000, 10_000, 15_000, 20_000, 30_000,
];
/** A held app opens if the node is back within this; later it would surprise. */
export const OPEN_WAIT_MAX_MS = 2 * 60_000;
const RELOAD_WAIT_MAX_MS = 10 * 60_000;
/** How long "Public node is back" stays before the window goes. */
export const BACK_SHOWN_MS = 1_600;
/** The window for GO's own loading comes back at most this often. */
const QDN_REPEAT_GAP_MS = 10 * 60_000;
const QDN_NOTICE_HIDDEN_KEY = 'go_public_node_down_qdn_hidden';

const PUBLIC_ORIGIN = new URL(HTTPS_EXT_NODE_QORTAL_LINK).origin;

const defaultConfig = (): PublicNodeWatchConfig => ({
  nodeUrl: () => null,
  deviceOnline: () => true,
  isVisible: () => typeof document === 'undefined' || !document.hidden,
});

type Waiting = PublicNodeApp & { run: () => void; since: number };

let config: PublicNodeWatchConfig = defaultConfig();
let enabled = false;
let health: PublicNodeHealth = 'unknown';
let lastAnswerAt = 0;
let probing: Promise<PublicNodeCheck> | null = null;
let lastTroubleProbeAt = Number.NEGATIVE_INFINITY;
let watchTimer: ReturnType<typeof setTimeout> | null = null;
let watchStep = 0;
let nextCheckAt: number | null = null;
let windowState: PublicNodeWindow | null = null;
let windowKey = 0;
let backTimer: ReturnType<typeof setTimeout> | null = null;
let waiting: Waiting | null = null;
let qdnShownThisOutage = false;
let lastQdnShownAt = Number.NEGATIVE_INFINITY;
/** Bumped when the node or the session changes: late answers are dropped. */
let generation = 0;
let visibilityBound = false;

const listeners = new Set<() => void>();
let snapshot: PublicNodeSnapshot = buildSnapshot();

function buildSnapshot(): PublicNodeSnapshot {
  return {
    health,
    window: windowState,
    checking: probing !== null,
    nextCheckAt,
  };
}

function emit() {
  snapshot = buildSnapshot();
  listeners.forEach((listener) => listener());
}

export function subscribePublicNodeWatch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPublicNodeSnapshot(): PublicNodeSnapshot {
  return snapshot;
}

export function configurePublicNodeWatch(
  next: Partial<PublicNodeWatchConfig>
): void {
  config = { ...config, ...next };
}

const isOnPublicNode = () => {
  const url = config.nodeUrl();
  return !!url && isPublicGatewayNodeUrl(url);
};

const isActive = () => enabled && isOnPublicNode();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** No answer from the node behind ext-node's nginx, or too busy to give one. */
const isNoAnswerStatus = (status: number) =>
  status >= 500 || status === 408 || status === 429;

async function askNode(): Promise<'up' | 'down'> {
  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<'down'>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve('down');
    }, PROBE_TIMEOUT_MS);
  });
  const asked = fetch(`${HTTPS_EXT_NODE_QORTAL_LINK}/admin/status`, {
    cache: 'no-store',
    credentials: 'omit',
    signal: controller?.signal,
  }).then(
    (response): 'up' | 'down' =>
      isNoAnswerStatus(response.status) ? 'down' : 'up',
    (): 'down' => 'down'
  );
  try {
    return await Promise.race([asked, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probe(): Promise<PublicNodeCheck> {
  if (!config.deviceOnline()) return 'offline';
  const startedAt = Date.now();
  if ((await askNode()) === 'up') return 'up';
  // A timeout already waited long enough; a quick failure gets one more ask.
  if (Date.now() - startedAt >= PROBE_TIMEOUT_MS) return 'down';
  await sleep(CONFIRM_RETRY_MS);
  if (!config.deviceOnline()) return 'offline';
  return askNode();
}

function clearWatchTimer() {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
  nextCheckAt = null;
}

function clearBackTimer() {
  if (backTimer) clearTimeout(backTimer);
  backTimer = null;
}

function scheduleWatch() {
  clearWatchTimer();
  if (!isActive() || health !== 'down' || !config.isVisible()) return;
  const delay =
    WATCH_INTERVALS_MS[Math.min(watchStep, WATCH_INTERVALS_MS.length - 1)];
  watchStep += 1;
  nextCheckAt = Date.now() + delay;
  watchTimer = setTimeout(() => {
    watchTimer = null;
    void checkPublicNodeNow();
  }, delay);
}

/** The waiting app, unless it has waited so long that opening it would surprise. */
function takeWaiting(): Waiting | null {
  const job = waiting;
  waiting = null;
  if (!job) return null;
  const max = job.kind === 'open' ? OPEN_WAIT_MAX_MS : RELOAD_WAIT_MAX_MS;
  return Date.now() - job.since <= max ? job : null;
}

function markUp() {
  lastAnswerAt = Date.now();
  const wasDown = health === 'down';
  health = 'up';
  watchStep = 0;
  clearWatchTimer();
  if (!wasDown && !waiting && windowState?.phase !== 'down') {
    emit();
    return;
  }
  qdnShownThisOutage = false;
  const job = takeWaiting();
  if (windowState?.phase === 'down') {
    windowState = { ...windowState, phase: 'back' };
    clearBackTimer();
    backTimer = setTimeout(() => {
      backTimer = null;
      windowState = null;
      emit();
    }, BACK_SHOWN_MS);
  }
  emit();
  // The app starts loading under "Public node is back".
  job?.run();
}

function markDown() {
  lastAnswerAt = 0;
  if (health !== 'down') {
    health = 'down';
    watchStep = 0;
    qdnShownThisOutage = false;
  }
  scheduleWatch();
  emit();
}

/** Asks the node now (one ask at a time; a running one is shared). */
export function checkPublicNodeNow(): Promise<PublicNodeCheck> {
  if (probing) return probing;
  const gen = generation;
  clearWatchTimer();
  const pending = probe().then((result) => {
    if (gen !== generation) return result;
    probing = null;
    if (result === 'up') markUp();
    else if (result === 'down') markDown();
    else {
      if (health === 'down') scheduleWatch();
      emit();
    }
    return result;
  });
  probing = pending;
  emit();
  return pending;
}

function openWindow(
  reason: PublicNodeWindow['reason'],
  app: PublicNodeApp | null
) {
  clearBackTimer();
  windowState =
    windowState?.phase === 'down'
      ? { ...windowState, reason, app: app ?? windowState.app }
      : { key: ++windowKey, reason, phase: 'down', app };
  emit();
}

function readQdnHidden(): boolean {
  try {
    return globalThis.localStorage?.getItem(QDN_NOTICE_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function isPublicNodeQdnNoticeHidden(): boolean {
  return readQdnHidden();
}

/** "Don't show again" for the window GO's own loading opens (not for apps). */
export function setPublicNodeQdnNoticeHidden(hidden: boolean): void {
  try {
    if (hidden) globalThis.localStorage?.setItem(QDN_NOTICE_HIDDEN_KEY, '1');
    else globalThis.localStorage?.removeItem(QDN_NOTICE_HIDDEN_KEY);
  } catch {
    /* the window still closes; it may come back next outage */
  }
}

function showQdnWindow() {
  if (!isActive() || health !== 'down' || windowState) return;
  if (qdnShownThisOutage || readQdnHidden() || !config.isVisible()) return;
  if (Date.now() - lastQdnShownAt < QDN_REPEAT_GAP_MS) return;
  qdnShownThisOutage = true;
  lastQdnShownAt = Date.now();
  openWindow('qdn', null);
}

/** The public node answered something: a socket pong, a fetch that came back. */
export function notePublicNodeAnswered(nodeUrl?: string | null): void {
  if (!isPublicGatewayNodeUrl(nodeUrl ?? undefined)) return;
  if (health === 'down') {
    // One answer while down: make sure before saying it is back.
    if (isActive()) void checkPublicNodeNow();
    return;
  }
  lastAnswerAt = Date.now();
  if (health !== 'up') {
    health = 'up';
    emit();
  }
}

/** The node status socket closed on its own: the last answer no longer counts. */
export function notePublicNodeSilent(nodeUrl?: string | null): void {
  if (!isPublicGatewayNodeUrl(nodeUrl ?? undefined)) return;
  lastAnswerAt = 0;
}

/** A load from the public node got no answer; checked before anything shows. */
export function reportPublicNodeTrouble(): void {
  if (!isActive()) return;
  if (health === 'down') {
    showQdnWindow();
    return;
  }
  if (probing) return;
  const now = Date.now();
  if (now - lastTroubleProbeAt < TROUBLE_PROBE_GAP_MS) return;
  lastTroubleProbeAt = now;
  void checkPublicNodeNow().then((result) => {
    if (result === 'down') showQdnWindow();
  });
}

interface PublicNodeOpenTarget {
  service: string;
  name: string;
}

/**
 * Before a Q-App or website opens from the node. false: the public node is
 * down; the window names the app and `retry` opens it once the node is back
 * (or once the user moves to another node).
 */
export function beforePublicNodeOpen(
  target: PublicNodeOpenTarget & { retry: () => void }
): boolean {
  if (!isActive() || health !== 'down') return true;
  const app: PublicNodeApp = {
    service: target.service,
    name: target.name,
    kind: 'open',
  };
  waiting = { ...app, run: target.retry, since: Date.now() };
  openWindow('app', app);
  // It may be back already; then the app opens straight away.
  void checkPublicNodeNow();
  return false;
}

/**
 * After a Q-App or website opened. Without a recent answer from the node it
 * is checked behind the app; if the node is down, the window says so and
 * `reload` runs once the node is back.
 */
export function afterPublicNodeOpen(
  target: PublicNodeOpenTarget & { reload: () => void }
): void {
  if (!isActive() || health === 'down') return;
  if (Date.now() - lastAnswerAt < ANSWER_FRESH_MS) return;
  const gen = generation;
  void checkPublicNodeNow().then((result) => {
    if (result !== 'down' || gen !== generation || !isActive()) return;
    const app: PublicNodeApp = {
      service: target.service,
      name: target.name,
      kind: 'reload',
    };
    waiting = { ...app, run: target.reload, since: Date.now() };
    openWindow('app', app);
  });
}

/** "Wait", back, a tap outside or a pull down: the window goes, GO keeps checking. */
export function waitForPublicNode(): void {
  if (!windowState) return;
  clearBackTimer();
  windowState = null;
  emit();
}

function resetState() {
  generation += 1;
  probing = null;
  clearWatchTimer();
  clearBackTimer();
  health = 'unknown';
  lastAnswerAt = 0;
  lastTroubleProbeAt = Number.NEGATIVE_INFINITY;
  watchStep = 0;
  qdnShownThisOutage = false;
  windowState = null;
}

/**
 * The user picked another node. An app that waited for the public node opens
 * on the new one (or reloads there).
 */
export function publicNodeUrlChanged(): void {
  const job = enabled && !isOnPublicNode() ? takeWaiting() : null;
  waiting = null;
  resetState();
  emit();
  job?.run();
}

const onVisibilityChange = () => {
  if (!enabled || health !== 'down') return;
  if (!config.isVisible()) {
    clearWatchTimer();
    emit();
    return;
  }
  void checkPublicNodeNow();
};

/** On while signed in on GO's main window; off resets everything. */
export function setPublicNodeWatchEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  if (typeof document !== 'undefined') {
    if (next && !visibilityBound) {
      document.addEventListener('visibilitychange', onVisibilityChange);
      visibilityBound = true;
    } else if (!next && visibilityBound) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      visibilityBound = false;
    }
  }
  if (!next) {
    waiting = null;
    resetState();
  }
  emit();
}

const requestUrl = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  const url = (input as { url?: unknown } | null)?.url;
  return typeof url === 'string' ? url : '';
};

const isPublicNodeRequest = (input: unknown) => {
  try {
    return new URL(requestUrl(input)).origin === PUBLIC_ORIGIN;
  } catch {
    return false;
  }
};

/** nginx in front of ext-node answers these when the node behind it is gone. */
const isGatewayError = (status: number) =>
  status === 502 || status === 503 || status === 504;

/**
 * Wraps a fetch so loads from the public node tell the watch how it is.
 * Aborted loads (timeouts the caller set, a closed screen) say nothing.
 */
export function observePublicNodeFetch<
  F extends (input: any, init?: any) => Promise<Response>,
>(fetchImpl: F): F {
  return (async (input: any, init?: any) => {
    if (!isPublicNodeRequest(input)) return fetchImpl(input, init);
    try {
      const response = await fetchImpl(input, init);
      if (isGatewayError(response.status)) reportPublicNodeTrouble();
      else notePublicNodeAnswered();
      return response;
    } catch (error) {
      const aborted =
        init?.signal?.aborted || (error as Error | null)?.name === 'AbortError';
      if (!aborted) reportPublicNodeTrouble();
      throw error;
    }
  }) as F;
}

/** Tests only. */
export function resetPublicNodeWatchForTests(): void {
  setPublicNodeWatchEnabled(false);
  config = defaultConfig();
  waiting = null;
  resetState();
  windowKey = 0;
  lastQdnShownAt = Number.NEGATIVE_INFINITY;
  listeners.clear();
  snapshot = buildSnapshot();
}
