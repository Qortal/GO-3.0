/**
 * What a chat row that failed to draw looked like, without its content.
 * Field types, flags and counts only: never text, names, addresses, ids or
 * emoji. Copy diagnostics prints it under the row's error so a pasted report
 * says which shape of row breaks. Output is space-separated key:value pairs
 * (colons, never '=', so the report's pseudonymiser leaves it alone).
 */
export type ChatRowShapeInput = {
  message: unknown;
  reactions: unknown;
  reply: unknown;
  replyExpiredMeta: unknown;
  isUpdating: boolean;
  isGroupedWithPrevious?: boolean;
  index: number;
  total: number;
  /** ChatList's chatIdentity; only its leading word is kept. */
  chatIdentity: string;
};

const WORD_RE = /^[a-z][a-z0-9_-]{0,23}$/i;
const EMBED_MARK = 'qortal://use-embed/';

const kindOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

/** A fixed-vocabulary value (event type, queue status) or its kind. */
const word = (value: unknown): string =>
  value == null
    ? '-'
    : typeof value === 'string' && WORD_RE.test(value)
      ? value
      : `(${kindOf(value)})`;

const yesNo = (value: unknown): string => (value ? 'yes' : 'no');

const imageKind = (image: unknown): string => {
  if (image == null) return '-';
  if (typeof image !== 'object') return `(${kindOf(image)})`;
  const img = image as Record<string, unknown>;
  if (img.reticulumResource) return 'resource';
  if (typeof img.dataUrl === 'string') {
    return img.dataUrl.startsWith('data:image/') ? 'data-image' : 'data-other';
  }
  if (img.dataUrl != null) return `dataUrl(${kindOf(img.dataUrl)})`;
  if (img.base64 != null) return 'base64';
  if (img.libraryGif) return 'gif';
  if (img.name && img.identifier && img.service) return 'qdn';
  return 'other';
};

const listShape = (value: unknown): string =>
  Array.isArray(value)
    ? `${value.length}/${imageKind(value[0])}`
    : value == null
      ? '-'
      : `(${kindOf(value)})`;

const reactionsShape = (reactions: unknown): string => {
  if (reactions == null) return '-';
  if (typeof reactions !== 'object' || Array.isArray(reactions)) {
    return `(${kindOf(reactions)})`;
  }
  const values = Object.values(reactions as Record<string, unknown>);
  const notLists = values.filter((value) => !Array.isArray(value)).length;
  const badItems = values.reduce<number>(
    (sum, value) =>
      sum +
      (Array.isArray(value)
        ? value.filter((item) => !item || typeof item !== 'object').length
        : 0),
    0
  );
  return `${values.length}${notLists ? ` notList:${notLists}` : ''}${
    badItems ? ` badItem:${badItems}` : ''
  }`;
};

const expiredShape = (meta: unknown): string => {
  if (meta == null) return '-';
  if (typeof meta !== 'object') return `(${kindOf(meta)})`;
  const m = meta as Record<string, unknown>;
  return m.deleted ? 'deleted' : m.missing ? 'missing' : 'edit';
};

const hasEmbed = (m: Record<string, unknown>): boolean =>
  [m.messageText, m.text, m.message].some(
    (value) => typeof value === 'string' && value.includes(EMBED_MARK)
  );

export function describeChatRowShape(input: ChatRowShapeInput): string {
  try {
    const surface =
      /^(group|direct|chat)\b/.exec(String(input.chatIdentity ?? ''))?.[1] ??
      'other';
    const parts = [`surface:${surface}`];
    const raw = input.message;
    if (!raw || typeof raw !== 'object') {
      parts.push(`message:${kindOf(raw)}`);
      return parts.join(' ');
    }
    const m = raw as Record<string, unknown>;
    const distance = Number(input.total) - 1 - Number(input.index);
    const fromEnd = Number.isFinite(distance) ? distance : -1;
    parts.push(
      `eventType:${word(m.eventType)}`,
      `type:${word(m.type)}`,
      `temp:${yesNo(m.isTemp)}`,
      `status:${word(m.status)}`,
      `updating:${yesNo(input.isUpdating)}`,
      `edit:${yesNo(m.isEdit)}`,
      `sender:${kindOf(m.sender)}`,
      `senderName:${kindOf(m.senderName)}`,
      `messageText:${kindOf(m.messageText)}`,
      `text:${kindOf(m.text)}`,
      `decryptedData:${kindOf(m.decryptedData)}`,
      `images:${listShape(m.images)}`,
      `attachments:${
        Array.isArray(m.attachments)
          ? m.attachments.length
          : word(m.attachments)
      }`,
      `embed:${yesNo(hasEmbed(m))}`,
      `reactions:${reactionsShape(input.reactions)}`,
      `repliedTo:${yesNo(m.repliedTo)}`,
      `reply:${kindOf(input.reply)}`,
      `replyExpired:${expiredShape(input.replyExpiredMeta)}`,
      `call:${yesNo(m.directCallHistory)}`,
      `grouped:${yesNo(input.isGroupedWithPrevious)}`,
      `last:${yesNo(fromEnd === 0)}`,
      `fromEnd:${fromEnd}`
    );
    return parts.join(' ');
  } catch {
    return 'shape:unavailable';
  }
}
