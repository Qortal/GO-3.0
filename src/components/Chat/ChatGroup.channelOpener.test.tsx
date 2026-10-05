import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/i18n';
import {
  getReticulumOtherChannelsUnread,
  ReticulumPhoneChannelOpener,
} from './ChatGroup';

const channels = [
  { channelId: 'general' },
  { channelId: 'off-topic' },
  { channelId: 'dev' },
];

const summaries = (
  entries: Record<string, Record<string, unknown>>
): Map<string, any> =>
  new Map(
    Object.entries(entries).map(([channelId, summary]) => [
      channelId,
      { groupId: 1, channelId, ...summary },
    ])
  );

describe('getReticulumOtherChannelsUnread', () => {
  it('ignores the open channel', () => {
    expect(
      getReticulumOtherChannelsUnread(
        channels,
        summaries({ general: { unreadCount: 4 } }),
        'general'
      )
    ).toBe('none');
  });

  it('reports unread in another channel', () => {
    expect(
      getReticulumOtherChannelsUnread(
        channels,
        summaries({ general: { unreadCount: 0 }, dev: { unreadCount: 2 } }),
        'general'
      )
    ).toBe('unread');
  });

  it('lets a mention anywhere else outrank plain unread', () => {
    expect(
      getReticulumOtherChannelsUnread(
        channels,
        summaries({
          'off-topic': { unreadCount: 1 },
          dev: { hasUnreadMention: true, unreadCount: 1 },
        }),
        'general'
      )
    ).toBe('mention');
    expect(
      getReticulumOtherChannelsUnread(
        channels,
        summaries({ dev: { mentionCount: 1 } }),
        'general'
      )
    ).toBe('mention');
  });

  it('only counts channels the reader can see', () => {
    expect(
      getReticulumOtherChannelsUnread(
        channels,
        summaries({ 'admins-only': { unreadCount: 9 } }),
        'general'
      )
    ).toBe('none');
  });
});

describe('ReticulumPhoneChannelOpener', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  const renderOpener = (otherChannelsUnread?: 'none' | 'unread' | 'mention') =>
    render(
      <ReticulumPhoneChannelOpener
        channelName="General"
        groupName="Qortal Project"
        onToggle={vi.fn()}
        open={false}
        otherChannelsUnread={otherChannelsUnread}
      />
    );

  it('has no dot when nothing is waiting elsewhere', () => {
    const { container } = renderOpener();
    expect(container.querySelector('[data-other-channels-unread]')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Show channels' })
    ).toBeInTheDocument();
  });

  it('shows the dot and says why for unread in another channel', () => {
    const { container } = renderOpener('unread');
    expect(
      container.querySelector('[data-other-channels-unread="unread"]')
    ).not.toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Show channels, new messages in other channels',
      })
    ).toBeInTheDocument();
  });

  it('marks a mention elsewhere', () => {
    const { container } = renderOpener('mention');
    expect(
      container.querySelector('[data-other-channels-unread="mention"]')
    ).not.toBeNull();
  });
});
