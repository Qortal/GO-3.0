/**
 * Splits a chat composer document that is over the message size limit into
 * consecutive documents that each fit, so a long text can still be sent as
 * several messages.
 *
 * Works on TipTap JSON (`editor.getJSON()`), never on HTML. The size rule is a
 * caller-supplied predicate, so the same splitter serves the plain JSON
 * payloads (Reticulum, public legacy groups) and the encrypted legacy ones.
 *
 * Split points, most preferred first:
 *   1. between top-level blocks (paragraphs, headings, lists, code, quotes),
 *      then between the children of nested containers, shallowest first
 *      (list items, blockquote children, a list item's paragraph and its
 *      sub-list, ...); an ordered list continued in a later part keeps its
 *      numbering through `attrs.start`
 *   2. inside a paragraph or heading after a hard break, inside a code block
 *      after a newline (that newline is dropped)
 *   3. between words (the whitespace at the split is dropped)
 *   4. between grapheme clusters (code points where Intl.Segmenter is
 *      missing), so a surrogate pair is never split
 * A part is always cut at the most preferred kind of point that still leaves
 * something in it, as late as that kind allows. Inline atoms (mentions, hard
 * breaks, emoji or image nodes) are never split, and marks and attributes are
 * kept on every piece. Only whitespace can go missing, and only at a split
 * point: blank paragraphs and whitespace at the start and end of every part
 * are trimmed (code-block whitespace is kept), and no part is empty.
 */
import { getHTMLFromFragment } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { MAX_SPLIT_MESSAGE_PARTS } from '../../constants/constants';

export { MAX_SPLIT_MESSAGE_PARTS };

/** Structurally compatible with TipTap's `JSONContent`. */
type ChatDocMark = {
  type: string;
  attrs?: Record<string, any>;
  [key: string]: any;
};

/** Structurally compatible with TipTap's `JSONContent`. */
export type ChatDocNode = {
  type?: string;
  attrs?: Record<string, any>;
  content?: ChatDocNode[];
  marks?: ChatDocMark[];
  text?: string;
  [key: string]: any;
};

export type SplitChatDocumentError = 'too_many_parts' | 'unsplittable';

type SplitChatDocumentResult =
  | { parts: ChatDocNode[]; error?: undefined }
  | { parts?: undefined; error: SplitChatDocumentError };

type SplitChatDocumentOptions = {
  /** Most parts allowed. Defaults to MAX_SPLIT_MESSAGE_PARTS. */
  maxParts?: number;
};

const KIND_TEXT = 0;
const KIND_INLINE_ATOM = 1;
const KIND_LEAF = 2;

const FLAG_WHITESPACE = 1;
const FLAG_NEWLINE = 2;
// Whitespace that may be dropped at the edge of a part: whitespace text and
// hard breaks outside code blocks, and empty paragraphs/headings/code blocks.
const FLAG_TRIMMABLE = 4;

// Split point priorities; lower is preferred. Block boundaries use the depth
// of the container they separate children of (0 = top level).
const PRIORITY_END = -1;
const PRIORITY_MAX_BLOCK_DEPTH = 999;
const PRIORITY_LINE = 1000;
const PRIORITY_WORD = 1001;
const PRIORITY_CHARACTER = 1002;

const TEXTBLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);
const WHITESPACE_ONLY = /^\s+$/;

type Frame = {
  node: ChatDocNode;
  childIndex: number;
  depth: number;
  textblock: boolean;
  code: boolean;
  path: number[];
};

type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

const isTextblock = (node: ChatDocNode): boolean =>
  TEXTBLOCK_TYPES.has(node.type as string) ||
  (Array.isArray(node.content) &&
    node.content.some((child) => child?.type === 'text'));

const getGraphemeSegmenter = (): GraphemeSegmenter | null => {
  try {
    const SegmenterCtor = (Intl as any)?.Segmenter;
    return typeof SegmenterCtor === 'function'
      ? new SegmenterCtor(undefined, { granularity: 'grapheme' })
      : null;
  } catch {
    return null;
  }
};

const isAscii = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
};

const forEachGrapheme = (
  text: string,
  segmenter: GraphemeSegmenter | null,
  visit: (start: number, end: number) => void
): void => {
  if (isAscii(text)) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10) {
        visit(i, i + 2);
        i++;
      } else {
        visit(i, i + 1);
      }
    }
    return;
  }
  if (segmenter) {
    for (const { segment, index } of segmenter.segment(text)) {
      visit(index, index + segment.length);
    }
    return;
  }
  for (let i = 0; i < text.length; ) {
    const width = (text.codePointAt(i) as number) > 0xffff ? 2 : 1;
    visit(i, i + width);
    i += width;
  }
};

