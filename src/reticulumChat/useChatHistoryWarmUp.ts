/**
 * Warm chats (App.tsx, phones): reads the latest messages of the chats most
 * likely to be opened next, the most recently active groups and DMs, into
 * the warm cache (chatWarmCache.ts), so they open with their messages
 * already on screen. Runs while signed in and unlocked, in idle moments,
 * one read at a time, and again for a chat whose latest message changed;
 * never while a chat is open (that chat keeps itself current, and its own
 * reads and sends must not queue behind one of these).
 *
 * Messages come from the phone's own chat database only (group reads with
 * repairNetwork: false): no peers are asked. Sender names it does not know
 * yet are looked up once, from the user's own Qortal node (the lookup a chat
 * makes when it opens), so a chat opens with names instead of addresses.
 * Everything stays in memory and is emptied when this stops (lock, logout).
 */
import { useEffect } from 'react';
import { getDefaultStore } from 'jotai';
import { getPrimaryNamesForAddresses } from '../components/Group/groupApi';
import {
  memberDirectsAtom,
  reticulumChatSummariesAtom,
  reticulumDirectSummariesAtom,
  userInfoAtom,
} from '../atoms/global';
import {
  clearChatWarmCache,
  directLatestTimestamp,
  groupLatestTimestamp,
  hasWarmGroupHistory,
  isAnyWarmChatOpen,
  onAllWarmChatsClosed,
  setChatWarmCacheOwner,
  readWarmName,
  setKnownReticulumChatEnabled,
  warmDirectNewestTimestamp,
  warmGroupNewestTimestamp,
  writeWarmDirectCalls,
  writeWarmDirectHistory,
  writeWarmGroupHistory,
  writeWarmName,
  writeWarmNames,
  withWarmNames,
} from './chatWarmCache';

/** Chats of each kind kept warm. */
export const CHAT_WARM_UP_COUNT = 6;
const GROUP_CHANNEL = 'general';
const HISTORY_LIMIT = 200;
const CALL_HISTORY_LIMIT = 100;

export type ChatWarmUpTiming = {
  /** After sign-in, before the first read (startup has its own work). */
  startDelayMs: number;
  /** After a summary changes, before looking again (bursts of messages). */
  replanDelayMs: number;
  /** Between two reads. */
  gapMs: number;
  /** A chat read this recently waits before it is read again. */
  rereadAfterMs: number;
};

const DEFAULT_TIMING: ChatWarmUpTiming = {
  startDelayMs: 4000,
  replanDelayMs: 2000,
  gapMs: 150,
  rereadAfterMs: 20000,
};

type WarmTask =
  | { kind: 'group'; groupId: number; latest: number }
  | { kind: 'direct'; peer: string; latest: number };

const taskKey = (task: WarmTask) =>
  task.kind === 'group' ? `g:${task.groupId}` : `d:${task.peer}`;

/**
 * The chats to keep warm whose copy is missing or older than their latest
 * event, most recently active first.
 */
export function planChatWarmUp(
  groupSummaries: Record<string, any>,
  directSummaries: Record<string, any>,
  count = CHAT_WARM_UP_COUNT
): WarmTask[] {
  const groups = Object.values(groupSummaries || {})
    .map((summary) => {
      const groupId = Number(summary?.groupId);
      if (!Number.isInteger(groupId) || groupId <= 0) return null;
      const latest = groupLatestTimestamp(groupId, GROUP_CHANNEL);
      if (latest == null) return null;
      return { kind: 'group' as const, groupId, latest };
    })
    .filter((task): task is NonNullable<typeof task> => task !== null)
    .sort((left, right) => right.latest - left.latest)
    .slice(0, count)
    .filter(
      (task) =>
        !hasWarmGroupHistory(task.groupId, GROUP_CHANNEL) ||
        warmGroupNewestTimestamp(task.groupId, GROUP_CHANNEL) < task.latest
    );
  const directs = Object.keys(directSummaries || {})
    .map((peer) => {
      const latest = directLatestTimestamp(peer);
      if (!peer || latest == null) return null;
      return { kind: 'direct' as const, peer, latest };
    })
    .filter((task): task is NonNullable<typeof task> => task !== null)
    .sort((left, right) => right.latest - left.latest)
    .slice(0, count)
    .filter((task) => warmDirectNewestTimestamp(task.peer) < task.latest);
  // Interleaved, so the top group and the top DM are both warm first.
  const tasks: WarmTask[] = [];
  for (
    let index = 0;
    index < Math.max(groups.length, directs.length);
    index++
  ) {
    if (groups[index]) tasks.push(groups[index]);
    if (directs[index]) tasks.push(directs[index]);
  }
  return tasks;
}

