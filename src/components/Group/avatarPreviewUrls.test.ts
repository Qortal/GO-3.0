import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGroupAvatarPreviewUrl,
  buildUserAvatarPreviewUrl,
  fullSizeAvatarRequestUrl,
  noteAvatarPublishedHere,
  PUBLISHED_AVATAR_SETTLE_MS,
  resetAvatarPublishesForTests,
} from './avatarPreviewUrls';

const BASE = 'http://node:12391/';

describe('avatar preview URLs', () => {
  it('asks the node for the full-size user avatar (blocking)', () => {
    expect(buildUserAvatarPreviewUrl(BASE, ' Alice Smith ')).toBe(
      'http://node:12391/arbitrary/THUMBNAIL/Alice%20Smith/qortal_avatar'
    );
  });

  it('asks the node for the full-size group avatar (blocking)', () => {
    expect(buildGroupAvatarPreviewUrl(BASE, 'Owner', 42)).toBe(
      'http://node:12391/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_42'
    );
    expect(buildGroupAvatarPreviewUrl(BASE, 'Owner', '7')).toBe(
      'http://node:12391/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_7'
    );
  });

  it('returns null when something is missing', () => {
    expect(buildUserAvatarPreviewUrl(BASE, '  ')).toBeNull();
    expect(buildUserAvatarPreviewUrl('', 'Alice')).toBeNull();
    expect(buildUserAvatarPreviewUrl(BASE, undefined)).toBeNull();
    expect(buildGroupAvatarPreviewUrl(BASE, null, 1)).toBeNull();
    expect(buildGroupAvatarPreviewUrl(BASE, 'Owner', null)).toBeNull();
    expect(buildGroupAvatarPreviewUrl(BASE, 'Owner', ' ')).toBeNull();
  });
});

describe('fullSizeAvatarRequestUrl', () => {
  afterEach(() => resetAvatarPublishesForTests());

  const FULL =
    'http://node:12391/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_42';

  it('keeps the plain URL normally and versions it for a reload', () => {
    expect(fullSizeAvatarRequestUrl(FULL)).toBe(FULL);
    expect(fullSizeAvatarRequestUrl(FULL, { reload: 2 })).toBe(`${FULL}?v=r2`);
  });

  it('waits after a publish from this device, then skips the HTTP cache', () => {
    noteAvatarPublishedHere('owner', 'qortal_group_avatar_42', 1_000);
    expect(fullSizeAvatarRequestUrl(FULL, { now: 2_000 })).toBeNull();
    const later = 1_000 + PUBLISHED_AVATAR_SETTLE_MS;
    expect(fullSizeAvatarRequestUrl(FULL, { now: later })).toBe(
      `${FULL}?v=1000`
    );
    expect(fullSizeAvatarRequestUrl(FULL, { now: later, reload: 1 })).toBe(
      `${FULL}?v=1000-r1`
    );
    // Other avatars of the same name are not affected.
    const user = 'http://node:12391/arbitrary/THUMBNAIL/Owner/qortal_avatar';
    expect(fullSizeAvatarRequestUrl(user, { now: 2_000 })).toBe(user);
  });
});