const classifyGrapheme = (text: string, start: number, end: number): number => {
  if (end - start === 1) {
    const code = text.charCodeAt(start);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
      return FLAG_WHITESPACE | FLAG_NEWLINE;
    }
    if (code === 32 || code === 9 || code === 11 || code === 12) {
      return FLAG_WHITESPACE;
    }
    if (code < 0x80) return 0;
  }
  const grapheme = text.slice(start, end);
  if (grapheme === '\r\n') return FLAG_WHITESPACE | FLAG_NEWLINE;
  return WHITESPACE_ONLY.test(grapheme) ? FLAG_WHITESPACE : 0;
};

const shellOf = (node: ChatDocNode): ChatDocNode => {
  const { content: _content, ...rest } = node;
  return { ...rest, content: [] };
};

const listStart = (node: ChatDocNode): number => {
  const start = Number(node.attrs?.start);
  return Number.isFinite(start) ? start : 1;
};

// A list item must open with a paragraph; a part that starts inside one at
// its sub-list gets an empty paragraph in front so the document stays valid.
const appendChild = (parent: ChatDocNode, child: ChatDocNode): void => {
  const content = parent.content as ChatDocNode[];
  if (
    parent.type === 'listItem' &&
    content.length === 0 &&
    child.type !== 'paragraph'
  ) {
    content.push({ type: 'paragraph' });
  }
  content.push(child);
};

/**
 * The document flattened into tokens (grapheme clusters, inline atoms and
 * childless blocks) in document order, with the priority of splitting before
 * each token. A part is the token range [start, end), rebuilt into a document
 * by reopening the ancestors of its tokens.
 */
class ChatDocumentModel {
  readonly frames: Frame[];
  readonly count: number;
  private readonly frame: number[] = [];
  private readonly kind: number[] = [];
  private readonly flags: number[] = [];
  private readonly node: ChatDocNode[] = [];
  private readonly start: number[] = [];
  private readonly end: number[] = [];
  private readonly runEnd: number[] = [];
  private readonly childIndex: number[] = [];
  /** priority[b]: how good a split before token b is; priority[count] = end. */
  readonly priority: Int16Array;
  /** nextKept[i]: first index >= i whose token is not trimmable. */
  private readonly nextKept: Int32Array;
  /** keptEnd[e]: [s, e) with trailing trimmable tokens removed ends here. */
  private readonly keptEnd: Int32Array;
  private readonly segmenter: GraphemeSegmenter | null;

  constructor(private readonly root: ChatDocNode) {
    this.segmenter = getGraphemeSegmenter();
    this.frames = [
      {
        node: root,
        childIndex: 0,
        depth: 0,
        textblock: false,
        code: false,
        path: [0],
      },
    ];
    this.visitContainer(0);
    const count = this.frame.length;
    this.count = count;

    this.priority = new Int16Array(count + 1);
    this.priority[count] = PRIORITY_END;
    for (let b = 1; b < count; b++) {
      this.priority[b] = this.splitPriority(b);
    }

    this.nextKept = new Int32Array(count + 1);
    this.nextKept[count] = count;
    for (let i = count - 1; i >= 0; i--) {
      this.nextKept[i] =
        this.flags[i] & FLAG_TRIMMABLE ? this.nextKept[i + 1] : i;
    }
    this.keptEnd = new Int32Array(count + 1);
    for (let e = 1; e <= count; e++) {
      this.keptEnd[e] =
        this.flags[e - 1] & FLAG_TRIMMABLE ? this.keptEnd[e - 1] : e;
    }
  }

  /** First token of the content left from `index` on, after trimming. */
  firstKept(index: number): number {
    return this.nextKept[Math.min(index, this.count)];
  }

  /** End of the content, with trailing trimmable tokens removed. */
  get contentEnd(): number {
    return this.keptEnd[this.count];
  }

  /** Builds the part for cut points a..b, or null when it would be blank. */
  buildPart(a: number, b: number): ChatDocNode | null {
    let end = b;
    if (
      b < this.count &&
      this.priority[b] === PRIORITY_LINE &&
      this.frames[this.frame[b - 1]].code
    ) {
      // Splitting a code block between lines: the newline becomes the split.
      end = b - 1;
    }
    end = this.keptEnd[end];
    const start = this.nextKept[a];
    return start < end ? this.build(start, end) : null;
  }

