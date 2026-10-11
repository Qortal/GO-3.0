import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import {
  CHAT_SHARE_RETURN_EVENT,
  type ChatShareContent,
} from './chatShareInbox';
import {
  useChatShareChannelDelivery,
  type ChatShareChannelDeliveryOptions,
} from './useChatShareChannelDelivery';

const content = (channelId?: string): ChatShareContent => ({
  text: 'https://qortal.dev',
  files: Promise.resolve([]),
  notices: [],
  ...(channelId ? { channelId } : {}),
});

const returned: unknown[] = [];
const onReturn = (event: Event) =>
  returned.push((event as CustomEvent).detail?.share);

afterEach(() => {
  returned.length = 0;
  unsubscribeFromEvent(CHAT_SHARE_RETURN_EVENT, onReturn);
});

/** A group chat on `selectedChannelId` whose openChannel switches it. */
function setup(overrides: Partial<ChatShareChannelDeliveryOptions> = {}) {
  subscribeToEvent(CHAT_SHARE_RETURN_EVENT, onReturn);
  const insert = vi.fn();
  const onChannelUnavailable = vi.fn();
  let props: ChatShareChannelDeliveryOptions = {
    enabled: true,
    groupKey: '7',
    selectedChannelId: 'general',
    channelIds: ['general', 'dev', 'news'],
    openChannel: vi.fn(),
    insert,
    onChannelUnavailable,
    ...overrides,
  };
  const hook = renderHook(
    (options: ChatShareChannelDeliveryOptions) =>
      useChatShareChannelDelivery(options),
    { initialProps: props }
  );
  const update = (next: Partial<ChatShareChannelDeliveryOptions>) => {
    props = { ...props, ...next };
    hook.rerender(props);
  };
  return { hook, insert, onChannelUnavailable, props: () => props, update };
}

describe('useChatShareChannelDelivery', () => {
  it('puts a share without a picked channel in at once', () => {
    const { hook, insert, props } = setup();
    const share = content();
    act(() => void hook.result.current(share));
    expect(insert).toHaveBeenCalledWith(share);
    expect(props().openChannel).not.toHaveBeenCalled();
  });

  it('puts a share for the channel on screen in at once', () => {
    const { hook, insert, props } = setup();
    const share = content('general');
    act(() => void hook.result.current(share));
    expect(insert).toHaveBeenCalledWith(share);
    expect(props().openChannel).not.toHaveBeenCalled();
  });

  it('opens the picked channel first, then puts the share in there', () => {
    const { hook, insert, props, update } = setup();
    const share = content('dev');
    act(() => void hook.result.current(share));
    expect(props().openChannel).toHaveBeenCalledWith('dev');
    // Not yet: General is still on screen.
    expect(insert).not.toHaveBeenCalled();

    // The insert of the render that shows the picked channel takes it.
    const insertInDev = vi.fn();
    update({ selectedChannelId: 'dev', insert: insertInDev });
    expect(insertInDev).toHaveBeenCalledWith(share);
    expect(insert).not.toHaveBeenCalled();

    // Once.
    update({ selectedChannelId: 'general' });
    update({ selectedChannelId: 'dev' });
    expect(insertInDev).toHaveBeenCalledTimes(1);
    expect(returned).toEqual([]);
  });

  it('hands a share for a channel the chat does not have back', () => {
    const { hook, insert, onChannelUnavailable, props } = setup();
    const share = content('deleted');
    act(() => void hook.result.current(share));
    expect(insert).not.toHaveBeenCalled();
    expect(props().openChannel).not.toHaveBeenCalled();
    expect(returned).toEqual([share]);
    expect(onChannelUnavailable).toHaveBeenCalledTimes(1);
  });

  it('hands it back when another chat opens before the channel', () => {
    const { hook, insert, update } = setup();
    const share = content('dev');
    act(() => void hook.result.current(share));
    update({ groupKey: '8', selectedChannelId: 'general' });
    expect(insert).not.toHaveBeenCalled();
    expect(returned).toEqual([share]);
  });

  it('hands it back when the chat closes before the channel opens', () => {
    const { hook, insert } = setup();
    const share = content('dev');
    act(() => void hook.result.current(share));
    hook.unmount();
    expect(insert).not.toHaveBeenCalled();
    expect(returned).toEqual([share]);
  });

  it('ignores a picked channel in a chat without channels', () => {
    const { hook, insert, props } = setup({ enabled: false });
    const share = content('dev');
    act(() => void hook.result.current(share));
    expect(insert).toHaveBeenCalledWith(share);
    expect(props().openChannel).not.toHaveBeenCalled();
  });
});
