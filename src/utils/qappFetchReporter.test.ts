import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../plugins/FileWriter', () => ({
  installNativeFrameScript: vi.fn(async () => true),
}));

import {
  buildQappFetchReporterScript,
  parseQappFetchMessage,
  QAPP_FETCH_MIN_BYTES,
} from './qappFetchReporter';

type Posted = { msg: Record<string, unknown>; origin: string };

/** Runs the serialised reporter the way a Q-App frame on a node would. */
function runInQappFrame(
  fetchImpl: (...args: unknown[]) => Promise<Response>,
  { isTop = false } = {}
) {
  const posted: Posted[] = [];
  // Node's own streams and Response, as a WebView has them; jsdom has neither.
  const frame: Record<string, unknown> = {
    fetch: fetchImpl,
    ReadableStream: NodeReadableStream,
    Response: globalThis.Response,
  };
  frame.top = isTop
    ? frame
    : {
        postMessage: (msg: Record<string, unknown>, origin: string) =>
          posted.push({ msg, origin }),
      };
  const location = new URL(
    'https://ext-node.qortal.link/render/APP/Q-Share?theme=dark'
  );
  new Function(
    'window',
    'location',
    buildQappFetchReporterScript('http://localhost')
  )(frame, location);
  return {
    fetch: frame.fetch as (
      input: string,
      init?: RequestInit
    ) => Promise<Response>,
    posted,
  };
}

const fileResponse = (size: number) =>
  new Response(new Uint8Array(size).fill(7), {
    status: 200,
    headers: {
      'content-length': String(size),
      'content-type': 'application/vnd.android.package-archive',
    },
  });

describe('Q-App fetch reporter', () => {
  it('reports a large QDN download as the app reads it', async () => {
    const size = QAPP_FETCH_MIN_BYTES + 12_345;
    const frame = runInQappFrame(async () => fileResponse(size));

    const res = await frame.fetch(
      '/arbitrary/FILE/GO%203.0/qshare_file_go-30-v0011_Mk2QCN'
    );
    expect(frame.posted).toHaveLength(0); // nothing until the app reads
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.android.package-archive'
    );

    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(size);

    const phases = frame.posted.map((p) => p.msg.phase);
    expect(phases[0]).toBe('start');
    expect(phases.at(-1)).toBe('done');
    expect(frame.posted.every((p) => p.origin === 'http://localhost')).toBe(
      true
    );
    const done = parseQappFetchMessage(frame.posted.at(-1)!.msg);
    expect(done).toMatchObject({
      phase: 'done',
      service: 'FILE',
      name: 'GO 3.0',
      identifier: 'qshare_file_go-30-v0011_Mk2QCN',
      loaded: size,
      total: size,
    });
  });

  it('leaves small responses, other URLs and posts alone', async () => {
    const small = fileResponse(1000);
    const frame = runInQappFrame(async () => small);
    expect(await frame.fetch('/arbitrary/FILE/name/id')).toBe(small);

    const big = fileResponse(QAPP_FETCH_MIN_BYTES + 1);
    const other = runInQappFrame(async () => big);
    expect(await other.fetch('/arbitrary/resources/search?service=FILE')).toBe(
      big
    );
    expect(
      await other.fetch('/arbitrary/FILE/name/id', { method: 'POST' })
    ).toBe(big);
    expect(frame.posted).toHaveLength(0);
    expect(other.posted).toHaveLength(0);
  });

  it('does nothing in GO’s own window', async () => {
    const fetchImpl = async () => fileResponse(10);
    const frame = runInQappFrame(fetchImpl, { isTop: true });
    expect(frame.fetch).toBe(fetchImpl);
  });
});

describe('parseQappFetchMessage', () => {
  const base = {
    __goQdnFetch: 1,
    phase: 'progress',
    id: 'abc1',
    service: 'FILE',
    name: 'GO 3.0',
    identifier: 'x',
    loaded: 10,
    total: 20,
  };

  it('accepts a well-formed report', () => {
    expect(parseQappFetchMessage(base)).toMatchObject({
      phase: 'progress',
      loaded: 10,
      total: 20,
    });
  });

  it('rejects anything else', () => {
    expect(parseQappFetchMessage({ ...base, __goQdnFetch: undefined })).toBe(
      null
    );
    expect(parseQappFetchMessage({ ...base, phase: 'explode' })).toBe(null);
    expect(parseQappFetchMessage({ ...base, service: 'file/../x' })).toBe(null);
    expect(parseQappFetchMessage({ ...base, id: '' })).toBe(null);
    expect(parseQappFetchMessage('string')).toBe(null);
    expect(
      parseQappFetchMessage({ ...base, loaded: -5, total: Infinity })
    ).toMatchObject({ loaded: 0, total: 0 });
  });
});
