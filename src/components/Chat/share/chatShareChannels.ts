/**
 * The channel step of a share into a group: "GO Groups" in the share sheet,
 * then a group tapped in the list. Which of the group's channels show, in
 * the order and categories of the group's own channel list (ChatGroup), and
 * which of them can take the share. A group with only one channel the user
 * can post in skips the step.
 */

/** The fields of a Reticulum group channel the step reads. */
export type ShareChannelLike = {
  channelId: string;
  name?: string;
  categoryId?: string;
  position?: number;
  archived?: boolean;
  writeMode?: string;
  readMode?: string;
};

export type ShareCategoryLike = {
  categoryId: string;
  name?: string;
};

export type ShareChannelBundle<T extends ShareChannelLike> = {
  channels?: T[];
  categories?: ShareCategoryLike[];
  /** The group's signed channel layout is in (getChannelMetadataBundle). */
  ready?: boolean;
};

export type ShareChannelRow<T> = {
  channel: T;
  /** Admins-only channels take posts from admins only. */
  canWrite: boolean;
};

export type ShareChannelSection<T> = {
  /** '' for the group's default category. */
  categoryId: string;
  /** The category header; null when the default category hides it. */
  name: string | null;
  rows: ShareChannelRow<T>[];
};

/** ChatGroup's DEFAULT_RETICULUM_CATEGORY_METADATA_ID. */
const DEFAULT_CATEGORY_METADATA_ID = 'cat-qchat-default';
/** ChatGroup's HIDDEN_RETICULUM_DEFAULT_CATEGORY_NAME. */
const HIDDEN_DEFAULT_CATEGORY_NAME = 'QCHAT_DEFAULT_CATEGORY_HIDDEN';
/** General and Qortal Land: they keep the default category's header. */
const SYSTEM_CHANNEL_IDS = new Set(['general', 'qortal-land']);
const ADMINS = 'admins';

const byPosition = (a: ShareChannelLike, b: ShareChannelLike) =>
  (a.position ?? 0) - (b.position ?? 0) ||
  String(a.name ?? '').localeCompare(String(b.name ?? ''));

/**
 * The channels as the group's channel list shows them: archived ones and
 * (for members) admins-only ones left out, the default category first, then
 * the others in their order; categories without a channel are left out.
 */
export function shareChannelSections<T extends ShareChannelLike>(
  bundle: ShareChannelBundle<T> | null | undefined,
  {
    isAdmin,
    defaultCategoryName,
  }: {
    isAdmin: boolean;
    /** Shown for the default category when it has no name of its own. */
    defaultCategoryName: string;
  }
): ShareChannelSection<T>[] {
  const channels = (Array.isArray(bundle?.channels) ? bundle.channels : [])
    .filter(
      (channel) =>
        typeof channel?.channelId === 'string' &&
        channel.channelId !== '' &&
        !channel.archived &&
        (channel.readMode !== ADMINS || isAdmin)
    )
    .sort(byPosition);
  const allCategories = (
    Array.isArray(bundle?.categories) ? bundle.categories : []
  ).filter((category) => typeof category?.categoryId === 'string');
  const defaultCategory = allCategories.find(
    (category) => category.categoryId === DEFAULT_CATEGORY_METADATA_ID
  );
  const categories = allCategories.filter(
    (category) =>
      category.categoryId !== '' &&
      category.categoryId !== DEFAULT_CATEGORY_METADATA_ID
  );
  const knownCategoryIds = new Set(
    categories.map((category) => category.categoryId)
  );
  const rowsByCategory = new Map<string, ShareChannelRow<T>[]>();
  for (const channel of channels) {
    const categoryId =
      channel.categoryId && knownCategoryIds.has(channel.categoryId)
        ? channel.categoryId
        : '';
    const rows = rowsByCategory.get(categoryId) ?? [];
    rows.push({ channel, canWrite: channel.writeMode !== ADMINS || isAdmin });
    rowsByCategory.set(categoryId, rows);
  }

  const sections: ShareChannelSection<T>[] = [];
  const defaultRows = rowsByCategory.get('') ?? [];
  if (defaultRows.length) {
    const ownName = defaultCategory?.name;
    const hidden =
      ownName === HIDDEN_DEFAULT_CATEGORY_NAME &&
      !defaultRows.some(({ channel }) =>
        SYSTEM_CHANNEL_IDS.has(channel.channelId)
      );
    sections.push({
      categoryId: '',
      name: hidden
        ? null
        : ownName && ownName !== HIDDEN_DEFAULT_CATEGORY_NAME
          ? ownName
          : defaultCategoryName,
      rows: defaultRows,
    });
  }
  // Categories come in the group's order (position, then name).
  for (const category of categories) {
    const rows = rowsByCategory.get(category.categoryId);
    if (!rows?.length) continue;
    sections.push({
      categoryId: category.categoryId,
      name: category.name || category.categoryId,
      rows,
    });
  }
  return sections;
}

