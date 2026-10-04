import { afterEach, describe, expect, it, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from '../lib/qdnAvatars/defaultCache';
import { qdnAvatarKey } from '../lib/qdnAvatars/keys';
import {
  API_BASE,
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
} from '../lib/qdnAvatars/testHarness';
import {
  NOTIFICATION_AVATAR_WAIT_MS,
  resolveNotificationIconUrl,
  showOsNotification,
} from './mobileOsNotifications';

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    createChannel: vi.fn(async () => undefined),
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' })),
  },
}));

const showAlertNotification = vi.fn(async (_options: unknown) => ({
  success: true,
}));
vi.mock('../plugins/QortalBackground', () => ({
  QortalBackground: {
    showAlertNotification: (options: unknown) => showAlertNotification(options),
  },
}));

vi.mock('./platform', () => ({
  isCapacitor: () => true,
  isElectron: () => false,
  isMobileViewport: () => false,
}));

const avatarUrl = (name: string) =>
  `${API_BASE}/arbitrary/THUMBNAIL/${encodeURIComponent(
    name
  )}/qortal_avatar?apiKey=k&async=true&_=Qsender`;

afterEach(() => {
  setQdnAvatarCacheForTests(null);
  showAlertNotification.mockClear();
  vi.restoreAllMocks();
});

describe('resolveNotificationIconUrl', () => {
  it('inlines a QDN avatar from the cache as a data URL', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const icon = await resolveNotificationIconUrl(avatarUrl('Alice'));
    expect(icon).toMatch(/^data:image\/png;base64,/);
    expect(h.calls[0].url).toBe(
      `${API_BASE}/arbitrary/THUMBNAIL/Alice/qortal_avatar?async=true`
    );
  });

  it('drops the icon when the node confirms there is no avatar', async () => {
    const h = createAvatarTestHarness({
      handler: () => notPublishedResponse('Bob'),
    });
    setQdnAvatarCacheForTests(h.cache);
    await expect(
      resolveNotificationIconUrl(avatarUrl('Bob'))
    ).resolves.toBeUndefined();
  });

  it('does not hold the notification for a slow node', async () => {
    const h = createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    const url = avatarUrl('Carol');
    let result: string | undefined | null = null;
    void resolveNotificationIconUrl(url).then((value) => {
      result = value;
    });
    await flushAsync(10);
    expect(result).toBeNull();
    await h.advance(NOTIFICATION_AVATAR_WAIT_MS + 1);
    await flushAsync(10);
    // The raw URL stays as the native side's own fallback.
    expect(result).toBe(url);
  });

  it('uses the bundled icon for a well-known app on a slow node', async () => {
    const h = createAvatarTestHarness({
      seeds: { [qdnAvatarKey('Q-Wallets')!]: '/assets/q-wallets.webp' },
      handler: (_url, { kind }) =>
        kind === 'other' ? imageResponse() : new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    const pending = resolveNotificationIconUrl(
      `${API_BASE}/arbitrary/THUMBNAIL/Q-Wallets/qortal_avatar?async=true`
    );
    await flushAsync(10);
    await h.advance(NOTIFICATION_AVATAR_WAIT_MS + 1);
    await expect(pending).resolves.toMatch(/^data:image\/png;base64,/);
  });

  it('leaves data URLs and relative icons alone', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    await expect(
      resolveNotificationIconUrl('data:image/png;base64,AA')
    ).resolves.toBe('data:image/png;base64,AA');
    await expect(
      resolveNotificationIconUrl(undefined)
    ).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(0);
  });
});

describe('showOsNotification', () => {
  it('hands the cached avatar to the native notification', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    await showOsNotification({
      title: 'Dan',
      body: 'hi',
      id: 'dm:Qdan',
      iconUrl: avatarUrl('Dan'),
      notificationType: 'direct',
    });
    expect(showAlertNotification).toHaveBeenCalledTimes(1);
    expect(showAlertNotification.mock.calls[0][0]).toMatchObject({
      iconUrl: expect.stringMatching(/^data:image\/png;base64,/),
      title: 'Dan',
    });
  });
});
