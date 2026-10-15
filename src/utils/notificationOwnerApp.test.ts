import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveRegisteredName = vi.hoisted(() => vi.fn());
vi.mock('./qdnNameDisplay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./qdnNameDisplay')>()),
  resolveRegisteredName,
}));

import { getNotificationAppIcon } from './notificationAppIcon';
import {
  getNotificationOwnerSpelling,
  pinNotificationToOwnerApp,
  pinNotificationToOwnerAppSpelled,
} from './notificationOwnerApp';

const QUITTER_AVATAR = '/arbitrary/THUMBNAIL/Quitter/qortal_avatar?async=true';

/** What Core sends for Torq's mention rule (Torq links to Quitter). */
const torqMention = (overrides: Record<string, unknown> = {}) => ({
  type: 'notification',
  event: 'RESOURCE_PUBLISHED',
  data: { service: 'DOCUMENT', name: 'VIPcrypto', identifier: 'q-post-1' },
  appName: 'torq',
  appService: 'APP',
  notificationId: 'quitter-mention-Simon',
  link: 'qortal://APP/Quitter/post/VIPcrypto/q-post-1',
  image: QUITTER_AVATAR,
  message: { en: 'VIPcrypto mentioned you in a post' },
  ...overrides,
});

afterEach(() => {
  resolveRegisteredName.mockReset();
  vi.useRealTimers();
});

describe('pinNotificationToOwnerApp', () => {
  it("opens and shows Torq for Torq's rule that names Quitter", () => {
    const pinned = pinNotificationToOwnerApp(torqMention(), 'Torq');
    expect(pinned.link).toBe('qortal://APP/Torq/post/VIPcrypto/q-post-1');
    expect(pinned.image).toBe(
      '/arbitrary/THUMBNAIL/Torq/qortal_avatar?async=true'
    );
    expect(pinned.appName).toBe('torq');
    expect(pinned.notificationId).toBe('quitter-mention-Simon');
  });

  it('uses the stored name when the registered spelling is not known', () => {
    expect(pinNotificationToOwnerApp(torqMention()).link).toBe(
      'qortal://APP/torq/post/VIPcrypto/q-post-1'
    );
    // A spelling of some other name is ignored.
    expect(pinNotificationToOwnerApp(torqMention(), 'Quitter').link).toBe(
      'qortal://APP/torq/post/VIPcrypto/q-post-1'
    );
  });

  it('leaves a notification that already points at its app alone', () => {
    const own = torqMention({
      link: 'qortal://APP/Torq/rev/VIPcrypto/r-1',
      image: '/arbitrary/THUMBNAIL/Torq/qortal_avatar?async=true',
    });
    expect(pinNotificationToOwnerApp(own, 'Torq')).toBe(own);

    const qmail = {
      event: 'RESOURCE_PUBLISHED',
      appName: 'Q-Mail',
      appService: 'APP',
      notificationId: 'q-mail-notification',
      link: 'qortal://app/Q-Mail',
      image: '/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true',
      data: { name: 'Someone' },
    };
    expect(pinNotificationToOwnerApp(qmail)).toBe(qmail);
  });

  it("keeps the post author's avatar a rule asked for", () => {
    const pinned = pinNotificationToOwnerApp(
      torqMention({
        image: '/arbitrary/THUMBNAIL/VIPcrypto/qortal_avatar?async=true',
      }),
      'Torq'
    );
    expect(pinned.image).toBe(
      '/arbitrary/THUMBNAIL/VIPcrypto/qortal_avatar?async=true'
    );
    expect(pinned.link).toBe('qortal://APP/Torq/post/VIPcrypto/q-post-1');
  });

  it('keeps inline images and bundled assets', () => {
    for (const image of [
      'data:image/png;base64,AAAA',
      '/assets/torq-icon.svg',
      undefined,
    ]) {
      expect(
        pinNotificationToOwnerApp(torqMention({ image }), 'Torq').image
      ).toBe(image);
    }
  });

  it("drops the other app's identifier but keeps the rest of the link", () => {
    expect(
      pinNotificationToOwnerApp(
        torqMention({
          link: 'qortal://APP/Quitter/post/a/b?identifier=quitter-main&tab=replies#top',
        }),
        'Torq'
      ).link
    ).toBe('qortal://APP/Torq/post/a/b?tab=replies#top');
    expect(
      pinNotificationToOwnerApp(
        torqMention({ link: 'qortal://APP/Quitter#/post/a/b' }),
        'Torq'
      ).link
    ).toBe('qortal://APP/Torq#/post/a/b');
  });

  it("opens the app's start page for links that are not an app", () => {
    for (const link of [
      'qortal://VIDEO/Quitter/some-video',
      'qortal://Quitter',
      'qortal://use-embed/x',
      'https://example.com/post',
      '',
    ]) {
      expect(
        pinNotificationToOwnerApp(torqMention({ link }), 'Torq').link
      ).toBe('qortal://APP/Torq');
    }
    // The app's own resources and website stay.
    const ownVideo = torqMention({
      link: 'qortal://VIDEO/Torq/clip-1',
      image: '/arbitrary/THUMBNAIL/torq/qortal_avatar',
    });
    expect(pinNotificationToOwnerApp(ownVideo, 'Torq')).toBe(ownVideo);
  });

  it('uses the website service for a website rule', () => {
    expect(
      pinNotificationToOwnerApp(
        torqMention({ appName: 'my site', appService: 'WEBSITE' }),
        'My Site'
      ).link
    ).toBe('qortal://WEBSITE/My%20Site/post/VIPcrypto/q-post-1');
  });

  it('leaves payments, Q-Chat mentions and other kinds alone', () => {
    const payment = {
      event: 'PAYMENT_RECEIVED',
      data: { sender: 'Q123' },
      image: QUITTER_AVATAR,
    };
    expect(pinNotificationToOwnerApp(payment)).toBe(payment);
    const mention = {
      event: 'Q_CHAT_MENTION',
      appName: 'Q-Chat mentions',
      link: 'qortal://APP/Quitter',
      data: { qChatMention: true },
    };
    expect(pinNotificationToOwnerApp(mention)).toBe(mention);
    const noApp = torqMention({ appName: '' });
    expect(pinNotificationToOwnerApp(noApp)).toBe(noApp);
  });
});

