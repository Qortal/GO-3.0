import { createEndpoint } from '../background/background';
import QortinoLlm, { isQortinoLlmNativeAvailable } from '../plugins/QortinoLlm';
import {
  DEFAULT_QORTINO_AGENT_MANIFEST,
  QORTINO_MANIFEST_IDENTIFIER,
  QORTINO_MANIFEST_SERVICE,
  QORTINO_QDN_NAME,
  resolveManifestFile,
  type QortinoAgentManifest,
  type QortinoManifestFile,
  type QortinoPackId,
} from './manifest';
import bundledKnowledge from './bundledKnowledge.json';
import {
  clearQortinoQshareCache,
  discoverQortinoQshareFiles,
  knownPublishedEntry,
  listQortinoResources,
  matchQshareEntry,
  matchResourceBySize,
  resourcePublishState,
} from './qshareDiscovery';
import { parseKnowledgePackJson, type KnowledgePack } from './rag';
import { saveInstallState, type QortinoInstallState } from './store';

export type DownloadProgress = {
  phase: 'manifest' | 'file' | 'finalizing' | 'done' | 'error';
  fileId?: string;
  label: string;
  bytesReceived: number;
  bytesTotal: number;
  fileIndex: number;
  fileCount: number;
  error?: string;
};

async function resolveQdnUrl(options: {
  service: string;
  name: string;
  identifier: string;
}): Promise<string> {
  const path =
    `/arbitrary/${options.service}/` +
    `${encodeURIComponent(options.name)}/${encodeURIComponent(options.identifier)}`;
  return createEndpoint(path);
}

/**
 * A node asked for a resource it has never seen searches the network for it,
 * which can take minutes and used to freeze the Qortino sheet on a blank
 * screen. Every metadata read is therefore bounded.
 */
const MANIFEST_FETCH_TIMEOUT_MS = 12_000;

async function fetchQdnResource(options: {
  service: string;
  name: string;
  identifier: string;
  timeoutMs?: number;
}): Promise<Response> {
  const endpoint = await resolveQdnUrl(options);
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? MANIFEST_FETCH_TIMEOUT_MS
  );
  try {
    response = await fetch(endpoint, { signal: controller.signal });
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Failed to fetch';
    throw new Error(`${detail} (${endpoint})`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`QDN fetch failed (${response.status}) for ${options.identifier}`);
  }
  return response;
}

function isUsableManifest(json: unknown): json is QortinoAgentManifest {
  const m = json as QortinoAgentManifest | null;
  return Boolean(m?.packs?.length && m?.files?.length);
}

/** Manifest published under its stable identifier (non Q-Share publish). */
async function fetchCanonicalManifest(): Promise<QortinoAgentManifest | null> {
  try {
    const response = await fetchQdnResource({
      service: QORTINO_MANIFEST_SERVICE,
      name: QORTINO_QDN_NAME,
      identifier: QORTINO_MANIFEST_IDENTIFIER,
    });
    const json = await response.json();
    return isUsableManifest(json) ? json : null;
  } catch {
    return null;
  }
}

async function readManifestResource(
  service: string,
  identifier: string
): Promise<QortinoAgentManifest | null> {
  try {
    const response = await fetchQdnResource({
      service,
      name: QORTINO_QDN_NAME,
      identifier,
    });
    const json = await response.json();
    return isUsableManifest(json) ? json : null;
  } catch {
    return null;
  }
}

