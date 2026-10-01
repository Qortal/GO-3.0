import { describe, expect, it } from 'vitest';
import {
  isReticulumDmEventForConversation,
  mergeEvents,
  projectReticulumDmEvents,
  reticulumDmEventToChatMessage,
  type ReticulumDmEvent,
} from './useReticulumDirectChat';

const event = (
  overrides: Partial<ReticulumDmEvent> &
    Pick<ReticulumDmEvent, 'eventId' | 'eventType' | 'senderAddress'>
): ReticulumDmEvent => ({
  conversationId: 'conversation',
  recipientAddress: overrides.senderAddress === 'alice' ? 'bob' : 'alice',
  senderPublicKey: 'public-key',
  senderSeq: 1,
  timestamp: 1,
  payload: '',
  payloadHash: 'hash',
  signature: 'signature',
  ...overrides,
});

describe('Reticulum DM event projection', () => {
  it('does not let DM payload data replace verified event metadata', () => {
    const message = event({
      eventId: 'message-1',
      eventType: 'edit',
      senderAddress: 'alice',
      recipientAddress: 'bob',
      senderName: 'Alice',
      targetEventId: 'verified-target',
      replyToEventId: 'verified-reply',
      timestamp: 42,
      expiresAt: 1234,
      payload: JSON.stringify({
        chatReference: 'spoofed-target',
        messageText: 'hello',
        otherData: {
          id: 'spoofed-id',
          signature: 'spoofed-signature',
          eventType: 'delete',
          sender: 'mallory',
          senderAddress: 'mallory',
          senderName: 'Mallory',
          recipientAddress: 'mallory-recipient',
          timestamp: 1,
          expiresAt: 2,
          messageText: 'spoofed message',
          chatReference: 'spoofed-target',
          repliedTo: 'spoofed-reply',
          reticulumChat: false,
          reticulumDirect: false,
          reticulumDeliveryStatus: 'pending',
          decryptedData: { content: 'spoofed' },
        },
      }),
    });

    expect(reticulumDmEventToChatMessage(message)).toMatchObject({
      id: 'message-1',
      signature: 'message-1',
      eventType: 'edit',
      sender: 'alice',
      senderAddress: 'alice',
      senderName: 'Alice',
      recipientAddress: 'bob',
      timestamp: 42,
      expiresAt: 1234,
      chatReference: 'verified-target',
      repliedTo: 'verified-reply',
      messageText: 'hello',
      reticulumChat: true,
      reticulumDirect: true,
      reticulumDeliveryStatus: undefined,
      decryptedData: expect.objectContaining({
        sender: 'mallory',
      }),
    });
  });

  it('projects reaction state onto its target without rendering action events', () => {
    const message = event({
      eventId: 'message-1',
      eventType: 'message',
      senderAddress: 'alice',
      payload: 'hello',
    });
    const reaction = event({
      eventId: 'reaction-1',
      eventType: 'reaction_add',
      senderAddress: 'bob',
      targetEventId: message.eventId,
      timestamp: 2,
      payload: JSON.stringify({
        otherData: { content: '👍', contentState: true, type: 'reaction' },
      }),
    });

    const projected = projectReticulumDmEvents([message, reaction]);

    expect(projected.messages).toHaveLength(1);
    expect(
      projected.chatReferences[message.eventId].reactions?.['👍']?.[0]?.sender
    ).toBe('bob');
  });

  it('applies reaction removal as the latest sender state', () => {
    const message = event({
      eventId: 'message-1',
      eventType: 'message',
      senderAddress: 'alice',
    });
    const add = event({
      eventId: 'reaction-1',
      eventType: 'reaction_add',
      senderAddress: 'bob',
      targetEventId: message.eventId,
      timestamp: 2,
      payload: JSON.stringify({ otherData: { content: '😂' } }),
    });
    const remove = event({
      eventId: 'reaction-2',
      eventType: 'reaction_remove',
      senderAddress: 'bob',
      targetEventId: message.eventId,
      timestamp: 3,
      payload: JSON.stringify({ otherData: { content: '😂' } }),
    });

    const projected = projectReticulumDmEvents([remove, message, add]);

    expect(
      projected.chatReferences[message.eventId].reactions?.['😂']
    ).toBeUndefined();
  });

  it('allows only the original sender to delete a DM', () => {
    const message = event({
      eventId: 'message-1',
      eventType: 'message',
      senderAddress: 'alice',
    });
    const unauthorizedDelete = event({
      eventId: 'delete-1',
      eventType: 'delete',
      senderAddress: 'bob',
      targetEventId: message.eventId,
      timestamp: 2,
    });
    expect(
      projectReticulumDmEvents([message, unauthorizedDelete]).messages
    ).toHaveLength(1);

    const authorizedDelete = event({
      eventId: 'delete-2',
      eventType: 'delete',
      senderAddress: 'alice',
      targetEventId: message.eventId,
      timestamp: 3,
    });
    const projected = projectReticulumDmEvents([message, authorizedDelete]);
    expect(projected.messages).toHaveLength(0);
    expect(projected.chatReferences[message.eventId].deleted).toBe(true);
  });
});

