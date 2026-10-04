import { describe, expect, it, vi } from 'vitest';

vi.mock('./globalApi', () => ({
  getArbitraryEndpointReact: () => '/arbitrary/resources/searchsimple',
  getBaseApiReactForAvatar: () => 'https://node.example',
}));

import {
  buildQortalAvatarUrl,
  resolveWalletAvatarSrc,
} from './walletAvatarCache';

const ADDRESS = 'QgB7zMfujQMLkisp1Lc8PBkVYs75sYB3vV';

// N-13: avatar requests never carry the wallet address, so the node cannot
// tell which wallets are saved on this device.
describe('wallet avatar URLs', () => {
  it('never puts the wallet address in the avatar request', () => {
    const url = buildQortalAvatarUrl('Alice Bob', ADDRESS);
    expect(url).toMatch(
      /\/arbitrary\/THUMBNAIL\/Alice%20Bob\/qortal_avatar\?async=true$/
    );
    expect(url).not.toContain(ADDRESS);
    expect(url).not.toContain('&_=');
  });

  it('asks for no avatar when there is no registered name and no cache', () => {
    expect(
      resolveWalletAvatarSrc({ primaryName: '', walletAddress: ADDRESS })
    ).toBeUndefined();
  });

  it('prefers a cached avatar saved for the same name', () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    expect(
      resolveWalletAvatarSrc({
        primaryName: 'Alice',
        walletAddress: ADDRESS,
        cachedAvatarEntry: { dataUrl, primaryName: 'alice' },
      })
    ).toBe(dataUrl);
  });
});
