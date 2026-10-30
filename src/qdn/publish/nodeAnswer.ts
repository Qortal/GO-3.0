/**
 * What the node's answer to a publish call means for trying again:
 * - no answer: the request failed (offline, node or SSH tunnel down,
 *   timeout), or the node or the proxy in front of it is busy or restarting
 *   (5xx, 408, 429). Worth another try, and the window says so.
 * - refused for want of the API key (401/403, or Core's "Missing 'X-API-KEY'
 *   header" / "API key invalid"): only the person can fix that, in node
 *   settings, so the publish stops at once.
 * - any other refusal (another 4xx) is Core's final word on that request too.
 */
import i18n from 'i18next';

const KEY_REFUSAL_TEXT = /Missing 'X-API-KEY' header|API key invalid/i;

const NODE_API_KEY_REQUIRED = 'NODE_API_KEY_REQUIRED';

/** The node turned the call down because it needs its API key. */
export function isNodeKeyRefusal(status: number, body = ''): boolean {
  return status === 401 || status === 403 || KEY_REFUSAL_TEXT.test(body);
}

/** A status that means the node is busy or did not finish, not "no". */
function isNodeBusyStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/** The node did not answer the call; it may be tried again. */
export class NodeNoAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeNoAnswerError';
  }
}

/** No answer, for a request (or its body) that failed on the way. */
export function noAnswerError(cause: unknown): NodeNoAnswerError {
  return new NodeNoAnswerError(
    (cause as { message?: string } | null)?.message ||
      i18n.t('core:message.error.network_generic', {
        postProcess: 'capitalizeFirstChar',
      })
  );
}

/** The node needs its API key for the call; trying again cannot help. */
export class NodeApiKeyRequiredError extends Error {
  readonly code = NODE_API_KEY_REQUIRED;

  constructor() {
    super(i18n.t('core:qdn_publish.node_api_key_needed'));
    this.name = 'NodeApiKeyRequiredError';
  }
}

export function isNodeApiKeyRequiredError(error: unknown): boolean {
  return (
    error instanceof NodeApiKeyRequiredError ||
    (error as { code?: unknown } | null)?.code === NODE_API_KEY_REQUIRED
  );
}

/** The error for an answer that is not ok, from its status and body. */
export function nodeAnswerError(status: number, body: string): Error {
  if (isNodeKeyRefusal(status, body)) return new NodeApiKeyRequiredError();
  if (isNodeBusyStatus(status)) return new NodeNoAnswerError(body);
  return new Error(body);
}

/** fetch, with a request that got no answer at all marked as such. */
export async function fetchFromNode(
  url: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw noAnswerError(error);
  }
}

/** The body of an answer that is not ok; '' when it cannot be read. */
export async function refusalBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
