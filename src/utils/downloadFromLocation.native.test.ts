import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadUrlToMobileDocuments: vi.fn(
    async (..._args: unknown[]) =>
      ({ path: '/x', uri: 'content://x', bytesWritten: 3 }) as const
  ),
  stored: { url: 'https://node.example', apikey: 'SECRETKEY' } as {
    url?: string;
    apikey?: string;
  } | null,
}));

vi.mock('../background/background.ts', () => ({
  createEndpoint: vi.fn(
    async (endpoint: string) =>
      `https://node.example${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=SECRETKEY`
  ),
  getApiKeyFromStorage: vi.fn(async () => mocks.stored),
  getBaseApi: vi.fn(async () => 'https://ext-node.qortal.link'),
}));
vi.mock('./platform', () => ({ isCapacitor: () => true }));
vi.mock('./qdnResourceFetch', () => ({
  waitForQdnResource: vi.fn(async () => undefined),
}));
vi.mock('./qdnDownloadNotifications', () => ({
  beginQdnSaveNotification: vi.fn(() => false),
  failQdnSaveNotification: vi.fn(),
  finishQdnSaveNotification: vi.fn(),
  reportQdnGatherProgress: vi.fn(),
  reportQdnTransferProgress: vi.fn(),
}));
vi.mock('./mobileFileSave', () => ({
  downloadUrlToMobileDocuments: mocks.downloadUrlToMobileDocuments,
  isSilentSaveFile: () => true,
  mobileSaveLocationLabelFor: () => 'Documents/Qortal Go/Docs',
  saveStreamToMobileDocuments: vi.fn(),
}));

import { downloadFromLocation } from './downloadFromLocation';

// C2 / GO-32: the native downloader sends the node API key as a header, so
// the URL it is given (which it may log or show in an error) carries none.
describe('downloadFromLocation on the phone', () => {
  beforeEach(() => {
    mocks.downloadUrlToMobileDocuments.mockClear();
    mocks.stored = { url: 'https://node.example', apikey: 'SECRETKEY' };
  });

  it('hands native a URL without the key, and the key separately', async () => {
    const result = await downloadFromLocation({
      filename: 'report.pdf',
      location: { service: 'FILE', name: 'Alice Bob', identifier: 'doc 1' },
    });
    expect(result.success).toBe(true);
    const [filename, url, , , apiKey] =
      mocks.downloadUrlToMobileDocuments.mock.calls[0];
    expect(filename).toBe('report.pdf');
    expect(url).toBe(
      'https://node.example/arbitrary/FILE/Alice%20Bob/doc%201?attachment=true&attachmentFilename=report.pdf'
    );
    expect(String(url)).not.toContain('SECRETKEY');
    expect(apiKey).toBe('SECRETKEY');
  });

  it('sends no key when no custom node is configured', async () => {
    mocks.stored = null;
    await downloadFromLocation({
      filename: 'a.txt',
      location: { service: 'FILE', name: 'Alice', identifier: 'x' },
    });
    const [, url, , , apiKey] =
      mocks.downloadUrlToMobileDocuments.mock.calls[0];
    expect(url).toBe(
      'https://ext-node.qortal.link/arbitrary/FILE/Alice/x?attachment=true&attachmentFilename=a.txt'
    );
    expect(apiKey).toBeUndefined();
  });
});
