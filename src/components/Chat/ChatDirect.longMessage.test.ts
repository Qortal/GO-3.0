import { Editor } from '@tiptap/core';
import { Color } from '@tiptap/extension-color';
import Mention from '@tiptap/extension-mention';
import TextStyle from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SIZE_MESSAGE,
  MAX_SPLIT_MESSAGE_PARTS,
} from '../../constants/constants';
import nacl from '../../encryption/nacl-fast';
import {
  MessageQueueProvider,
  useMessageQueue,
} from '../../messaging/MessageQueueContext';
import {
  type ChatDocNode,
  chatDocumentText,
  chatDocumentToHtml,
  utf8ByteLength,
} from '../../utils/chat/splitLongMessage';
import {
  buildDirectMessagePartPayloads,
  directMessageHtmlSize,
  directMessageSizeBudget,
  guardLegacyDirectMessageParts,
  legacyDirectMessageOverhead,
  planDirectMessageParts,
  sendDirectMessagePartsInOrder,
} from './ChatDirect';
import { toChatImagePointer } from './gifs/libraryGifs';

// The node and mark types the chat composer (TipTap.tsx) produces.
const composerExtensions = [
  TextStyle,
  Color.configure({ types: [TextStyle.name, 'listItem'] }),
  StarterKit,
  Mention,
];

const text = (value: string, marks?: ChatDocNode['marks']): ChatDocNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const paragraph = (...content: ChatDocNode[]): ChatDocNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const mention = (id: string): ChatDocNode => ({
  type: 'mention',
  attrs: { id, label: id },
});
const words = (count: number, seed = 0) =>
  Array.from({ length: count }, (_, i) => `word${(i + seed) % 997}`).join(' ');
const nonWhitespace = (value: string) => value.replace(/\s+/g, '');
const collect = (node: ChatDocNode, type: string): ChatDocNode[] => {
  const found: ChatDocNode[] = [];
  const visit = (current: ChatDocNode) => {
    if (current?.type === type) found.push(current);
    current?.content?.forEach(visit);
  };
  visit(node);
  return found;
};

const editors: Editor[] = [];
const composerWith = (...content: ChatDocNode[]) => {
  const editor = new Editor({
    extensions: composerExtensions,
    content: { type: 'doc', content },
  });
  editors.push(editor);
  return editor;
};

// What ChatDirect's sendMessage and size handler pass in for a composer.
const planComposer = (
  editor: Editor,
  options: { isEdit?: boolean; maxParts?: number; maximum?: number } = {}
) =>
  planDirectMessageParts({
    html: editor.getHTML(),
    getDoc: () => editor.getJSON(),
    toHtml: (doc) => chatDocumentToHtml(doc, editor.schema),
    ...options,
  });

const partsOf = (plan: ReturnType<typeof planDirectMessageParts>) => {
  if (plan.error) throw new Error(`split failed: ${plan.error}`);
  return plan.parts;
};

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.restoreAllMocks();
});

describe('directMessageHtmlSize', () => {
  it('is the Blob size of the JSON string plus 200, as the composer counts', () => {
    for (const html of [
      '<p>hello</p>',
      '<p>héllo "quoted" 👋🏽 世界</p><p>line\nbreak\t&amp;</p>',
      '',
    ]) {
      expect(directMessageHtmlSize(html)).toBe(
        new Blob([JSON.stringify(html)]).size + 200
      );
    }
  });
});

