import { describe, expect, it } from 'vitest';
import { parseQdnThumbnailRef } from './qdnThumbnailRef';

describe('parseQdnThumbnailRef', () => {
  it('reads app paths used by notifications', () => {
    expect(
      parseQdnThumbnailRef(
        '/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true'
      )
    ).toEqual({ name: 'Q-Mail', identifier: 'qortal_avatar' });
  });

  it('reads full node URLs with an api key and cache buster', () => {
    expect(
      parseQdnThumbnailRef(
        'https://node.example:12391/arbitrary/THUMBNAIL/Some%20User/qortal_avatar?apiKey=k&async=true&_=Qabc'
      )
    ).toEqual({ name: 'Some User', identifier: 'qortal_avatar' });
  });

  it('reads group avatars', () => {
    expect(
      parseQdnThumbnailRef(
        'http://127.0.0.1:12391/arbitrary/THUMBNAIL/owner/qortal_group_avatar_12'
      )
    ).toEqual({ name: 'owner', identifier: 'qortal_group_avatar_12' });
  });

  it('rejects other resources and bad input', () => {
    expect(parseQdnThumbnailRef('/arbitrary/IMAGE/x/y')).toBeNull();
    expect(
      parseQdnThumbnailRef('/arbitrary/THUMBNAIL/x/y/file.png')
    ).toBeNull();
    expect(parseQdnThumbnailRef('/arbitrary/THUMBNAIL/%E0%A4%A/x')).toBeNull();
    expect(parseQdnThumbnailRef('/assets/logo.svg')).toBeNull();
    expect(parseQdnThumbnailRef(undefined)).toBeNull();
    expect(parseQdnThumbnailRef('')).toBeNull();
  });
});
