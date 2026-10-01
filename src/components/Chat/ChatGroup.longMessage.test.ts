import { Editor, getSchema } from '@tiptap/core';
import { Color } from '@tiptap/extension-color';
import Mention from '@tiptap/extension-mention';
import TextStyle from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SIZE_MESSAGE,
  MAX_SPLIT_MESSAGE_PARTS,
} from '../../constants/constants';
import {
  type ChatDocNode,
  chatDocumentText,
  chatDocumentToHtml,
  jsonPayloadSize,
  utf8ByteLength,
} from '../../utils/chat/splitLongMessage';
import {
  encryptSingle,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import {
  buildChatGroupMessageParts,
  buildChatGroupPartPayload,
  createSplitPartSender,
  fitChatGroupPartsToWire,
  getComposerSizeLine,
  measureChatGroupComposer,
} from './ChatGroup';

// The node and mark types the chat composer (TipTap.tsx) produces.
const composerExtensions = [
  TextStyle,
  Color.configure({ types: [TextStyle.name, 'listItem'] }),
  StarterKit,
  Mention,
];
const schema = getSchema(composerExtensions);

const doc = (...content: ChatDocNode[]): ChatDocNode => ({
  type: 'doc',
  content,
});
const text = (value: string): ChatDocNode => ({ type: 'text', text: value });
const paragraph = (...content: ChatDocNode[]): ChatDocNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const mention = (id: string, label = id): ChatDocNode => ({
  type: 'mention',
  attrs: { id, label },
});

const words = (count: number, seed = 0) =>
  Array.from({ length: count }, (_, i) => `word${(i + seed) % 997}`).join(' ');
const nonWhitespace = (value: string) => value.replace(/\s+/g, '');

// A long message: 12 paragraphs of about 700 bytes, some 8.5 KB in all.
const longDoc = () =>
  doc(
    ...Array.from({ length: 12 }, (_, i) => paragraph(text(words(90, i * 90))))
  );

// Stand-in for the legacy private-group rule (encrypt the base64 of the HTML
// as JSON, plus 200): base64 twice, so about 16/9 of the JSON bytes.
const fakeEncryptedSize = async (html: string) =>
  Math.ceil((utf8ByteLength(JSON.stringify(html)) * 16) / 9) + 200;

const editors: Editor[] = [];
const editorHtml = (content: ChatDocNode) => {
  const editor = new Editor({ extensions: composerExtensions, content });
  editors.push(editor);
  return editor.getHTML();
};

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

describe('measureChatGroupComposer', () => {
  it('returns a text within the limit as it is, measured like the composer always did', async () => {
    const short = doc(paragraph(text('hello '), mention('Qabc', 'alice')));
    const measured = await measureChatGroupComposer({ doc: short, schema });

    expect(measured.error).toBeUndefined();
    expect(measured.parts).toHaveLength(1);
    expect(measured.parts?.[0]).toBe(short);
    expect(measured.size).toBe(new Blob([JSON.stringify(short)]).size + 300);
  });

  it('splits a plain JSON text over the limit into parts that each fit, in order', async () => {
    const source = longDoc();
    const measured = await measureChatGroupComposer({ doc: source, schema });

    expect(measured.size).toBe(jsonPayloadSize(source));
    expect(measured.size).toBeGreaterThan(MAX_SIZE_MESSAGE);
    const parts = measured.parts as ChatDocNode[];
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(jsonPayloadSize(part)).toBeLessThanOrEqual(MAX_SIZE_MESSAGE);
    }
    expect(nonWhitespace(parts.map(chatDocumentText).join(''))).toBe(
      nonWhitespace(chatDocumentText(source))
    );
  });

  it('reports a text that would need too many parts', async () => {
    const huge = doc(
      ...Array.from({ length: 200 }, (_, i) => paragraph(text(words(100, i))))
    );
    const measured = await measureChatGroupComposer({ doc: huge, schema });
    expect(measured.error).toBe('too_many_parts');
    expect(measured.parts).toBeUndefined();
    expect(measured.size).toBe(jsonPayloadSize(huge));
  });

  it('reports a mention too big to fit in any part', async () => {
    const measured = await measureChatGroupComposer({
      doc: doc(paragraph(mention('Qabc', 'x'.repeat(MAX_SIZE_MESSAGE)))),
      schema,
    });
    expect(measured.error).toBe('unsplittable');
  });

  it('measures an encrypted text once, with the HTML it was given, when it fits', async () => {
    const short = doc(paragraph(text('hello')));
    const encryptedSize = vi.fn(fakeEncryptedSize);
    const measured = await measureChatGroupComposer({
      doc: short,
      encryptedSize,
      html: '<p>hello</p>',
      schema,
    });

    expect(measured.parts?.[0]).toBe(short);
    expect(encryptedSize).toHaveBeenCalledTimes(1);
    expect(encryptedSize).toHaveBeenCalledWith('<p>hello</p>');
    expect(measured.size).toBe(await fakeEncryptedSize('<p>hello</p>'));
  });

  it('splits an encrypted text so every part fits after encryption', async () => {
    const source = longDoc();
    const html = chatDocumentToHtml(source, schema);
    const encryptedSize = vi.fn(fakeEncryptedSize);
    const measured = await measureChatGroupComposer({
      doc: source,
      encryptedSize,
      html,
      schema,
    });

    const parts = measured.parts as ChatDocNode[];
    // The encrypted rule is stricter than the JSON one, so more parts.
    const plain = await measureChatGroupComposer({ doc: source, schema });
    expect(parts.length).toBeGreaterThan(plain.parts?.length as number);
    for (const part of parts) {
      expect(
        await fakeEncryptedSize(chatDocumentToHtml(part, schema))
      ).toBeLessThanOrEqual(MAX_SIZE_MESSAGE);
    }
    // The whole text is encrypted once, not again by the splitter.
    expect(
      encryptedSize.mock.calls.filter(([value]) => value === html)
    ).toHaveLength(1);
    expect(nonWhitespace(parts.map(chatDocumentText).join(''))).toBe(
      nonWhitespace(chatDocumentText(source))
    );
  });
});

