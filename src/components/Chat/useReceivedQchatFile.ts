import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../utils/events';
import { isRefusedForOpen } from '../../utils/nativeFileOpen';
import {
  openReceivedChatFile,
  receivedFileDisplayName,
  saveReceivedChatFile,
  statReceivedChatFile,
  type ReceivedChatFile,
} from '../../utils/receivedChatFiles';

/**
 * - `present`: GO holds the file in its private storage.
 * - `legacy`: only the copy an older build put in public Downloads is left.
 * - `gone`: removed from this device (logout deletes received files).
 * - `unknown`: not checked yet, or the check is not available.
 */
type ReceivedQchatFileState = 'unknown' | 'present' | 'legacy' | 'gone';

/** What the private copy and an older build's Downloads copy add up to. */
export function receivedQchatFileState(
  privateCopy: boolean | null,
  hasLegacyCopy: boolean
): ReceivedQchatFileState {
  if (privateCopy === true) return 'present';
  if (hasLegacyCopy) return 'legacy';
  return privateCopy === false ? 'gone' : 'unknown';
}

/**
 * The chat card's actions for a file received over Reticulum on Android:
 * "Open" in GO's own viewer and an explicit "Save to device" (N-22, N-27).
 * `enabled` is false on desktop and before the transfer completed.
 */
export function useReceivedQchatFile(
  file: ReceivedChatFile | null,
  enabled: boolean
) {
  const { t } = useTranslation(['core']);
  const path = String(file?.path || '');
  const legacyUri = String(file?.legacyUri || '');
  const fileName = String(file?.fileName || '');
  const [state, setState] = useState<ReceivedQchatFileState>('unknown');
  const [busy, setBusy] = useState<'open' | 'save' | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setState('unknown');
      return;
    }
    if (!path) {
      setState(receivedQchatFileState(false, !!legacyUri));
      return;
    }
    let cancelled = false;
    void statReceivedChatFile(path).then((stat) => {
      if (cancelled) return;
      setState(
        receivedQchatFileState(stat === null ? null : stat.exists, !!legacyUri)
      );
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, legacyUri, path]);

  const notify = useCallback(
    (message: string, type: 'success' | 'info' | 'error') => {
      executeEvent('openGlobalSnackBar', { message, type });
    },
    []
  );

  const run = useCallback(
    async (action: 'open' | 'save', work: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(action);
      try {
        await work();
      } catch (error) {
        console.error(`[ReceivedFile] ${action} failed:`, error);
        notify(
          action === 'open'
            ? t('core:file_transfer.open_failed')
            : t('core:file_transfer.save_error_generic'),
          'error'
        );
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [notify, t]
  );

  const isPackage = isRefusedForOpen({
    uri: path || legacyUri,
    fileName: receivedFileDisplayName({ path, fileName }),
  });

  const open = useCallback(
    () =>
      run('open', async () => {
        const result = await openReceivedChatFile({
          path,
          legacyUri,
          fileName,
        });
        if (result.ok) return;
        if (result.reason === 'missing') {
          setState(receivedQchatFileState(false, false));
          notify(t('core:file_transfer.received_file_gone'), 'info');
        } else if (result.reason === 'package') {
          notify(t('core:file_transfer.package_not_opened'), 'info');
        } else {
          console.error('[ReceivedFile] open failed:', result.error);
          notify(t('core:file_transfer.open_failed'), 'error');
        }
      }),
    [fileName, legacyUri, notify, path, run, t]
  );

  const save = useCallback(
    () =>
      run('save', async () => {
        const result = await saveReceivedChatFile({
          path,
          legacyUri,
          fileName,
        });
        if (result.ok) {
          notify(
            isPackage
              ? t('core:file_transfer.package_saved', {
                  location: result.location,
                })
              : t('core:file_transfer.saved_to', {
                  location: result.location,
                }),
            'success'
          );
          return;
        }
        switch (result.reason) {
          case 'already_public':
            notify(t('core:file_transfer.received_in_downloads'), 'info');
            break;
          case 'missing':
            setState(receivedQchatFileState(false, false));
            notify(t('core:file_transfer.received_file_gone'), 'info');
            break;
          case 'permission':
            notify(t('core:file_transfer.storage_permission'), 'error');
            break;
          default:
            console.error('[ReceivedFile] save failed:', result.error);
            notify(t('core:file_transfer.save_error_generic'), 'error');
        }
      }),
    [fileName, isPackage, legacyUri, notify, path, run, t]
  );

  return { state, busy, isPackage, open, save };
}
