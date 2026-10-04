import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from '../../lib/qdnAvatars/testHarness';
import { MessageItem } from './MessageItem';

vi.mock('../../App', async () => {
  const { createContext: create } = await import('react');
  return {
    QORTAL_APP_CONTEXT: create({
      getIndividualUserInfo: async () => null,
    }),
    getBaseApiReact: () => 'http://node.test',
  };
});
vi.mock('../../hooks/usePresence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/usePresence')>()),
  useStatus: () => 'offline',
}));
vi.mock('./MessageDisplay', () => ({ MessageDisplay: () => null }));
vi.mock('../Embeds/Embed', () => ({ Embed: () => null }));
vi.mock('../ReactionPicker', () => ({ ReactionPicker: () => null }));
vi.mock('./ReticulumImageViewer', () => ({ ReticulumImageViewer: () => null }));
vi.mock('./AvatarPreviewModal', () => ({
  AvatarPreviewModal: ({ open, src }: { open: boolean; src?: string }) =>
    open && src ? <img alt="" data-testid="avatar-preview" src={src} /> : null,
}));

const ME = 'QMeAddress';
const PEER = 'QPeerAddress';

const incoming = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  eventId: 'event-1',
  signature: 'event-1',
  timestamp: 1_800_000_000_000,
  sender: PEER,
  senderAddress: PEER,
  senderName: 'Peer',
  recipientAddress: ME,
  text: '<p>hello</p>',
  message: '<p>hello</p>',
  messageText: 'hello',
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
        isPrivate: false,
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

const avatarImages = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('img')).filter((img) =>
    (img.getAttribute('src') ?? '').startsWith('blob:')
  );

afterEach(() => {
  setQdnAvatarCacheForTests(null);
  vi.unstubAllGlobals();
});

describe('MessageItem sender avatar', () => {
  it("shows the sender's cached avatar", async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = renderItem(incoming());
    await act(async () => {
      await flushAsync();
    });
    expect(avatarImages(container)).toHaveLength(1);
    expect(h.calls[0].url).toContain(
      '/arbitrary/THUMBNAIL/Peer/qortal_avatar?async=true'
    );
  });

  it('keeps the letter when the node is down, without throwing', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = renderItem(incoming());
    await act(async () => {
      await flushAsync();
    });
    expect(avatarImages(container)).toHaveLength(0);
  });

  it('shows the group avatar on official group system messages', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    renderItem(
      incoming({
        groupId: 77,
        qchatSystem: {
          groupId: 77,
          groupName: 'Garden',
          type: 'calendar-event-created',
        },
        syntheticReticulumCalendarSystem: true,
      }),
      { reticulumGroupAvatarOwnerName: 'Owner' }
    );
    await act(async () => {
      await flushAsync();
    });
    expect(h.calls.map((call) => call.url)).toEqual([
      'http://node:12391/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_77?async=true',
    ]);
  });

  it('keeps the group letter on system messages while the owner is unknown', async () => {
    const h = createAvatarTestHarness({
      handler: () => imageResponse(),
      seeds: { 'THUMBNAIL/quitter/qortal_avatar': '/seeds/quitter.webp' },
    });
    setQdnAvatarCacheForTests(h.cache);
    // Calendar system messages carry the group name as senderName.
    const { container } = renderItem(
      incoming({
        groupId: 77,
        senderName: 'Quitter',
        qchatSystem: {
          groupId: 77,
          groupName: 'Quitter',
          type: 'calendar-event-created',
        },
        syntheticReticulumCalendarSystem: true,
      }),
      { reticulumGroupAvatarOwnerName: '' }
    );
    await act(async () => {
      await flushAsync();
    });
    expect(h.calls).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('previews the cached avatar at once, then the full-size one', async () => {
    // Records image loads, which jsdom never finishes itself.
    const loads: { url: string; onload: (() => void) | null }[] = [];
    vi.stubGlobal(
      'Image',
      class {
        url = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
          this.url = value;
          loads.push(this);
        }
      }
    );
    const fullUrl = 'http://node.test/arbitrary/THUMBNAIL/Peer/qortal_avatar';
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = renderItem(incoming(), {
      reticulumChatEnabled: false,
    });
    await act(async () => {
      await flushAsync();
    });
    const [img] = avatarImages(container);
    expect(img).toBeTruthy();
    fireEvent.load(img);
    fireEvent.click(img.parentElement as HTMLElement);
    const preview = () =>
      screen.getByTestId('avatar-preview').getAttribute('src');
    expect(preview()).toBe('blob:test/1');
    const fullLoad = loads.find((load) => load.url === fullUrl);
    expect(fullLoad).toBeTruthy();
    act(() => {
      fullLoad?.onload?.();
    });
    expect(preview()).toBe(fullUrl);
  });
});
