import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://192.168.1.20:12391';
const KEY = 'SECRET_NODE_KEY';

const llm = vi.hoisted(() => ({
  addListener: vi.fn(async () => ({ remove: async () => undefined })),
  cancelDownload: vi.fn(async () => undefined),
  downloadUrl: vi.fn(),
  extractZip: vi.fn(async () => ({ destDir: '/agent', extractedFiles: 3 })),
  fileExists: vi.fn(async () => ({ exists: true, path: '/agent/x', size: 1 })),
  getStoragePaths: vi.fn(async () => ({
    knowledgeDir: '/agent/knowledge',
    modelsDir: '/agent/models',
    rootDir: '/agent',
  })),
}));

vi.mock('../../background/background', () => ({
  createEndpoint: async (path: string) =>
    `${NODE}${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`,
  getApiKeyFromStorage: async () => ({ apikey: KEY, url: NODE }),
  getBaseApi: async () => NODE,
}));
vi.mock('../../plugins/QortinoLlm', () => ({
  default: llm,
  isQortinoLlmNativeAvailable: () => true,
}));
vi.mock('../qshareDiscovery', () => ({
  clearQortinoQshareCache: vi.fn(),
  discoverQortinoQshareFiles: async () => new Map(),
  knownPublishedEntry: () => null,
  listQortinoResources: async () => [],
  matchQshareEntry: () => null,
  matchResourceBySize: () => null,
  resourcePublishState: async () => 'published',
}));
vi.mock('../store', () => ({ saveInstallState: vi.fn(async () => undefined) }));

import { installQortinoPack } from '../download';
import type { QortinoAgentManifest } from '../manifest';

const manifest: QortinoAgentManifest = {
  agentId: 'qortino',
  displayName: 'Qortino',
  files: [
    {
      id: 'pack-small',
      identifier: 'qshare_file_pack_small',
      name: 'Qortino AI',
      relativePath: 'packs/small.zip',
      role: 'pack',
      service: 'FILE',
      sizeBytes: 10,
    },
  ],
  knowledge: { currentIdentifier: 'k', version: '1' },
  packs: [
    {
      approxDownloadBytes: 10,
      description: '',
      embedderRelativePath: 'models/embed.gguf',
      id: 'small',
      knowledgeRelativePath: 'knowledge/pack.json',
      label: 'Small',
      llmRelativePath: 'models/llm.gguf',
      minRamBytes: 0,
      packZipFileId: 'pack-small',
    },
  ],
  personaVersion: '1',
  schemaVersion: 1,
};

describe('Qortino pack download and the node API key', () => {
  beforeEach(() => {
    llm.downloadUrl.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'READY' })))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes the key separately, never inside the URL', async () => {
    llm.downloadUrl.mockResolvedValue({
      bytesWritten: 10,
      path: '/agent/packs/small.zip',
    });

    await installQortinoPack({ manifest, packId: 'small' });

    expect(llm.downloadUrl).toHaveBeenCalledTimes(1);
    const [options] = llm.downloadUrl.mock.calls[0] as [
      { apiKey?: string; relativePath: string; url: string },
    ];
    expect(options.apiKey).toBe(KEY);
    expect(options.url).toBe(
      `${NODE}/arbitrary/FILE/Qortino%20AI/qshare_file_pack_small`
    );
    expect(options.url).not.toContain(KEY);
    expect(options.relativePath).toBe('packs/small.zip');
  });

  it('shows no key in the error when the download fails', async () => {
    llm.downloadUrl.mockRejectedValue(
      Object.assign(new Error(`HTTP 404 for ${NODE}/x?apiKey=${KEY}`), {
        code: 'ERR',
      })
    );

    const failure = await installQortinoPack({
      manifest,
      packId: 'small',
    }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).not.toContain(KEY);
    expect(message).toContain('HTTP 404');
    expect(message).toContain(
      `URL: ${NODE}/arbitrary/FILE/Qortino%20AI/qshare_file_pack_small`
    );
  });
});
