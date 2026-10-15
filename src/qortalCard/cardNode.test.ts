import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../background/background', () => ({
  createEndpoint: async (path: string) => `http://node${path}`,
  processTransactionVersion2: vi.fn(),
}));

import {
  fetchPrimaryName,
  fetchQortBalance,
  isAddressUsed,
  isNameFree,
  uploadAvatarForSigning,
} from './cardNode';

const answer = (status: number, body: string) =>
  vi.fn(async () => new Response(body, { status }));

describe('node answers, as Qortal core 6.1 gives them', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats an address the node has never seen as unused', async () => {
    vi.stubGlobal(
      'fetch',
      answer(404, '{"error":124,"message":"account address unknown"}')
    );
    await expect(isAddressUsed('Qunknown')).resolves.toBe(false);
  });

  it('treats an address with a last reference as used', async () => {
    vi.stubGlobal('fetch', answer(200, '5c6VxNJhpt4LrTP3zQbwVuWniiSbQAEa'));
    await expect(isAddressUsed('Qused')).resolves.toBe(true);
    vi.stubGlobal('fetch', answer(200, 'false'));
    await expect(isAddressUsed('Qfresh')).resolves.toBe(false);
  });

  it('does not guess when the node is broken', async () => {
    vi.stubGlobal('fetch', answer(500, 'oops'));
    await expect(isAddressUsed('Q')).rejects.toThrow('500');
  });

  it('reads a zero balance written as 0E-8', async () => {
    vi.stubGlobal('fetch', answer(200, '0E-8'));
    await expect(fetchQortBalance('Q')).resolves.toBe(0n);
    vi.stubGlobal('fetch', answer(200, '0.10000000'));
    await expect(fetchQortBalance('Q')).resolves.toBe(10000000n);
  });
});

describe('names on chain, as the node answers them', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the primary name, or none', async () => {
    vi.stubGlobal(
      'fetch',
      answer(
        200,
        '{"name":"qortal","owner":"QP3J3GHgjqP69neTAprpYe4co33eKQiQpS"}'
      )
    );
    await expect(fetchPrimaryName('QP3J')).resolves.toBe('qortal');
    // No name: core answers the owner alone.
    vi.stubGlobal(
      'fetch',
      answer(200, '{"owner":"QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoA"}')
    );
    await expect(fetchPrimaryName('QaQX')).resolves.toBeNull();
  });

  it('tells a free name from a taken one', async () => {
    vi.stubGlobal(
      'fetch',
      answer(404, '{"error":401,"message":"name unknown"}')
    );
    await expect(isNameFree('Simon Card')).resolves.toBe(true);
    vi.stubGlobal(
      'fetch',
      answer(200, '{"name":"qortal","reducedName":"q0rta1","owner":"QP3J"}')
    );
    await expect(isNameFree('Qortal')).resolves.toBe(false);
    vi.stubGlobal('fetch', answer(500, 'oops'));
    await expect(isNameFree('x')).rejects.toThrow('500');
  });

  it('uploads an avatar to the card name and returns the bytes to sign', async () => {
    const fetchMock = answer(200, '3mJr7AoUXx2Wqd');
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      uploadAvatarForSigning('Simon Card', 'aGVsbG8=', 1000000n)
    ).resolves.toBe('3mJr7AoUXx2Wqd');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'http://node/arbitrary/THUMBNAIL/Simon%20Card/qortal_avatar/base64?fee=1000000'
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBe('aGVsbG8=');

    vi.stubGlobal(
      'fetch',
      answer(400, '{"error":401,"message":"name unknown"}')
    );
    await expect(
      uploadAvatarForSigning('Nobody', 'aGVsbG8=', 1000000n)
    ).rejects.toThrow('name unknown');
  });
});