/** Most addresses asked about in one lookup. */
const NAME_LOOKUP_LIMIT = 100;

/**
 * Names for the senders in `events` not known yet, from the Qortal node in
 * one request. Each address is asked once (`asked`, per sign-in), whether it
 * turns out to have a name or not.
 */
async function learnSenderNames(
  events: unknown[],
  addressField: 'authorAddress' | 'senderAddress',
  account: string,
  asked: Set<string>
): Promise<void> {
  const missing: string[] = [];
  for (const item of events) {
    const address = (item as Record<string, unknown>)?.[addressField];
    if (typeof address !== 'string' || !address || address === account) {
      continue;
    }
    if (asked.has(address) || readWarmName(address)) continue;
    asked.add(address);
    missing.push(address);
    if (missing.length >= NAME_LOOKUP_LIMIT) break;
  }
  if (missing.length === 0) return;
  const found = await getPrimaryNamesForAddresses(missing).catch(() => null);
  if (!found) {
    // Asked again next time (the node may be back).
    for (const address of missing) asked.delete(address);
    return;
  }
  for (const address of missing) {
    const name = found[address];
    if (typeof name === 'string' && name.trim()) writeWarmName(address, name);
  }
}

async function runWarmTask(
  task: WarmTask,
  account: string,
  askedNames: Set<string>
): Promise<void> {
  const chat = window.reticulumChat;
  if (!chat) return;
  if (task.kind === 'group') {
    const page = await chat.getMessageHistoryPage?.(
      task.groupId,
      GROUP_CHANNEL,
      HISTORY_LIMIT,
      { repairNetwork: false }
    );
    const events = Array.isArray(page?.events) ? page.events : [];
    if (events.length === 0) return;
    await learnSenderNames(events, 'authorAddress', account, askedNames);
    writeWarmGroupHistory(
      task.groupId,
      GROUP_CHANNEL,
      {
        events: withWarmNames(events, 'authorAddress'),
        hasOlder: page?.hasMore === true,
      },
      account
    );
    return;
  }
  const history = await chat.getDirectHistory?.(
    account,
    task.peer,
    HISTORY_LIMIT
  );
  if (Array.isArray(history) && history.length > 0) {
    await learnSenderNames(history, 'senderAddress', account, askedNames);
    writeWarmDirectHistory(
      account,
      task.peer,
      withWarmNames(history, 'senderAddress')
    );
  }
  const calls = await chat
    .getDirectCallHistory?.(account, task.peer, CALL_HISTORY_LIMIT)
    ?.catch?.(() => null);
  if (Array.isArray(calls)) writeWarmDirectCalls(account, task.peer, calls);
}

export type UseChatHistoryWarmUpOptions = {
  /** Phone, signed in, unlocked. Nothing runs (and the cache is empty)
   * while false. */
  enabled: boolean;
  /** Signed-in wallet address. */
  address: string | null | undefined;
  /** Tests only. */
  timing?: Partial<ChatWarmUpTiming>;
};