/** Manifest shared through Q-Share (`qortino_agent_manifest.json`). */
async function fetchQshareManifest(): Promise<QortinoAgentManifest | null> {
  const files = await discoverQortinoQshareFiles().catch(
    () => new Map<string, never>() as never
  );
  const entry =
    files.get('qortino_agent_manifest.json') ||
    files.get('qortino-agent-manifest.json');
  if (entry) {
    const viaMetadata = await readManifestResource(
      entry.service || 'FILE',
      entry.identifier
    );
    if (viaMetadata) return viaMetadata;
  }

  // Cold node: the metadata document may not be fetchable yet. The manifest is
  // the only tiny FILE under this name, so probe the small ones newest-first.
  const rows = await listQortinoResources('FILE').catch(() => []);
  const small = rows
    .filter((row) => row.size > 0 && row.size <= 256 * 1024)
    .sort((a, b) => b.created - a.created);
  for (const row of small) {
    const manifest = await readManifestResource(
      row.service || 'FILE',
      row.identifier
    );
    if (manifest) return manifest;
  }
  return null;
}

/**
 * Point every manifest file at the identifier it was actually published under.
 * Manifests declare stable ids (`qortino_pack_lite`), but a Q-Share publish
 * mints random ones — without this the download 404s.
 *
 * The filename map is preferred, then a size match against the resource
 * listing (works on a cold node, which cannot serve the metadata document
 * quickly), and finally the declared identifier if the node knows it.
 */
async function applyQshareIdentifiers(
  manifest: QortinoAgentManifest
): Promise<QortinoAgentManifest> {
  const [shared, fileRows] = await Promise.all([
    discoverQortinoQshareFiles().catch(
      () => new Map<string, never>() as never
    ),
    listQortinoResources('FILE').catch(() => []),
  ]);

  const claimed = new Set<string>();
  const files: QortinoManifestFile[] = [];

  for (const file of manifest.files) {
    const byName = matchQshareEntry(shared, {
      relativePath: file.relativePath,
      id: file.id,
      identifier: file.identifier,
    });
    if (byName) {
      claimed.add(byName.identifier);
      files.push({
        ...file,
        identifier: byName.identifier,
        service: byName.service || file.service || 'FILE',
        sizeBytes: file.sizeBytes || byName.size || 0,
      });
      continue;
    }

    // Declared identifier is only trustworthy if the node confirms it.
    const declared = await resourcePublishState(
      file.service || 'FILE',
      file.identifier
    );
    if (declared === 'published') {
      claimed.add(file.identifier);
      files.push(file);
      continue;
    }

    const known = knownPublishedEntry({
      relativePath: file.relativePath,
      id: file.id,
    });
    if (known && !claimed.has(known.identifier)) {
      claimed.add(known.identifier);
      files.push({
        ...file,
        identifier: known.identifier,
        service: known.service || file.service || 'FILE',
        sizeBytes: file.sizeBytes || known.size || 0,
      });
      continue;
    }

    const bySize = matchResourceBySize(fileRows, file.sizeBytes, {
      exclude: claimed,
    });
    if (bySize) {
      claimed.add(bySize.identifier);
      files.push({
        ...file,
        identifier: bySize.identifier,
        service: bySize.service || file.service || 'FILE',
      });
      continue;
    }

    files.push(file);
  }

  return { ...manifest, files };
}

/** How long UI callers wait before falling back to the bundled manifest. */
const MANIFEST_UI_BUDGET_MS = 8_000;

let resolvedManifest: QortinoAgentManifest | null = null;
let resolvedManifestPromise: Promise<QortinoAgentManifest> | null = null;

async function resolveManifest(): Promise<QortinoAgentManifest> {
  const manifest =
    (await fetchCanonicalManifest()) ||
    (await fetchQshareManifest()) ||
    DEFAULT_QORTINO_AGENT_MANIFEST;
  return applyQshareIdentifiers(manifest);
}

/**
 * Resolved manifest with real QDN identifiers.
 *
 * Resolution touches the node several times, so callers get the bundled
 * manifest once `timeoutMs` elapses rather than staring at a blank sheet; the
 * network result keeps resolving and is cached for the next call. The bundled
 * copy carries the current publish's identifiers, so an early return still
 * assembles correctly.
 */