describe('bell icon of a Q-App notification', () => {
  it("shows the app's own avatar, not the app its rule names", () => {
    expect(
      getNotificationAppIcon(torqMention(), {
        isQChatMention: false,
        getApiBase: () => 'http://node.test',
      })
    ).toEqual({ avatar: { name: 'torq', identifier: 'qortal_avatar' } });
  });
});

describe('getNotificationOwnerSpelling', () => {
  it('returns the registered spelling', async () => {
    resolveRegisteredName.mockResolvedValue('Torq');
    await expect(getNotificationOwnerSpelling('torq')).resolves.toBe('Torq');
    expect((await pinNotificationToOwnerAppSpelled(torqMention())).link).toBe(
      'qortal://APP/Torq/post/VIPcrypto/q-post-1'
    );
  });

  it('does not wait long for a slow node', async () => {
    vi.useFakeTimers();
    resolveRegisteredName.mockReturnValue(new Promise(() => {}));
    const spelling = getNotificationOwnerSpelling('torq');
    await vi.advanceTimersByTimeAsync(1500);
    await expect(spelling).resolves.toBe('torq');
  });

  it('does not look up names for other notifications', async () => {
    const payment = { event: 'PAYMENT_RECEIVED', data: {} };
    await expect(pinNotificationToOwnerAppSpelled(payment)).resolves.toBe(
      payment
    );
    expect(resolveRegisteredName).not.toHaveBeenCalled();
  });
});
