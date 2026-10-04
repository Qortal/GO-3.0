import { describe, expect, it } from 'vitest';
import { getNotificationAppIcon } from './notificationAppIcon';

const getApiBase = () => 'http://node.test';

describe('getNotificationAppIcon', () => {
  it('shows a QDN thumbnail path from the avatar cache', () => {
    expect(
      getNotificationAppIcon(
        {
          appName: 'Q-Mail',
          image: '/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true',
        },
        { isQChatMention: false, getApiBase }
      )
    ).toEqual({
      avatar: { name: 'Q-Mail', identifier: 'qortal_avatar' },
    });
  });

  it("falls back to the app's avatar, then Q-Mail", () => {
    expect(
      getNotificationAppIcon(
        { appName: 'Q-Tube' },
        { isQChatMention: false, getApiBase }
      ).avatar
    ).toEqual({ name: 'Q-Tube', identifier: 'qortal_avatar' });
    expect(
      getNotificationAppIcon({}, { isQChatMention: false, getApiBase }).avatar
    ).toEqual({ name: 'Q-Mail', identifier: 'qortal_avatar' });
  });

  it('keeps other node images as URLs', () => {
    expect(
      getNotificationAppIcon(
        { appName: 'X', image: '/arbitrary/IMAGE/x/y' },
        { isQChatMention: false, getApiBase }
      )
    ).toEqual({ avatar: null, src: 'http://node.test/arbitrary/IMAGE/x/y' });
  });

  it('keeps bundled assets and inline images as they are', () => {
    const icon = (image: string) =>
      getNotificationAppIcon(
        { appName: 'Q-Wallets', image },
        { isQChatMention: false, getApiBase }
      );
    expect(icon('/assets/LogoSelected-abc123.svg')).toEqual({
      avatar: null,
      src: '/assets/LogoSelected-abc123.svg',
    });
    expect(icon('./assets/LogoSelected.svg').src).toBe(
      './assets/LogoSelected.svg'
    );
    expect(icon('data:image/svg+xml;base64,PHN2Zz4=').src).toBe(
      'data:image/svg+xml;base64,PHN2Zz4='
    );
    expect(icon('blob:https://localhost/1').src).toBe(
      'blob:https://localhost/1'
    );
  });

  it('only loads full URLs from the own node', () => {
    const icon = (image: string) =>
      getNotificationAppIcon(
        { appName: 'X', image },
        { isQChatMention: false, getApiBase }
      );
    expect(icon('http://node.test/arbitrary/IMAGE/x/y').src).toBe(
      'http://node.test/arbitrary/IMAGE/x/y'
    );
    expect(icon('https://tracker.example/pixel.png')).toEqual({
      avatar: null,
    });
    expect(icon('//tracker.example/pixel.png')).toEqual({ avatar: null });
    expect(icon('http://node.test.evil/x.png')).toEqual({ avatar: null });
  });

  it('has no icon for Q-Chat mentions and never throws', () => {
    expect(
      getNotificationAppIcon(
        { appName: 'Q-Mail' },
        { isQChatMention: true, getApiBase }
      )
    ).toEqual({ avatar: null });
    expect(
      getNotificationAppIcon(
        { image: '/arbitrary/IMAGE/x/y' },
        {
          isQChatMention: false,
          getApiBase: () => {
            throw new Error('no node');
          },
        }
      )
    ).toEqual({ avatar: null });
  });
});
