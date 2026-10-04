/**
 * One network attempt for a QDN avatar, classified so the cache can decide
 * what to do next. Never throws.
 */
import {
  QDN_AVATAR_MAX_DOWNLOAD_BYTES,
  sniffImageType,
  type AvatarImageBytes,
} from './imageBytes';

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export type AvatarFetchOutcome =
  /** The node sent an image. */
  | { kind: 'image'; image: AvatarImageBytes }
  /** The node says this name never published the avatar. */
  | { kind: 'missing' }
  /** The node sent something that is not an image (200 with other bytes). */
  | { kind: 'invalid' }
  /**
   * The node does not have the file (yet): 404, empty body. With async=true
   * this is the normal first answer while the node fetches it.
   */
  | { kind: 'unavailable'; status: number }
  | {
      kind: 'error';
      reason: 'timeout' | 'network' | 'http' | 'too_large';
      status?: number;
    };

/** Core's 404 text when no PUT transaction exists for name+identifier. */
const NOT_PUBLISHED_MESSAGE = /find PUT transaction/i;

type TimerHandle = unknown;

/** Timer functions, injectable so tests can drive timeouts with a fake clock. */
export type AvatarFetchTimers = {
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

type TimedSignal = {
  signal: AbortSignal;
  /** Resolves when the time is up (also if the fetch ignores the abort). */
  expired: Promise<void>;
  cancel: () => void;
  timedOut: () => boolean;
};

function timedSignal(
  timeoutMs: number,
  timers: AvatarFetchTimers = {}
): TimedSignal {
  const setTimer =
    timers.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    timers.clearTimer ??
    ((handle: TimerHandle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));
  const controller = new AbortController();
  let didTimeout = false;
  let expire: () => void = () => {};
  const expired = new Promise<void>((resolve) => {
    expire = resolve;
  });
  const timer = setTimer(() => {
    didTimeout = true;
    controller.abort();
    expire();
  }, timeoutMs);
  return {
    signal: controller.signal,
    expired,
    cancel: () => clearTimer(timer),
    timedOut: () => didTimeout,
  };
}

const TIMEOUT_OUTCOME = { kind: 'error', reason: 'timeout' } as const;

/** Reads at most `maxBytes`; null when the body is larger. */
async function readCapped(
  response: Response,
  maxBytes: number
): Promise<ArrayBuffer | null> {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    return buffer.byteLength > maxBytes ? null : buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const buffer = await readCapped(response, 4096);
    if (!buffer) return '';
    const text = new TextDecoder().decode(buffer);
    try {
      const parsed = JSON.parse(text);
      return typeof parsed?.message === 'string' ? parsed.message : text;
    } catch {
      return text;
    }
  } catch {
    return '';
  }
}

/** GETs one avatar URL and classifies the answer. */
export async function fetchAvatarAttempt(
  fetchImpl: FetchLike,
  url: string,
  options: { timeoutMs: number; maxBytes?: number } & AvatarFetchTimers
): Promise<AvatarFetchOutcome> {
  const maxBytes = options.maxBytes ?? QDN_AVATAR_MAX_DOWNLOAD_BYTES;
  const timed = timedSignal(options.timeoutMs, options);
  const attempt = async (): Promise<AvatarFetchOutcome> => {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        signal: timed.signal,
        credentials: 'omit',
      });
      if (response.status === 404) {
        const message = await readErrorMessage(response);
        return NOT_PUBLISHED_MESSAGE.test(message)
          ? { kind: 'missing' }
          : { kind: 'unavailable', status: 404 };
      }
      if (!response.ok) {
        return { kind: 'error', reason: 'http', status: response.status };
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        return { kind: 'error', reason: 'too_large' };
      }
      const bytes = await readCapped(response, maxBytes);
      if (!bytes) return { kind: 'error', reason: 'too_large' };
      if (!bytes.byteLength) {
        return { kind: 'unavailable', status: response.status };
      }
      const type = sniffImageType(bytes);
      if (!type) return { kind: 'invalid' };
      return { kind: 'image', image: { bytes, type } };
    } catch {
      return timed.timedOut()
        ? TIMEOUT_OUTCOME
        : { kind: 'error', reason: 'network' };
    }
  };
  try {
    return await Promise.race([
      attempt(),
      timed.expired.then(() => TIMEOUT_OUTCOME),
    ]);
  } finally {
    timed.cancel();
  }
}

export type AvatarPublishStatus = 'not_published' | 'published' | 'unknown';

/**
 * Asks the node whether the avatar was ever published (resource status
 * endpoint). `unknown` on any error, including old nodes without the endpoint.
 */
export async function fetchAvatarPublishStatus(
  fetchImpl: FetchLike,
  url: string,
  options: { timeoutMs: number } & AvatarFetchTimers
): Promise<AvatarPublishStatus> {
  const timed = timedSignal(options.timeoutMs, options);
  const attempt = async (): Promise<AvatarPublishStatus> => {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        signal: timed.signal,
        credentials: 'omit',
      });
      if (!response.ok) return 'unknown';
      const buffer = await readCapped(response, 16 * 1024);
      if (!buffer) return 'unknown';
      const parsed = JSON.parse(new TextDecoder().decode(buffer));
      const status = typeof parsed?.status === 'string' ? parsed.status : '';
      if (status === 'NOT_PUBLISHED') return 'not_published';
      return status ? 'published' : 'unknown';
    } catch {
      return 'unknown';
    }
  };
  try {
    return await Promise.race([
      attempt(),
      timed.expired.then((): AvatarPublishStatus => 'unknown'),
    ]);
  } finally {
    timed.cancel();
  }
}