  private push(
    frame: number,
    kind: number,
    flags: number,
    node: ChatDocNode,
    start: number,
    end: number,
    childIndex: number
  ): void {
    this.frame.push(frame);
    this.kind.push(kind);
    this.flags.push(flags);
    this.node.push(node);
    this.start.push(start);
    this.end.push(end);
    this.runEnd.push(this.frame.length);
    this.childIndex.push(childIndex);
  }

  private pushLeaf(frame: number, node: ChatDocNode, childIndex: number) {
    const blank = TEXTBLOCK_TYPES.has(node.type as string);
    this.push(
      frame,
      KIND_LEAF,
      blank ? FLAG_WHITESPACE | FLAG_TRIMMABLE : 0,
      node,
      0,
      0,
      childIndex
    );
  }

  private visitContainer(parentFrame: number): void {
    const parent = this.frames[parentFrame];
    const content = parent.node.content;
    if (!Array.isArray(content)) return;
    content.forEach((child, index) => {
      if (!child || typeof child !== 'object') return;
      const hasContent =
        Array.isArray(child.content) && child.content.length > 0;
      if (!hasContent || child.type === 'text') {
        this.pushLeaf(parentFrame, child, index);
        return;
      }
      const frameIndex = this.frames.length;
      const textblock = isTextblock(child);
      this.frames.push({
        node: child,
        childIndex: index,
        depth: parent.depth + 1,
        textblock,
        code: child.type === 'codeBlock',
        path: [...parent.path, frameIndex],
      });
      const before = this.frame.length;
      if (textblock) this.visitInline(frameIndex);
      else this.visitContainer(frameIndex);
      // Nothing inside produced a token (only empty text nodes, say): keep
      // the block whole so it is not silently lost.
      if (this.frame.length === before) {
        this.pushLeaf(parentFrame, child, index);
      }
    });
  }

  private visitInline(frameIndex: number): void {
    const { node, code } = this.frames[frameIndex];
    (node.content as ChatDocNode[]).forEach((child, index) => {
      if (!child || typeof child !== 'object') return;
      if (child.type === 'text') {
        const text = typeof child.text === 'string' ? child.text : '';
        if (!text) return;
        const first = this.frame.length;
        forEachGrapheme(text, this.segmenter, (start, end) => {
          const flags = classifyGrapheme(text, start, end);
          const trimmable = !code && flags & FLAG_WHITESPACE;
          this.push(
            frameIndex,
            KIND_TEXT,
            trimmable ? flags | FLAG_TRIMMABLE : flags,
            child,
            start,
            end,
            index
          );
        });
        const last = this.frame.length;
        for (let i = first; i < last; i++) this.runEnd[i] = last;
        return;
      }
      const lineBreak = child.type === 'hardBreak';
      this.push(
        frameIndex,
        KIND_INLINE_ATOM,
        lineBreak ? FLAG_WHITESPACE | FLAG_NEWLINE | FLAG_TRIMMABLE : 0,
        child,
        0,
        0,
        index
      );
    });
  }

  private splitPriority(b: number): number {
    const before = this.frame[b - 1];
    const after = this.frame[b];
    if (before === after && this.frames[before].textblock) {
      const previous = this.flags[b - 1];
      if (previous & FLAG_NEWLINE) return PRIORITY_LINE;
      if (previous & FLAG_WHITESPACE && !(this.flags[b] & FLAG_WHITESPACE)) {
        return PRIORITY_WORD;
      }
      return PRIORITY_CHARACTER;
    }
    const pathBefore = this.frames[before].path;
    const pathAfter = this.frames[after].path;
    const limit = Math.min(pathBefore.length, pathAfter.length);
    let common = 1;
    while (common < limit && pathBefore[common] === pathAfter[common]) {
      common++;
    }
    return Math.min(common - 1, PRIORITY_MAX_BLOCK_DEPTH);
  }

