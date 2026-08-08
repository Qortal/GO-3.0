/**
 * QDN identifiers and client-side defaults for the Qortino Offline Agent.
 *
 * Publish under name `Qortino AI` (DOCUMENT / FILE resources). The client
 * fetches `qortino_agent_manifest` first, then downloads the Lite or Standard
 * pack zip the device needs.
 */

/** Q-Share / QDN registered name for all agent resources. */
export const QORTINO_QDN_NAME = 'Qortino AI';

export const QORTINO_MANIFEST_SERVICE = 'DOCUMENT';
export const QORTINO_MANIFEST_IDENTIFIER = 'qortino_agent_manifest';

export const QORTINO_FILE_SERVICE = 'FILE';

/** Stable QDN identifiers for packaged binaries / packs. */
export const QORTINO_QDN_IDS = {
  manifest: 'qortino_agent_manifest',
  packLite: 'qortino_pack_lite',
  packStandard: 'qortino_pack_standard',
  llmMedium: 'qortino_llm_qwen25_3b_q4',
  llmSmall: 'qortino_llm_qwen25_15b_q4',
  embedder: 'qortino_embed_minilm',
  knowledgePrefix: 'qortino_knowledge_',
} as const;

/**
 * Identifiers the packs are actually published under.
 *
 * Q-Share mints a random identifier per file rather than using the stable ids
 * above, so the manifest's declared identifier 404s. These are read from the
 * live Q-Share metadata document at runtime; this baked-in copy of the current
 * publish keeps assemble working when a node cannot serve that document (its
 * arbitrary-resource cache may lag behind the chain).
 *
 * Keyed by the manifest `relativePath` basename.
 */
export const PUBLISHED_QSHARE_FILES: Record<
  string,
  { identifier: string; service: string; sizeBytes: number }
> = {
  'qortino-lite.zip': {
    identifier: 'qshare_file_qortino-ai_xPL274',
    service: 'FILE',
    sizeBytes: 988093746,
  },
  'qortino-standard.zip': {
    identifier: 'qshare_file_qortino-ai_hE3ZLM',
    service: 'FILE',
    sizeBytes: 1910730222,
  },
  'qortino_agent_manifest.json': {
    identifier: 'qshare_file_qortino-ai_ZAFI6r',
    service: 'FILE',
    sizeBytes: 2351,
  },
};

export type QortinoPackId = 'small' | 'medium';

export type QortinoManifestFile = {
  id: string;
  service?: string;
  name?: string;
  identifier: string;
  relativePath: string;
  sizeBytes: number;
  sha256?: string;
  role: 'llm' | 'embedder' | 'knowledge' | 'pack' | 'other';
  packIds?: QortinoPackId[];
};

export type QortinoAgentManifest = {
  schemaVersion: number;
  agentId: string;
  displayName: string;
  personaVersion: string;
  minAppVersion?: string;
  publishedAt?: string;
  packs: {
    id: QortinoPackId;
    label: string;
    description: string;
    minRamBytes: number;
    approxDownloadBytes: number;
    /** Single Q-Share FILE zip containing model + embedder + knowledge. */
    packZipFileId: string;
    llmRelativePath: string;
    embedderRelativePath: string;
    knowledgeRelativePath: string;
    /** @deprecated Prefer packZipFileId; kept for older manifests. */
    llmFileId?: string;
    embedderFileId?: string;
    knowledgeFileId?: string;
  }[];
  files: QortinoManifestFile[];
  knowledge: {
    currentIdentifier: string;
    version: string;
  };
  licenses?: {
    llm: string;
    embedder: string;
  };
  safetyDisclaimer?: string;
};

/**
 * Shown in the gate and given to the model. Owned by the app rather than the
 * published manifest, so the wording can change without republishing to QDN.
 */
export const QORTINO_SAFETY_DISCLAIMER =
  'Qortino can be confidently wrong → double-check anything important.';

/** Built-in fallback when QDN manifest is unreachable (still requires download). */
export const DEFAULT_QORTINO_AGENT_MANIFEST: QortinoAgentManifest = {
  schemaVersion: 1,
  agentId: 'qortino',
  displayName: 'Qortino',
  personaVersion: '1',
  packs: [
    {
      id: 'small',
      label: 'Qortino Lite',
      description: 'Qwen2.5-1.5B Q4 — best for ~6 GB devices / tight storage.',
      minRamBytes: 5 * 1024 ** 3,
      approxDownloadBytes: 988_093_746,
      packZipFileId: QORTINO_QDN_IDS.packLite,
      llmRelativePath: 'models/qwen25-1.5b-instruct-q4.gguf',
      embedderRelativePath: 'models/all-minilm-l6-v2-q8.gguf',
      knowledgeRelativePath: 'knowledge/qortino-knowledge-v2.json',
    },
    {
      id: 'medium',
      label: 'Qortino Standard',
      description: 'Qwen2.5-3B Q4 — stronger Qortal / coding help on ~8 GB phones.',
      minRamBytes: 7 * 1024 ** 3,
      approxDownloadBytes: 1_910_730_222,
      packZipFileId: QORTINO_QDN_IDS.packStandard,
      llmRelativePath: 'models/qwen25-3b-instruct-q4.gguf',
      embedderRelativePath: 'models/all-minilm-l6-v2-q8.gguf',
      knowledgeRelativePath: 'knowledge/qortino-knowledge-v2.json',
    },
  ],
  files: [
    {
      id: QORTINO_QDN_IDS.packLite,
      service: QORTINO_FILE_SERVICE,
      name: QORTINO_QDN_NAME,
      identifier: PUBLISHED_QSHARE_FILES['qortino-lite.zip'].identifier,
      relativePath: 'packs/qortino-lite.zip',
      sizeBytes: 988_093_746,
      sha256: 'b03a106a181d8b714ad1de8275a054e696e1333dce5ac4f460df3439bb96452d',
      role: 'pack',
      packIds: ['small'],
    },
    {
      id: QORTINO_QDN_IDS.packStandard,
      service: QORTINO_FILE_SERVICE,
      name: QORTINO_QDN_NAME,
      identifier: PUBLISHED_QSHARE_FILES['qortino-standard.zip'].identifier,
      relativePath: 'packs/qortino-standard.zip',
      sizeBytes: 1_910_730_222,
      sha256: '365155e1588dc69c4e275b8eaaae561e09f5ee9ac951ae8f0424cda74484a929',
      role: 'pack',
      packIds: ['medium'],
    },
  ],
  knowledge: {
    currentIdentifier: `${QORTINO_QDN_IDS.knowledgePrefix}v2`,
    version: 'v2',
  },
  licenses: {
    llm: 'Apache-2.0 (Qwen2.5)',
    embedder: 'Apache-2.0 (all-MiniLM-L6-v2)',
  },
  safetyDisclaimer: QORTINO_SAFETY_DISCLAIMER,
};

export function resolveManifestFile(
  manifest: QortinoAgentManifest,
  fileId: string
): QortinoManifestFile | undefined {
  return manifest.files.find((f) => f.id === fileId || f.identifier === fileId);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
