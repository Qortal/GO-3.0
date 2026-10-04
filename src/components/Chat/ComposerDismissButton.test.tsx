import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ComposerAttachmentTile,
  ComposerDismissButton,
} from './ComposerDismissButton';
import { COMPOSER_DISMISS_BUTTON_PX } from './composerCornerLayout';

const originalMatchMedia = window.matchMedia;

type Device = 'phone' | 'desktop' | 'wide touch screen';

const matchesOn = (device: Device, query: string): boolean => {
  if (query.includes('orientation')) return false;
  if (query.includes('hover: none')) return device !== 'desktop';
  // theme.breakpoints.down('md'): narrower than 900px.
  return device === 'phone';
};

const emulate = (device: Device) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matchesOn(device, query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('ComposerDismissButton', () => {
  describe('on a phone', () => {
    beforeEach(() => emulate('phone'));

    it('is a thumb-sized X', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <ComposerDismissButton
          desktopIcon={<span data-testid="desktop-icon" />}
          label="Remove file"
          onClick={onClick}
        />
      );

      const button = screen.getByRole('button', { name: 'Remove file' });
      expect(button).toHaveStyle({
        height: `${COMPOSER_DISMISS_BUTTON_PX}px`,
        width: `${COMPOSER_DISMISS_BUTTON_PX}px`,
      });
      expect(screen.queryByTestId('desktop-icon')).not.toBeInTheDocument();
      await user.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('keeps the keyboard up', () => {
      const keepFocus = vi.fn((event) => event.preventDefault());
      render(
        <ComposerDismissButton
          desktopIcon={null}
          keepFocus={keepFocus}
          label="Cancel edit"
          onClick={vi.fn()}
        />
      );

      const button = screen.getByRole('button', { name: 'Cancel edit' });
      button.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      );
      expect(keepFocus).toHaveBeenCalled();
    });

    it('can reach into the padding around it instead of growing its chip', () => {
      render(
        <ComposerDismissButton
          bleed={4}
          desktopIcon={null}
          label="Remove file"
          onClick={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Remove file' })).toHaveStyle({
        marginBottom: '-4px',
        marginTop: '-4px',
      });
    });
  });

  describe('on a touch screen wider than a phone', () => {
    beforeEach(() => emulate('wide touch screen'));

    it('is still a thumb-sized X', () => {
      render(
        <ComposerDismissButton
          desktopIcon={<span data-testid="desktop-icon" />}
          label="Cancel edit"
          onClick={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Cancel edit' })).toHaveStyle({
        height: `${COMPOSER_DISMISS_BUTTON_PX}px`,
      });
      expect(screen.queryByTestId('desktop-icon')).not.toBeInTheDocument();
    });
  });

  describe('on desktop', () => {
    beforeEach(() => emulate('desktop'));

    it('keeps its compact glyph', () => {
      render(
        <ComposerDismissButton
          desktopIcon={<span data-testid="desktop-icon" />}
          label="Remove file"
          onClick={vi.fn()}
        />
      );

      expect(screen.getByTestId('desktop-icon')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Remove file' })
      ).not.toHaveStyle({ height: `${COMPOSER_DISMISS_BUTTON_PX}px` });
    });
  });
});

describe('ComposerAttachmentTile', () => {
  it('puts a visible, thumb-sized remove button beside the picture on phones', async () => {
    emulate('phone');
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <ComposerAttachmentTile label="Remove GIF" onRemove={onRemove}>
        <img alt="pending GIF" />
      </ComposerAttachmentTile>
    );

    const button = screen.getByRole('button', { name: 'Remove GIF' });
    expect(button).toHaveStyle({
      height: `${COMPOSER_DISMISS_BUTTON_PX}px`,
      width: `${COMPOSER_DISMISS_BUTTON_PX}px`,
    });
    expect(button).not.toHaveStyle({ opacity: '0' });
    expect(button.contains(screen.getByAltText('pending GIF'))).toBe(false);
    await user.click(button);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('shows the remove button on a touch screen wider than a phone', async () => {
    // A tablet or an unfolded foldable gets the desktop layout but has no
    // hover either: the X must not wait for one.
    emulate('wide touch screen');
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <ComposerAttachmentTile label="Remove image" onRemove={onRemove}>
        <img alt="pending" />
      </ComposerAttachmentTile>
    );

    const button = screen.getByRole('button', { name: 'Remove image' });
    expect(button).not.toHaveStyle({ opacity: '0' });
    expect(button).not.toHaveStyle({ position: 'absolute' });
    expect(button).toHaveStyle({
      height: `${COMPOSER_DISMISS_BUTTON_PX}px`,
    });
    expect(button.contains(screen.getByAltText('pending'))).toBe(false);
    await user.click(button);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('adds no padding above or below the picture on phones', () => {
    emulate('phone');
    const { container } = render(
      <ComposerAttachmentTile label="Remove image" onRemove={vi.fn()}>
        <img alt="pending" />
      </ComposerAttachmentTile>
    );

    const chip = container.querySelector('[data-composer-attachment-chip]');
    expect(chip).toHaveStyle({ paddingTop: '0px', paddingBottom: '0px' });
  });

  it('keeps the hover button over the picture on desktop', () => {
    emulate('desktop');
    render(
      <ComposerAttachmentTile label="Remove image" onRemove={vi.fn()}>
        <img alt="pending" />
      </ComposerAttachmentTile>
    );

    expect(screen.getByRole('button', { name: 'Remove image' })).toHaveStyle({
      opacity: '0',
      position: 'absolute',
    });
  });
});