describe('Reticulum DM live conversation filtering', () => {
  it('does not place an unrelated DM event in Saved Messages', () => {
    expect(
      isReticulumDmEventForConversation(
        {
          conversationId: 'alice-and-bob',
          senderAddress: 'alice',
          recipientAddress: 'bob',
        },
        'alice-saved',
        'alice',
        'alice'
      )
    ).toBe(false);
  });

  it('accepts only exact self-to-self events in Saved Messages', () => {
    expect(
      isReticulumDmEventForConversation(
        {
          conversationId: 'alice-saved',
          senderAddress: 'alice',
          recipientAddress: 'alice',
        },
        'alice-saved',
        'alice',
        'alice'
      )
    ).toBe(true);
  });

  it('requires both the conversation ID and normal DM participant pair', () => {
    expect(
      isReticulumDmEventForConversation(
        {
          conversationId: 'alice-and-bob',
          senderAddress: 'bob',
          recipientAddress: 'alice',
        },
        'alice-and-bob',
        'alice',
        'bob'
      )
    ).toBe(true);
    expect(
      isReticulumDmEventForConversation(
        {
          conversationId: 'alice-and-bob',
          senderAddress: 'mallory',
          recipientAddress: 'alice',
        },
        'alice-and-bob',
        'alice',
        'bob'
      )
    ).toBe(false);
  });
});

describe('Reticulum DM delivery state in the UI', () => {
  it('maps the own-device copy onto the chat message', () => {
    const message = reticulumDmEventToChatMessage(
      event({
        eventId: 'own-1',
        eventType: 'message',
        senderAddress: 'alice',
        localDeliveryStatus: 'pending',
        localOwnDeviceCopiedAt: 1234,
      })
    );
    expect(message).toMatchObject({
      reticulumDeliveryStatus: 'pending',
      reticulumOwnDeviceCopiedAt: 1234,
    });
  });

  it('does not let a payload forge an own-device copy', () => {
    const message = reticulumDmEventToChatMessage(
      event({
        eventId: 'own-2',
        eventType: 'message',
        senderAddress: 'alice',
        localDeliveryStatus: 'pending',
        payload: JSON.stringify({
          messageText: 'hi',
          otherData: {
            reticulumOwnDeviceCopiedAt: 99,
            localOwnDeviceCopiedAt: 99,
          },
        }),
      })
    );
    expect(message.reticulumOwnDeviceCopiedAt).toBeUndefined();
    expect(message.localOwnDeviceCopiedAt).toBeUndefined();
  });

  it('treats earlier pending own messages as delivered once a later own event is sent', () => {
    const own = (
      eventId: string,
      timestamp: number,
      overrides: Partial<ReticulumDmEvent> = {}
    ) =>
      event({
        eventId,
        eventType: 'message',
        senderAddress: 'alice',
        timestamp,
        localDeliveryStatus: 'pending',
        ...overrides,
      });
    const statusOf = (events: ReticulumDmEvent[]) =>
      Object.fromEntries(
        projectReticulumDmEvents(events).messages.map((message) => [
          message.eventId,
          message.reticulumDeliveryStatus,
        ])
      );

    const m1 = own('m1', 1, { localOwnDeviceCopiedAt: 5 });
    const m2 = own('m2', 2);
    // A later sent message or a sent reaction both prove delivery.
    expect(
      statusOf([m1, m2, own('m3', 3, { localDeliveryStatus: 'sent' })])
    ).toEqual({ m1: 'sent', m2: 'sent', m3: 'sent' });
    expect(
      statusOf([
        m1,
        m2,
        own('r1', 3, {
          eventType: 'reaction_add',
          targetEventId: 'm1',
          localDeliveryStatus: 'sent',
          payload: JSON.stringify({ content: '👍' }),
        }),
      ])
    ).toEqual({ m1: 'sent', m2: 'sent' });
    // Anything after the newest sent event stays pending.
    expect(
      statusOf([own('m0', 0, { localDeliveryStatus: 'sent' }), m1, m2])
    ).toEqual({ m0: 'sent', m1: 'pending', m2: 'pending' });
    // The stored events are not rewritten.
    expect(m1.localDeliveryStatus).toBe('pending');
  });

  it('never lets a peer event or a Saved Messages event vouch for delivery', () => {
    const pending = event({
      eventId: 'm1',
      eventType: 'message',
      senderAddress: 'alice',
      timestamp: 1,
      localDeliveryStatus: 'pending',
    });
    const fromPeer = event({
      eventId: 'p1',
      eventType: 'message',
      senderAddress: 'bob',
      timestamp: 2,
      localDeliveryStatus: 'sent',
    });
    const selfDm = event({
      eventId: 's1',
      eventType: 'message',
      senderAddress: 'alice',
      recipientAddress: 'alice',
      timestamp: 3,
      localDeliveryStatus: 'sent',
    });
    const [message] = projectReticulumDmEvents([
      pending,
      fromPeer,
      selfDm,
    ]).messages;
    expect(message.reticulumDeliveryStatus).toBe('pending');
  });

  it('never walks delivery progress back on a stale copy of an event', () => {
    const pending = event({
      eventId: 'own-3',
      eventType: 'message',
      senderAddress: 'alice',
      localDeliveryStatus: 'pending',
    });
    const copied = { ...pending, localOwnDeviceCopiedAt: 50 };
    const sent = {
      ...pending,
      localDeliveryStatus: 'sent' as const,
      localDeliveryUpdatedAt: 60,
    };

    // A stale pending emit after the copy keeps the copy.
    expect(mergeEvents([copied], [pending])[0]).toMatchObject({
      localDeliveryStatus: 'pending',
      localOwnDeviceCopiedAt: 50,
    });
    // A stale pending emit or history page after delivery keeps 'sent'.
    expect(mergeEvents([sent], [copied])[0]).toMatchObject({
      localDeliveryStatus: 'sent',
      localDeliveryUpdatedAt: 60,
      localOwnDeviceCopiedAt: 50,
    });
    // Forward progress still applies.
    expect(mergeEvents([pending], [sent])[0].localDeliveryStatus).toBe('sent');
  });
});