describe('buildChatGroupMessageParts', () => {
  it('sends JSON parts on plain payloads, with the HTML the editor would render', async () => {
    const source = doc(
      paragraph(text(words(300))),
      paragraph(text('ping '), mention('Qbob', 'bob'), text(' please')),
      paragraph(text(words(300, 5)))
    );
    const measured = await measureChatGroupComposer({ doc: source, schema });
    const parts = buildChatGroupMessageParts({
      doc: source,
      html: 'unused for split parts',
      parts: measured.parts as ChatDocNode[],
      plainPayload: true,
      schema,
    });

    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part, index) => {
      expect(part.message).toBe(measured.parts?.[index]);
      expect(part.html).toBe(editorHtml(part.message as ChatDocNode));
    });
    // Mentions are resolved per part from its own HTML: only one part has it.
    expect(
      parts.filter((part) => part.html?.includes('data-id="Qbob"'))
    ).toHaveLength(1);
  });

  it('sends the HTML of each part on encrypted payloads', () => {
    const first = doc(paragraph(text('one')));
    const second = doc(paragraph(text('two')));
    const parts = buildChatGroupMessageParts({
      doc: longDoc(),
      html: 'unused',
      parts: [first, second],
      plainPayload: false,
      schema,
    });
    expect(parts).toEqual([
      { html: '<p>one</p>', message: '<p>one</p>' },
      { html: '<p>two</p>', message: '<p>two</p>' },
    ]);
  });

  it('keeps the editor HTML for the editor document itself', () => {
    const source = doc(paragraph(text('same')));
    expect(
      buildChatGroupMessageParts({
        doc: source,
        html: '<p>from the editor</p>',
        parts: [source],
        plainPayload: true,
        schema,
      })
    ).toEqual([{ html: '<p>from the editor</p>', message: source }]);
  });

  it('turns a blank part into what an empty composer sends', () => {
    const blank = doc(paragraph());
    const build = (plainPayload: boolean) =>
      buildChatGroupMessageParts({
        doc: longDoc(),
        html: 'unused',
        parts: [blank],
        plainPayload,
        schema,
      });
    expect(build(true)).toEqual([{ html: null, message: '<p></p>' }]);
    expect(build(false)).toEqual([{ html: null, message: null }]);
  });
});

