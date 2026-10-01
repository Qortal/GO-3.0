import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { MessageItem } from './MessageItem';
import { setReticulumDmDeliveryTrackingSince } from './reticulumDmDeliveryState';

// The glyph gating lives in MessageItem; its heavy children are reduced to
// stubs. MessageDisplay keeps rendering its trailing content, which is where
// a grouped (header-less) message shows its glyph.
vi.mock('../../App', async () => {
  const { createContext: create } = await import('react');
  return {
    QORTAL_APP_CONTEXT: create({
      getIndividualUserInfo: async () => null,
    }),
    getBaseApiReact: () => '',
  };
});
vi.mock('../../hooks/usePresence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/usePresence')>()),
  useStatus: () => 'offline',
}));
vi.mock('./MessageDisplay', () => ({
  MessageDisplay: ({ trailingContent }: { trailingContent?: ReactNode }) => (
    <div data-testid="message-display">{trailingContent}</div>
  ),
}));
vi.mock('../Embeds/Embed', () => ({ Embed: () => null }));
vi.mock('../ReactionPicker', () => ({ ReactionPicker: () => null }));
vi.mock('./ReticulumImageViewer', () => ({ ReticulumImageViewer: () => null }));
vi.mock('./AvatarPreviewModal', () => ({ AvatarPreviewModal: () => null }));

const ME = 'QMeAddress';
const PEER = 'QPeerAddress';
const NOW = 1_800_000_000_000;

const dm = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  eventId: 'event-1',
  signature: 'event-1',
  timestamp: NOW,
  sender: ME,
  senderAddress: ME,
  senderName: ME,
  recipientAddress: PEER,
  text: '<p>hello</p>',
  message: '<p>hello</p>',
  messageText: 'hello',
  reticulumChat: true,
  reticulumDirect: true,
  reticulumDeliveryStatus: 'pending',
  ...overrides,
});

const renderItem = (
  message: Record<string, unknown>,
  props: Record<string, unknown> = {}
) =>
  render(
    <MessageItem
      {...({
        handleReaction: vi.fn(),
        isLast: false,
        isPrivate: true,
        message,
        myAddress: ME,
        onReply: vi.fn(),
        onSeen: vi.fn(),
        reactions: {},
        reticulumChatEnabled: true,
        ...props,
      } as any)}
    />
  );

describe('MessageItem Reticulum DM delivery glyph', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setReticulumDmDeliveryTrackingSince(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Counted in the DOM, hidden or not, so a second copy in the collapsed
  // (display: none) header row would fail the test.
  const glyphsIn = (container: HTMLElement) =>
    container.querySelectorAll('[data-delivery-state]');

  it('shows exactly one glyph in the header of an own DM', () => {
    const { container } = renderItem(dm());
    expect(glyphsIn(container)).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Sending' })).toBeInTheDocument();
    expect(screen.getByTestId('message-display')).not.toContainElement(
      glyphsIn(container)[0] as HTMLElement
    );
  });

  it('shows exactly one glyph after the text of a grouped own DM', () => {
    const { container } = renderItem(dm(), { isGroupedWithPrevious: true });
    expect(glyphsIn(container)).toHaveLength(1);
    const glyph = screen.getByRole('img', { name: 'Sending' });
    expect(screen.getByTestId('message-display')).toContainElement(glyph);
  });

  it('shows no glyph for group posts, Saved Messages or incoming DMs', () => {
    for (const message of [
      dm({ reticulumDirect: false }),
      dm({ recipientAddress: ME, reticulumDeliveryStatus: 'sent' }),
      dm({
        sender: PEER,
        senderAddress: PEER,
        recipientAddress: ME,
        reticulumDeliveryStatus: 'received',
      }),
    ]) {
      for (const isGroupedWithPrevious of [false, true]) {
        const { container, unmount } = renderItem(message, {
          isGroupedWithPrevious,
        });
        expect(glyphsIn(container)).toHaveLength(0);
        unmount();
      }
    }
  });

  it('shows no glyph outside a Reticulum list (legacy Core DMs)', () => {
    // A Core DM payload can carry reticulumDirect / delivery fields and a
    // spoofed sender; only lists built from the Reticulum engine are trusted.
    const { container } = renderItem(dm({ reticulumDeliveryStatus: 'sent' }), {
      reticulumChatEnabled: false,
    });
    expect(glyphsIn(container)).toHaveLength(0);
  });

  it('shows no glyph on temp, updating or reply-preview rows', () => {
    for (const props of [
      { isTemp: true },
      { isUpdating: true },
      { isShowingAsReply: true },
    ]) {
      const { container, unmount } = renderItem(dm(), props);
      expect(glyphsIn(container)).toHaveLength(0);
      unmount();
    }
  });
});
