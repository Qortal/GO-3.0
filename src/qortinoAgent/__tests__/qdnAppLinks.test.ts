import { describe, expect, it } from 'vitest';
import {
  buildQdnAppLink,
  classifyQdnActivity,
  formatQdnResourceLine,
} from '../qdnAppLinks';

describe('qdnAppLinks (full MA Helper set)', () => {
  it('builds Q-Tube video deep links with _metadata route id', () => {
    const link = buildQdnAppLink(
      'Simon James',
      'VIDEO',
      'qtube_vid_abc123'
    );
    expect(link).toBe(
      'qortal://APP/Q-Tube/video/Simon%20James/qtube_vid_abc123_metadata'
    );
  });

  it('builds Quitter post deep links', () => {
    const id = 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-abcdefghijklmno-v1';
    const link = buildQdnAppLink('Qortal Justin', 'DOCUMENT', id);
    expect(link).toContain('qortal://APP/Quitter/post/');
    expect(link).toContain(encodeURIComponent('Qortal Justin'));
  });

  it('builds Q-Blog, Subwire, Q-Music, Ear-Bump, Q-Share, Q-Manager, Q-Shop, Q-Fund, Q-Chat', () => {
    expect(
      buildQdnAppLink('Alice', 'BLOG_POST', 'q-blog-alice-post-hello-world')
    ).toBe('qortal://APP/Q-Blog/Alice/alice/hello-world');

    const subId = '7l1NGsWiY0SgPb-FJVWQM-xxxxx-abcdefghijklmno-v1';
    expect(buildQdnAppLink('Bob', 'DOCUMENT', subId)).toBe(
      `qortal://APP/Subwire/article/Bob/${encodeURIComponent(subId)}`
    );

    expect(
      buildQdnAppLink('Carol', 'AUDIO', 'enjoymusic_song_xyz')
    ).toBe('qortal://APP/Q-Music/songs/Carol/enjoymusic_song_xyz');

    expect(
      buildQdnAppLink('Carol', 'PLAYLIST', 'enjoymusic_playlist_xyz')
    ).toBe('qortal://APP/Q-Music/playlists/Carol/enjoymusic_playlist_xyz');

    expect(
      buildQdnAppLink('Dan', 'PLAYLIST', 'earbump_playlist_xyz')
    ).toBe('qortal://APP/Ear-Bump/playlists/Dan/earbump_playlist_xyz');

    // MA Helper: Ear-Bump songs have no deep link
    expect(buildQdnAppLink('Dan', 'AUDIO', 'earbump_song_xyz')).toBeNull();

    expect(
      buildQdnAppLink('Eve', 'FILE', 'qshare_file_abc_f_deadbeef')
    ).toBe(
      'qortal://APP/Q-Share/share/Eve/qshare_file_abc_metadata'
    );

    expect(buildQdnAppLink('Frank', 'FILE', 'my-doc.pdf')).toBe(
      'qortal://APP/Q-Manager/file/Frank/my-doc.pdf'
    );

    expect(buildQdnAppLink('Gina', 'PRODUCT', 'q-store-product-1')).toBe(
      'qortal://APP/Q-Shop/Gina/q-store-product-1'
    );

    expect(buildQdnAppLink('Hank', 'DOCUMENT', 'qfund_campaign_1')).toBe(
      'qortal://APP/Q-Fund/Hank/qfund_campaign_1'
    );

    expect(buildQdnAppLink('Ivy', 'DOCUMENT', 'qchat_msg_1')).toBe(
      'qortal://APP/Q-Chat/message/Ivy/qchat_msg_1'
    );
  });

  it('opens WEBSITE / APP roots and Q-Shops app-only', () => {
    expect(buildQdnAppLink('My Site', 'WEBSITE', 'default')).toBe(
      'qortal://WEBSITE/My%20Site'
    );
    expect(buildQdnAppLink('My App', 'APP', 'default')).toBe(
      'qortal://APP/My%20App'
    );
    // Q-Shops: app root only (no per-item path)
    expect(
      buildQdnAppLink('Shopper', 'DOCUMENT', 'q-store-order-123')
    ).toBe('qortal://APP/Q-Shops');
  });

  it('Q-Mail is preview-only (no deep link)', () => {
    expect(
      buildQdnAppLink('Mailer', 'MAIL_PRIVATE', '_mail_inbox_1')
    ).toBeNull();
    expect(classifyQdnActivity('MAIL_PRIVATE', '_mail_inbox_1').isAux).toBe(
      true
    );
  });

  it('classifies likes vs primary publishes', () => {
    const like = classifyQdnActivity('DOCUMENT', 'qtube_like_xyz', 'Crowetic');
    expect(like.kind).toBe('qtube_like');
    expect(like.isAux).toBe(true);
    expect(like.link).toBeNull();

    const video = classifyQdnActivity(
      'VIDEO',
      'qtube_vid_hello',
      'Crowetic'
    );
    expect(video.kind).toBe('qtube_video');
    expect(video.link).toContain('Q-Tube/video');
  });

  it('formats resource lines with open links and small hash', () => {
    const line = formatQdnResourceLine({
      index: 1,
      name: 'Simon James',
      service: 'VIDEO',
      identifier: 'qtube_vid_demo01',
      title: 'My demo video',
    });
    expect(line).toContain('Q-Tube video');
    expect(line).toContain('[Open in Q-Tube](qortal://APP/Q-Tube/');
    expect(line).toContain('`qtube_vid_demo01`');
  });
});
