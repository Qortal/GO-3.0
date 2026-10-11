import { describe, expect, it } from 'vitest';
import {
  getReticulumPostDelivery,
  getReticulumPostDeliveryState,
  hasReticulumPostDeliveryState,
  RETICULUM_GROUP_POST_PENDING_MAX_AGE_MS,
  RETICULUM_POST_SENDING_MS,
  RETICULUM_SELF_DM_POST_PENDING_MAX_AGE_MS,
  reticulumPostDeliveryBoundaryAt,
  reticulumPostDeliveryItemFields,
  reticulumPostDeliveryTextKey,
} from './reticulumPostDeliveryState';
import { RETICULUM_DM_ONLY_LOCAL_AFTER_MS } from './reticulumDmDeliveryState';
import { mergeReticulumPayloadWithVerifiedEnvelope } from '../../utils/reticulumEventEnvelope';

const ME = 'QMeAddress';
const PEER = 'QPeerAddress';
const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60_000;

/** An own group post as ChatGroup builds it from a tracked engine event. */
const post = (overrides: Record<string, unknown> = {}) => ({
  signature: 'post-1',
  sender: ME,
  reticulumChat: true,
  reticulumPostDeliverySince: NOW,
  ...overrides,
});

/** A Saved Message as the DM hook builds it from a tracked engine event. */
const savedMessage = (overrides: Record<string, unknown> = {}) =>
  post({
    signature: 'saved-1',
    reticulumDirect: true,
    recipientAddress: ME,
    reticulumDeliveryStatus: 'sent',
    ...overrides,
  });

describe('getReticulumPostDeliveryState: group posts', () => {
  it('is sending for 12 s, then not picked up yet', () => {
    expect(RETICULUM_POST_SENDING_MS).toBe(12_000);
    // DMs to someone else keep their own window.
    expect(RETICULUM_DM_ONLY_LOCAL_AFTER_MS).toBe(30_000);
    expect(getReticulumPostDeliveryState(post(), ME, NOW)).toBe('sending');
    expect(getReticulumPostDeliveryState(post(), ME, NOW + 11_999)).toBe(
      'sending'
    );
    expect(getReticulumPostDeliveryState(post(), ME, NOW + 12_000)).toBe(
      'not_picked_up'
    );
  });

  it('shows nothing once this phone no longer offers the post (29 d)', () => {
    expect(RETICULUM_GROUP_POST_PENDING_MAX_AGE_MS).toBe(29 * DAY_MS);
    expect(
      getReticulumPostDeliveryState(
        post(),
        ME,
        NOW + RETICULUM_GROUP_POST_PENDING_MAX_AGE_MS - 1
      )
    ).toBe('not_picked_up');
    expect(
      getReticulumPostDeliveryState(
        post(),
        ME,
        NOW + RETICULUM_GROUP_POST_PENDING_MAX_AGE_MS
      )
    ).toBeNull();
    // Still a tracked row: the glyph stays mounted for a late proof.
    expect(hasReticulumPostDeliveryState(post(), ME)).toBe(true);
  });

  it('is delivered by a member at any age, even within the first seconds', () => {
    const fetched = post({ reticulumPostMemberAt: NOW + 2_000 });
    for (const at of [NOW + 3_000, NOW + 40 * DAY_MS]) {
      expect(getReticulumPostDelivery(fetched, ME, at)).toEqual({
        scope: 'group',
        state: 'delivered',
        via: 'member',
      });
    }
  });

  it('is delivered by an own device (like the home Hub), at any age', () => {
    const fetched = post({ reticulumPostOwnDeviceAt: NOW + 1_000 });
    for (const at of [NOW + 2_000, NOW + 40 * DAY_MS]) {
      expect(getReticulumPostDelivery(fetched, ME, at)).toEqual({
        scope: 'group',
        state: 'delivered',
        via: 'own_device',
      });
    }
  });

  it('names the member when both an own device and a member fetched it', () => {
    expect(
      getReticulumPostDelivery(
        post({ reticulumPostOwnDeviceAt: NOW, reticulumPostMemberAt: NOW }),
        ME,
        NOW
      )?.via
    ).toBe('member');
  });

  it('takes a proof from the store when the row has none', () => {
    expect(
      getReticulumPostDelivery(post(), ME, NOW + 60_000, {
        ownDeviceAt: NOW + 5_000,
      })
    ).toMatchObject({ state: 'delivered', via: 'own_device' });
    expect(
      getReticulumPostDelivery(
        post({ reticulumPostOwnDeviceAt: NOW }),
        ME,
        NOW + 60_000,
        { memberAt: NOW + 5_000 }
      )
    ).toMatchObject({ state: 'delivered', via: 'member' });
    // Past the max age a stored proof still shows.
    expect(
      getReticulumPostDeliveryState(post(), ME, NOW + 40 * DAY_MS, {
        memberAt: NOW + 40 * DAY_MS,
      })
    ).toBe('delivered');
  });

  it('shows nothing for untracked or other people’s posts', () => {
    for (const message of [
      // From before this build, or written on another device.
      post({ reticulumPostDeliverySince: undefined }),
      post({ reticulumPostDeliverySince: 0 }),
      post({ reticulumPostDeliverySince: 'soon' }),
      // Someone else's post, even with the fields.
      post({ sender: PEER }),
      // Not from a Reticulum list.
      post({ reticulumChat: undefined }),
    ]) {
      expect(hasReticulumPostDeliveryState(message, ME)).toBe(false);
      expect(getReticulumPostDeliveryState(message, ME, NOW)).toBeNull();
    }
    expect(hasReticulumPostDeliveryState(post(), undefined)).toBe(false);
    expect(hasReticulumPostDeliveryState(null, ME)).toBe(false);
  });
});

