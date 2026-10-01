import { Editor, getSchema } from '@tiptap/core';
import { Color } from '@tiptap/extension-color';
import Mention from '@tiptap/extension-mention';
import TextStyle from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_SIZE_MESSAGE } from '../../constants/constants';
import {
  type ChatDocNode,
  MAX_SPLIT_MESSAGE_PARTS,
  chatDocumentText,
  chatDocumentToHtml,
  jsonPayloadFits,
  jsonPayloadSize,
  splitChatDocument,
  splitChatDocumentAsync,
  utf8ByteLength,
} from './splitLongMessage';

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
const text = (value: string, marks?: ChatDocNode['marks']): ChatDocNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const paragraph = (...content: ChatDocNode[]): ChatDocNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const heading = (level: number, ...content: ChatDocNode[]): ChatDocNode => ({
  type: 'heading',
  attrs: { level },
  content,
});
const listItem = (...content: ChatDocNode[]): ChatDocNode => ({
  type: 'listItem',
  content,
});
const bulletList = (...items: ChatDocNode[]): ChatDocNode => ({
  type: 'bulletList',
  content: items,
});
const orderedList = (start: number, ...items: ChatDocNode[]): ChatDocNode => ({
  type: 'orderedList',
  attrs: { start },
  content: items,
});
const codeBlock = (value: string, language: string | null = 'ts') => ({
  type: 'codeBlock',
  attrs: { language },
  content: value ? [text(value)] : [],
});
const blockquote = (...content: ChatDocNode[]): ChatDocNode => ({
  type: 'blockquote',
  content,
});
const mention = (id: string, label = id): ChatDocNode => ({
  type: 'mention',
  attrs: { id, label },
});
const hardBreak = (): ChatDocNode => ({ type: 'hardBreak' });

const words = (count: number, seed = 0) =>
  Array.from({ length: count }, (_, i) => `word${(i + seed) % 997}`).join(' ');

const nonWhitespace = (value: string) => value.replace(/\s+/g, '');

const partsOf = (result: ReturnType<typeof splitChatDocument>) => {
  if (result.error) throw new Error(`split failed: ${result.error}`);
  return result.parts;
};

const collect = (node: ChatDocNode, type: string): ChatDocNode[] => {
  const found: ChatDocNode[] = [];
  const visit = (current: ChatDocNode) => {
    if (current?.type === type) found.push(current);
    current?.content?.forEach(visit);
  };
  visit(node);
  return found;
};

const isBlankBlock = (node: ChatDocNode) =>
  (node.type === 'paragraph' || node.type === 'heading') &&
  !nonWhitespace(chatDocumentText(node)) &&
  !(node.content || []).some((child) => child.type === 'mention');

// Every rule a produced part has to satisfy, whatever the input.
const expectWellFormedSplit = (
  original: ChatDocNode,
  parts: ChatDocNode[],
  fits: (part: ChatDocNode) => boolean
) => {
  expect(parts.length).toBeGreaterThan(0);
  for (const part of parts) {
    expect(part.type).toBe('doc');
    expect(fits(part)).toBe(true);
    // Valid against the composer schema (content expressions and marks).
    expect(() => schema.nodeFromJSON(part).check()).not.toThrow();
    const top = part.content || [];
    expect(top.length).toBeGreaterThan(0);
    expect(isBlankBlock(top[0])).toBe(false);
    expect(isBlankBlock(top[top.length - 1])).toBe(false);
    expect(
      nonWhitespace(chatDocumentText(part)).length +
        collect(part, 'horizontalRule').length
    ).toBeGreaterThan(0);
  }
  // No non-whitespace character lost or duplicated, in order.
  expect(
    parts.map((part) => nonWhitespace(chatDocumentText(part))).join('')
  ).toBe(nonWhitespace(chatDocumentText(original)));
  // Mentions survive whole, once each, in order.
  expect(
    parts.flatMap((part) => collect(part, 'mention').map((node) => node.attrs))
  ).toEqual(collect(original, 'mention').map((node) => node.attrs));
};

const byteFits = (maxBytes: number) => jsonPayloadFits(maxBytes, 0);

