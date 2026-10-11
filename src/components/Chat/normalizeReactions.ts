import type { ReactionsMap } from './ChatList';

type ReactionItem = ReactionsMap[string][number];

/** One frozen empty list, so an empty who-reacted list keeps its identity. */
export const NO_REACTORS: readonly ReactionItem[] = Object.freeze([]);

export const isReactorItem = (item: unknown): item is ReactionItem =>
  typeof item === 'object' && item !== null;

const isCleanList = (list: unknown): list is ReactionItem[] =>
  Array.isArray(list) && list.length > 0 && list.every(isReactorItem);

/**
 * The reactions map as MessageItem draws it: every entry a non-empty list of
 * reactor objects. Returns the input itself when it is already like that (the
 * usual case, so identities hold) and null when nothing is left. Never
 * mutates.
 */
export function normalizeReactionsMap(raw: unknown): ReactionsMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.every((key) => isCleanList(source[key]))) {
    return source as ReactionsMap;
  }
  const next: ReactionsMap = {};
  let kept = 0;
  for (const key of keys) {
    const list = source[key];
    if (!Array.isArray(list)) continue;
    const reactors = list.filter(isReactorItem);
    if (reactors.length === 0) continue;
    next[key] = reactors;
    kept += 1;
  }
  return kept > 0 ? next : null;
}
