import { Preferences } from '@capacitor/preferences';
import QortinoLlm, {
  isQortinoLlmNativeAvailable,
} from '../plugins/QortinoLlm';
import {
  DEFAULT_QORTINO_AGENT_MANIFEST,
  type QortinoAgentManifest,
  type QortinoPackId,
} from './manifest';
import type { KnowledgePack } from './rag';

const INSTALL_KEY = 'qortino_agent_install_v1';

export type QortinoInstallState = {
  installed: boolean;
  packId?: QortinoPackId;
  llmPath?: string;
  embedderPath?: string;
  knowledgePath?: string;
  knowledgeVersion?: string;
  manifestVersion?: number;
  personaVersion?: string;
  installedAt?: number;
  lastOpenedAt?: number;
};

/**
 * A recorded install only counts when its model is actually on disk under the
 * current storage root. Older builds kept packs in internal storage, and the
 * files can also be cleared by the user — either way the gate should offer to
 * assemble again instead of opening a chat that fails to load a model.
 */
async function isInstallUsable(state: QortinoInstallState): Promise<boolean> {
  if (!state.installed || !state.llmPath) return false;
  if (!isQortinoLlmNativeAvailable()) return true;
  try {
    const { rootDir } = await QortinoLlm.getStoragePaths();
    if (rootDir && !state.llmPath.startsWith(rootDir)) return false;
    const hit = await QortinoLlm.fileExists({ absolutePath: state.llmPath });
    return hit.exists && hit.size > 0;
  } catch {
    // Plugin hiccup — trust the stored state rather than forcing a re-download.
    return true;
  }
}

export async function loadInstallState(): Promise<QortinoInstallState> {
  try {
    const { value } = await Preferences.get({ key: INSTALL_KEY });
    if (!value) {
      return { installed: false };
    }
    const state = JSON.parse(value) as QortinoInstallState;
    if (state.installed && !(await isInstallUsable(state))) {
      return { installed: false };
    }
    return state;
  } catch {
    return { installed: false };
  }
}

export async function saveInstallState(state: QortinoInstallState): Promise<void> {
  await Preferences.set({
    key: INSTALL_KEY,
    value: JSON.stringify(state),
  });
}

export async function clearInstallState(): Promise<void> {
  await Preferences.remove({ key: INSTALL_KEY });
}

type QortinoRuntimeCache = {
  manifest: QortinoAgentManifest;
  knowledge: KnowledgePack | null;
  install: QortinoInstallState;
};

let runtimeCache: QortinoRuntimeCache | null = null;

export function getRuntimeCache(): QortinoRuntimeCache | null {
  return runtimeCache;
}

export function setRuntimeCache(cache: QortinoRuntimeCache): void {
  runtimeCache = cache;
}

export function defaultRuntimeCache(install?: QortinoInstallState): QortinoRuntimeCache {
  return {
    manifest: DEFAULT_QORTINO_AGENT_MANIFEST,
    knowledge: null,
    install: install ?? { installed: false },
  };
}
