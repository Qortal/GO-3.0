/**
 * Binary channel from GO's page to phone storage (FileWriter's `goFileSink`).
 *
 * The plugin call path (`FileWriter.writeChunk`) carries base64 inside JSON:
 * every byte is encoded here, parsed and decoded natively, and the file is
 * reopened for every chunk. A 120 MB save was about 330 of those round trips
 * and most of the wait. ArrayBuffers posted to the sink arrive natively as
 * bytes and go into one open stream.
 *
 * The sink only exists where the WebView supports binary web messages; callers
 * fall back to the plugin path on {@link NativeFileSinkUnavailableError}.
 */
import i18n from 'i18next';

type SinkReply = {
  op: 'opened' | 'ack' | 'closed' | 'aborted' | 'error';
  sid: string;
  message?: string;
  written?: number;
  path?: string;
  uri?: string;
  bytesWritten?: number;
};

type InjectedSink = {
  postMessage(message: string | ArrayBuffer): void;
  addEventListener?: (
    type: 'message',
    listener: (event: MessageEvent) => void
  ) => void;
  onmessage?: ((event: MessageEvent) => void) | null;
};

type NativeFileSinkResult = {
  path: string;
  uri: string;
  bytesWritten: number;
};

type NativeFileSinkOptions = {
  /** Sort into Images / Videos / Audio / Documents / Apps / Qortino AI. */
  categorize?: boolean;
  mimeType?: string;
};

/** The sink is missing or never answered; nothing was written. */
export class NativeFileSinkUnavailableError extends Error {}

/** Slice size for blobs: few messages, and little held at once. */
const NATIVE_FILE_SINK_CHUNK_BYTES = 4 * 1024 * 1024;
/** Small stream chunks are merged up to this before they are sent. */
const MIN_MESSAGE_BYTES = 1024 * 1024;
/** One chunk is written while the next crosses; more only costs memory. */
const MAX_IN_FLIGHT = 2;
const OPEN_TIMEOUT_MS = 15_000;
const REPLY_TIMEOUT_MS = 120_000;

const handlers = new Map<string, (reply: SinkReply) => void>();
let activeSid: string | null = null;
let listeningOn: InjectedSink | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getSink(): InjectedSink | null {
  if (typeof window === 'undefined') return null;
  const sink = (window as unknown as { goFileSink?: InjectedSink }).goFileSink;
  return sink && typeof sink.postMessage === 'function' ? sink : null;
}

export function hasNativeFileSink(): boolean {
  return getSink() !== null;
}

function parseReply(data: unknown): SinkReply | null {
  if (typeof data !== 'string') return null;
  try {
    const reply = JSON.parse(data);
    return reply && typeof reply.op === 'string' ? reply : null;
  } catch {
    return null;
  }
}

function listen(sink: InjectedSink): void {
  if (listeningOn === sink) return;
  const onMessage = (event: MessageEvent) => {
    const reply = parseReply(event?.data);
    if (!reply) return;
    // A chunk that arrives with no save open is answered without a sid.
    const handler =
      handlers.get(reply.sid) ??
      (!reply.sid && activeSid ? handlers.get(activeSid) : undefined);
    handler?.(reply);
  };
  if (typeof sink.addEventListener === 'function') {
    sink.addEventListener('message', onMessage);
  } else {
    sink.onmessage = onMessage;
  }
  listeningOn = sink;
}

function newSid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = chunk;
  if (
    buffer instanceof ArrayBuffer &&
    byteOffset === 0 &&
    byteLength === buffer.byteLength
  ) {
    return buffer;
  }
  return chunk.slice().buffer as ArrayBuffer;
}

