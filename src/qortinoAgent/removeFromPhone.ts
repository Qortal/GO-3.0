/**
 * Settings → Remove Qortino from this phone. The model's files, its saved
 * warm-up state and the install record go; the chats stay (they have a
 * delete of their own). Downloading again starts from nothing.
 */
import QortinoLlm from '../plugins/QortinoLlm';
import { cancelQortinoInstallJob } from './installJob';
import {
  getQortinoInstallJob,
  IDLE_QORTINO_INSTALL_JOB,
  updateQortinoInstallJob,
} from './installJobStore';
import { setPendingQortinoInstall } from './installPending';
import { forgetQortinoModel, unloadQortinoModelNow } from './modelSession';
import { clearInstallState, clearLegacyInstall } from './store';

export async function removeQortinoFromPhone(): Promise<{
  freedBytes: number;
}> {
  cancelQortinoInstallJob();
  setPendingQortinoInstall(false);
  // The native side reads the weights straight from these files.
  await unloadQortinoModelNow();
  forgetQortinoModel();
  // A failure leaves the install record: the next open checks which parts
  // are still there.
  const { freedBytes } = await QortinoLlm.cleanupStorage({ keep: [] });
  await clearInstallState();
  await clearLegacyInstall();
  updateQortinoInstallJob({
    ...IDLE_QORTINO_INSTALL_JOB,
    viewOpen: getQortinoInstallJob().viewOpen,
  });
  return { freedBytes };
}
