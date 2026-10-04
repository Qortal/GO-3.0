import { describe, expect, it } from 'vitest';
import { profileLinksToOfficial } from '../qdnLookup';

const chips = (...links: { label: string; href: string }[]) =>
  profileLinksToOfficial('Nobody In Overrides 7f3a', { links });

// GO-21: a profile link is turned into a Q-App chip only from the checked
// parts of the link, so "..", "%2e%2e" or a path never reach addTab as a name.
describe('profileLinksToOfficial', () => {
  it('turns a plain APP or WEBSITE link into a chip with the decoded name', () => {
    expect(
      chips(
        { label: 'Blog', href: 'qortal://APP/Q-Blog' },
        { label: 'Site', href: 'qortal://WEBSITE/My%20Site' }
      )
    ).toEqual([
      expect.objectContaining({ service: 'APP', name: 'Q-Blog' }),
      expect.objectContaining({ service: 'WEBSITE', name: 'My Site' }),
    ]);
  });

  it('keeps only the app name when the link has a path', () => {
    const [chip] = chips({ label: 'Post', href: 'qortal://APP/Q-Blog/post/1' });
    expect(chip).toMatchObject({ service: 'APP', name: 'Q-Blog' });
  });

  it.each([
    'qortal://APP/..%2F..%2Farbitrary',
    'qortal://APP/%2e%2e',
    'qortal://APP/Q-Blog/../../admin',
    'qortal://WEBSITE/a%2Fb',
  ])('drops %s', (href) => {
    expect(chips({ label: 'x', href })).toEqual([]);
  });

  it('leaves https links as they were', () => {
    expect(chips({ label: 'Web', href: 'https://qortal.dev' })).toEqual([
      expect.objectContaining({ href: 'https://qortal.dev' }),
    ]);
  });
});
