/**
 * Whether Qortino AI is on this phone and ready to answer. Checked again
 * whenever Qortino's window closes (it may have been downloaded or removed
 * there) and when a download finishes in the background.
 */
import { useAtomValue } from 'jotai';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { qortinoAgentOpenAtom } from '../../../atoms/global';
import { isQortinoLlmInferenceAvailable } from '../../../plugins/QortinoLlm';
import {
  getQortinoInstallJob,
  subscribeQortinoInstallJob,
} from '../../../qortinoAgent/installJobStore';
import { loadInstallState } from '../../../qortinoAgent/store';

export function useQortinoReady(): boolean {
  const [ready, setReady] = useState(false);
  const sheetOpen = useAtomValue(qortinoAgentOpenAtom);
  const jobStatus = useSyncExternalStore(
    subscribeQortinoInstallJob,
    () => getQortinoInstallJob().status,
    () => getQortinoInstallJob().status
  );

  useEffect(() => {
    if (sheetOpen || !isQortinoLlmInferenceAvailable()) return;
    let cancelled = false;
    void loadInstallState()
      .then((state) => {
        if (!cancelled) setReady(Boolean(state.installed && state.llmPath));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [jobStatus, sheetOpen]);

  return ready;
}
