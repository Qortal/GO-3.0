import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
  getBaseApiReactForAvatar: () => 'http://127.0.0.1:12391',
}));

import {
  blobLooksLikePdf,
  fetchQtubePosterDataUrl,
  isSafeQortinoImageSrc,
  posterFromMetadataJson,
} from '../qdnMedia';

const TRACKER = 'https://tracker.example/p.gif';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('posterFromMetadataJson', () => {
  it('drops a poster on a third-party host', () => {
    expect(posterFromMetadataJson({ videoImage: TRACKER })).toBeNull();
    expect(
      posterFromMetadataJson({ extracts: ['http://203.0.113.9/x.jpg'] })
    ).toBeNull();
    expect(
      posterFromMetadataJson({ videoImage: 'HTTPS://tracker.example/x' })
    ).toBeNull();
    expect(posterFromMetadataJson({ videoImage: 'javascript:alert(1)' })).toBe(
      null
    );
  });

  it('keeps inline posters and posters served by a Qortal node', () => {
    expect(
      posterFromMetadataJson({ videoImage: 'data:image/webp;base64,UklGR' })
    ).toBe('data:image/webp;base64,UklGR');
    expect(posterFromMetadataJson({ videoImage: '/9j/4AAQSkZJRg' })).toBe(
      'data:image/jpeg;base64,/9j/4AAQSkZJRg'
    );
    const node = 'http://127.0.0.1:12391/arbitrary/THUMBNAIL/a/b';
    expect(posterFromMetadataJson({ videoImage: node })).toBe(node);
  });

  it('says "not there yet" for missing or failed metadata', () => {
    expect(posterFromMetadataJson(null)).toBeUndefined();
    expect(posterFromMetadataJson({ error: 'not found' })).toBeUndefined();
    expect(posterFromMetadataJson({ title: 'no poster' })).toBeUndefined();
  });
});

describe('isSafeQortinoImageSrc', () => {
  it('accepts only GO, data:/blob: and Qortal node sources', () => {
    expect(isSafeQortinoImageSrc('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafeQortinoImageSrc('blob:http://localhost/abc')).toBe(true);
    expect(
      isSafeQortinoImageSrc('http://127.0.0.1:12391/arbitrary/VIDEO/a/b')
    ).toBe(true);
    expect(isSafeQortinoImageSrc(TRACKER)).toBe(false);
    expect(isSafeQortinoImageSrc('')).toBe(false);
    expect(isSafeQortinoImageSrc(undefined)).toBe(false);
  });
});

describe('fetchQtubePosterDataUrl', () => {
  it('never returns a third-party poster and stops polling for it', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ title: 'Dogs', videoImage: TRACKER }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const started = Date.now();
    await expect(
      fetchQtubePosterDataUrl('Mallory', 'poster-test-1', { timeoutMs: 5_000 })
    ).resolves.toBeUndefined();
    // One kick plus one metadata read, not a poll until the timeout.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('tracker.example')
      )
    ).toBe(false);
  });

  it('returns an inline poster as before', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ videoImage: 'data:image/jpeg;base64,/9j/AA' }),
      }))
    );
    await expect(
      fetchQtubePosterDataUrl('Alice', 'poster-test-2', { timeoutMs: 5_000 })
    ).resolves.toBe('data:image/jpeg;base64,/9j/AA');
  });
});

describe('blobLooksLikePdf', () => {
  it('recognises a PDF by its bytes whatever type the node gave it', async () => {
    expect(
      await blobLooksLikePdf(
        new Blob(['%PDF-1.7\n%\u00e2\u00e3'], {
          type: 'application/octet-stream',
        })
      )
    ).toBe(true);
    expect(await blobLooksLikePdf(new Blob(['%PDF-1.4\n']))).toBe(true);
    // Readers accept a short preamble before the header.
    expect(await blobLooksLikePdf(new Blob(['\uFEFFjunk\r\n%PDF-1.5\n']))).toBe(
      true
    );
  });

  it('rejects other files, empty and missing blobs', async () => {
    expect(await blobLooksLikePdf(new Blob(['PK\u0003\u0004zip']))).toBe(false);
    expect(await blobLooksLikePdf(new Blob(['%PDF']))).toBe(false);
    expect(await blobLooksLikePdf(new Blob([]))).toBe(false);
    expect(await blobLooksLikePdf(null)).toBe(false);
    expect(
      await blobLooksLikePdf(new Blob(['x'.repeat(2048) + '%PDF-1.7']))
    ).toBe(false);
  });
});