describe('buildChatGroupPartPayload', () => {
  const shared = {
    attachments: [{ fileName: 'report.pdf', reticulumResource: true }],
    images: [{ identifier: 'img-1', service: 'IMAGE' }],
    isEdit: false,
    messageExpiryPayload: { expiresAt: 1234, expiryDurationMs: 60_000 },
    plainPayload: true,
    publicData: { isEdited: false },
    repliedTo: 'reply-target',
  };

  // The payload as sendMessage built it before messages could be split.
  const singleMessagePayload = ({
    attachments,
    decryptedData,
    images,
    isEdit,
    mentionedAddresses,
    mentionTargets,
    message,
    messageExpiryPayload,
    plainPayload,
    publicData,
    repliedTo,
    specialId,
  }: Omit<Parameters<typeof buildChatGroupPartPayload>[0], 'partIndex'>) => {
    const otherData = {
      repliedTo,
      ...(decryptedData || {}),
      type: isEdit ? 'edit' : '',
      specialId,
      images: images,
      ...(attachments.length > 0 ? { attachments } : {}),
      mentionedAddresses,
      mentionTargets,
      ...publicData,
    };
    return {
      ...(otherData || {}),
      [plainPayload ? 'messageText' : 'message']: message,
      ...messageExpiryPayload,
      version: 3,
    };
  };

  it.each([
    ['a Reticulum reply with images and files', shared],
    [
      'a legacy private message',
      {
        ...shared,
        attachments: [],
        messageExpiryPayload: {},
        plainPayload: false,
        publicData: {},
        repliedTo: undefined,
      },
    ],
    [
      'an edit',
      {
        ...shared,
        attachments: [],
        decryptedData: { repliedTo: 'original-reply', type: 'edit' },
        isEdit: true,
        messageExpiryPayload: {},
        publicData: { isEdited: true },
      },
    ],
  ])('builds %s as one part exactly as before', (_label, fields) => {
    const input = {
      ...fields,
      mentionedAddresses: ['Qalice'],
      mentionTargets: [{ address: 'Qalice', type: 'user' }],
      message: { type: 'doc', content: [paragraph(text('hi'))] },
      specialId: 'abcde',
    };
    const { objectMessage, otherData, repliedTo } = buildChatGroupPartPayload({
      ...input,
      partIndex: 0,
    });
    expect(JSON.stringify(objectMessage)).toBe(
      JSON.stringify(singleMessagePayload(input))
    );
    expect(Object.keys(otherData)).toEqual(
      Object.keys(singleMessagePayload(input)).filter(
        (key) =>
          key !== 'messageText' &&
          key !== 'message' &&
          key !== 'version' &&
          !(key in input.messageExpiryPayload)
      )
    );
    expect(repliedTo).toBe(input.repliedTo);
  });

  it('puts the reply, images and files on the first part only, and expiry on all', () => {
    const payloads = ['one', 'two', 'three'].map((word, partIndex) =>
      buildChatGroupPartPayload({
        ...shared,
        mentionedAddresses: partIndex === 1 ? ['Qbob'] : [],
        mentionTargets: partIndex === 1 ? [{ address: 'Qbob' }] : [],
        message: { type: 'doc', content: [paragraph(text(word))] },
        partIndex,
        specialId: `id-${partIndex}`,
      })
    );

    expect(payloads[0].repliedTo).toBe('reply-target');
    expect(payloads[0].objectMessage).toMatchObject({
      attachments: shared.attachments,
      images: shared.images,
      repliedTo: 'reply-target',
    });
    for (const later of payloads.slice(1)) {
      expect(later.repliedTo).toBeUndefined();
      const sent = JSON.parse(JSON.stringify(later.objectMessage));
      expect(sent.repliedTo).toBeUndefined();
      expect(sent.images).toEqual([]);
      expect(sent).not.toHaveProperty('attachments');
    }
    payloads.forEach(({ objectMessage }, partIndex) => {
      expect(objectMessage).toMatchObject({
        expiresAt: 1234,
        expiryDurationMs: 60_000,
        isEdited: false,
        specialId: `id-${partIndex}`,
        type: '',
        version: 3,
      });
    });
    expect(payloads.map((p) => p.objectMessage.mentionedAddresses)).toEqual([
      [],
      ['Qbob'],
      [],
    ]);
    expect(
      payloads.map((p) =>
        chatDocumentText((p.objectMessage as Record<string, any>).messageText)
      )
    ).toEqual(['one', 'two', 'three']);
  });
});

