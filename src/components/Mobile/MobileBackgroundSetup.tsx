import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  ButtonBase,
  Dialog,
  DialogContent,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { onlineAddressesAtom } from '../../atoms/presence';
import { nodeInfosAtom, selectedNodeInfoAtom } from '../../atoms/global';
import { QortalBackground } from '../../plugins/QortalBackground';
import {
  buildNodeLabel,
  buildPeersLabel,
  buildSyncLabel,
  dismissBatteryOptimizationPrompt,
  openAppBatterySettings,
  requestIgnoreBatteryOptimizations,
  shouldShowBatteryOptimizationPrompt,
  startMobilePersistentStatus,
  stopMobilePersistentStatus,
  subscribeMobilePersistentStatusUpdates,
  updateMobilePersistentStatus,
} from '../../utils/mobileBackgroundService';
import { initMobileTransferNotifications } from '../../utils/mobileTransferNotifications';
import { isCapacitor } from '../../utils/platform';
import {
  dialogContentSx,
  getDialogPaperSx,
} from '../App/dialogSurface';

type MobileBackgroundSetupProps = {
  enabled: boolean;
  onIncomingCallAction?: (payload: {
    callId?: string;
    action?: string;
  }) => void;
};

export const MobileBackgroundSetup = ({
  enabled,
  onIncomingCallAction,
}: MobileBackgroundSetupProps) => {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const { t } = useTranslation(['auth']);
  const onlineAddresses = useAtomValue(onlineAddressesAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const onlineCountRef = useRef(onlineAddresses.size);
  const selectedNodeRef = useRef(selectedNode);
  const nodeInfosRef = useRef(nodeInfos);
  const publishStatusRef = useRef<(() => void) | null>(null);
  const [batteryPromptOpen, setBatteryPromptOpen] = useState(false);

  onlineCountRef.current = onlineAddresses.size;
  selectedNodeRef.current = selectedNode;
  nodeInfosRef.current = nodeInfos;

  useEffect(() => {
    if (!enabled || !isCapacitor()) return undefined;

    initMobileTransferNotifications();

    let cancelled = false;

    const boot = async () => {
      const shouldPrompt = await shouldShowBatteryOptimizationPrompt();
      if (!cancelled && shouldPrompt) {
        setBatteryPromptOpen(true);
      }

      await startMobilePersistentStatus({
        reticulumLabel: 'Reticulum starting',
        reticulumKind: 'starting',
        onlineCount: onlineCountRef.current,
        nodeLabel: buildNodeLabel(selectedNodeRef.current),
        syncLabel: buildSyncLabel(nodeInfosRef.current),
        peersLabel: buildPeersLabel(onlineCountRef.current),
      });
    };

    void boot();

    const { publish, unsubscribe } = subscribeMobilePersistentStatusUpdates(
      () => ({
        onlineCount: onlineCountRef.current,
        nodeLabel: buildNodeLabel(selectedNodeRef.current),
        syncLabel: buildSyncLabel(nodeInfosRef.current),
        peersLabel: buildPeersLabel(onlineCountRef.current),
      }),
      (snapshot) => {
        void updateMobilePersistentStatus(snapshot);
      }
    );
    publishStatusRef.current = publish;

    const incomingCallListener = QortalBackground.addListener(
      'incomingCallAction',
      (event) => {
        onIncomingCallAction?.({
          callId: event.callId,
          action: event.action,
        });
      }
    );

    return () => {
      cancelled = true;
      publishStatusRef.current = null;
      unsubscribe();
      void stopMobilePersistentStatus();
      void incomingCallListener.then((handle) => handle.remove());
    };
  }, [enabled, onIncomingCallAction]);

  useEffect(() => {
    if (!enabled || !isCapacitor()) return;
    publishStatusRef.current?.();
  }, [enabled, selectedNode, nodeInfos, onlineAddresses]);

  const handleNotNow = useCallback(() => {
    setBatteryPromptOpen(false);
  }, []);

  const handleNeverShowAgain = useCallback(async () => {
    await dismissBatteryOptimizationPrompt();
    setBatteryPromptOpen(false);
  }, []);

  const handleAllowUnrestricted = useCallback(async () => {
    await requestIgnoreBatteryOptimizations();
    setBatteryPromptOpen(false);
  }, []);

  const handleOpenAppSettings = useCallback(async () => {
    await openAppBatterySettings();
    setBatteryPromptOpen(false);
  }, []);

  if (!enabled || !isCapacitor()) {
    return null;
  }

  const actionButtonSx = (primary = false) => ({
    alignItems: 'center',
    backgroundColor: primary
      ? isLight
        ? alpha(theme.palette.primary.main, 0.12)
        : 'rgba(118,164,255,0.16)'
      : isLight
        ? alpha(theme.palette.text.primary, 0.05)
        : 'rgba(255,255,255,0.05)',
    border: `1px solid ${
      primary
        ? alpha(theme.palette.primary.main, 0.34)
        : isLight
          ? theme.palette.divider
          : 'rgba(255,255,255,0.1)'
    }`,
    borderRadius: '12px',
    boxSizing: 'border-box' as const,
    color: theme.palette.text.primary,
    display: 'flex',
    fontSize: '0.92rem',
    fontWeight: 700,
    justifyContent: 'center',
    lineHeight: 1.35,
    minHeight: 48,
    px: 2,
    py: 1.25,
    textAlign: 'center' as const,
    width: '100%',
  });

  const textButtonSx = {
    alignItems: 'center',
    borderRadius: '10px',
    color: theme.palette.text.secondary,
    display: 'flex',
    fontSize: '0.86rem',
    fontWeight: 600,
    justifyContent: 'center',
    lineHeight: 1.35,
    minHeight: 44,
    px: 1.5,
    py: 1,
    textAlign: 'center' as const,
    width: '100%',
  };

  return (
    <Dialog
      open={batteryPromptOpen}
      onClose={() => handleNotNow()}
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: getDialogPaperSx(theme, { maxWidth: 420, radius: 20 }),
      }}
    >
      <DialogContent sx={{ ...dialogContentSx, pt: 2.2 }}>
        <Typography
          sx={{
            fontSize: '1.05rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            mb: 1,
          }}
        >
          {t('auth:mobile_background.battery_title', {
            defaultValue: 'Keep Qortal Go reachable',
          })}
        </Typography>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.9rem',
            lineHeight: 1.55,
            mb: 1.4,
          }}
        >
          {t('auth:mobile_background.battery_body', {
            defaultValue:
              'To receive calls and messages reliably, disable battery restrictions for Qortal Go. On Android, turn off "Pause app activity if unused" and allow unrestricted battery use.',
          })}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85 }}>
          <ButtonBase
            onClick={() => void handleAllowUnrestricted()}
            sx={actionButtonSx(true)}
          >
            {t('auth:mobile_background.battery_allow', {
              defaultValue: 'Allow in background',
            })}
          </ButtonBase>
          <ButtonBase
            onClick={() => void handleOpenAppSettings()}
            sx={actionButtonSx(false)}
          >
            {t('auth:mobile_background.battery_settings', {
              defaultValue: 'Open settings',
            })}
          </ButtonBase>
          <ButtonBase onClick={handleNotNow} sx={actionButtonSx(false)}>
            {t('auth:mobile_background.battery_not_now', {
              defaultValue: 'Not now',
            })}
          </ButtonBase>
          <ButtonBase
            onClick={() => void handleNeverShowAgain()}
            sx={textButtonSx}
          >
            {t('auth:mobile_background.battery_never_again', {
              defaultValue: 'Never show this again',
            })}
          </ButtonBase>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default MobileBackgroundSetup;
