import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { ComposerDiscardButton } from './ComposerDiscardButton';
import { composerExpiryDisplaced, composerStageThreeIsShort } from './TipTap';
import {
  COMPOSER_CORNER_BUTTON_PX,
  COMPOSER_FOUR_SLOT_PX,
  COMPOSER_STAGE_THREE_MAX_PX,
} from './composerCornerLayout';

describe('ComposerDiscardButton', () => {
  it('discards when there is a message', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    render(<ComposerDiscardButton idle={false} onDiscard={onDiscard} />);

    const button = screen.getByRole('button', { name: 'Discard message' });
    expect(button).toHaveClass('compact-composer-discard');
    expect(button).not.toHaveAttribute('data-idle');

    await user.click(button);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('is as big a target as the other corner controls', () => {
    render(<ComposerDiscardButton idle={false} onDiscard={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Discard message' })).toHaveStyle(
      {
        height: `${COMPOSER_CORNER_BUTTON_PX}px`,
        width: `${COMPOSER_CORNER_BUTTON_PX}px`,
      }
    );
  });

  it('stays mounted but inert while there is nothing to discard', () => {
    const onDiscard = vi.fn();
    render(<ComposerDiscardButton idle onDiscard={onDiscard} />);

    const button = screen.getByRole('button', { name: 'Discard message' });
    // The rail CSS hides it by this attribute; a click that still reaches it
    // (keyboard, assistive tech) must not throw anything away.
    expect(button).toHaveAttribute('data-idle', '');
    button.click();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('does nothing while the message is being sent', () => {
    const onDiscard = vi.fn();
    render(
      <ComposerDiscardButton disabled idle={false} onDiscard={onDiscard} />
    );

    const button = screen.getByRole('button', { name: 'Discard message' });
    expect(button).toBeDisabled();
    button.click();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});

describe('composerExpiryDisplaced', () => {
  const rail = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = `<div class="compact-composer-rail--right">${html}</div>`;
    return root;
  };
  const expiry = '<div class="compact-composer-expiry"></div>';
  const send = '<button class="compact-composer-send"></button>';

  it('gives a group an extra slot on the right once discard shows', () => {
    expect(
      composerExpiryDisplaced(
        rail(
          `${expiry}<button class="compact-composer-discard"></button>${send}`
        )
      )
    ).toBe(true);
  });

  it('needs no extra slot while discard is idle', () => {
    expect(
      composerExpiryDisplaced(
        rail(
          `${expiry}<button class="compact-composer-discard" data-idle=""></button>${send}`
        )
      )
    ).toBe(false);
  });

  it('gives direct messages, which have no expiry, no extra gutter', () => {
    expect(
      composerExpiryDisplaced(
        rail(`<button class="compact-composer-discard"></button>${send}`)
      )
    ).toBe(false);
  });
});

describe('composerStageThreeIsShort', () => {
  it('lets a portrait phone grow stage 3 to four buttons', () => {
    expect(composerStageThreeIsShort(Number.POSITIVE_INFINITY, 800)).toBe(
      false
    );
    expect(composerStageThreeIsShort(300, 800)).toBe(false);
  });

  it('is short when attachments or the tray leave the bar under four buttons', () => {
    expect(composerStageThreeIsShort(COMPOSER_FOUR_SLOT_PX - 20, 800)).toBe(
      true
    );
  });

  it('is short when 45% of the viewport is under four buttons', () => {
    expect(composerStageThreeIsShort(Number.POSITIVE_INFINITY, 300)).toBe(true);
    const tallEnough = Math.ceil(COMPOSER_FOUR_SLOT_PX / 0.45);
    expect(
      composerStageThreeIsShort(Number.POSITIVE_INFINITY, tallEnough)
    ).toBe(false);
    expect(
      composerStageThreeIsShort(Number.POSITIVE_INFINITY, tallEnough - 4)
    ).toBe(true);
  });

  it('rounds the room the way the stylesheet gets it', () => {
    expect(composerStageThreeIsShort(COMPOSER_FOUR_SLOT_PX - 0.4, 800)).toBe(
      false
    );
    expect(composerStageThreeIsShort(COMPOSER_FOUR_SLOT_PX - 0.6, 800)).toBe(
      true
    );
  });

  it('is never short just because of its own cap', () => {
    expect(
      composerStageThreeIsShort(COMPOSER_STAGE_THREE_MAX_PX + 100, 2000)
    ).toBe(false);
  });
});