describe('fitChatGroupPartsToWire', () => {
  const base64Bytes = (length: number) =>
    btoa(String.fromCharCode(...Array.from({ length }, (_, i) => i + 1)));
  // Legacy group keys: the current format, and the older one that stores a
  // nonce and base64-encodes twice, so it grows faster.
  const keyFormats = [
    ['current', { 1: { messageKey: base64Bytes(32) } }],
    [
      'nonce-carrying',
      { 1: { messageKey: base64Bytes(32), nonce: base64Bytes(24) } },
    ],
  ] as const;
  let secretKeyObject: Record<
    number,
    Record<string, string>
  > = keyFormats[0][1];
  // The real legacy private-group composer rule (measureEncryptedChatHtml).
  const realEncryptedSize = async (html: string) =>
    (
      await encryptSingle({
        data64: await objectToBase64(JSON.stringify(html)),
        secretKeyObject,
      })
    ).length + 200;

  // What sendMessage gives the first part of a reply with a pasted image.
  const replySignature = 'S'.repeat(88);
  const imagePointer = {
    name: 'SomeLongerName',
    identifier: 'grp-q-manager_0_group_1234_abcdefghijkl',
    service: 'IMAGE',
    timestamp: 1727000000000,
  };
  const address = (fill: string) => `Q${fill.repeat(33)}`;
  const mentionedAddressesOf = (html: string | null) => [
    ...new Set(
      [...(html || '').matchAll(/data-id="([^"]+)"/g)].map((match) => match[1])
    ),
  ];

  // One long paragraph with a few mentions: packed to the limit by the
  // composer rule, word by word.
  const longMentionDoc = () =>
    doc(
      paragraph(
        ...Array.from({ length: 6 }, (_, i) => [
          text(`${words(230, i * 230)} `),
          mention(address(String.fromCharCode(97 + i)), `user${i}`),
          text(' '),
        ]).flat(),
        text(words(120, 7))
      )
    );

  const buildWire =
    (source: ChatDocNode, html: string, plainPayload: boolean) =>
    async (parts: ChatDocNode[]) => {
      const messageParts = buildChatGroupMessageParts({
        doc: source,
        html,
        parts,
        plainPayload,
        schema,
      });
      const built: string[] = [];
      for (const [partIndex, part] of messageParts.entries()) {
        const mentionedAddresses = mentionedAddressesOf(part.html);
        const { objectMessage } = buildChatGroupPartPayload({
          attachments: [],
          images: [imagePointer],
          isEdit: false,
          mentionedAddresses,
          mentionTargets: [],
          message: part.message,
          messageExpiryPayload: {},
          partIndex,
          plainPayload,
          publicData: plainPayload ? { isEdited: false } : {},
          repliedTo: replySignature,
          specialId: 'abcde',
        });
        built.push(
          plainPayload
            ? JSON.stringify(objectMessage)
            : await encryptSingle({
                data64: await objectToBase64(objectMessage),
                secretKeyObject,
              })
        );
      }
      return built;
    };

  it.each(keyFormats)(
    'keeps every encrypted legacy part, reply and image included, within the CHAT limit (%s key)',
    async (_label, key) => {
      secretKeyObject = key;
      const source = longMentionDoc();
      const html = chatDocumentToHtml(source, schema);
      const measured = await measureChatGroupComposer({
        doc: source,
        encryptedSize: realEncryptedSize,
        html,
        schema,
      });
      const build = buildWire(source, html, false);

      // The composer rule alone packs the first part past what Core accepts.
      const unchecked = await build(measured.parts as ChatDocNode[]);
      expect(unchecked[0].length).toBeGreaterThan(MAX_SIZE_MESSAGE);

      const fitted = await fitChatGroupPartsToWire({
        build,
        parts: measured.parts as ChatDocNode[],
        split: (budget) =>
          measureChatGroupComposer({
            doc: source,
            encryptedSize: realEncryptedSize,
            html,
            maxBytes: budget,
            schema,
          }),
        wireSize: (payload) => utf8ByteLength(payload),
      });

      expect(fitted.error).toBeUndefined();
      const built = fitted.built as string[];
      expect(built.length).toBeLessThanOrEqual(MAX_SPLIT_MESSAGE_PARTS);
      for (const payload of built) {
        expect(utf8ByteLength(payload)).toBeLessThanOrEqual(MAX_SIZE_MESSAGE);
      }
      const parts = fitted.parts as ChatDocNode[];
      expect(parts).toHaveLength(built.length);
      expect(nonWhitespace(parts.map(chatDocumentText).join(''))).toBe(
        nonWhitespace(chatDocumentText(source))
      );
    }
  );

  it('keeps every plain legacy part, reply and image included, within the CHAT limit', async () => {
    const source = longMentionDoc();
    const html = chatDocumentToHtml(source, schema);
    const measured = await measureChatGroupComposer({ doc: source, schema });
    const build = buildWire(source, html, true);
    const unchecked = await build(measured.parts as ChatDocNode[]);
    expect(utf8ByteLength(unchecked[0])).toBeGreaterThan(MAX_SIZE_MESSAGE);

    const fitted = await fitChatGroupPartsToWire({
      build,
      parts: measured.parts as ChatDocNode[],
      split: (budget) =>
        measureChatGroupComposer({ doc: source, maxBytes: budget, schema }),
      wireSize: (payload) => utf8ByteLength(payload),
    });

    expect(fitted.error).toBeUndefined();
    for (const payload of fitted.built as string[]) {
      expect(utf8ByteLength(payload)).toBeLessThanOrEqual(MAX_SIZE_MESSAGE);
      // The payload still carries the part's text as TipTap JSON.
      expect(JSON.parse(payload).messageText.type).toBe('doc');
    }
    expect(
      nonWhitespace(
        (fitted.parts as ChatDocNode[]).map(chatDocumentText).join('')
      )
    ).toBe(nonWhitespace(chatDocumentText(source)));
  });

  it('re-splits a text that fit as one message once its reply is counted', async () => {
    // Just under the composer limit, so it was never split before.
    let body = words(560);
    const single = () => doc(paragraph(text(body)));
    while (jsonPayloadSize(single()) > MAX_SIZE_MESSAGE) {
      body = body.slice(0, body.lastIndexOf(' '));
    }
    const source = single();
    const measured = await measureChatGroupComposer({ doc: source, schema });
    expect(measured.parts?.[0]).toBe(source);

    const fitted = await fitChatGroupPartsToWire({
      build: buildWire(source, chatDocumentToHtml(source, schema), true),
      parts: measured.parts as ChatDocNode[],
      split: (budget) =>
        measureChatGroupComposer({ doc: source, maxBytes: budget, schema }),
      wireSize: (payload) => utf8ByteLength(payload),
    });

    expect(fitted.parts).toHaveLength(2);
    for (const payload of fitted.built as string[]) {
      expect(utf8ByteLength(payload)).toBeLessThanOrEqual(MAX_SIZE_MESSAGE);
    }
  });

  it('builds once and never re-splits when every part already fits', async () => {
    const parts = [doc(paragraph(text('one'))), doc(paragraph(text('two')))];
    const build = vi.fn(async (current: ChatDocNode[]) =>
      current.map(chatDocumentText)
    );
    const split = vi.fn();
    const fitted = await fitChatGroupPartsToWire({
      build,
      parts,
      split,
      wireSize: (value) => value.length,
    });
    expect(fitted).toEqual({ built: ['one', 'two'], parts });
    expect(build).toHaveBeenCalledTimes(1);
    expect(split).not.toHaveBeenCalled();
  });

  it('lowers the budget by the overshoot and passes on a split error', async () => {
    const split = vi.fn(async (_budget: number) => ({
      size: 9000,
      error: 'too_many_parts' as const,
    }));
    const fitted = await fitChatGroupPartsToWire({
      build: async () => [MAX_SIZE_MESSAGE + 100],
      parts: [doc(paragraph(text('x')))],
      split,
      wireSize: (value: number) => value,
    });
    expect(fitted.error).toBe('too_many_parts');
    expect(split).toHaveBeenCalledTimes(1);
    expect(split.mock.calls[0][0]).toBeLessThanOrEqual(MAX_SIZE_MESSAGE - 100);
  });

  it('gives up as unsplittable when parts keep coming out too big', async () => {
    const split = vi.fn(async (budget: number) => ({
      size: 9000,
      parts: [doc(paragraph(text(String(budget))))],
    }));
    const fitted = await fitChatGroupPartsToWire({
      build: async () => [MAX_SIZE_MESSAGE + 1],
      maxAttempts: 3,
      parts: [doc(paragraph(text('x')))],
      split,
      wireSize: (value: number) => value,
    });
    expect(fitted.error).toBe('unsplittable');
    expect(split).toHaveBeenCalledTimes(2);
  });
});

