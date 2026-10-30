import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Box,
  ButtonBase,
  CircularProgress,
  Drawer,
  Typography,
} from '@mui/material';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ShareRoundedIcon from '@mui/icons-material/ShareRounded';
import { useTranslation } from 'react-i18next';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { useCloseWithGoWindows } from '../../utils/closeGoWindows';
import { SAFE_AREA_BOTTOM } from '../../utils/mobileSafeArea';
import { isRefusedForOpen } from '../../utils/nativeFileOpen';
import { useGoLayout } from '../../layout/goLayout';

const OPEN_EVENT = 'openSavedFileActions';

type SavedFileActionsDetail = {
  /** The name the file was saved under. */
  fileName: string;
  /** Where it went, e.g. "Documents/Qortal Go/Documents". */
  folder?: string;
  /** The saved file's uri (content:// on Android 10+). */
  uri?: string;
  mimeType?: string;
  /** The bytes, still in memory: Share needs a file:// copy of them. */
  blob?: Blob;
};

/** Shows "Open with…" and "Share…" for a file GO just saved. */
export function openSavedFileActions(detail: SavedFileActionsDetail): void {
  executeEvent(OPEN_EVENT, detail);
}

let shareSequence = 0;

/**
 * Bottom sheet behind a tapped "Saved to …" popup: hands the saved file to
 * another app, through the Android "Open with" chooser or the share sheet.
 */
export const SavedFileActionsSheet = () => {
  const { t } = useTranslation(['core', 'reticulum']);
  const [file, setFile] = useState<
    (SavedFileActionsDetail & { shareKey: string }) | null
  >(null);
  const [busy, setBusy] = useState<'open' | 'share' | null>(null);
  // GO tablets and landscape: a centred sheet, not rows across the screen.
  const centredSheet = useGoLayout((l) => l.go && l.widthClass !== 'compact');

  const close = useCallback(() => {
    setFile(null);
    setBusy(null);
  }, []);

  useEffect(() => {
    const handleOpen = (event: CustomEvent<SavedFileActionsDetail>) => {
      const detail = event.detail;
      if (!detail?.fileName || (!detail.uri && !detail.blob)) return;
      setBusy(null);
      setFile({ ...detail, shareKey: `saved-file:${++shareSequence}` });
    };
    subscribeToEvent(OPEN_EVENT, handleOpen);
    return () => unsubscribeFromEvent(OPEN_EVENT, handleOpen);
  }, []);

  useAndroidBack(
    () => {
      close();
      return true;
    },
    { priority: BACK_PRIORITY.sheet, enabled: !!file }
  );
  useCloseWithGoWindows(!!file, close);

  const notifyError = (key: string) =>
    executeEvent('openGlobalSnackBar', {
      message: t(key, { postProcess: 'capitalizeFirstChar' }),
      type: 'error',
    });

  const run = async (action: 'open' | 'share') => {
    if (!file || busy) return;
    setBusy(action);
    try {
      const {
        openStagedMobileFileWith,
        shareStagedMobileFile,
        stageMobileFileForSharing,
      } = await import('../../utils/mobileFileShare');
      if (action === 'open') {
        // The saved copy itself, so the other app sees the real file.
        let opened = false;
        if (file.uri) {
          const { openSavedMobileFile } =
            await import('../../utils/mobileFileSave');
          opened = await openSavedMobileFile(
            file.uri,
            file.fileName,
            file.mimeType
          );
        }
        if (!opened && file.blob) {
          const staged = await stageMobileFileForSharing(
            file.shareKey,
            file.fileName,
            file.blob
          );
          await openStagedMobileFileWith(staged, file.fileName, file.mimeType);
          opened = true;
        }
        if (!opened) throw new Error('No app opened the file');
      } else {
        // The share sheet takes file:// only, not the MediaStore uri.
        if (!file.blob) throw new Error('Nothing to share');
        const staged = await stageMobileFileForSharing(
          file.shareKey,
          file.fileName,
          file.blob
        );
        await shareStagedMobileFile(staged, file.fileName);
      }
      close();
    } catch (error) {
      console.error(`[SavedFileActions] ${action} failed:`, error);
      setBusy(null);
      notifyError(
        action === 'share'
          ? 'reticulum:file_viewer.share_failed'
          : 'core:file_transfer.open_failed'
      );
    }
  };

  const canOpen =
    !!file &&
    !isRefusedForOpen({
      uri: file.uri,
      fileName: file.fileName,
      mimeType: file.mimeType,
    });
  const canShare = !!file?.blob;

  const actions: {
    key: 'open' | 'share';
    label: string;
    icon: ReactNode;
    show: boolean;
  }[] = [
    {
      key: 'open',
      label: t('reticulum:file_viewer.open_with', {
        postProcess: 'capitalizeFirstChar',
      }),
      icon: <OpenInNewRoundedIcon />,
      show: canOpen,
    },
    {
      key: 'share',
      label: t('reticulum:file_viewer.share', {
        postProcess: 'capitalizeFirstChar',
      }),
      icon: <ShareRoundedIcon />,
      show: canShare,
    },
  ];

  return (
    <Drawer
      anchor="bottom"
      open={!!file}
      onClose={close}
      sx={{ zIndex: 2600 }}
      PaperProps={{
        sx: {
          backgroundColor: 'background.paper',
          backgroundImage: 'none',
          borderTop: 1,
          borderColor: 'divider',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          color: 'text.primary',
          paddingBottom: `calc(${SAFE_AREA_BOTTOM} + 12px)`,
          ...(centredSheet ? { maxWidth: 560, mx: 'auto' } : {}),
        },
      }}
    >
      {file ? (
        <Box sx={{ px: 2, pt: 1 }}>
          <Box
            sx={{
              backgroundColor: 'action.disabled',
              borderRadius: 999,
              height: 4,
              mb: 1.75,
              mx: 'auto',
              width: 36,
            }}
          />
          <Box
            sx={{ alignItems: 'center', display: 'flex', gap: 1.5, mb: 1.5 }}
          >
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: 'action.selected',
                borderRadius: '12px',
                color: 'primary.main',
                display: 'flex',
                flexShrink: 0,
                height: 44,
                justifyContent: 'center',
                width: 44,
              }}
            >
              <InsertDriveFileRoundedIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: '0.95rem', fontWeight: 700 }}>
                {file.fileName}
              </Typography>
              {file.folder ? (
                <Typography
                  noWrap
                  sx={{ color: 'text.secondary', fontSize: '0.78rem' }}
                >
                  {file.folder}
                </Typography>
              ) : null}
            </Box>
          </Box>
          {actions
            .filter((action) => action.show)
            .map((action) => (
              <ButtonBase
                key={action.key}
                disabled={!!busy}
                onClick={() => void run(action.key)}
                sx={{
                  alignItems: 'center',
                  borderRadius: '14px',
                  display: 'flex',
                  gap: 1.5,
                  justifyContent: 'flex-start',
                  minHeight: 52,
                  px: 1.25,
                  width: '100%',
                  '&:active': { backgroundColor: 'action.hover' },
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    color: 'text.secondary',
                    display: 'flex',
                    justifyContent: 'center',
                    width: 28,
                  }}
                >
                  {busy === action.key ? (
                    <CircularProgress size={20} sx={{ color: 'inherit' }} />
                  ) : (
                    action.icon
                  )}
                </Box>
                <Typography sx={{ fontSize: '0.98rem', fontWeight: 600 }}>
                  {action.label}
                </Typography>
              </ButtonBase>
            ))}
        </Box>
      ) : null}
    </Drawer>
  );
};
