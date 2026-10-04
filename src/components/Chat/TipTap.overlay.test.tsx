import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import Tiptap from './TipTap';
import {
  COMPOSER_CORNER_BUTTON_PX,
  COMPOSER_CORNER_ICON_PX,
} from './composerCornerLayout';

// The popover picker's trigger, as the corner rail renders it.
const picker = vi.hoisted(() => ({ props: null as any }));
vi.mock('../ReactionPicker', () => ({
  ReactionPicker: (props: any) => {
    picker.props = props;
    return <button aria-label="popover emoji picker" type="button" />;
  },
}));

const setPhone = (phone: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderCornerComposer = (inOverlay: boolean) =>
  render(
    <Tiptap
      compactActions={() => (
        <button className="compact-composer-send" type="button">
          send
        </button>
      )}
      compactChat
      inOverlay={inOverlay}
      insertFiles={() => undefined}
      insertGif={() => undefined}
      isChat
      onEnter={() => undefined}
      placeholder="Reply to discussion..."
      setEditorRef={() => undefined}
    />
  );

describe('TipTap corner composer in a dialog', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    setPhone(true);
    picker.props = null;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('keeps the chat composer as it was: emoji panel and expand', async () => {
    const view = renderCornerComposer(false);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Emoji' })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(
      view.container.querySelector('.compact-composer-expand')
    ).not.toBeNull();
    expect(picker.props).toBeNull();
  });

  it('uses the popover picker at corner size and has no full screen', async () => {
    const view = renderCornerComposer(true);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'popover emoji picker' })
      ).toBeInTheDocument()
    );
    // The app shell's emoji panel sits under a dialog.
    expect(screen.queryByRole('button', { name: 'Emoji' })).toBeNull();
    expect(picker.props.buttonSize).toBe(COMPOSER_CORNER_BUTTON_PX);
    expect(picker.props.iconSize).toBe(COMPOSER_CORNER_ICON_PX);
    expect(typeof picker.props.onGifSelect).toBe('function');
    expect(
      view.container
        .querySelector('.compact-composer-emoji')
        ?.contains(screen.getByRole('button', { name: 'popover emoji picker' }))
    ).toBe(true);
    // No way into the full-screen composer, whose attachment slot belongs to
    // the chat under the dialog.
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull();
    expect(view.container.querySelector('.compact-composer-expand')).toBeNull();
    // Everything else of the corner layout is there.
    expect(
      view.container.querySelector('.tiptap-chat-composer--corners')
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Add attachment' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Formatting' })
    ).toBeInTheDocument();
    expect(
      view.container.querySelector(
        '.compact-composer-rail--right .compact-composer-send'
      )
    ).not.toBeNull();
  });
});