describe('createSplitPartSender', () => {
  // Runs queue items the way MessageQueueContext does: strictly in order,
  // each tried up to three times before it is given up on.
  const runQueue = async (items: Array<() => Promise<unknown>>) => {
    const outcomes: string[] = [];
    for (const item of items) {
      let outcome = 'failed';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await item();
          outcome = 'sent';
          break;
        } catch (error) {
          outcome = `failed: ${(error as Error).message}`;
        }
      }
      outcomes.push(outcome);
    }
    return outcomes;
  };

  it('sends every part when none fails', async () => {
    const sendAfter = createSplitPartSender(() => new Error('fallback'));
    const publish = vi.fn(async () => 'ok');
    const outcomes = await runQueue(
      [0, 1, 2].map((partIndex) => sendAfter(partIndex, publish))
    );
    expect(outcomes).toEqual(['sent', 'sent', 'sent']);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('does not send the parts after one that failed for good', async () => {
    const sendAfter = createSplitPartSender(() => new Error('fallback'));
    const published: number[] = [];
    const publish = (partIndex: number) => async () => {
      if (partIndex === 1) throw new Error('rpc timeout');
      published.push(partIndex);
    };
    const outcomes = await runQueue(
      [0, 1, 2, 3].map((partIndex) => sendAfter(partIndex, publish(partIndex)))
    );
    expect(outcomes).toEqual([
      'sent',
      'failed: rpc timeout',
      'failed: rpc timeout',
      'failed: rpc timeout',
    ]);
    expect(published).toEqual([0]);
  });

  it('carries on once a retried part goes through', async () => {
    const sendAfter = createSplitPartSender(() => new Error('fallback'));
    let firstTry = true;
    const published: number[] = [];
    const outcomes = await runQueue(
      [0, 1, 2].map((partIndex) =>
        sendAfter(partIndex, async () => {
          if (partIndex === 1 && firstTry) {
            firstTry = false;
            throw new Error('busy');
          }
          published.push(partIndex);
        })
      )
    );
    expect(outcomes).toEqual(['sent', 'sent', 'sent']);
    expect(published).toEqual([0, 1, 2]);
  });
});

