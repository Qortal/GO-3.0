import { describe, expect, it } from 'vitest';
import {
  buildQdnAvatarStatusUrl,
  buildQdnAvatarUrl,
  parseQdnAvatarKey,
  qdnAvatarKey,
  qdnGroupAvatarIdentifier,
} from './keys';

describe('qdnAvatarKey', () => {
  it('ignores case and surrounding spaces in names', () => {
    expect(qdnAvatarKey('Q-Tube')).toBe('THUMBNAIL/q-tube/qortal_avatar');
    expect(qdnAvatarKey('  q-tube ')).toBe(qdnAvatarKey('Q-TUBE'));
  });

  it('keeps identifiers as published and defaults to qortal_avatar', () => {
    expect(qdnAvatarKey('Alice', '')).toBe('THUMBNAIL/alice/qortal_avatar');
    expect(qdnAvatarKey('Alice', qdnGroupAvatarIdentifier(42))).toBe(
      'THUMBNAIL/alice/qortal_group_avatar_42'
    );
  });

  it('returns null without a usable name', () => {
    expect(qdnAvatarKey('')).toBeNull();
    expect(qdnAvatarKey('   ')).toBeNull();
    expect(qdnAvatarKey(null)).toBeNull();
    expect(qdnAvatarKey(undefined)).toBeNull();
    expect(qdnAvatarKey(42 as unknown as string)).toBeNull();
  });

  it('encodes names with spaces and slashes so keys stay parseable', () => {
    const key = qdnAvatarKey('Welcome to Qortal/x');
    expect(key).toBe('THUMBNAIL/welcome%20to%20qortal%2Fx/qortal_avatar');
    expect(parseQdnAvatarKey(key!)).toEqual({
      name: 'welcome to qortal/x',
      identifier: 'qortal_avatar',
    });
  });

  it('rejects keys that are not avatar keys', () => {
    expect(parseQdnAvatarKey('APP/q-tube/qortal_avatar')).toBeNull();
    expect(parseQdnAvatarKey('THUMBNAIL/q-tube')).toBeNull();
    expect(parseQdnAvatarKey('THUMBNAIL/%E0%A4%A/x')).toBeNull();
  });
});

describe('avatar URLs', () => {
  const ref = { name: 'Q Lottery', identifier: 'qortal_avatar' };

  it('builds the async URL by default and the blocking URL on request', () => {
    expect(buildQdnAvatarUrl('http://node:12391/', ref)).toBe(
      'http://node:12391/arbitrary/THUMBNAIL/Q%20Lottery/qortal_avatar?async=true'
    );
    expect(
      buildQdnAvatarUrl('http://node:12391', ref, { blocking: true })
    ).toBe('http://node:12391/arbitrary/THUMBNAIL/Q%20Lottery/qortal_avatar');
  });

  it('builds the resource status URL', () => {
    expect(buildQdnAvatarStatusUrl('https://ext-node.qortal.link', ref)).toBe(
      'https://ext-node.qortal.link/arbitrary/resource/status/THUMBNAIL/Q%20Lottery/qortal_avatar'
    );
  });
});