export type ShareChannelStep =
  /** Ask: several channels can take the share (or none can, which says so). */
  | { kind: 'pick' }
  /**
   * Straight into the group: `channelId` is the only channel that can take
   * the share, or null when the group's channels are not known (the channel
   * that opens takes it, as without the step).
   */
  | { kind: 'direct'; channelId: string | null };

export function shareChannelStep<T extends ShareChannelLike>(
  sections: readonly ShareChannelSection<T>[]
): ShareChannelStep {
  const rows = sections.flatMap((section) => section.rows);
  if (!rows.length) return { kind: 'direct', channelId: null };
  const writable = rows.filter((row) => row.canWrite);
  if (writable.length === 1) {
    return { kind: 'direct', channelId: writable[0].channel.channelId };
  }
  return { kind: 'pick' };
}

/** Whether no channel shown can take the share (all admins-only). */
export function noWritableShareChannel<T>(
  sections: readonly ShareChannelSection<T>[]
): boolean {
  const rows = sections.flatMap((section) => section.rows);
  return rows.length > 0 && rows.every((row) => !row.canWrite);
}

/** ChatGroup's channel-list load: the first try, then these waits. */
export const SHARE_CHANNEL_RETRY_DELAYS_MS = [0, 100, 250, 500, 1_000];

type ChannelSource = {
  subscribeGroup?: (groupId: number) => unknown;
  getChannelMetadataBundle?: (groupId: number) => unknown;
};

/**
 * The group's channels, read like the group chat reads them (subscribe,
 * then the metadata bundle, retried while the signed layout is not in).
 * Null when nothing came; the last layout seen when it never got ready.
 */
export async function loadShareChannelBundle<T extends ShareChannelLike>(
  groupId: number,
  isCancelled: () => boolean,
  source: ChannelSource | undefined = typeof window !== 'undefined'
    ? (window.reticulumChat as ChannelSource | undefined)
    : undefined
): Promise<ShareChannelBundle<T> | null> {
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  if (typeof source?.getChannelMetadataBundle !== 'function') return null;
  let last: ShareChannelBundle<T> | null = null;
  let subscribed = false;
  for (const delayMs of SHARE_CHANNEL_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    if (isCancelled()) return null;
    try {
      if (!subscribed) {
        await source.subscribeGroup?.(groupId);
        subscribed = true;
      }
      const bundle = (await source.getChannelMetadataBundle(
        groupId
      )) as ShareChannelBundle<T> | null;
      if (isCancelled()) return null;
      if (Array.isArray(bundle?.channels) && bundle.channels.length > 0) {
        last = bundle;
        if (bundle.ready === true) return bundle;
      }
    } catch {
      // Tried again after the next wait.
    }
  }
  return last;
}

/** ChatGroup's normalizeReticulumChannelName, for the unread summaries. */
export const normalizeShareChannelId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