describe('jsonPayloadFits / jsonPayloadSize', () => {
  it('measures UTF-8 bytes of the JSON plus the overhead, like the composer', () => {
    const sample = doc(paragraph(text('héllo 👋🏽 世界 \ud83d')));
    const json = JSON.stringify(sample);
    const expected = new TextEncoder().encode(json).length;
    expect(utf8ByteLength(json)).toBe(expected);
    expect(jsonPayloadSize(sample)).toBe(expected + 300);
    expect(jsonPayloadSize(sample, 200)).toBe(expected + 200);
    expect(jsonPayloadFits(expected + 300)(sample)).toBe(true);
    expect(jsonPayloadFits(expected + 299)(sample)).toBe(false);
    expect(jsonPayloadFits(expected, 0)(sample)).toBe(true);
  });

  it('counts astral characters as 4 bytes and BMP ones as 2 or 3', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('世')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

describe('splitChatDocument', () => {
  it('returns the very same document when it already fits', () => {
    const input = doc(paragraph(text('short')));
    const result = splitChatDocument(input, byteFits(1000));
    expect(result.parts).toHaveLength(1);
    expect(result.parts?.[0]).toBe(input);
  });

  it('defaults to MAX_SPLIT_MESSAGE_PARTS = 15', () => {
    expect(MAX_SPLIT_MESSAGE_PARTS).toBe(15);
  });

  it('packs whole top-level blocks into as few messages as fit', () => {
    // Equal-sized paragraphs, so exactly three fit per message.
    const blocks = Array.from({ length: 12 }, (_, i) =>
      paragraph(text(`${String(i).padStart(2, '0')} ${words(40)}`))
    );
    const input = doc(...blocks);
    const blockBytes = utf8ByteLength(JSON.stringify(blocks[0]));
    // Room for three paragraphs (plus the doc wrapper), not four.
    const fits = byteFits(3 * blockBytes + 60);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(part.content).toHaveLength(3);
      for (const block of part.content || []) {
        expect(blocks.map((b) => chatDocumentText(b))).toContain(
          chatDocumentText(block)
        );
      }
    }
  });

  it('keeps a short block to itself rather than splitting it into the next one', () => {
    const intro = paragraph(text('Here is the log:'));
    const long = paragraph(text(words(400)));
    const input = doc(intro, long);
    const fits = byteFits(1200);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(chatDocumentText(parts[0])).toBe('Here is the log:');
    expect(parts.length).toBeGreaterThan(2);
  });

  it('splits an oversized list between items and continues ordered numbering', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      listItem(paragraph(text(`item ${i + 1} ${words(12, i)}`)))
    );
    const input = doc(paragraph(text('Steps:')), orderedList(5, ...items));
    const fits = byteFits(1500);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(parts.length).toBeGreaterThan(2);

    let expectedStart = 5;
    const seen: string[] = [];
    for (const part of parts) {
      for (const list of collect(part, 'orderedList')) {
        expect(list.attrs?.start).toBe(expectedStart);
        for (const item of list.content || []) {
          const itemText = chatDocumentText(item);
          // Whole items only: the text starts with its own number.
          expect(itemText).toMatch(/^item \d+ /);
          seen.push(itemText);
        }
        expectedStart += (list.content || []).length;
      }
    }
    expect(seen).toEqual(items.map((item) => chatDocumentText(item)));
  });

  it('splits a bullet list between items without adding attributes', () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      listItem(paragraph(text(words(15, i))))
    );
    const input = doc(bulletList(...items));
    const fits = byteFits(1200);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    for (const part of parts) {
      expect(part.content).toHaveLength(1);
      expect(part.content?.[0].type).toBe('bulletList');
      expect(part.content?.[0].attrs).toBeUndefined();
    }
  });

  it('continues a list item that is split at its nested list with a valid empty paragraph', () => {
    const nested = bulletList(
      ...Array.from({ length: 20 }, (_, i) =>
        listItem(paragraph(text(words(12, i))))
      )
    );
    const input = doc(
      orderedList(
        1,
        listItem(paragraph(text('first'))),
        listItem(paragraph(text(words(60))), nested)
      )
    );
    const fits = byteFits(900);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    // The continuation keeps item 2's number.
    for (const part of parts.slice(1)) {
      expect(part.content?.[0].type).toBe('orderedList');
      expect(part.content?.[0].attrs?.start).toBe(2);
    }
  });

  it('splits an oversized code block between lines, keeping its language', () => {
    const lines = Array.from(
      { length: 120 },
      (_, i) => `  const value${i} = compute(${i}, "${'x'.repeat(i % 7)}");`
    );
    const input = doc(codeBlock(lines.join('\n'), 'typescript'));
    const fits = byteFits(1500);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(parts.length).toBeGreaterThan(2);
    const pieces = parts.map((part) => {
      expect(part.content).toHaveLength(1);
      const block = part.content?.[0] as ChatDocNode;
      expect(block.type).toBe('codeBlock');
      expect(block.attrs).toEqual({ language: 'typescript' });
      return chatDocumentText(block);
    });
    // Only the newline at each split goes; indentation is kept.
    expect(pieces.join('\n')).toBe(lines.join('\n'));
    for (const piece of pieces) {
      expect(piece.startsWith('  const value')).toBe(true);
    }
  });

  it('splits a single overlong code line at whitespace, losing nothing', () => {
    const line = Array.from({ length: 300 }, (_, i) => `tok${i}`).join(' ');
    const input = doc(codeBlock(line, null));
    const fits = byteFits(700);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(parts.map((part) => chatDocumentText(part)).join('')).toBe(line);
  });

  it('splits an oversized paragraph between words and drops only the space', () => {
    const sentence = words(600);
    const input = doc(paragraph(text(sentence)));
    const fits = byteFits(1000);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    const pieces = parts.map((part) => chatDocumentText(part));
    for (const piece of pieces) {
      expect(piece).toMatch(/^word\d+( word\d+)*$/);
    }
    expect(pieces.join(' ')).toBe(sentence);
  });

  it('keeps a heading level on both sides of a split', () => {
    const input = doc(heading(2, text(words(300))));
    const fits = byteFits(900);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    for (const part of parts) {
      expect(part.content?.[0]).toMatchObject({
        type: 'heading',
        attrs: { level: 2 },
      });
    }
  });

  it('prefers a hard break over a word boundary', () => {
    const lines = Array.from({ length: 12 }, (_, i) => text(words(20, i)));
    const content: ChatDocNode[] = [];
    lines.forEach((line, i) => {
      if (i) content.push(hardBreak());
      content.push(line);
    });
    const input = doc(paragraph(...content));
    const fits = byteFits(900);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    const lineTexts = lines.map((line) => line.text);
    for (const part of parts) {
      const inline = part.content?.[0].content || [];
      expect(inline[0].type).toBe('text');
      expect(inline[inline.length - 1].type).toBe('text');
      for (const node of inline) {
        if (node.type === 'text') expect(lineTexts).toContain(node.text);
      }
    }
  });

  it('falls back to grapheme-safe character splits inside one long word', () => {
    const word = 'a👍🏽b👨‍👩‍👧‍👦c🇫🇮dé'.repeat(120);
    const input = doc(paragraph(text(word)));
    const fits = byteFits(500);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    const pieces = parts.map((part) => chatDocumentText(part));
    expect(pieces.join('')).toBe(word);
    const segmenter = new (Intl as any).Segmenter(undefined, {
      granularity: 'grapheme',
    });
    const clusters = (value: string): string[] =>
      Array.from(
        segmenter.segment(value) as Iterable<{ segment: string }>,
        (s) => s.segment
      );
    // Cutting on cluster boundaries means the pieces' clusters are the
    // original's clusters.
    expect(pieces.flatMap(clusters)).toEqual(clusters(word));
  });

  describe('without Intl.Segmenter', () => {
    const original = (Intl as any).Segmenter;
    afterEach(() => {
      (Intl as any).Segmenter = original;
    });

    it('still never splits a surrogate pair', () => {
      (Intl as any).Segmenter = undefined;
      const word = 'x😀y𝄞z'.repeat(200);
      const input = doc(paragraph(text(word)));
      const fits = byteFits(301);
      const parts = partsOf(splitChatDocument(input, fits));
      expectWellFormedSplit(input, parts, fits);
      const pieces = parts.map((part) => chatDocumentText(part));
      expect(pieces.join('')).toBe(word);
      for (const piece of pieces) {
        expect(piece).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/);
      }
    });
  });

  it('never splits mention atoms and computes nothing about them', () => {
    const content: ChatDocNode[] = [];
    for (let i = 0; i < 80; i++) {
      content.push(text(`hello `), mention(`addr${i}`, `user${i}`), text(', '));
    }
    const input = doc(paragraph(...content));
    const fits = byteFits(1200);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(parts.length).toBeGreaterThan(2);
  });

  it('keeps marks on both sides of a split', () => {
    const marks = [
      { type: 'bold' },
      { type: 'italic' },
      { type: 'textStyle', attrs: { color: '#ff0000' } },
    ];
    const input = doc(
      paragraph(text('plain start '), text(words(400), marks), text(' end'))
    );
    const fits = byteFits(1100);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) {
      const styled = (part.content?.[0].content || []).filter((node) =>
        /word/.test(node.text || '')
      );
      expect(styled.length).toBeGreaterThan(0);
      for (const node of styled) expect(node.marks).toEqual(marks);
    }
    expect(chatDocumentText(parts[0]).startsWith('plain start word0')).toBe(
      true
    );
  });

  it('trims blank paragraphs and whitespace at the edges of every part', () => {
    const blank = () => paragraph();
    const spaces = () => paragraph(text('   '));
    const input = doc(
      blank(),
      spaces(),
      paragraph(text(words(60))),
      blank(),
      blank(),
      blank(),
      paragraph(text(words(60, 3))),
      blank(),
      paragraph(text(`   ${words(60, 5)}   `)),
      blank(),
      spaces()
    );
    const fits = byteFits(700);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    for (const part of parts) {
      const value = chatDocumentText(part);
      expect(value).toBe(value.trim());
    }
  });

  it('keeps blank lines between blocks inside a part', () => {
    const input = doc(
      paragraph(text('a')),
      paragraph(),
      paragraph(text('b')),
      paragraph(text(words(200)))
    );
    const fits = byteFits(600);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(parts[0].content).toEqual([
      paragraph(text('a')),
      paragraph(),
      paragraph(text('b')),
    ]);
  });

  it('sends a blank but oversized document as one empty paragraph', () => {
    const input = doc(...Array.from({ length: 300 }, () => paragraph()));
    const parts = partsOf(splitChatDocument(input, byteFits(500)));
    expect(parts).toEqual([doc(paragraph())]);
  });

  it('reports too_many_parts past the limit and splits up to it', () => {
    const blocks = Array.from({ length: 16 }, (_, i) =>
      paragraph(text(words(30, i)))
    );
    const blockBytes = Math.max(
      ...blocks.map((block) => utf8ByteLength(JSON.stringify(block)))
    );
    const fits = byteFits(blockBytes + 40);
    expect(splitChatDocument(doc(...blocks), fits)).toEqual({
      error: 'too_many_parts',
    });
    expect(
      partsOf(splitChatDocument(doc(...blocks.slice(1)), fits))
    ).toHaveLength(15);
    expect(
      partsOf(splitChatDocument(doc(...blocks), fits, { maxParts: 16 }))
    ).toHaveLength(16);
    expect(splitChatDocument(doc(...blocks), fits, { maxParts: 3 })).toEqual({
      error: 'too_many_parts',
    });
  });

  it('reports unsplittable when one atom cannot fit on its own', () => {
    const input = doc(
      paragraph(text(words(50))),
      paragraph(mention('x', 'y'.repeat(2000))),
      paragraph(text(words(50)))
    );
    expect(splitChatDocument(input, byteFits(1000))).toEqual({
      error: 'unsplittable',
    });
  });

  it('reports unsplittable when not even one character fits', () => {
    const input = doc(paragraph(text(words(50))));
    expect(splitChatDocument(input, byteFits(20))).toEqual({
      error: 'unsplittable',
    });
  });

  it('keeps blockquotes and nested structure valid when splitting inside them', () => {
    const input = doc(
      blockquote(
        paragraph(text(words(80))),
        bulletList(
          ...Array.from({ length: 10 }, (_, i) =>
            listItem(paragraph(text(words(20, i))))
          )
        ),
        paragraph(text(words(80, 7)))
      ),
      { type: 'horizontalRule' },
      paragraph(text('after'))
    );
    const fits = byteFits(800);
    const parts = partsOf(splitChatDocument(input, fits));
    expectWellFormedSplit(input, parts, fits);
    expect(collect(parts[parts.length - 1], 'horizontalRule')).toHaveLength(1);
  });

  it('holds every rule over generated documents (property check)', () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T>(values: T[]): T =>
      values[Math.floor(random() * values.length)];
    const vocabulary = [
      'alpha',
      'beta',
      'gamma',
      'déjà',
      'naïve',
      '世界',
      '😀',
      '👍🏽',
      '🇫🇮',
      'x'.repeat(40),
      'https://example.com/a/very/long/path?with=query',
    ];
    const markSets = [
      undefined,
      [{ type: 'bold' }],
      [{ type: 'italic' }, { type: 'strike' }],
      [{ type: 'code' }],
      [{ type: 'textStyle', attrs: { color: '#00aa00' } }],
    ];
    const inline = (count: number): ChatDocNode[] => {
      const nodes: ChatDocNode[] = [];
      for (let i = 0; i < count; i++) {
        const roll = random();
        if (roll < 0.08) nodes.push(mention(`a${i}`, pick(['bob', 'alice'])));
        else if (roll < 0.14) nodes.push(hardBreak());
        else {
          const value = Array.from(
            { length: 1 + Math.floor(random() * 12) },
            () => pick(vocabulary)
          ).join(pick([' ', ' ', '  ', '']));
          nodes.push(text(`${value} `, pick(markSets)));
        }
      }
      return nodes;
    };
    const block = (depth: number): ChatDocNode => {
      const roll = random();
      if (roll < 0.1) return paragraph();
      if (roll < 0.45 || depth > 2) {
        return paragraph(...inline(1 + Math.floor(random() * 12)));
      }
      if (roll < 0.52) {
        return heading(1 + Math.floor(random() * 3), ...inline(3));
      }
      if (roll < 0.62) {
        return codeBlock(
          Array.from(
            { length: 1 + Math.floor(random() * 40) },
            (_, i) => `  line ${i} ${pick(vocabulary)}`
          ).join('\n')
        );
      }
      if (roll < 0.7) {
        return blockquote(block(depth + 1), block(depth + 1));
      }
      if (roll < 0.75) return { type: 'horizontalRule' };
      const items = Array.from({ length: 1 + Math.floor(random() * 8) }, () =>
        random() < 0.3
          ? listItem(
              paragraph(...inline(3)),
              bulletList(listItem(block(depth + 2)))
            )
          : listItem(block(depth + 1))
      );
      return random() < 0.5
        ? bulletList(...items)
        : orderedList(1 + Math.floor(random() * 5), ...items);
    };

    let split = 0;
    for (let round = 0; round < 40; round++) {
      const input = doc(
        ...Array.from({ length: 1 + Math.floor(random() * 14) }, () => block(0))
      );
      // The real rule (4000 bytes with 300 of overhead) and tighter budgets,
      // still roomy enough for one character under five nested wrappers.
      const fits =
        round % 3
          ? jsonPayloadFits(pick([600, 800, 1000, 2000]), 0)
          : jsonPayloadFits(MAX_SIZE_MESSAGE);
      const result = splitChatDocument(input, fits, { maxParts: Infinity });
      expect(result.error).toBeUndefined();
      if (result.error) continue;
      if (result.parts.length > 1) split++;
      expectWellFormedSplit(input, result.parts, fits);
      if (!fits(input)) {
        for (const list of result.parts.flatMap((part) =>
          collect(part, 'orderedList')
        )) {
          expect(Number.isInteger(list.attrs?.start)).toBe(true);
        }
      }
    }
    expect(split).toBeGreaterThan(25);
  }, 20_000);

  it('splits a 200 KB paste well under a second', () => {
    const paragraphs = Array.from({ length: 1400 }, (_, i) =>
      paragraph(text(`${words(22, i)} ${i % 3 ? 'é👍🏽' : ''}`))
    );
    const pasted = doc(...paragraphs);
    const oneParagraph = doc(paragraph(text(words(33000))));
    expect(chatDocumentText(pasted).length).toBeGreaterThan(200_000);
    expect(chatDocumentText(oneParagraph).length).toBeGreaterThan(200_000);
    const fits = jsonPayloadFits(MAX_SIZE_MESSAGE);

    for (const input of [pasted, oneParagraph]) {
      let calls = 0;
      const started = performance.now();
      const parts = partsOf(
        splitChatDocument(
          input,
          (part) => {
            calls++;
            return fits(part);
          },
          { maxParts: Infinity }
        )
      );
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(1000);
      expect(parts.length).toBeGreaterThan(50);
      // A binary search, not a scan: a few dozen calls per part at most.
      expect(calls / parts.length).toBeLessThan(30);
      expect(
        parts.map((part) => nonWhitespace(chatDocumentText(part))).join('')
      ).toBe(nonWhitespace(chatDocumentText(input)));
    }

    // With the default limit the same paste is refused quickly.
    const started = performance.now();
    expect(splitChatDocument(pasted, fits)).toEqual({
      error: 'too_many_parts',
    });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('splitChatDocumentAsync', () => {
  it('matches the sync split with an async size check', async () => {
    const input = doc(
      paragraph(text('Intro')),
      orderedList(
        3,
        ...Array.from({ length: 20 }, (_, i) =>
          listItem(paragraph(text(words(15, i)), mention(`m${i}`)))
        )
      ),
      codeBlock(Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')),
      paragraph(text(words(300)))
    );
    const fits = byteFits(1000);
    let calls = 0;
    const asyncResult = await splitChatDocumentAsync(input, async (part) => {
      calls++;
      await Promise.resolve();
      return fits(part);
    });
    const parts = partsOf(asyncResult);
    expect(parts).toEqual(partsOf(splitChatDocument(input, fits)));
    expectWellFormedSplit(input, parts, fits);
    expect(calls / parts.length).toBeLessThan(30);
  });

  it('passes errors through', async () => {
    const input = doc(paragraph(mention('x', 'y'.repeat(900))));
    await expect(
      splitChatDocumentAsync(input, async (part) => byteFits(500)(part))
    ).resolves.toEqual({ error: 'unsplittable' });
    await expect(
      splitChatDocumentAsync(input, async () => {
        throw new Error('encryption failed');
      })
    ).rejects.toThrow('encryption failed');
  });
});

describe('chatDocumentToHtml', () => {
  it('renders a part exactly as editor.getHTML() would', () => {
    const input = doc(
      paragraph(
        text('Hi '),
        mention('addr', 'alice'),
        text(' — '),
        text('bold', [{ type: 'bold' }])
      ),
      orderedList(4, listItem(paragraph(text('four')))),
      codeBlock('a < b && c', 'js')
    );
    const editor = new Editor({
      extensions: composerExtensions,
      content: input,
    });
    try {
      expect(chatDocumentToHtml(input, editor.schema)).toBe(editor.getHTML());
      expect(chatDocumentToHtml(input, editor.schema)).toContain(
        '<ol start="4">'
      );
    } finally {
      editor.destroy();
    }
  });
});

describe('chatDocumentText', () => {
  it('joins blocks with newlines and renders atoms', () => {
    expect(
      chatDocumentText(
        doc(
          paragraph(text('a'), hardBreak(), text('b ')),
          paragraph(mention('id1', '@carol')),
          bulletList(listItem(paragraph(text('c'))))
        )
      )
    ).toBe('a\nb \n@carol\nc');
  });
});