export async function fetchQortinoManifest(options?: {
  timeoutMs?: number;
  force?: boolean;
}): Promise<QortinoAgentManifest> {
  if (options?.force) {
    resolvedManifest = null;
    resolvedManifestPromise = null;
    clearQortinoQshareCache();
  }
  if (resolvedManifest) return resolvedManifest;

  if (!resolvedManifestPromise) {
    resolvedManifestPromise = resolveManifest()
      .then((m) => {
        resolvedManifest = m;
        return m;
      })
      .catch(() => {
        resolvedManifestPromise = null;
        return DEFAULT_QORTINO_AGENT_MANIFEST;
      });
  }

  const budget = options?.timeoutMs ?? MANIFEST_UI_BUDGET_MS;
  if (budget <= 0) return resolvedManifestPromise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const onBudgetSpent = new Promise<QortinoAgentManifest>((resolve) => {
    timer = setTimeout(() => resolve(DEFAULT_QORTINO_AGENT_MANIFEST), budget);
  });
  try {
    return await Promise.race([resolvedManifestPromise, onBudgetSpent]);
  } finally {
    clearTimeout(timer);
  }
}

function capacitorErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const o = err as { message?: string; errorMessage?: string; code?: string };
    if (o.errorMessage) return o.errorMessage;
    if (o.message) return o.message;
    if (o.code) return String(o.code);
  }
  return 'Assemble failed';
}

type ResourceStatusPayload = {
  status?: string;
  localChunkCount?: number;
  totalChunkCount?: number;
};

const TERMINAL_STATUS_FAILURES = new Set([
  'BLOCKED',
  'BUILD_FAILED',
  'FAILED_TO_DOWNLOAD',
  'NOT_PUBLISHED',
  'UNSUPPORTED',
]);

/** Give up only when the node stops making progress, not on a fixed clock. */
const CHUNK_STALL_TIMEOUT_MS = 6 * 60_000;

async function fetchResourceStatus(
  service: string,
  name: string,
  identifier: string,
  signal?: AbortSignal
): Promise<ResourceStatusPayload | null> {
  try {
    const url = await createEndpoint(
      `/arbitrary/resource/status/${encodeURIComponent(service)}/` +
        `${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`
    );
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as ResourceStatusPayload;
  } catch {
    return null;
  }
}

/**
 * Make the node pull the resource's chunks and build it.
 *
 * `GET /arbitrary/{service}/{name}/{identifier}` 404s while the data is not
 * assembled locally, which is always the case the first time a device asks for
 * a multi-GB pack. Kicking an async build and polling the status endpoint is
 * what turns that 404 into a served file.
 */
