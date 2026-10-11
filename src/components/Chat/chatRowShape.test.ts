import { describe, expect, it } from 'vitest';
import { describeChatRowShape } from './chatRowShape';

const ADDRESS = 'QdT4yZ1V2u3w4x5y6z7A8B9C1D2E3F4G5H';

describe('describeChatRowShape', () => {
  it('describes a row full of content without any of it', () => {
    const shape = describeChatRowShape({
      message: {
        signature: 'sig-zebra',
        eventType: 'message',
        sender: ADDRESS,
        senderName: 'Alice',
        messageText: `<p>secret words … qortal://use-embed/IMAGE?name=x</p>`,
        text: 'secret words',
        images: [{ name: 'alice', identifier: 'qchat_x', service: 'IMAGE' }],
        attachments: [{ fileHash: 'abc' }],
        repliedTo: 'sig-other',
        status: 'Hello there',
        isTemp: true,
      },
      reactions: { '👍': [{ sender: 'Q1' }, null], '❤️': undefined },
      reply: { messageText: 'secret words' },
      replyExpiredMeta: null,
      isUpdating: false,
      isGroupedWithPrevious: true,
      index: 9,
      total: 10,
      chatIdentity: 'group:694',
    });
    expect(shape).not.toMatch(
      /secret|Alice|zebra|694|👍|❤|Hello|alice|qchat|Q[1-9A-HJ-NP-Za-km-z]{33}|https?:|=/
    );
    expect(shape).toBe(
      'surface:group eventType:message type:- temp:yes status:(string) updating:no edit:no sender:string senderName:string messageText:string text:string decryptedData:undefined images:1/qdn attachments:1 embed:yes reactions:2 notList:1 badItem:1 repliedTo:yes reply:object replyExpired:- call:no grouped:yes last:yes fromEnd:0'
    );
  });

  it('stops after the kind of a missing message', () => {
    expect(
      describeChatRowShape({
        message: null,
        reactions: null,
        reply: null,
        replyExpiredMeta: null,
        isUpdating: false,
        index: 0,
        total: 1,
        chatIdentity: 'direct:Qabc',
      })
    ).toBe('surface:direct message:null');
  });

  it('names image, reply-expiry and reaction kinds', () => {
    const shape = describeChatRowShape({
      message: {
        images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
        attachments: 'not a list',
        directCallHistory: { status: 'missed' },
        status: 'failed',
      },
      reactions: ['x'],
      reply: undefined,
      replyExpiredMeta: { deleted: true },
      isUpdating: true,
      index: 2,
      total: 10,
      chatIdentity: 'unknown',
    });
    expect(shape).toContain('surface:other');
    expect(shape).toContain('images:1/data-image');
    expect(shape).toContain('attachments:(string)');
    expect(shape).toContain('status:failed');
    expect(shape).toContain('updating:yes');
    expect(shape).toContain('reactions:(array)');
    expect(shape).toContain('reply:undefined');
    expect(shape).toContain('replyExpired:deleted');
    expect(shape).toContain('call:yes');
    expect(shape).toContain('last:no fromEnd:7');
  });

  it('gives shape:unavailable when reading the row throws', () => {
    const message = {};
    Object.defineProperty(message, 'eventType', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    expect(
      describeChatRowShape({
        message,
        reactions: null,
        reply: null,
        replyExpiredMeta: null,
        isUpdating: false,
        index: 0,
        total: 1,
        chatIdentity: 'group:1',
      })
    ).toBe('shape:unavailable');
  });
});