export function useChatHistoryWarmUp({
  enabled,
  address,
  timing,
}: UseChatHistoryWarmUpOptions): void {
  // The app's store (no Provider): the cache reads the summaries there too.
  const store = getDefaultStore();
  const account = typeof address === 'string' ? address.trim() : '';
  const startDelayMs = timing?.startDelayMs ?? DEFAULT_TIMING.startDelayMs;
  const replanDelayMs = timing?.replanDelayMs ?? DEFAULT_TIMING.replanDelayMs;
  const gapMs = timing?.gapMs ?? DEFAULT_TIMING.gapMs;
  const rereadAfterMs = timing?.rereadAfterMs ?? DEFAULT_TIMING.rereadAfterMs;

  useEffect(() => {
    if (!enabled || !account) {
      clearChatWarmCache();
      return;
    }
    setChatWarmCacheOwner(account);
    let stopped = false;
    let chatOn = false;
    let running = false;
    let queue: WarmTask[] = [];
    let timer: number | null = null;
    let idle: number | null = null;
    /** When each chat was last read (busy chats are not read on every
     * message). */
    const readAt = new Map<string, number>();
    /** Addresses whose name was asked of the node since sign-in. */
    const askedNames = new Set<string>();

    const clearWait = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (idle !== null) window.cancelIdleCallback?.(idle);
      timer = null;
      idle = null;
    };
    /** `run` after `delay`, in an idle moment, while GO is on screen. */
    const later = (run: () => void, delay: number) => {
      clearWait();
      timer = window.setTimeout(() => {
        timer = null;
        if (stopped) return;
        if (document.visibilityState === 'hidden') return;
        if (typeof window.requestIdleCallback === 'function') {
          idle = window.requestIdleCallback(
            () => {
              idle = null;
              if (!stopped) run();
            },
            { timeout: 2000 }
          );
        } else {
          run();
        }
      }, delay);
    };

    /** Names GO already has on this phone (own name, the DM list). */
    const learnNames = () => {
      const userInfo = store.get(userInfoAtom) as {
        address?: unknown;
        name?: unknown;
      } | null;
      if (userInfo) writeWarmNames([userInfo]);
      const directs = store.get(memberDirectsAtom);
      if (Array.isArray(directs)) writeWarmNames(directs);
    };

    const plan = () => {
      if (stopped || !chatOn) return;
      learnNames();
      const now = Date.now();
      let nextDue = Infinity;
      const next = planChatWarmUp(
        store.get(reticulumChatSummariesAtom) || {},
        store.get(reticulumDirectSummariesAtom) || {}
      ).filter((task) => {
        const due = (readAt.get(taskKey(task)) ?? -Infinity) + rereadAfterMs;
        if (due <= now) return true;
        nextDue = Math.min(nextDue, due);
        return false;
      });
      const queued = new Set(queue.map(taskKey));
      queue = queue.concat(next.filter((task) => !queued.has(taskKey(task))));
      if (queue.length > 0) pump();
      else if (Number.isFinite(nextDue)) later(plan, nextDue - now);
    };

    const pump = () => {
      if (stopped || running || timer !== null || idle !== null) return;
      // A chat on screen: wait until it closes (onAllWarmChatsClosed).
      if (isAnyWarmChatOpen()) return;
      const task = queue.shift();
      if (!task) return;
      later(() => {
        if (isAnyWarmChatOpen()) {
          queue.unshift(task);
          return;
        }
        readAt.set(taskKey(task), Date.now());
        running = true;
        void runWarmTask(task, account, askedNames)
          .catch(() => {
            // Warm-up is optional: the chat still reads on open.
          })
          .finally(() => {
            running = false;
            if (stopped) return;
            if (queue.length > 0) {
              later(() => pump(), gapMs);
            }
          });
      }, 0);
    };

    const replan = () => {
      if (stopped || !chatOn) return;
      clearWait();
      later(plan, replanDelayMs);
    };

    const startTimer = window.setTimeout(() => {
      void Promise.resolve(window.reticulumChat?.isEnabled?.())
        .then((on) => {
          setKnownReticulumChatEnabled(on === true);
          if (stopped || on !== true) return;
          chatOn = true;
          plan();
        })
        .catch(() => {});
    }, startDelayMs);

    const offGroups = store.sub(reticulumChatSummariesAtom, replan);
    const offDirects = store.sub(reticulumDirectSummariesAtom, replan);
    const offChatsClosed = onAllWarmChatsClosed(replan);
    const onVisible = () => {
      if (document.visibilityState === 'visible') replan();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      window.clearTimeout(startTimer);
      clearWait();
      offGroups();
      offDirects();
      offChatsClosed();
      document.removeEventListener('visibilitychange', onVisible);
      queue = [];
      clearChatWarmCache();
    };
  }, [
    account,
    enabled,
    gapMs,
    replanDelayMs,
    rereadAfterMs,
    startDelayMs,
    store,
  ]);
}