describe('getReticulumPostDeliveryState: Saved Messages', () => {
  it('is sending for 12 s, then not picked up yet for 48 h', () => {
    expect(RETICULUM_SELF_DM_POST_PENDING_MAX_AGE_MS).toBe(48 * 60 * 60_000);
    expect(getReticulumPostDelivery(savedMessage(), ME, NOW + 1_000)).toEqual({
      scope: 'self_dm',
      state: 'sending',
      via: null,
    });
    expect(
      getReticulumPostDeliveryState(savedMessage(), ME, NOW + 12_000)
    ).toBe('not_picked_up');
    expect(
      getReticulumPostDeliveryState(
        savedMessage(),
        ME,
        NOW + RETICULUM_SELF_DM_POST_PENDING_MAX_AGE_MS - 1
      )
    ).toBe('not_picked_up');
    expect(
      getReticulumPostDeliveryState(
        savedMessage(),
        ME,
        NOW + RETICULUM_SELF_DM_POST_PENDING_MAX_AGE_MS
      )
    ).toBeNull();
  });

  it('is delivered once another own device fetched it, at any age', () => {
    for (const message of [
      savedMessage({ reticulumPostOwnDeviceAt: NOW + 1_000 }),
      savedMessage(),
    ]) {
      const delivery = getReticulumPostDelivery(
        message,
        ME,
        NOW + 10 * DAY_MS,
        { ownDeviceAt: NOW + 1_000 }
      );
      expect(delivery).toEqual({
        scope: 'self_dm',
        state: 'delivered',
        via: 'own_device',
      });
      expect(reticulumPostDeliveryTextKey(delivery!)).toBe(
        'delivered_own_device_self_dm'
      );
    }
  });

  it('never counts a member for a Saved Message', () => {
    expect(
      getReticulumPostDeliveryState(
        savedMessage({ reticulumPostMemberAt: NOW }),
        ME,
        NOW + 60_000,
        { memberAt: NOW }
      )
    ).toBe('not_picked_up');
  });

  it('shows nothing for an untracked Saved Message', () => {
    const untracked = savedMessage({ reticulumPostDeliverySince: undefined });
    expect(hasReticulumPostDeliveryState(untracked, ME)).toBe(false);
    expect(getReticulumPostDeliveryState(untracked, ME, NOW)).toBeNull();
  });

  it('never gives a DM to someone else a post state', () => {
    const dmToPeer = savedMessage({
      recipientAddress: PEER,
      reticulumDeliveryStatus: 'pending',
      reticulumPostOwnDeviceAt: NOW,
    });
    expect(hasReticulumPostDeliveryState(dmToPeer, ME)).toBe(false);
    expect(getReticulumPostDeliveryState(dmToPeer, ME, NOW)).toBeNull();
    // An incoming DM neither.
    expect(
      hasReticulumPostDeliveryState(
        savedMessage({ sender: PEER, recipientAddress: ME }),
        ME
      )
    ).toBe(false);
  });
});

describe('reticulumPostDeliveryTextKey', () => {
  it('picks the label and hint for each state and scope', () => {
    const key = (
      scope: 'group' | 'self_dm',
      state: 'sending' | 'not_picked_up' | 'delivered',
      via: 'member' | 'own_device' | null = null
    ) => reticulumPostDeliveryTextKey({ scope, state, via });
    expect(key('group', 'sending')).toBe('sending');
    expect(key('group', 'not_picked_up')).toBe('not_picked_up');
    expect(key('group', 'delivered', 'member')).toBe('delivered_member');
    expect(key('group', 'delivered', 'own_device')).toBe(
      'delivered_own_device'
    );
    expect(key('self_dm', 'sending')).toBe('sending_self_dm');
    expect(key('self_dm', 'not_picked_up')).toBe('not_picked_up_self_dm');
  });
});

