import { act, render, renderHook } from '@testing-library/react';
import { Activity, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_SHARE_READY_WAIT_MS,
  CHAT_SHARE_RETURN_EVENT,
  hasChatShareFor,
  insertSharedText,
  queueChatShareFor,
  resetChatShareInbox,
  returnChatShare,
  sharedTextToHtml,
  takeChatShareFor,
  useChatShareInbox,
  type ChatShareContent,
} from './chatShareInbox';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';

const content = (text = 'https://qortal.dev'): ChatShareContent => ({
  text,
  files: Promise.resolve([]),
  notices: [],
});

afterEach(() => {
  resetChatShareInbox();
  vi.useRealTimers();
});

describe('chatShareInbox queue', () => {
  it('gives a share only to its chat, once', () => {
    const share = content();
    queueChatShareFor('group:1', share);
    expect(takeChatShareFor('group:2')).toBeNull();
    expect(takeChatShareFor('group:1')).toBe(share);
    expect(takeChatShareFor('group:1')).toBeNull();
  });

  it('drops a share no chat took in time', () => {
    vi.useFakeTimers();
    queueChatShareFor('group:1', content());
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(takeChatShareFor('group:1')).toBeNull();
  });

  it('tells whether a fresh share waits for a chat', () => {
    vi.useFakeTimers();
    queueChatShareFor('group:1', content());
    expect(hasChatShareFor('group:1')).toBe(true);
    expect(hasChatShareFor('group:2')).toBe(false);
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(hasChatShareFor('group:1')).toBe(false);
  });

  it('hands a share back to the lists', () => {
    const returned: unknown[] = [];
    const onReturn = (event: Event) =>
      returned.push((event as CustomEvent).detail?.share);
    subscribeToEvent(CHAT_SHARE_RETURN_EVENT, onReturn);
    const share = content();
    returnChatShare(share);
    unsubscribeFromEvent(CHAT_SHARE_RETURN_EVENT, onReturn);
    expect(returned).toEqual([share]);
  });

  it('keeps only the newest share', () => {
    queueChatShareFor('group:1', content('first'));
    const second = content('second');
    queueChatShareFor('direct:Q', second);
    expect(takeChatShareFor('group:1')).toBeNull();
    expect(takeChatShareFor('direct:Q')).toBe(second);
  });
});

describe('useChatShareInbox', () => {
  it('waits until the draft is in, then delivers', () => {
    const deliver = vi.fn();
    const share = content();
    queueChatShareFor('group:1', share);
    const { result } = renderHook(() => useChatShareInbox('group:1', deliver));
    expect(deliver).not.toHaveBeenCalled();
    act(() => result.current('group:1'));
    expect(deliver).toHaveBeenCalledWith(share);
  });

  it('delivers at once to the chat already open', () => {
    const deliver = vi.fn();
    const { result } = renderHook(() =>
      useChatShareInbox('direct:QBob', deliver)
    );
    act(() => result.current('direct:QBob'));
    const share = content();
    act(() => queueChatShareFor('direct:QBob', share));
    expect(deliver).toHaveBeenCalledWith(share);
  });

  it('leaves a share for another chat alone', () => {
    const deliver = vi.fn();
    const { result } = renderHook(() => useChatShareInbox('group:1', deliver));
    act(() => result.current('group:1'));
    const share = content();
    act(() => queueChatShareFor('group:2', share));
    expect(deliver).not.toHaveBeenCalled();
    expect(takeChatShareFor('group:2')).toBe(share);
  });

  it('holds a share until the composer is ready', () => {
    const deliver = vi.fn();
    const share = content();
    queueChatShareFor('direct:QBob', share);
    const { result, rerender } = renderHook(
      ({ ready }) => useChatShareInbox('direct:QBob', deliver, { ready }),
      { initialProps: { ready: false } }
    );
    act(() => result.current('direct:QBob'));
    expect(deliver).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(deliver).toHaveBeenCalledWith(share);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('takes the share anyway when the composer never gets ready', () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const share = content();
    const { result } = renderHook(() =>
      useChatShareInbox('group:1', deliver, { ready: false })
    );
    act(() => result.current('group:1'));
    act(() => queueChatShareFor('group:1', share));
    act(() => vi.advanceTimersByTime(CHAT_SHARE_READY_WAIT_MS - 1));
    expect(deliver).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(deliver).toHaveBeenCalledWith(share);
  });

  it('takes a share queued while the chat was hidden once it shows', () => {
    const deliver = vi.fn();
    let markReady: (key: string) => void = () => undefined;
    const Chat = () => {
      markReady = useChatShareInbox('group:7', deliver);
      return null;
    };
    const { rerender } = render(
      createElement(Activity, { mode: 'visible' }, createElement(Chat))
    );
    act(() => markReady('group:7'));
    // Chat parked: its effects (the listener) are gone, its refs stay.
    rerender(createElement(Activity, { mode: 'hidden' }, createElement(Chat)));
    const share = content();
    act(() => queueChatShareFor('group:7', share));
    expect(deliver).not.toHaveBeenCalled();
    rerender(createElement(Activity, { mode: 'visible' }, createElement(Chat)));
    expect(deliver).toHaveBeenCalledWith(share);
  });

  it('does not deliver for a chat that was switched away from', () => {
    const deliver = vi.fn();
    const { result, rerender } = renderHook(
      ({ chatKey }) => useChatShareInbox(chatKey, deliver),
      { initialProps: { chatKey: 'group:1' } }
    );
    act(() => result.current('group:1'));
    rerender({ chatKey: 'group:2' });
    act(() => queueChatShareFor('group:1', content()));
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('shared text', () => {
  it('escapes markup and keeps lines', () => {
    expect(sharedTextToHtml('<b>hi</b> & "you"\r\nnext')).toBe(
      '<p>&lt;b&gt;hi&lt;/b&gt; &amp; &quot;you&quot;</p><p>next</p>'
    );
  });

  it('fills an empty composer and appends to a draft', () => {
    const setContent = vi.fn();
    const insertContentAt = vi.fn();
    const empty = {
      isEmpty: true,
      state: { doc: { content: { size: 2 } } },
      commands: { setContent, insertContentAt },
    };
    expect(insertSharedText(empty, '  https://x.y  ')).toBe(true);
    expect(setContent).toHaveBeenCalledWith('<p>https://x.y</p>', true);

    const draft = { ...empty, isEmpty: false };
    draft.state = { doc: { content: { size: 12 } } };
    insertSharedText(draft, 'more');
    expect(insertContentAt).toHaveBeenCalledWith(12, '<p>more</p>');
  });

  it('does nothing without text or an editor', () => {
    const commands = { setContent: vi.fn(), insertContentAt: vi.fn() };
    expect(insertSharedText({ isEmpty: true, commands }, '   ')).toBe(false);
    expect(insertSharedText(null, 'x')).toBe(false);
    expect(commands.setContent).not.toHaveBeenCalled();
  });
});