describe('getComposerSizeLine', () => {
  const maximum = MAX_SIZE_MESSAGE;

  it('shows the byte count while within the limit', () => {
    expect(getComposerSizeLine({ maximum, size: 3500 })).toEqual({
      key: 'core:message.error.message_size',
      options: { maximum, size: 3500, postProcess: 'capitalizeFirstChar' },
      tone: 'neutral',
    });
  });

  it('announces the split once the text is over the limit', () => {
    expect(getComposerSizeLine({ maximum, size: 9000, splitParts: 3 })).toEqual(
      {
        key: 'core:message.generic.long_message_split',
        options: { count: 3 },
        tone: 'notice',
      }
    );
  });

  it('says nothing when trimming blank lines was enough', () => {
    expect(
      getComposerSizeLine({ maximum, size: 4100, splitParts: 1 })
    ).toBeNull();
  });

  it('explains why an over-limit text cannot be sent', () => {
    expect(
      getComposerSizeLine({
        maximum,
        size: 90000,
        splitError: 'too_many_parts',
        splitParts: 3,
      })
    ).toEqual({
      key: 'core:message.error.long_message_too_many_parts',
      options: { maximum: MAX_SPLIT_MESSAGE_PARTS },
      tone: 'error',
    });
    expect(
      getComposerSizeLine({ maximum, size: 5000, splitError: 'unsplittable' })
    ).toMatchObject({
      key: 'core:message.error.long_message_unsplittable',
      tone: 'error',
    });
    expect(
      getComposerSizeLine({ maximum, size: 5000, splitError: 'edit' })
    ).toEqual({
      key: 'core:message.error.edit_message_too_long',
      options: { maximum },
      tone: 'error',
    });
  });

  it('falls back to the size error while the split is not known yet', () => {
    expect(getComposerSizeLine({ maximum, size: 4500 })).toMatchObject({
      key: 'core:message.error.message_size',
      tone: 'error',
    });
  });

  it('ignores a stale split error once back within the limit', () => {
    expect(
      getComposerSizeLine({ maximum, size: 3900, splitError: 'edit' })
    ).toMatchObject({
      key: 'core:message.error.message_size',
      tone: 'neutral',
    });
  });
});