describe('reticulumPostDeliveryBoundaryAt', () => {
  it('arms only the 12 s boundary, never the max age', () => {
    expect(reticulumPostDeliveryBoundaryAt(post(), 'sending', NOW)).toBe(
      NOW + RETICULUM_POST_SENDING_MS
    );
    expect(
      reticulumPostDeliveryBoundaryAt(post(), 'not_picked_up', NOW + 20_000)
    ).toBeNull();
    expect(
      reticulumPostDeliveryBoundaryAt(post(), 'delivered', NOW)
    ).toBeNull();
    expect(reticulumPostDeliveryBoundaryAt(post(), null, NOW)).toBeNull();
  });

  it('waits at most one window for a post stamped ahead of the clock', () => {
    const ahead = post({ reticulumPostDeliverySince: NOW + 5 * DAY_MS });
    expect(getReticulumPostDeliveryState(ahead, ME, NOW)).toBe('sending');
    expect(reticulumPostDeliveryBoundaryAt(ahead, 'sending', NOW)).toBe(
      NOW + RETICULUM_POST_SENDING_MS
    );
  });
});

describe('reticulumPostDeliveryItemFields', () => {
  it('copies the engine fields that are set, and nothing for untracked rows', () => {
    expect(
      reticulumPostDeliveryItemFields({
        localPostDeliverySince: NOW,
        localPostOwnDeviceAt: NOW + 1,
        localPostMemberAt: NOW + 2,
      })
    ).toEqual({
      reticulumPostDeliverySince: NOW,
      reticulumPostOwnDeviceAt: NOW + 1,
      reticulumPostMemberAt: NOW + 2,
    });
    expect(
      reticulumPostDeliveryItemFields({ localPostDeliverySince: NOW })
    ).toEqual({ reticulumPostDeliverySince: NOW });
    expect(reticulumPostDeliveryItemFields({})).toEqual({});
    expect(reticulumPostDeliveryItemFields(undefined)).toEqual({});
    // A proof without a tracked row is not a tracked row.
    expect(
      reticulumPostDeliveryItemFields({ localPostOwnDeviceAt: NOW })
    ).toEqual({});
  });
});

describe('group chat items (ChatGroup convertReticulumEventToChatItem)', () => {
  // The same envelope ChatGroup builds: the verified event fields plus the
  // copied engine fields, merged over the decrypted payload.
  const groupItem = (event: Record<string, unknown>, payload = {}) =>
    mergeReticulumPayloadWithVerifiedEnvelope(
      { messageText: 'hi', ...payload },
      {
        signature: event.eventId,
        id: event.eventId,
        sender: event.authorAddress,
        reticulumChat: true,
        ...reticulumPostDeliveryItemFields(event),
      }
    );

  it('copies the engine fields of a tracked own post', () => {
    const item = groupItem({
      eventId: 'post-1',
      authorAddress: ME,
      localPostDeliverySince: NOW,
      localPostMemberAt: NOW + 3_000,
    });
    expect(item).toMatchObject({
      reticulumPostDeliverySince: NOW,
      reticulumPostMemberAt: NOW + 3_000,
    });
    expect(getReticulumPostDelivery(item, ME, NOW + 4_000)).toEqual({
      scope: 'group',
      state: 'delivered',
      via: 'member',
    });
  });

  it('leaves untracked rows as they were, and a payload cannot fake one', () => {
    const item = groupItem(
      { eventId: 'post-2', authorAddress: ME },
      {
        reticulumPostDeliverySince: NOW,
        reticulumPostMemberAt: NOW,
        localPostDeliverySince: NOW,
      }
    );
    expect(item).not.toHaveProperty('reticulumPostDeliverySince');
    expect(item).not.toHaveProperty('reticulumPostMemberAt');
    expect(hasReticulumPostDeliveryState(item, ME)).toBe(false);
  });
});

// Every key the glyph can ask for exists, translated, in all 12 locales.
const LOCALES = import.meta.glob('../../i18n/locales/*/reticulum.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, any>>;

describe('post delivery strings', () => {
  const keys = [
    'sending',
    'not_picked_up',
    'delivered_member',
    'delivered_own_device',
    'sending_self_dm',
    'not_picked_up_self_dm',
    'delivered_own_device_self_dm',
  ];

  it('has every label and hint in all 12 locales', () => {
    const languages = Object.keys(LOCALES)
      .map((path) => path.split('/').slice(-2)[0])
      .sort();
    expect(languages).toEqual([
      'ar',
      'de',
      'en',
      'es',
      'et',
      'fi',
      'fr',
      'it',
      'ja',
      'pt',
      'ru',
      'zh',
    ]);
    const english = Object.entries(LOCALES).find(([path]) =>
      path.includes('/en/')
    )![1].post_delivery;
    expect(Object.keys(english).sort()).toEqual([...keys].sort());
    for (const [path, locale] of Object.entries(LOCALES)) {
      const strings = locale.post_delivery;
      expect(Object.keys(strings).sort(), path).toEqual([...keys].sort());
      for (const key of keys) {
        expect(Object.keys(strings[key]).sort(), `${path} ${key}`).toEqual([
          'hint',
          'label',
        ]);
        for (const field of ['hint', 'label']) {
          const value = strings[key][field];
          expect(typeof value === 'string' && value.trim(), path).toBeTruthy();
          if (!path.includes('/en/')) {
            // Translated, not English left in place.
            expect(value, `${path} ${key}.${field}`).not.toBe(
              english[key][field]
            );
          }
        }
      }
    }
  });
});
