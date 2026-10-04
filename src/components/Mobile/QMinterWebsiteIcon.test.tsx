import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node:12391',
}));

import { qdnAvatarKey } from '../../lib/qdnAvatars';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from '../../lib/qdnAvatars/testHarness';
import { QMinterWebsiteIcon } from './QMinterWebsiteIcon';

const SEED = '/seeds/q-minter.webp';
const NODE_AVATAR =
  'http://node:12391/arbitrary/THUMBNAIL/Q-Minter/qortal_avatar?async=true';

const never = () => new Promise<Response>(() => {});

afterEach(async () => {
  await flushAsync();
  setQdnAvatarCacheForTests(null);
});

const iconSrc = () => screen.getByAltText('Q-Minter').getAttribute('src');

describe('QMinterWebsiteIcon', () => {
  it('shows the shipped icon at once and the live one when it arrives', async () => {
    let answer: (response: Response) => void = () => {};
    const h = createAvatarTestHarness({
      seeds: { [qdnAvatarKey('Q-Minter')!]: SEED },
      handler: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    setQdnAvatarCacheForTests(h.cache);

    render(<QMinterWebsiteIcon />);
    expect(iconSrc()).toBe(SEED);

    await act(async () => {
      await h.idle();
      answer(imageResponse());
      await h.idle();
    });

    expect(iconSrc()).toMatch(/^blob:test\//);
  });

  it('falls back to the node avatar, then the favicons, then the icon', async () => {
    setQdnAvatarCacheForTests(
      createAvatarTestHarness({
        seeds: { [qdnAvatarKey('Q-Minter')!]: SEED },
        handler: never,
      }).cache
    );

    render(<QMinterWebsiteIcon />);
    expect(iconSrc()).toBe(SEED);

    fireEvent.error(screen.getByAltText('Q-Minter'));
    expect(iconSrc()).toBe(NODE_AVATAR);

    fireEvent.error(screen.getByAltText('Q-Minter'));
    expect(iconSrc()).toBe('http://node:12391/site/Q-Minter/favicon.ico');

    fireEvent.error(screen.getByAltText('Q-Minter'));
    expect(iconSrc()).toBe(
      'http://node:12391/render/WEBSITE/Q-Minter/favicon.ico'
    );

    fireEvent.error(screen.getByAltText('Q-Minter'));
    expect(screen.queryByAltText('Q-Minter')).toBeNull();
    expect(screen.getByTestId('SavingsRoundedIcon')).toBeInTheDocument();
  });
});
