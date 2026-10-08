import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/Group/groupApi', () => ({
  getPrimaryNamesForAddresses: vi.fn(async () => ({})),
}));

import {
  useReticulumDirectChat,
  type ReticulumDmEvent,
} from './useReticulumDirectChat';

const ME = 'Qme';
const PEER = 'Qpeer';

const message = (eventId: string, timestamp: number): ReticulumDmEvent => ({
  eventId,
  conversationId: 'conversation',
  senderAddress: PEER,
  recipientAddress: ME,
  senderPublicKey: 'public-key',
  senderSeq: timestamp,
  timestamp,
  eventType: 'message',
  payload: JSON.stringify({ messageText: `<p>${eventId}</p>` }),
  payloadHash: `hash-${eventId}`,
  signature: `signature-${eventId}`,
});

describe('useReticulumDirectChat loadHistoryFrom', () => {
  const original = window.reticulumChat;

  afterEach(() => {
    window.reticulumChat = original;
  });

  it('adds the conversation from an older message to what is loaded', async () => {
    const getDirectHistoryFrom = vi.fn(async () => [
      message('old-1', 100),
      message('old-2', 200),
    ]);
    window.reticulumChat = {
      isEnabled: async () => true,
      setLocalDmAddresses: vi.fn(async () => undefined),
      getDirectHistory: vi.fn(async () => [message('latest', 9_000)]),
      getDirectHistoryFrom,
      onDirectEvent: () => () => {},
      onDirectTyping: () => () => {},
      onDirectSummaryChanged: () => () => {},
      onSilenceChanged: () => () => {},
    } as any;

    const { result } = renderHook(() => useReticulumDirectChat(ME, PEER));
    await waitFor(() => expect(result.current.initialHistoryReady).toBe(true));
    expect(result.current.messages.map((m: any) => m.signature)).toEqual([
      'latest',
    ]);

    let loaded = false;
    await act(async () => {
      loaded = await result.current.loadHistoryFrom('old-1');
    });

    expect(loaded).toBe(true);
    expect(getDirectHistoryFrom).toHaveBeenCalledWith(ME, PEER, 'old-1');
    expect(result.current.messages.map((m: any) => m.signature)).toEqual([
      'old-1',
      'old-2',
      'latest',
    ]);
  });

  it('does nothing without the engine call', async () => {
    window.reticulumChat = {
      isEnabled: async () => true,
      setLocalDmAddresses: vi.fn(async () => undefined),
      getDirectHistory: vi.fn(async () => []),
      onDirectEvent: () => () => {},
      onDirectTyping: () => () => {},
      onDirectSummaryChanged: () => () => {},
      onSilenceChanged: () => () => {},
    } as any;
    const { result } = renderHook(() => useReticulumDirectChat(ME, PEER));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    let loaded = true;
    await act(async () => {
      loaded = await result.current.loadHistoryFrom('old-1');
    });
    expect(loaded).toBe(false);
  });
});