  private build(start: number, end: number): ChatDocNode {
    const root = shellOf(this.root);
    const openFrames = [0];
    const openNodes = [root];
    let i = start;
    while (i < end) {
      const path = this.frames[this.frame[i]].path;
      const limit = Math.min(openFrames.length, path.length);
      let common = 1;
      while (common < limit && openFrames[common] === path[common]) common++;
      openFrames.length = common;
      openNodes.length = common;
      for (let depth = common; depth < path.length; depth++) {
        const frame = this.frames[path[depth]];
        const shell = shellOf(frame.node);
        if (shell.type === 'orderedList') {
          const firstChild =
            depth + 1 < path.length
              ? this.frames[path[depth + 1]].childIndex
              : this.childIndex[i];
          if (firstChild > 0) {
            shell.attrs = {
              ...(shell.attrs || {}),
              start: listStart(frame.node) + firstChild,
            };
          }
        }
        appendChild(openNodes[depth - 1], shell);
        openFrames.push(path[depth]);
        openNodes.push(shell);
      }
      const parent = openNodes[openNodes.length - 1];
      const node = this.node[i];
      if (this.kind[i] === KIND_TEXT) {
        const runEnd = Math.min(this.runEnd[i], end);
        const from = this.start[i];
        const to = this.end[runEnd - 1];
        appendChild(
          parent,
          from === 0 && to === (node.text as string).length
            ? node
            : { ...node, text: (node.text as string).slice(from, to) }
        );
        i = runEnd;
      } else {
        appendChild(parent, node);
        i++;
      }
    }
    return root;
  }
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const normalizeMaxParts = (maxParts: number | undefined): number => {
  if (maxParts === Infinity) return Infinity;
  if (typeof maxParts !== 'number' || !Number.isFinite(maxParts)) {
    return MAX_SPLIT_MESSAGE_PARTS;
  }
  return Math.max(1, Math.floor(maxParts));
};

/**
 * The split as a coroutine: it yields each candidate document and is resumed
 * with whether that document fits, so the sync and async entry points share
 * one implementation.
 */
function* planSplit(
  doc: ChatDocNode,
  maxParts: number
): Generator<ChatDocNode, SplitChatDocumentResult, boolean> {
  if (yield doc) return { parts: [doc] };

  const model = new ChatDocumentModel(doc);
  const { count, priority } = model;
  const contentEnd = model.contentEnd;
  let start = model.firstKept(0);

  if (start >= contentEnd) {
    // Nothing but blank lines: send what an empty composer sends.
    const empty = { ...shellOf(doc), content: [{ type: 'paragraph' }] };
    return (yield empty) ? { parts: [empty] } : { error: 'unsplittable' };
  }

  // The last part that fitted, so the chosen one is not rebuilt.
  const lastFit: { start: number; end: number; part: ChatDocNode | null } = {
    start: -1,
    end: -1,
    part: null,
  };

  function* probe(
    a: number,
    b: number
  ): Generator<ChatDocNode, boolean, boolean> {
    const part = model.buildPart(a, b);
    if (!part) return true;
    const fits = yield part;
    if (fits) {
      lastFit.start = a;
      lastFit.end = b;
      lastFit.part = part;
    }
    return fits;
  }

  // Largest b in (a, count] whose part fits, assuming that bigger parts never
  // fit when a smaller one does not. Gallops out from a guess (the previous
  // part's size), then bisects, so it costs about 2*log2(tokens per part)
  // calls to fits() and never builds a part much bigger than one that fits.
  function* largestFit(
    a: number,
    guess: number
  ): Generator<ChatDocNode, number, boolean> {
    let fitting = a;
    let failing = count + 1;
    const first = Math.min(count, a + Math.max(1, guess));
    const firstStep = Math.max(1, Math.floor(guess / 8));
    if (yield* probe(a, first)) {
      fitting = first;
      for (let step = firstStep; fitting + step < failing; step *= 2) {
        const b = fitting + step;
        if (yield* probe(a, b)) fitting = b;
        else {
          failing = b;
          break;
        }
      }
    } else {
      failing = first;
      for (let step = firstStep; failing - step > fitting; step *= 2) {
        const b = failing - step;
        if (yield* probe(a, b)) {
          fitting = b;
          break;
        }
        failing = b;
      }
    }
    while (failing - fitting > 1) {
      const b = fitting + Math.floor((failing - fitting) / 2);
      if (yield* probe(a, b)) fitting = b;
      else failing = b;
    }
    return fitting > a ? fitting : -1;
  }

  const parts: ChatDocNode[] = [];
  let guess = 1;
  while (start < contentEnd) {
    if (parts.length >= maxParts) return { error: 'too_many_parts' };
    const limit = yield* largestFit(start, guess);
    if (limit < 0) return { error: 'unsplittable' };

    // The most preferred split point that still fits, latest on ties.
    let cut = limit;
    let cutPriority = priority[limit];
    for (let b = limit - 1; b > start && cutPriority > 0; b--) {
      if (priority[b] < cutPriority) {
        cut = b;
        cutPriority = priority[b];
      }
    }
    if (cut !== limit && !(yield* probe(start, cut))) cut = limit;

    const part =
      lastFit.start === start && lastFit.end === cut
        ? lastFit.part
        : model.buildPart(start, cut);
    if (part) parts.push(cloneJson(part));
    guess = limit - start;
    start = model.firstKept(cut);
  }
  return { parts };
}

/**
 * Splits `doc` into consecutive documents that each satisfy `fits`.
 *
 * - `doc` itself comes back untouched as the only part when `fits(doc)`.
 * - Otherwise every part is a fresh `{ type: 'doc', content }` built only from
 *   node and mark types found in `doc`, and satisfies `fits`. It can be a
 *   single part (when trimming blank lines was enough), so always send the
 *   parts rather than the original document.
 * - `too_many_parts` when more than `options.maxParts` (default
 *   MAX_SPLIT_MESSAGE_PARTS) would be needed, `unsplittable` when a single
 *   atom (a mention, an image node, one character) cannot fit on its own.
 *
 * `fits` must be monotonic (a part that fits keeps fitting when content is
 * removed from it) and must not mutate its argument.
 */
export function splitChatDocument(
  doc: ChatDocNode,
  fits: (part: ChatDocNode) => boolean,
  options: SplitChatDocumentOptions = {}
): SplitChatDocumentResult {
  if (!doc || typeof doc !== 'object') return { error: 'unsplittable' };
  const plan = planSplit(doc, normalizeMaxParts(options.maxParts));
  let step = plan.next(true);
  while (!step.done) step = plan.next(Boolean(fits(step.value)));
  return step.value;
}

/**
 * splitChatDocument with an async size check, for payloads whose size is only
 * known after encryption. Calls `fits` one at a time, about 2*log2(tokens per
 * part) times per part.
 */
export async function splitChatDocumentAsync(
  doc: ChatDocNode,
  fits: (part: ChatDocNode) => boolean | Promise<boolean>,
  options: SplitChatDocumentOptions = {}
): Promise<SplitChatDocumentResult> {
  if (!doc || typeof doc !== 'object') return { error: 'unsplittable' };
  const plan = planSplit(doc, normalizeMaxParts(options.maxParts));
  let step = plan.next(true);
  while (!step.done) step = plan.next(Boolean(await fits(step.value)));
  return step.value;
}

const utf8Encoder =
  typeof TextEncoder === 'function' ? new TextEncoder() : null;

/** UTF-8 byte length, as TextEncoder (and Blob) count it. */
export function utf8ByteLength(value: string): number {
  if (utf8Encoder) return utf8Encoder.encode(value).length;
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The composer's size of a JSON payload: UTF-8 bytes of JSON.stringify(doc)
 * plus the envelope overhead the composer adds (300 for group/DM JSON).
 */
export function jsonPayloadSize(doc: unknown, overheadBytes = 300): number {
  return utf8ByteLength(JSON.stringify(doc)) + overheadBytes;
}

/** A `fits` for plain JSON payloads: jsonPayloadSize(part) <= maxBytes. */
export function jsonPayloadFits(
  maxBytes: number,
  overheadBytes = 300
): (part: ChatDocNode) => boolean {
  return (part) => jsonPayloadSize(part, overheadBytes) <= maxBytes;
}

/**
 * The HTML `editor.getHTML()` would return for `doc`, rendered with the
 * editor's own schema (pass `editor.schema`) - for the legacy paths that send
 * HTML. Needs a DOM.
 */
export function chatDocumentToHtml(doc: ChatDocNode, schema: Schema): string {
  return getHTMLFromFragment(schema.nodeFromJSON(doc).content, schema);
}

/**
 * Plain text of a document: blocks on their own lines, hard breaks as
 * newlines, mentions as `@label`.
 */
export function chatDocumentText(node: ChatDocNode | null | undefined): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text')
    return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') {
    const label = String(node.attrs?.label ?? node.attrs?.id ?? '');
    return `@${label.replace(/^@/, '')}`;
  }
  const content = Array.isArray(node.content) ? node.content : [];
  return content
    .map((child) => chatDocumentText(child))
    .join(isTextblock(node) ? '' : '\n');
}