async function waitForPackResourceReady(
  file: QortinoManifestFile,
  options: {
    onProgress: (percent: number, status: string) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  const service = file.service || 'FILE';
  const name = file.name || QORTINO_QDN_NAME;

  const kickUrl = await createEndpoint(
    `/arbitrary/${encodeURIComponent(service)}/` +
      `${encodeURIComponent(name)}/${encodeURIComponent(file.identifier)}?async=true`
  );
  void fetch(kickUrl, { signal: options.signal }).catch(() => undefined);

  let delay = 500;
  let bestChunks = -1;
  let lastProgressAt = Date.now();

  for (;;) {
    if (options.signal?.aborted) throw new Error('Download cancelled');

    const status = await fetchResourceStatus(
      service,
      name,
      file.identifier,
      options.signal
    );
    const state = String(status?.status || '');
    const local = Number(status?.localChunkCount || 0);
    const total = Number(status?.totalChunkCount || 0);
    const percent =
      state === 'READY'
        ? 100
        : total > 0
          ? Math.min(99, Math.round((local / total) * 100))
          : 0;
    options.onProgress(percent, state);

    if (state === 'READY') return;
    if (TERMINAL_STATUS_FAILURES.has(state)) {
      throw new Error(
        `QDN could not serve the pack (${state}). ` +
          `The data may not be hosted by enough peers right now.`
      );
    }

    if (local > bestChunks) {
      bestChunks = local;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > CHUNK_STALL_TIMEOUT_MS) {
      throw new Error(
        `QDN download stalled at ${local}/${total || '?'} chunks (${state || 'unknown'}). ` +
          `No peer is serving the remaining data — try again later.`
      );
    }

    // All chunks present but not assembled yet — ask the node to build.
    if (state === 'DOWNLOADED') {
      const buildUrl = await createEndpoint(
        `/arbitrary/resource/status/${encodeURIComponent(service)}/` +
          `${encodeURIComponent(name)}/${encodeURIComponent(file.identifier)}?build=true`
      );
      void fetch(buildUrl, { signal: options.signal }).catch(() => undefined);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(3_000, Math.round(delay * 1.2));
  }
}

async function streamFileToAppStorage(
  file: QortinoManifestFile,
  onBytes: (received: number, total: number) => void,
  signal?: AbortSignal,
  onQdnProgress?: (percent: number, status: string) => void
): Promise<string> {
  if (!isQortinoLlmNativeAvailable()) {
    throw new Error('Native storage required to install Qortino Agent');
  }

  const progressHandle = await QortinoLlm.addListener(
    'downloadProgress',
    (event) => {
      if (typeof event.bytesReceived === 'number') {
        onBytes(
          event.bytesReceived,
          event.bytesTotal > 0 ? event.bytesTotal : file.sizeBytes || event.bytesReceived
        );
      }
    }
  );

  const onAbort = () => {
    void QortinoLlm.cancelDownload().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort);

  try {
    if (signal?.aborted) {
      throw new Error('Download cancelled');
    }

    // Native HTTP download straight from the connected node (no WebView CORS).
    const service = file.service || 'FILE';
    const name = file.name || QORTINO_QDN_NAME;

    // A 404 mid-download is opaque — say up front when the node is certain it
    // has no such resource. An unanswered probe is not treated as missing.
    if ((await resourcePublishState(service, file.identifier)) === 'missing') {
      throw new Error(
        `Qortal node reports no resource "${file.identifier}" ` +
          `(${service}/${name}). The pack may still be propagating on QDN, ` +
          `or it was published under a different identifier.`
      );
    }

    // The node must hold the assembled resource before it will serve it.
    await waitForPackResourceReady(file, {
      onProgress: (percent, status) => onQdnProgress?.(percent, status),
      signal,
    });

    const url = await resolveQdnUrl({
      service,
      name,
      identifier: file.identifier,
    });
    try {
      const result = await QortinoLlm.downloadUrl({
        url,
        relativePath: file.relativePath,
      });
      onBytes(result.bytesWritten, result.bytesWritten);
      return result.path;
    } catch (e) {
      throw new Error(`${capacitorErrorMessage(e)}\nURL: ${url}`);
    }
  } catch (e) {
    throw new Error(capacitorErrorMessage(e));
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await progressHandle.remove().catch(() => undefined);
  }
}

export function filesForPack(
  manifest: QortinoAgentManifest,
  packId: QortinoPackId
): QortinoManifestFile[] {
  const pack = manifest.packs.find((p) => p.id === packId);
  if (!pack) {
    throw new Error(`Unknown pack: ${packId}`);
  }
  if (pack.packZipFileId) {
    const zip = resolveManifestFile(manifest, pack.packZipFileId);
    return zip ? [zip] : [];
  }
  const ids = [pack.llmFileId, pack.embedderFileId, pack.knowledgeFileId].filter(
    Boolean
  ) as string[];
  return ids
    .map((id) => resolveManifestFile(manifest, id))
    .filter((f): f is QortinoManifestFile => Boolean(f));
}

export async function installQortinoPack(options: {
  manifest: QortinoAgentManifest;
  packId: QortinoPackId;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<QortinoInstallState> {
  const { manifest, packId, onProgress, signal } = options;
  const pack = manifest.packs.find((p) => p.id === packId);
  if (!pack) {
    throw new Error(`Unknown pack: ${packId}`);
  }
  const packFiles = filesForPack(manifest, packId);
  if (!packFiles.length) {
    throw new Error('No files to download for pack');
  }
  // The gate may be showing a manifest that returned before identifier
  // resolution finished — re-check right before a multi-GB download.
  const { files } = await applyQshareIdentifiers({
    ...manifest,
    files: packFiles,
  });

  const storage = await QortinoLlm.getStoragePaths();
  let fileIndex = 0;
  let zipPath = '';

  for (const file of files) {
    fileIndex += 1;
    const label =
      file.role === 'pack'
        ? `Assembling ${pack.label}…`
        : `Assembling ${file.role}…`;
    onProgress?.({
      phase: 'file',
      fileId: file.id,
      label,
      bytesReceived: 0,
      bytesTotal: file.sizeBytes,
      fileIndex,
      fileCount: files.length,
    });

    const path = await streamFileToAppStorage(
      file,
      (bytesReceived, bytesTotal) => {
        onProgress?.({
          phase: 'file',
          fileId: file.id,
          label: `${label} saving to device`,
          bytesReceived,
          bytesTotal,
          fileIndex,
          fileCount: files.length,
        });
      },
      signal,
      (percent, status) => {
        // Chunk retrieval is the long part — show it rather than a dead bar.
        onProgress?.({
          phase: 'file',
          fileId: file.id,
          label:
            status === 'DOWNLOADED' || status === 'BUILDING'
              ? `${label} unpacking on node`
              : `${label} fetching from QDN`,
          bytesReceived: Math.round((percent / 100) * (file.sizeBytes || 0)),
          bytesTotal: file.sizeBytes,
          fileIndex,
          fileCount: files.length,
        });
      }
    );
    if (file.role === 'pack') {
      zipPath = path;
    }
  }

  onProgress?.({
    phase: 'finalizing',
    label: 'Unpacking the kit…',
    bytesReceived: 0,
    bytesTotal: 0,
    fileIndex: files.length,
    fileCount: files.length,
  });

  if (zipPath) {
    await QortinoLlm.extractZip({ zipAbsolutePath: zipPath });
  }

  const llmPath = `${storage.rootDir}/${pack.llmRelativePath}`;
  const embedderPath = `${storage.rootDir}/${pack.embedderRelativePath}`;
  const knowledgePath = `${storage.rootDir}/${pack.knowledgeRelativePath}`;

  const llmOk = await QortinoLlm.fileExists({ absolutePath: llmPath });
  if (!llmOk.exists) {
    throw new Error('Pack extracted but model file is missing');
  }

  const state: QortinoInstallState = {
    installed: true,
    packId,
    llmPath,
    embedderPath,
    knowledgePath,
    knowledgeVersion: manifest.knowledge.version,
    manifestVersion: manifest.schemaVersion,
    personaVersion: manifest.personaVersion,
    installedAt: Date.now(),
  };
  await saveInstallState(state);

  onProgress?.({
    phase: 'done',
    label: 'Qortino Agent assembled — offline ready',
    bytesReceived: 1,
    bytesTotal: 1,
    fileIndex: files.length,
    fileCount: files.length,
  });

  return state;
}

export async function loadKnowledgeFromInstall(
  install: QortinoInstallState
): Promise<KnowledgePack | null> {
  if (!install.knowledgePath || !isQortinoLlmNativeAvailable()) {
    return null;
  }
  try {
    const { text } = await QortinoLlm.readText({
      absolutePath: install.knowledgePath,
    });
    return parseKnowledgePackJson(text);
  } catch {
    return null;
  }
}

/**
 * Curated knowledge pack shipped in the app (your markdown docs, chunked).
 * QDN updates can replace this after download; until then RAG uses the bundle.
 */
export const BUILTIN_SAMPLE_KNOWLEDGE: KnowledgePack =
  bundledKnowledge as KnowledgePack;
