import { Preferences } from '@capacitor/preferences';
import QortinoLlm, { isQortinoLlmNativeAvailable } from '../plugins/QortinoLlm';
import {
  modelPartRelativePath,
  qortinoLayoutForPath,
  type QortinoModelSpec,
} from './manifest';

/**
 * v1 described the Qwen2.5 Lite/Standard packs. Those installs are not
 * carried over: the gate offers the new model and the old files are deleted
 * once it is in place.
 */
const INSTALL_KEY = 'qortino_agent_install_v2';
const LEGACY_INSTALL_KEY = 'qortino_agent_install_v1';

export type QortinoInstallState = {
  installed: boolean;
  /** QORTINO_MODEL.id the files belong to. */
  modelId?: string;
  /** First GGUF part — what loadModel is given. */
  llmPath?: string;
  installedAt?: number;
  lastOpenedAt?: number;
};

/**
 * An install counts only when every part of the current model is on disk at
 * its exact size under the current storage root, in the layout (two or three
 * parts) it was saved in. The parts were hashed once after download; a size
 * check is enough here and costs nothing.
 */
async function isInstallUsable(
  state: QortinoInstallState,
  model: QortinoModelSpec = qortinoLayoutForPath(state.llmPath)
): Promise<boolean> {
  if (!state.installed || !state.llmPath || state.modelId !== model.id) {
    return false;
  }
  if (!isQortinoLlmNativeAvailable()) return true;
  try {
    const { rootDir } = await QortinoLlm.getStoragePaths();
    if (rootDir && !state.llmPath.startsWith(rootDir)) return false;
    for (const part of model.parts) {
      const hit = await QortinoLlm.fileExists({
        relativePath: modelPartRelativePath(part),
      });
      if (!hit.exists || (part.sizeBytes > 0 && hit.size !== part.sizeBytes)) {
        return false;
      }
    }
    return true;
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

export async function saveInstallState(
  state: QortinoInstallState
): Promise<void> {
  await Preferences.set({
    key: INSTALL_KEY,
    value: JSON.stringify(state),
  });
}

/** Forget the install: its files were removed from this phone. */
export async function clearInstallState(): Promise<void> {
  await Preferences.remove({ key: INSTALL_KEY });
}

/** True when this phone still has an install record from the old packs. */
export async function hasLegacyInstall(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: LEGACY_INSTALL_KEY });
    return Boolean(
      value && (JSON.parse(value) as { installed?: boolean }).installed
    );
  } catch {
    return false;
  }
}

export async function clearLegacyInstall(): Promise<void> {
  await Preferences.remove({ key: LEGACY_INSTALL_KEY }).catch(() => undefined);
}
