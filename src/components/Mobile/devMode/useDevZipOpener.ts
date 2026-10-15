import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../../../atoms/global';
import { executeEvent } from '../../../utils/events';
import { getBaseApiReact } from '../../../utils/globalApi';
import {
  DEV_ZIP_MAX_BYTES,
  DevZipError,
  buildDevZip,
  devAppLabelFromFileName,
  devAppName,
  type DevZipProblem,
} from './devModeApp';

const problemOf = (error: unknown): DevZipProblem =>
  error instanceof DevZipError ? error.problem : 'build';

/**
 * Opens a picked zip in a tab. The tab's Refresh reads the same file again,
 * so a zip replaced on the phone shows its new version; when the file can't
 * be read any more (or the new zip doesn't build), the last copy reloads.
 */
export function useDevZipOpener() {
  const { t } = useTranslation(['core']);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);

  const say = useCallback(
    (type: 'info' | 'error', message: string, sticky = false) => {
      setInfoSnack({ type, message, ...(sticky ? { duration: null } : {}) });
      setOpenSnack(true);
    },
    [setInfoSnack, setOpenSnack]
  );

  const problemText = useCallback(
    (problem: DevZipProblem) =>
      t(`core:go_dev_mode.error_${problem}`, {
        amount: Math.round(DEV_ZIP_MAX_BYTES / (1024 * 1024)),
        postProcess: 'capitalizeFirstChar',
      }),
    [t]
  );

  const building = useCallback(
    (name: string) =>
      say(
        'info',
        t('core:go_dev_mode.building', {
          name,
          postProcess: 'capitalizeFirstChar',
        }),
        true
      ),
    [say, t]
  );

  const openZip = useCallback(
    async (file: File) => {
      const label = devAppLabelFromFileName(file.name);
      building(label);
      let url: string;
      try {
        url = await buildDevZip(getBaseApiReact(), file);
      } catch (error) {
        say('error', problemText(problemOf(error)));
        return;
      }

      const refresh = async (tabId: string) => {
        building(label);
        try {
          executeEvent('updateAppUrl', {
            tabId,
            url: await buildDevZip(getBaseApiReact(), file),
          });
          setOpenSnack(false);
        } catch (error) {
          executeEvent('refreshApp', { tabId });
          const problem = problemOf(error);
          say(
            'error',
            problem === 'unreadable'
              ? t('core:go_dev_mode.refresh_unreadable', {
                  postProcess: 'capitalizeFirstChar',
                })
              : problemText(problem)
          );
        }
      };

      executeEvent('addTab', {
        data: {
          url,
          isPreview: true,
          isDevZip: true,
          service: 'APP',
          name: devAppName(label),
          label,
          filePath: '',
          refreshFunc: (tabId: string) => {
            void refresh(tabId);
          },
        },
      });
      // The tab opening is the answer.
      setOpenSnack(false);
    },
    [building, problemText, say, setOpenSnack, t]
  );

  return { openZip };
}
