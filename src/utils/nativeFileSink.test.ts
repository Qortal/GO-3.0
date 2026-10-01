import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NativeFileSinkUnavailableError,
  readBlobSlices,
  resetNativeFileSinkForTests,
  writeToNativeFileSink,
} from './nativeFileSink';

type Reply = Record<string, unknown>;

/**
 * Plays the native side of the protocol: answers on the next tick, the way
 * the WebView delivers replies, and records every byte it is given.
 */
function installFakeSink(
  behave: {
    failOnChunk?: number;
    silent?: boolean;
  } = {}
) {
  let listener: ((event: MessageEvent) => void) | null = null;
  const commands: Reply[] = [];
  const chunks: Uint8Array[] = [];
  let sid = '';
  let written = 0;
  const reply = (message: Reply) =>
    setTimeout(() =>
      listener?.({ data: JSON.stringify(message) } as MessageEvent)
    );
  const sink = {
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => {
      listener = fn;
    },
    postMessage: (message: string | ArrayBuffer) => {
      if (behave.silent) return;
      if (typeof message === 'string') {
        const command = JSON.parse(message);
        commands.push(command);
        if (command.op === 'open') {
          sid = command.sid;
          written = 0;
          reply({ op: 'opened', sid });
        } else if (command.op === 'close') {
          reply({
            op: 'closed',
            sid,
            path: 'content://media/external_primary/file/7',
            uri: 'content://media/external_primary/file/7',
            bytesWritten: written,
          });
        } else if (command.op === 'abort') {
          reply({ op: 'aborted', sid });
        }
        return;
      }
      chunks.push(new Uint8Array(message));
      if (behave.failOnChunk === chunks.length) {
        reply({ op: 'error', sid, message: 'disk full' });
        return;
      }
      written += message.byteLength;
      reply({ op: 'ack', sid, written });
    },
  };
  (window as unknown as { goFileSink?: unknown }).goFileSink = sink;
  return { commands, chunks };
}

const bytes = (length: number, fill = 1) => new Uint8Array(length).fill(fill);

describe('writeToNativeFileSink', () => {
  beforeEach(() => {
    resetNativeFileSinkForTests();
  });

  afterEach(() => {
    delete (window as unknown as { goFileSink?: unknown }).goFileSink;
    vi.useRealTimers();
  });

  it('opens, streams every byte, closes and reports progress', async () => {
    const fake = installFakeSink();
    const progress: number[] = [];

    const result = await writeToNativeFileSink(
      'Qortal Go/GO 3.0 v0.0.11.apk',
      [bytes(700_000), bytes(700_000, 2), bytes(10, 3)],
      { categorize: true, mimeType: 'application/vnd.android.package-archive' },
      (written) => progress.push(written)
    );

    expect(fake.commands[0]).toMatchObject({
      op: 'open',
      filename: 'Qortal Go/GO 3.0 v0.0.11.apk',
      categorize: true,
    });
    expect(fake.commands.at(-1)).toMatchObject({ op: 'close' });
    const total = fake.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(total).toBe(1_400_010);
    // Small pieces are merged before they cross.
    expect(fake.chunks.length).toBe(2);
    expect(progress.at(-1)).toBe(1_400_010);
    expect(result).toEqual({
      path: 'content://media/external_primary/file/7',
      uri: 'content://media/external_primary/file/7',
      bytesWritten: 1_400_010,
    });
  });

  it('rejects with the native error and aborts the save', async () => {
    const fake = installFakeSink({ failOnChunk: 2 });
    const big = [bytes(1_100_000), bytes(1_100_000), bytes(1_100_000)];

    await expect(
      writeToNativeFileSink('Qortal Go/a.bin', big, { categorize: true })
    ).rejects.toThrow('disk full');
    expect(fake.commands.some((command) => command.op === 'abort')).toBe(true);
  });

  it('is unavailable when there is no sink', async () => {
    await expect(
      writeToNativeFileSink('Qortal Go/a.bin', [bytes(10)])
    ).rejects.toBeInstanceOf(NativeFileSinkUnavailableError);
  });

  it('is unavailable when the sink never opens, and reads nothing', async () => {
    vi.useFakeTimers();
    installFakeSink({ silent: true });
    let read = false;
    const source = (async function* () {
      read = true;
      yield bytes(10);
    })();

    const pending = writeToNativeFileSink('Qortal Go/a.bin', source);
    const settled = expect(pending).rejects.toBeInstanceOf(
      NativeFileSinkUnavailableError
    );
    await vi.advanceTimersByTimeAsync(16_000);
    await settled;
    expect(read).toBe(false);
  });

  it('runs one save at a time', async () => {
    const fake = installFakeSink();
    await Promise.all([
      writeToNativeFileSink('Qortal Go/one.bin', [bytes(5)]),
      writeToNativeFileSink('Qortal Go/two.bin', [bytes(6)]),
    ]);
    expect(fake.commands.map((command) => command.op)).toEqual([
      'open',
      'close',
      'open',
      'close',
    ]);
  });
});

describe('readBlobSlices', () => {
  it('yields the blob in order, a slice at a time', async () => {
    // jsdom's Blob has no arrayBuffer(); the WebView's and Node's do.
    const blob = new NodeBlob([bytes(10, 1), bytes(5, 2)]) as unknown as Blob;
    const slices: number[] = [];
    let total = 0;
    for await (const slice of readBlobSlices(blob, 4)) {
      slices.push(slice.length);
      total += slice.length;
    }
    expect(slices).toEqual([4, 4, 4, 3]);
    expect(total).toBe(15);
  });
});
