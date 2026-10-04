import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TIME_DAYS_1_IN_MILLISECONDS } from '../../constants/constants';
import { COMPOSER_CORNER_BUTTON_PX } from './composerCornerLayout';
import { ReticulumMessageExpiryButton } from './ReticulumMessageExpiryButton';

describe('ReticulumMessageExpiryButton in the composer corner', () => {
  it('is a round button the size of the other corner controls', () => {
    render(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={2 * TIME_DAYS_1_IN_MILLISECONDS}
        corner
        onChange={() => undefined}
      />
    );

    const button = screen.getByRole('button', { name: 'Set message expiry' });
    expect(button).toHaveStyle({
      borderRadius: '50%',
      height: `${COMPOSER_CORNER_BUTTON_PX}px`,
      width: `${COMPOSER_CORNER_BUTTON_PX}px`,
    });
    expect(button).toHaveTextContent('2D');
  });

  it('keeps its bordered desktop look elsewhere', () => {
    render(<ReticulumMessageExpiryButton onChange={() => undefined} />);

    expect(
      screen.getByRole('button', { name: 'Set message expiry' })
    ).toHaveStyle({ height: '34px', width: '34px' });
  });
});
