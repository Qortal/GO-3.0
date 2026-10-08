/**
 * The viewer's own reactions show the moment they are made. A reaction goes
 * through the send queue first (sign, publish) and only then lands in the
 * chat references, which on a phone can take a good part of a second. Until
 * then the queued reaction is laid over the confirmed ones, and for a short
 * grace after it leaves the queue too, so the chip doesn't blink out in the
 * gap before the confirmed copy arrives. A reaction that failed for good
 * drops straight back to what is confirmed.
 */

type ReactionItem = { sender: string; senderName?: string };
type ReactionsMap = { [emoji: string]: ReactionItem[] };

/** Queue item type for reaction sends (see MessageQueueContext.addToQueue). */
export const REACTION_QUEUE_TYPE = 'chat-reaction';
/** How long a sent reaction is shown before its confirmed copy arrives. */
export const OPTIMISTIC_REACTION_GRACE_MS = 6_000;

export type QueuedReaction = {
  signature: string;
  emoji: string;
  /** False: taking the reaction back. */
  add: boolean;
};

type QueueItemView = {
  type?: unknown;
  status?: unknown;
  chatReference?: unknown;
  message?: { content?: unknown; contentState?: unknown } | null;
};

export const isReactionQueueItem = (item: unknown): boolean =>
  (item as QueueItemView | null)?.type === REACTION_QUEUE_TYPE;

const toQueuedReaction = (item: QueueItemView): QueuedReaction | null => {
  const signature = item.chatReference;
  const emoji = item.message?.content;
  if (typeof signature !== 'string' || !signature) return null;
  if (typeof emoji !== 'string' || !emoji) return null;
  return { signature, emoji, add: item.message?.contentState !== false };
};

/** Reaction sends in the queue, in order, and the ones that failed for good. */
export const readQueuedReactions = (
  items: readonly unknown[] | null | undefined
): { pending: QueuedReaction[]; failed: QueuedReaction[] } => {
  const pending: QueuedReaction[] = [];
  const failed: QueuedReaction[] = [];
  for (const raw of items ?? []) {
    if (!isReactionQueueItem(raw)) continue;
    const item = raw as QueueItemView;
    const reaction = toQueuedReaction(item);
    if (!reaction) continue;
    (item.status === 'failed-permanent' ? failed : pending).push(reaction);
  }
  return { pending, failed };
};

/** `reactions` with the viewer's own changes laid over it (a new object). */
export const applyOwnReactions = (
  reactions: ReactionsMap | null | undefined,
  changes: ReadonlyMap<string, boolean>,
  myAddress: string,
  myName?: string
): ReactionsMap | null => {
  if (changes.size === 0) return reactions ?? null;
  const next: ReactionsMap = { ...(reactions ?? {}) };
  for (const [emoji, add] of changes) {
    const current = next[emoji] ?? [];
    const mine = current.some((item) => item?.sender === myAddress);
    if (mine === add) continue;
    next[emoji] = add
      ? [...current, { sender: myAddress, senderName: myName }]
      : current.filter((item) => item?.sender !== myAddress);
  }
  return next;
};

type Held = QueuedReaction & { releasedAt: number | null };

const keyOf = (signature: string, emoji: string) =>
  `${signature}\u0001${emoji}`;

/**
 * Remembers queued reactions across renders, so one that just left the
 * queue keeps showing until its confirmed copy is in (or the grace is over).
 */
export class OptimisticReactionTracker {
  private held = new Map<string, Held>();

  /**
   * The viewer's reaction changes to show, per message signature.
   * `isConfirmedMine` tells whether the confirmed references already have
   * the viewer's reaction `emoji` on `signature`.
   */
  update(
    queueItems: readonly unknown[] | null | undefined,
    isConfirmedMine: (signature: string, emoji: string) => boolean,
    now: number
  ): Map<string, Map<string, boolean>> {
    const { pending, failed } = readQueuedReactions(queueItems);
    const queued = new Set<string>();
    for (const reaction of pending) {
      const key = keyOf(reaction.signature, reaction.emoji);
      queued.add(key);
      this.held.set(key, { ...reaction, releasedAt: null });
    }
    for (const reaction of failed) {
      const key = keyOf(reaction.signature, reaction.emoji);
      if (!queued.has(key)) this.held.delete(key);
    }
    const result = new Map<string, Map<string, boolean>>();
    for (const [key, entry] of this.held) {
      if (!queued.has(key) && entry.releasedAt === null) {
        entry.releasedAt = now;
      }
      if (
        entry.releasedAt !== null &&
        (now - entry.releasedAt >= OPTIMISTIC_REACTION_GRACE_MS ||
          isConfirmedMine(entry.signature, entry.emoji) === entry.add)
      ) {
        this.held.delete(key);
        continue;
      }
      let changes = result.get(entry.signature);
      if (!changes) {
        changes = new Map();
        result.set(entry.signature, changes);
      }
      changes.set(entry.emoji, entry.add);
    }
    return result;
  }

  /** Until the next held reaction runs out of grace, or null for none. */
  msUntilNextExpiry(now: number): number | null {
    let soonest: number | null = null;
    for (const entry of this.held.values()) {
      if (entry.releasedAt === null) continue;
      const left = Math.max(
        0,
        entry.releasedAt + OPTIMISTIC_REACTION_GRACE_MS - now
      );
      soonest = soonest === null ? left : Math.min(soonest, left);
    }
    return soonest;
  }
}