async function* coalesce(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
): AsyncGenerator<Uint8Array> {
  let parts: Uint8Array[] = [];
  let size = 0;
  const merged = () => {
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  for await (const chunk of chunks) {
    if (!chunk || chunk.length === 0) continue;
    parts.push(chunk);
    size += chunk.length;
    if (size >= MIN_MESSAGE_BYTES) {
      yield merged();
      parts = [];
      size = 0;
    }
  }
  if (size > 0) yield merged();
}

/**
 * Streams chunks into Documents/<filename> through the sink. One save at a
 * time: the native side has a single open file, so later saves wait here.
 */
export function writeToNativeFileSink(
  filename: string,
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: NativeFileSinkOptions = {},
  onProgress?: (bytesWritten: number) => void
): Promise<NativeFileSinkResult> {
  const run = queue.then(() =>
    runSession(filename, chunks, options, onProgress)
  );
  queue = run.catch(() => undefined);
  return run;
}

async function runSession(
  filename: string,
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: NativeFileSinkOptions,
  onProgress?: (bytesWritten: number) => void
): Promise<NativeFileSinkResult> {
  const sink = getSink();
  if (!sink) throw new NativeFileSinkUnavailableError('No native file sink');
  listen(sink);

  const sid = newSid();
  const waiting: Array<{
    resolve: (reply: SinkReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  let failure: Error | null = null;

  const fail = (error: Error) => {
    if (!failure) failure = error;
    while (waiting.length) {
      const next = waiting.shift()!;
      clearTimeout(next.timer);
      next.reject(failure);
    }
  };

  handlers.set(sid, (reply) => {
    if (reply.op === 'error') {
      fail(
        new Error(
          reply.message || i18n.t('core:file_transfer.save_error_generic')
        )
      );
      return;
    }
    const next = waiting.shift();
    if (!next) return;
    clearTimeout(next.timer);
    next.resolve(reply);
  });
  activeSid = sid;

  // Replies arrive as later message events, so registering right after the
  // post is never too late.
  const expect = (timeoutMs: number, onTimeout: () => Error) =>
    new Promise<SinkReply>((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const timer = setTimeout(() => fail(onTimeout()), timeoutMs);
      waiting.push({ resolve, reject, timer });
    });
  const stalled = () => new Error(i18n.t('core:file_transfer.save_stalled'));

  let opened = false;
  try {
    sink.postMessage(
      JSON.stringify({
        op: 'open',
        sid,
        filename,
        categorize: options.categorize === true,
        mimeType: options.mimeType || undefined,
      })
    );
    await expect(
      OPEN_TIMEOUT_MS,
      () => new NativeFileSinkUnavailableError('Native file sink did not open')
    );
    opened = true;

    const inFlight: Promise<SinkReply>[] = [];
    const settle = async () => {
      const ack = await inFlight.shift()!;
      if (typeof ack.written === 'number') onProgress?.(ack.written);
    };
    for await (const chunk of coalesce(chunks)) {
      if (failure) throw failure;
      sink.postMessage(toArrayBuffer(chunk));
      const ack = expect(REPLY_TIMEOUT_MS, stalled);
      // Left unawaited when an earlier chunk fails; that failure is reported.
      ack.catch(() => undefined);
      inFlight.push(ack);
      if (inFlight.length >= MAX_IN_FLIGHT) await settle();
    }
    while (inFlight.length) await settle();

    sink.postMessage(JSON.stringify({ op: 'close', sid }));
    const closed = await expect(REPLY_TIMEOUT_MS, stalled);
    if (!closed.path) {
      throw new Error(i18n.t('core:file_transfer.save_error_generic'));
    }
    return {
      path: closed.path,
      uri: closed.uri || closed.path,
      bytesWritten: Number(closed.bytesWritten) || 0,
    };
  } catch (error) {
    if (opened) {
      try {
        sink.postMessage(JSON.stringify({ op: 'abort', sid }));
      } catch {
        /* the save failed either way */
      }
    }
    throw error;
  } finally {
    for (const next of waiting) clearTimeout(next.timer);
    handlers.delete(sid);
    if (activeSid === sid) activeSid = null;
  }
}

/** Reads a blob a slice at a time, never whole. */
export async function* readBlobSlices(
  blob: Blob,
  sliceBytes: number = NATIVE_FILE_SINK_CHUNK_BYTES
): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < blob.size; offset += sliceBytes) {
    const slice = blob.slice(offset, Math.min(offset + sliceBytes, blob.size));
    yield new Uint8Array(await slice.arrayBuffer());
  }
}

/** Test hook: forget the sink the module is listening on. */
export function resetNativeFileSinkForTests(): void {
  handlers.clear();
  activeSid = null;
  listeningOn = null;
  queue = Promise.resolve();
}
