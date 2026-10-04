import i18n from 'i18next';

/**
 * Sends a value transfer that has already been signed, without ever signing it
 * again.
 *
 * Retrying by rebuilding the transaction gives it a new timestamp and a new
 * signature, so Core sees a second, separate payment. If the first one was
 * accepted and only the reply was lost (a dropped mobile connection, or a node
 * that answers with an error after taking it), the user pays twice. Here a
 * failed attempt is followed by a lookup of the signature, and only the same
 * signed bytes are sent again, which Core can accept at most once.
 */

export type SignedTransaction = {
  /** Base58 of the full signed transaction bytes. */
  signedBytes58: string;
  /** Base58 of the transaction signature (the last 64 bytes). */
  signature58: string;
};

/** A node reply or lookup result for the transaction (TransactionData JSON). */
export type TransactionRecord = {
  signature: string;
  [field: string]: unknown;
};

export type SignedSubmitDeps = {
  /** Posts the signed bytes to the node; resolves with the node's reply. */
  submit: (signedBytes58: string) => Promise<unknown>;
  /** The node's record for this signature, or null when it does not know it. */
  lookup: (signature58: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
};

export type SignedSubmitOptions = {
  /** Total number of sends of the same bytes (default 3). */
  attempts?: number;
  /** Wait between attempts in ms (default 10 s). */
  retryDelayMs?: number;
  /** Message for a failure that has none of its own. */
  fallbackMessage?: string;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 10_000;

/** The node refused this transaction (a Core API error, not a lost reply). */
export class TransactionRejectedError extends Error {
  readonly reply: unknown;

  constructor(message: string, reply: unknown) {
    super(message);
    this.name = 'TransactionRejectedError';
    this.reply = reply;
  }
}

/**
 * GO could not confirm the transfer: every send failed (or the node said it
 * already has it) and the node does not return it for its signature. It may
 * still arrive, so the message tells the user to check before paying again.
 * `detail` keeps the last network or node error.
 */
export class TransactionNotConfirmedError extends Error {
  readonly signature: string;
  readonly detail: string;

  constructor(signature: string, detail = '') {
    super(
      i18n.t('question:message.error.transfer_not_confirmed', {
        signature,
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'TransactionNotConfirmedError';
    this.signature = signature;
    this.detail = detail;
  }
}

function asRecord(value: unknown): TransactionRecord {
  return value as TransactionRecord;
}

function replySignature(reply: unknown): string {
  if (reply && typeof reply === 'object') {
    const signature = (reply as { signature?: unknown }).signature;
    if (typeof signature === 'string') return signature;
  }
  return '';
}

const MAX_SHOWN_MESSAGE_LENGTH = 200;

/** Short plain text: no markup and no line breaks. */
function isShowableText(text: string): boolean {
  return (
    !!text && text.length <= MAX_SHOWN_MESSAGE_LENGTH && !/[<>\r\n]/.test(text)
  );
}

/**
 * The `message` of a JSON error reply, when it is short plain text. Anything
 * else (an HTML error page from a proxy, a bare text body) is not shown to the
 * user; the caller's fallback message is used instead.
 */
function replyMessage(reply: unknown): string {
  if (reply && typeof reply === 'object') {
    const message = (reply as { message?: unknown }).message;
    if (typeof message === 'string' && isShowableText(message.trim())) {
      return message.trim();
    }
  }
  return '';
}

/**
 * Core's TRANSACTION_ALREADY_EXISTS ("transaction already exists"): the node
 * already has these exact bytes, so an earlier send went through.
 */
function isAlreadyKnownRejection(reply: unknown): boolean {
  const message = (reply as { message?: unknown })?.message;
  return typeof message === 'string' && /already[\s_]+exists/i.test(message);
}

/** A Core API error body, {"error": <code>, "message": "..."}. */
function isCoreRejection(reply: unknown): boolean {
  if (!reply || typeof reply !== 'object') return false;
  const code = (reply as { error?: unknown }).error;
  return typeof code === 'number' && Number.isFinite(code);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '';
}

/**
 * Submits `tx` and resolves with the node's record of it (a reply or lookup
 * whose `signature` is tx.signature58).
 *
 * - The node's reply carries this signature: done.
 * - The node refused it with a Core error: one lookup (it may already be
 *   known), then TransactionRejectedError. The same bytes would be refused
 *   again, so there is no retry. When the refusal may mean an earlier send
 *   went through (it came after a resend, or Core says the transaction
 *   already exists), GO waits and looks once more, and reports
 *   TransactionNotConfirmedError rather than a plain refusal.
 * - Anything else (network error, empty or unexpected reply): wait, look the
 *   signature up, and send the same bytes again if the node does not know it,
 *   up to `attempts` sends. Then wait, one last lookup, and
 *   TransactionNotConfirmedError if the node still does not know it.
 */
export async function submitSignedTransactionOnce(
  tx: SignedTransaction,
  deps: SignedSubmitDeps,
  options: SignedSubmitOptions = {}
): Promise<TransactionRecord> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const retryDelayMs = Math.max(
    0,
    options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  );
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fallbackMessage =
    options.fallbackMessage ||
    i18n.t('question:message.error.process_transaction', {
      postProcess: 'capitalizeFirstChar',
    });

  const findKnown = async (): Promise<TransactionRecord | null> => {
    try {
      const record = await deps.lookup(tx.signature58);
      return replySignature(record) === tx.signature58
        ? asRecord(record)
        : null;
    } catch {
      return null;
    }
  };

  let lastMessage = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelayMs);
      const known = await findKnown();
      if (known) return known;
    }

    let reply: unknown;
    try {
      reply = await deps.submit(tx.signedBytes58);
    } catch (error) {
      lastMessage = errorMessage(error) || lastMessage;
      continue;
    }

    if (replySignature(reply) === tx.signature58) return asRecord(reply);

    if (isCoreRejection(reply)) {
      const known = await findKnown();
      if (known) return known;
      if (attempt > 0 || isAlreadyKnownRejection(reply)) {
        // An earlier send may have gone through: look again, never resend.
        await sleep(retryDelayMs);
        const late = await findKnown();
        if (late) return late;
        throw new TransactionNotConfirmedError(
          tx.signature58,
          replyMessage(reply) || lastMessage
        );
      }
      throw new TransactionRejectedError(
        replyMessage(reply) || fallbackMessage,
        reply
      );
    }
    lastMessage = replyMessage(reply) || lastMessage;
  }

  // The last send may still reach the node a moment after it failed here.
  await sleep(retryDelayMs);
  const known = await findKnown();
  if (known) return known;
  throw new TransactionNotConfirmedError(tx.signature58, lastMessage);
}
