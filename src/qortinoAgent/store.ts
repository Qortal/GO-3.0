import { Preferences } from '@capacitor/preferences';
import QortinoLlm, {
  isQortinoLlmNativeAvailable,
} from '../plugins/QortinoLlm';
import type { QortinoPackId } from './manifest';

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
