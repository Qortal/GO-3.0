/**
 * Bundled ("presaved") avatars for the most used Q-Apps, shipped in the APK.
 * Shown while there is no cached live icon, so app lists keep their icons on
 * a slow node and offline. Refresh with tools/qdnAvatarSeeds/refresh-seeds.mjs.
 */
import { QDN_AVATAR_SEEDS } from '../../assets/qdnAvatarSeeds/manifest';
import { qdnAvatarKey, type QdnAvatarKey } from './keys';

let seedUrlsByKey: Map<QdnAvatarKey, string> | null = null;

function seedMap(): Map<QdnAvatarKey, string> {
  if (!seedUrlsByKey) {
    seedUrlsByKey = new Map();
    for (const seed of QDN_AVATAR_SEEDS) {
      const key = qdnAvatarKey(seed.name);
      if (key && seed.url) seedUrlsByKey.set(key, seed.url);
    }
  }
  return seedUrlsByKey;
}

/** Bundled icon URL for a cache key (only `qortal_avatar` keys have seeds). */
export function qdnAvatarSeedUrlForKey(
  key: QdnAvatarKey | null | undefined
): string | undefined {
  return key ? seedMap().get(key) : undefined;
}

/** Bundled icon URL for a Q-App / website name, if GO ships one. */
export function getQdnAvatarSeedUrl(
  name: string | null | undefined
): string | undefined {
  return qdnAvatarSeedUrlForKey(qdnAvatarKey(name));
}

/** Names that have a bundled icon, as published on QDN. */
export function getQdnAvatarSeedNames(): string[] {
  return QDN_AVATAR_SEEDS.map((seed) => seed.name);
}
