import { describe, expect, it } from 'vitest';
import { filterSeenInAppKeysForApp } from './notificationSeenInAppScope';

const STORED = [
  'RESOURCE_PUBLISHED-q-mail-APP-q-mail-notification',
  'RESOURCE_PUBLISHED-q-mail-APP-q-mail-notification-qortal_qmail_abc',
  'RESOURCE_PUBLISHED-q-mail-WEBSITE-q-mail-notification',
  'RESOURCE_PUBLISHED-q-tube-APP-q-tube-new-video-vid_123',
  'RESOURCE_PUBLISHED-q-mail-extra-APP-other',
  'PAYMENT_RECEIVED-5signatureabc',
];

describe('filterSeenInAppKeysForApp', () => {
  it("keeps only the calling app's keys for its service", () => {
    expect(filterSeenInAppKeysForApp(STORED, 'q-mail', 'APP')).toEqual([
      'RESOURCE_PUBLISHED-q-mail-APP-q-mail-notification',
      'RESOURCE_PUBLISHED-q-mail-APP-q-mail-notification-qortal_qmail_abc',
    ]);
  });

  it('does not leak keys of a different service under the same name', () => {
    expect(filterSeenInAppKeysForApp(STORED, 'q-mail', 'WEBSITE')).toEqual([
      'RESOURCE_PUBLISHED-q-mail-WEBSITE-q-mail-notification',
    ]);
  });

  it('does not match an app whose name merely starts with the caller name', () => {
    expect(filterSeenInAppKeysForApp(STORED, 'q', 'APP')).toEqual([]);
    expect(filterSeenInAppKeysForApp(STORED, 'q-mail-extra', 'APP')).toEqual([
      'RESOURCE_PUBLISHED-q-mail-extra-APP-other',
    ]);
  });

  it('lowercases the app name like the stored keys', () => {
    expect(filterSeenInAppKeysForApp(STORED, 'Q-Tube', 'APP')).toEqual([
      'RESOURCE_PUBLISHED-q-tube-APP-q-tube-new-video-vid_123',
    ]);
  });

  it('never returns non-app keys such as payments', () => {
    const all = ['APP', 'WEBSITE'].flatMap((service) =>
      ['q-mail', 'q-tube', ''].flatMap((name) =>
        filterSeenInAppKeysForApp(STORED, name, service)
      )
    );
    expect(all.some((k) => k.startsWith('PAYMENT_RECEIVED'))).toBe(false);
  });

  it('tolerates bad input', () => {
    expect(
      filterSeenInAppKeysForApp(undefined as any, 'q-mail', 'APP')
    ).toEqual([]);
    expect(
      filterSeenInAppKeysForApp([null, 1, 'x'] as any, 'q-mail', 'APP')
    ).toEqual([]);
  });
});
