import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings
// rather than returning raw keys.
import '../../i18n/i18n';
import { ChatList } from './ChatList';
import {
  clearAppErrorsForTests,
  getRecentAppErrors,
} from '../../utils/appErrorRing';

// A chat row that throws shows "Invalid Data". It must be drawn again once
// its data is fixed, stop retrying when it keeps failing, and leave a
// content-free record for Copy diagnostics.

const virtualizer = vi.hoisted(() => ({
  count: 0,
  getTotalSize: () => virtualizer.count * 80,
  getVirtualItems: () =>
    Array.from({ length: virtualizer.count }, (_, index) => ({
      index,
      key: index,
      size: 80,
      start: index * 80,
    })),
  isScrolling: false,
  getOffsetForIndex: vi.fn(
    (index: number, align: 'start' | 'end') => [index * 80, align] as const
  ),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  scrollToOffset: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: (range: {
    startIndex: number;
    endIndex: number;
    overscan: number;
    count: number;
  }) => {
    const start = Math.max(0, range.startIndex - range.overscan);
    const end = Math.min(range.count - 1, range.endIndex + range.overscan);
    return Array.from(
      { length: Math.max(0, end - start + 1) },
      (_, offset) => start + offset
    );
  },
  useVirtualizer: (options: { count: number }) => {
    virtualizer.count = options.count;
    return virtualizer;
  },
}));

const rows = vi.hoisted(() => ({ throwsLeft: new Map<string, number>() }));

vi.mock('./MessageItem', () => ({
  MessageItem: ({
    message,
    reactions,
    reply,
  }: {
    message: { signature?: string };
    reactions?: Record<string, unknown> | null;
    reply?: { images?: unknown; messageText?: unknown } | null;
  }) => {
    const signature = String(message?.signature);
    const left = rows.throwsLeft.get(signature) ?? 0;
    if (left > 0) {
      rows.throwsLeft.set(signature, left - 1);
      throw new TypeError("Cannot read properties of null (reading 'map')");
    }
    if (reactions && '💥' in reactions) {
      throw new TypeError('reactions entry is not a list');
    }
    return (
      <div
        data-testid={`message-${signature}`}
        data-reply-images={reply ? JSON.stringify(reply.images ?? null) : ''}
        data-reply-text={reply ? String(reply.messageText ?? '') : ''}
      />
    );
  },
}));

vi.mock('./ChatOptions', () => ({
  ChatOptions: () => null,
}));

const message = (
  signature: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  signature,
  id: signature,
  message: '<p>secret words</p>',
  messageText: '<p>secret words</p>',
  sender: 'Qremote',
  senderName: 'remote',
  timestamp: Number(signature.replace(/\D/g, '')) || 1,
  ...overrides,
});

const baseProps = {
  chatId: 'group-1:general',
  chatReferences: {},
  handleReaction: vi.fn(),
  initialMessages: [],
  myAddress: 'Qme',
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onReply: vi.fn(),
  reticulumChatEnabled: true,
  reticulumInitialHistoryReady: true,
  reticulumUnreadCount: 0,
  reticulumViewActive: true,
  tempChatReferences: [],
  tempMessages: [],
};

// React 19 reports renders it redrew past through onRecoverableError; RTL's
// default would fail the run.
const ROOT_OPTIONS = { onRecoverableError: () => {} } as const;

const invalidRows = () => screen.queryAllByText(/Invalid Data/i).length;

/** Catches recorded for the one broken row so far. */
const catches = () => getRecentAppErrors()[0]?.count ?? 0;