describe('planDirectMessageParts', () => {
  it('sends a text that fits as one message with its HTML untouched', () => {
    const getDoc = vi.fn(() => ({ type: 'doc' }));
    const toHtml = vi.fn(() => '');
    const html = `<p>${'a'.repeat(MAX_SIZE_MESSAGE - 200 - 9)}</p>`;
    expect(directMessageHtmlSize(html)).toBe(MAX_SIZE_MESSAGE);

    const plan = planDirectMessageParts({ html, getDoc, toHtml });

    expect(plan).toEqual({ parts: [{ html }] });
    expect(plan.parts?.[0].html).toBe(html);
    expect(getDoc).not.toHaveBeenCalled();
    expect(toHtml).not.toHaveBeenCalled();
  });

  it('never splits an edit that is over the limit', () => {
    const getDoc = vi.fn(() => ({ type: 'doc' }));
    const html = `<p>${'a'.repeat(MAX_SIZE_MESSAGE)}</p>`;

    expect(
      planDirectMessageParts({ html, getDoc, toHtml: () => '', isEdit: true })
    ).toEqual({ error: 'edit' });
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('lets an edit that fits through as one message', () => {
    expect(
      planDirectMessageParts({
        html: '<p>fixed typo</p>',
        getDoc: () => ({ type: 'doc' }),
        toHtml: () => '',
        isEdit: true,
      })
    ).toEqual({ parts: [{ html: '<p>fixed typo</p>' }] });
  });

  it('splits a long text into ordered parts that each fit, losing nothing', () => {
    const blocks = Array.from({ length: 14 }, (_, i) =>
      paragraph(text(words(90, i * 90)))
    );
    const editor = composerWith(...blocks);
    expect(directMessageHtmlSize(editor.getHTML())).toBeGreaterThan(
      MAX_SIZE_MESSAGE
    );

    const parts = partsOf(planComposer(editor));

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(MAX_SPLIT_MESSAGE_PARTS);
    for (const part of parts) {
      expect(directMessageHtmlSize(part.html)).toBeLessThanOrEqual(
        MAX_SIZE_MESSAGE
      );
      // Each part's HTML is exactly what the composer would send for it.
      expect(part.html).toBe(composerWith(...part.doc.content).getHTML());
      // Whole paragraphs only: none is cut between words.
      expect(part.html.startsWith('<p>word')).toBe(true);
    }
    expect(
      parts.map((part) => nonWhitespace(chatDocumentText(part.doc))).join('')
    ).toBe(nonWhitespace(chatDocumentText(editor.getJSON())));
  });

  it('splits one huge paragraph between words, keeping marks and mentions', () => {
    const content: ChatDocNode[] = [];
    for (let i = 0; i < 40; i++) {
      content.push(text(`${words(20, i * 20)} `, [{ type: 'bold' }]));
      content.push(mention(`user${i}`));
      content.push(text(' '));
    }
    const editor = composerWith(paragraph(...content));

    const parts = partsOf(planComposer(editor));

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(directMessageHtmlSize(part.html)).toBeLessThanOrEqual(
        MAX_SIZE_MESSAGE
      );
      expect(part.html).toContain('<strong>');
    }
    expect(
      parts.flatMap((part) => collect(part.doc, 'mention').map((m) => m.attrs))
    ).toEqual(collect(editor.getJSON(), 'mention').map((m) => m.attrs));
    expect(
      parts.map((part) => nonWhitespace(chatDocumentText(part.doc))).join('')
    ).toBe(nonWhitespace(chatDocumentText(editor.getJSON())));
  });

  it('sends the trimmed text when dropping blank lines is enough', () => {
    const editor = composerWith(
      paragraph(text('hello')),
      ...Array.from({ length: 600 }, () => paragraph())
    );
    expect(directMessageHtmlSize(editor.getHTML())).toBeGreaterThan(
      MAX_SIZE_MESSAGE
    );

    const parts = partsOf(planComposer(editor));

    expect(parts).toHaveLength(1);
    expect(parts[0].html).toBe('<p>hello</p>');
  });

  it('refuses a text that needs more than the allowed parts', () => {
    const editor = composerWith(
      ...Array.from({ length: 14 }, (_, i) =>
        paragraph(text(words(90, i * 90)))
      )
    );
    expect(planComposer(editor, { maxParts: 1 })).toEqual({
      error: 'too_many_parts',
    });
  });

  it('refuses a text holding something that cannot fit on its own', () => {
    const editor = composerWith(paragraph(text('hello')));
    // '<p>h</p>' alone is 210 bytes as the composer counts it.
    expect(planComposer(editor, { maximum: 209 })).toEqual({
      error: 'unsplittable',
    });
  });

  it('treats a failure while splitting as unsplittable', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const plan = planDirectMessageParts({
      html: `<p>${'a'.repeat(MAX_SIZE_MESSAGE)}</p>`,
      getDoc: () => ({
        type: 'doc',
        content: [paragraph(text('a'.repeat(MAX_SIZE_MESSAGE)))],
      }),
      toHtml: () => {
        throw new Error('no DOM');
      },
    });
    expect(plan).toEqual({ error: 'unsplittable' });
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('buildDirectMessagePartPayloads', () => {
  const ids = () => {
    let next = 0;
    return () => `id-${++next}`;
  };
  const image = { identifier: 'img' };
  const attachment = { identifier: 'file' };

  // The otherData ChatDirect built inline before long texts could be split.
  const singleMessageOtherData = ({
    editData,
    specialId,
    repliedTo,
    chatReference,
    images,
    attachments,
  }: {
    editData?: Record<string, unknown>;
    specialId: string;
    repliedTo?: string;
    chatReference?: string;
    images: unknown[];
    attachments: unknown[];
  }) => ({
    ...(editData || {}),
    specialId,
    repliedTo,
    type: chatReference ? 'edit' : '',
    ...(images.length > 0 ? { images } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  });

  it('builds a single message exactly as before', () => {
    for (const [images, attachments, repliedTo] of [
      [[image], [attachment], 'reply-sig'],
      [[], [], undefined],
      [[image], [], undefined],
    ] as [unknown[], unknown[], string | undefined][]) {
      const [payload, ...rest] = buildDirectMessagePartPayloads({
        texts: ['<p>hi</p>'],
        createSpecialId: ids(),
        repliedTo,
        images,
        attachments,
      });
      expect(rest).toHaveLength(0);
      expect(payload.messageText).toBe('<p>hi</p>');
      const expected = singleMessageOtherData({
        specialId: 'id-1',
        repliedTo,
        images,
        attachments,
      });
      expect(payload.otherData).toEqual(expected);
      // Same keys in the same order, so the sent JSON is byte-identical.
      expect(Object.keys(payload.otherData)).toEqual(Object.keys(expected));
      expect(JSON.stringify(payload.otherData)).toBe(JSON.stringify(expected));
    }
  });

  it('builds an edit exactly as before', () => {
    const editData = { specialId: 'old', repliedTo: 'orig', extra: 1 };
    const [payload] = buildDirectMessagePartPayloads({
      texts: ['<p>edited</p>'],
      createSpecialId: ids(),
      editData,
      isEdit: true,
      repliedTo: 'orig',
    });
    const expected = singleMessageOtherData({
      editData,
      specialId: 'id-1',
      repliedTo: 'orig',
      chatReference: 'edited-sig',
      images: [],
      attachments: [],
    });
    expect(JSON.stringify(payload.otherData)).toBe(JSON.stringify(expected));
    expect(payload.otherData.type).toBe('edit');
    expect(payload.otherData.specialId).toBe('id-1');
  });

  it('puts the reply and attachments on the first part only', () => {
    const payloads = buildDirectMessagePartPayloads({
      texts: ['<p>one</p>', '<p>two</p>', '<p>three</p>'],
      createSpecialId: ids(),
      repliedTo: 'reply-sig',
      images: [image],
      attachments: [attachment],
    });

    expect(payloads.map((payload) => payload.messageText)).toEqual([
      '<p>one</p>',
      '<p>two</p>',
      '<p>three</p>',
    ]);
    expect(payloads[0].otherData).toEqual({
      specialId: 'id-1',
      repliedTo: 'reply-sig',
      type: '',
      images: [image],
      attachments: [attachment],
    });
    for (const [index, payload] of payloads.slice(1).entries()) {
      expect(JSON.stringify(payload.otherData)).toBe(
        JSON.stringify({ specialId: `id-${index + 2}`, type: '' })
      );
      expect(payload.otherData.repliedTo).toBeUndefined();
    }
    // Each part is its own queued message.
    expect(
      new Set(payloads.map((payload) => payload.otherData.specialId)).size
    ).toBe(3);
  });
});

describe('legacy on-chain DM size', () => {
  // nacl-fast is untyped; this is the call ChatTransaction encrypts with.
  const { secretbox } = nacl as {
    secretbox: (
      message: Uint8Array,
      nonce: Uint8Array,
      key: Uint8Array
    ) => Uint8Array;
  };
  // What background sendChatDirect puts in the CHAT transaction for a part:
  // the UTF-8 JSON it builds, encrypted with nacl.secretbox (ChatTransaction).
  const onChainSize = (messageText: string, otherData: object) =>
    secretbox(
      new TextEncoder().encode(
        JSON.stringify({ message: messageText, version: 2, ...otherData })
      ),
      new Uint8Array(24),
      new Uint8Array(32)
    ).length;
  // ChatDirect's specialIds are 5 characters long.
  const specialIds = () => {
    let next = 0;
    return () => `s${String(++next).padStart(4, '0')}`;
  };
  const replySignature = '5'.repeat(88);
  // A library GIF with the longest name and identifier QDN allows.
  const gif = toChatImagePointer({
    identifier: 'g'.repeat(64),
    name: 'n'.repeat(40),
    service: 'IMAGE',
  });

  it('counts exactly what the transaction carries beyond the HTML', () => {
    for (const otherData of [
      { specialId: 's0001', type: '' },
      { specialId: 's0001', repliedTo: replySignature, type: '' },
      { specialId: 's0001', type: '', images: [gif] },
    ]) {
      for (const html of ['<p>hi</p>', '<p>héllo "q" 👋🏽</p>']) {
        expect(
          utf8ByteLength(JSON.stringify(html)) +
            legacyDirectMessageOverhead(otherData)
        ).toBe(onChainSize(html, otherData));
      }
    }
  });

  it('keeps the full maximum when the envelope already covers the data', () => {
    expect(directMessageSizeBudget(null)).toBe(MAX_SIZE_MESSAGE);
    expect(directMessageSizeBudget({ specialId: 's0001', type: '' })).toBe(
      MAX_SIZE_MESSAGE
    );
    expect(
      directMessageSizeBudget({
        specialId: 's0001',
        repliedTo: replySignature,
        type: '',
      })
    ).toBe(MAX_SIZE_MESSAGE);
  });

  it('keeps every part of a long text sent with a reply and GIF within the CHAT limit', () => {
    const editor = composerWith(
      ...Array.from({ length: 30 }, (_, i) =>
        paragraph(text(words(60, i * 60)))
      )
    );
    const payloadsFor = (texts: string[]) =>
      buildDirectMessagePartPayloads({
        texts,
        createSpecialId: specialIds(),
        repliedTo: replySignature,
        images: [gif],
      });
    const budget = directMessageSizeBudget(payloadsFor([''])[0].otherData);
    expect(budget).toBeLessThan(MAX_SIZE_MESSAGE);

    const payloads = payloadsFor(
      partsOf(planComposer(editor, { maximum: budget })).map(
        (part) => part.html
      )
    );

    expect(payloads.length).toBeGreaterThan(2);
    expect(payloads[0].otherData.images).toEqual([gif]);
    for (const { messageText, otherData } of payloads) {
      expect(onChainSize(messageText, otherData)).toBeLessThanOrEqual(
        MAX_SIZE_MESSAGE
      );
    }
    // Without the lower budget the first part would not fit on chain.
    const [unbudgetedFirst] = payloadsFor(
      partsOf(planComposer(editor)).map((part) => part.html)
    );
    expect(
      onChainSize(unbudgetedFirst.messageText, unbudgetedFirst.otherData)
    ).toBeGreaterThan(MAX_SIZE_MESSAGE);
  });
});

describe('sendDirectMessagePartsInOrder', () => {
  const recordingSends = (count: number, failAt = -1) => {
    const log: string[] = [];
    const sends = Array.from({ length: count }, (_, index) =>
      vi.fn(async () => {
        log.push(`start ${index}`);
        await Promise.resolve();
        if (index === failAt) throw new Error(`part ${index} failed`);
        log.push(`done ${index}`);
      })
    );
    return { log, sends };
  };

  it('sends every part, each after the previous one has finished', async () => {
    const { log, sends } = recordingSends(3);
    const canContinue = vi.fn(() => true);
    const keepUnsent = vi.fn();

    await expect(
      sendDirectMessagePartsInOrder({ sends, canContinue, keepUnsent })
    ).resolves.toBe(true);

    expect(log).toEqual([
      'start 0',
      'done 0',
      'start 1',
      'done 1',
      'start 2',
      'done 2',
    ]);
    // Asked before each later part, never before the first.
    expect(canContinue).toHaveBeenCalledTimes(2);
    expect(keepUnsent).not.toHaveBeenCalled();
  });

  it('keeps the rest instead of sending it once it may not continue', async () => {
    const { sends } = recordingSends(4);
    let allowed = 2;
    const keepUnsent = vi.fn();

    await expect(
      sendDirectMessagePartsInOrder({
        sends,
        canContinue: () => allowed-- > 1,
        keepUnsent,
      })
    ).resolves.toBe(false);

    expect(sends.map((send) => send.mock.calls.length)).toEqual([1, 1, 0, 0]);
    expect(keepUnsent).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('stops at a failed part, keeps it and the rest, and rejects', async () => {
    const { sends } = recordingSends(4, 1);
    const keepUnsent = vi.fn();

    await expect(
      sendDirectMessagePartsInOrder({
        sends,
        canContinue: () => true,
        keepUnsent,
      })
    ).rejects.toThrow('part 1 failed');

    expect(sends.map((send) => send.mock.calls.length)).toEqual([1, 1, 0, 0]);
    expect(keepUnsent).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe('guardLegacyDirectMessageParts', () => {
  // Runs the parts through the real message queue, as ChatDirect does.
  const queueParts = (
    sends: Array<() => Promise<unknown>>,
    keepUnsent: (fromIndex: number) => void
  ) => {
    const { result } = renderHook(() => useMessageQueue(), {
      wrapper: MessageQueueProvider,
    });
    const guarded = guardLegacyDirectMessageParts(sends, keepUnsent);
    act(() => {
      guarded.forEach((send, index) =>
        result.current.addToQueue(
          send,
          { message: { specialId: `part-${index}`, text: `part ${index}` } },
          'chat-direct',
          'peer'
        )
      );
    });
    return result;
  };
  const rowStatuses = (queueChats: Record<string, any[]>) =>
    Object.fromEntries(
      (queueChats.peer || []).map((row) => [row.message.specialId, row.status])
    );

  it('sends every part in order when each goes through', async () => {
    const order: number[] = [];
    const sends = [0, 1, 2].map((index) =>
      vi.fn(async () => {
        order.push(index);
        return { clearQueueOnSuccess: true };
      })
    );
    const keepUnsent = vi.fn();

    const queue = queueParts(sends, keepUnsent);

    await waitFor(() => expect(order).toEqual([0, 1, 2]));
    await waitFor(() => expect(queue.current.queueChats.peer).toBeUndefined());
    expect(keepUnsent).not.toHaveBeenCalled();
  });

  it('keeps sending after a part that went through on a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let failures = 1;
    const sends = [0, 1, 2].map((index) =>
      vi.fn(async () => {
        if (index === 1 && failures-- > 0) throw new Error('offline');
        return { clearQueueOnSuccess: true };
      })
    );
    const keepUnsent = vi.fn();

    queueParts(sends, keepUnsent);

    await waitFor(() => expect(sends[2]).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(sends[1]).toHaveBeenCalledTimes(2);
    expect(keepUnsent).not.toHaveBeenCalled();
  });

  it('leaves no gap: after a part the queue gave up on, the rest is kept, not sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sends = [0, 1, 2, 3].map((index) =>
      vi.fn(async () => {
        if (index === 1) throw new Error('offline');
        return {};
      })
    );
    const keepUnsent = vi.fn();

    const queue = queueParts(sends, keepUnsent);

    await waitFor(() => expect(keepUnsent).toHaveBeenCalled(), {
      timeout: 4000,
    });
    await waitFor(() =>
      expect(rowStatuses(queue.current.queueChats)).toEqual({
        'part-0': 'sending',
        'part-1': 'failed-permanent',
      })
    );
    expect(keepUnsent).toHaveBeenCalledExactlyOnceWith(1);
    // The queue tried the failed part three times, then dropped the rest.
    expect(sends.map((send) => send.mock.calls.length)).toEqual([1, 3, 0, 0]);
  });
});