const sleep = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe('ChatList row recovery', () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearAppErrorsForTests();
    rows.throwsLeft.clear();
    let nextFrame = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws a row again after it failed and records what it looked like', async () => {
    // Three throws: React's own synchronous retry absorbs a single one, so
    // the boundary would never see it.
    rows.throwsLeft.set('sig-zebra', 3);
    render(
      <ChatList
        {...baseProps}
        initialMessages={[
          message('m1'),
          message('m2'),
          message('sig-zebra', { timestamp: 3 }),
        ]}
      />,
      ROOT_OPTIONS
    );
    await waitFor(() =>
      expect(screen.getByTestId('message-sig-zebra')).toBeInTheDocument()
    );
    expect(invalidRows()).toBe(0);
    const [entry] = getRecentAppErrors();
    expect(entry).toMatchObject({
      kind: 'caught',
      boundary: 'chat-row',
      name: 'TypeError',
    });
    expect(entry.healed).toBeGreaterThanOrEqual(1);
    expect(entry.shape).toContain('surface:group');
    expect(entry.shape).toContain('last:yes');
    expect(entry.shape).toContain('fromEnd:0');
    expect(JSON.stringify(entry)).not.toMatch(/secret|zebra|Qremote|remote/);
  });

  it("clears the box once the row's data is fixed", async () => {
    const messages = [message('m1'), message('m2'), message('m3')];
    const view = render(
      <ChatList
        {...baseProps}
        initialMessages={messages}
        chatReferences={{ m3: { reactions: { '💥': [{ sender: 'Qx' }] } } }}
      />,
      ROOT_OPTIONS
    );
    await waitFor(() => expect(invalidRows()).toBe(1));
    // The timed retries run out (waitFor lets their updates through; one
    // long act() would hold them back until it ends)...
    await waitFor(() => expect(catches()).toBe(6), { timeout: 3_000 });
    await sleep(700);
    // ...and the box stays: the same data throws every time.
    expect(catches()).toBe(6);
    expect(invalidRows()).toBe(1);
    view.rerender(
      <ChatList
        {...baseProps}
        initialMessages={messages}
        chatReferences={{ m3: { reactions: { '👍': [{ sender: 'Qx' }] } } }}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('message-m3')).toBeInTheDocument()
    );
    expect(invalidRows()).toBe(0);
    expect(getRecentAppErrors()[0].healed).toBeGreaterThanOrEqual(1);
  });

  it('stops drawing a row that keeps failing', async () => {
    const messages = [message('m1'), message('m2'), message('m3')];
    const broken = () => ({
      m3: { reactions: { '💥': [{ sender: 'Qx' }] } },
    });
    const view = render(
      <ChatList
        {...baseProps}
        initialMessages={messages}
        chatReferences={broken()}
      />,
      ROOT_OPTIONS
    );
    await waitFor(() => expect(catches()).toBe(6), { timeout: 3_000 });
    await sleep(200);
    for (let i = 0; i < 6; i += 1) {
      view.rerender(
        <ChatList
          {...baseProps}
          initialMessages={messages}
          chatReferences={broken()}
        />
      );
      await sleep(50);
    }
    await sleep(300);
    expect(invalidRows()).toBe(1);
    const entries = getRecentAppErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0].boundary).toBe('chat-row');
    // 6 catches (1 + 5 timed retries), then 3 data changes a minute.
    expect(entries[0].count).toBe(9);
    expect(entries[0].healed).toBe(0);
  });
});

describe('ChatList reply quote of an edited message', () => {
  beforeEach(() => {
    rows.throwsLeft.clear();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const original = message('m1', {
    images: [{ name: 'a', identifier: 'old', service: 'IMAGE' }],
  });
  const replying = message('m2', { repliedTo: 'm1' });
  const quote = () => screen.getByTestId('message-m2');

  it("shows the edit's pictures, like the edited row", () => {
    const edited = [{ name: 'a', identifier: 'new', service: 'IMAGE' }];
    render(
      <ChatList
        {...baseProps}
        initialMessages={[original, replying]}
        chatReferences={{
          m1: {
            edit: {
              message: '<p>edited</p>',
              messageText: 'edited',
              images: edited,
              timestamp: 5,
            },
          },
        }}
      />
    );
    expect(quote().dataset.replyText).toBe('edited');
    expect(JSON.parse(quote().dataset.replyImages!)).toEqual(edited);
  });

  it('keeps the original pictures when the edit carries none', () => {
    render(
      <ChatList
        {...baseProps}
        initialMessages={[original, replying]}
        chatReferences={{
          m1: { edit: { messageText: 'edited', timestamp: 5 } },
        }}
      />
    );
    expect(quote().dataset.replyText).toBe('edited');
    expect(JSON.parse(quote().dataset.replyImages!)).toEqual(original.images);
  });
});
