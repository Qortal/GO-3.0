import { useCallback, useEffect, useState, type ReactNode } from 'react';
import syncedImg from '../assets/syncStatus/synced.webp';
import syncedMintingImg from '../assets/syncStatus/synced_minting.webp';
import syncingImg from '../assets/syncStatus/syncing.webp';
import '../styles/CoreSyncStatus.css';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { manifestData } from './NotAuthenticated';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  nodeInfosAtom,
  p2pHealthAtom,
  selectedNodeInfoAtom,
} from '../atoms/global';
import { nodeDisplay } from '../utils/helpers';
import { computeP2pHealth, type P2pHealthLevel } from '../lib/p2pHealth';
import {
  getMobileReticulumStatus,
  onMobileReticulumStatus,
} from '../bridge/capacitorBridge';

export type { P2pHealthLevel };
import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../constants/constants';
import { getDialogInfoCardSx } from './App/dialogSurface';

type ReticulumStatusSnapshot = {
  onlineRemoteHubInterfaces?: number;
  p2pActiveOverlayPeers?: number;
};

const CoreInfoStatRow = ({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: ReactNode;
  valueColor?: string;
}) => {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';

  return (
    <Box
      sx={{
        alignItems: 'start',
        borderBottom: `1px solid ${
          isLight
            ? alpha(theme.palette.divider, 0.85)
            : alpha(theme.palette.common.white, 0.08)
        }`,
        columnGap: 2,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)',
        py: 1.25,
        '&:last-child': { borderBottom: 'none', pb: 0 },
        '&:first-of-type': { pt: 0 },
      }}
    >
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.8125rem',
          fontWeight: 500,
          lineHeight: 1.45,
          textAlign: 'left',
        }}
      >
        {label}
      </Typography>
      <Typography
        component="div"
        sx={{
          color: valueColor ?? theme.palette.primary.main,
          fontSize: '0.8125rem',
          fontWeight: 600,
          lineHeight: 1.45,
          textAlign: 'right',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
};

export const CoreSyncStatus = ({
  renderIcon,
  useExternalTooltip = false,
}: {
  renderIcon?: React.ReactNode;
  useExternalTooltip?: boolean;
}) => {
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const setSharedP2pHealth = useSetAtom(p2pHealthAtom);
  const [coreInfos, setCoreInfos] = useState({});
  const [p2pActiveOverlayPeers, setP2pActiveOverlayPeers] = useState<
    number | null
  >(null);
  const [connectedRemoteInterfaces, setConnectedRemoteInterfaces] = useState<
    number | null
  >(null);
  const [p2pHealth, setP2pHealth] = useState<P2pHealthLevel | null>(null);

  const nodeBase = selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK;
  const isUsingGateway = nodeBase?.includes('ext-node.qortal.link') ?? false;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();

  const applyReticulumStatus = useCallback(
    (status: ReticulumStatusSnapshot | null | undefined) => {
      const active =
        typeof status?.p2pActiveOverlayPeers === 'number'
          ? status.p2pActiveOverlayPeers
          : null;
      setP2pActiveOverlayPeers(active);
      setConnectedRemoteInterfaces(
        typeof status?.onlineRemoteHubInterfaces === 'number'
          ? status.onlineRemoteHubInterfaces
          : null
      );
      if (!status) {
        setP2pHealth(null);
        setSharedP2pHealth('unknown');
        return;
      }
      const hubs = status.onlineRemoteHubInterfaces ?? 0;
      const nextP2pHealth = computeP2pHealth({
        onlineRemoteHubInterfaces: hubs,
        p2pActiveOverlayPeers: status.p2pActiveOverlayPeers ?? 0,
      });
      setP2pHealth(nextP2pHealth);
      setSharedP2pHealth(nextP2pHealth);
    },
    [setSharedP2pHealth]
  );

  useEffect(() => {
    let canceled = false;
    const getCoreInfos = async () => {
      try {
        const url = `${nodeBase}/admin/info`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await response.json();
        if (!canceled) {
          setCoreInfos(data);
        }
      } catch (error) {
        console.error('Request failed', error);
        if (!canceled) {
          setCoreInfos({});
        }
      }
    };

    setCoreInfos({});
    getCoreInfos();

    const interval = setInterval(getCoreInfos, 30000);

    return () => {
      canceled = true;
      clearInterval(interval);
    };
  }, [nodeBase]);

  useEffect(() => {
    let canceled = false;
    const api = window.electronAPI as any;
    if (typeof api?.reticulumGetStatus !== 'function') {
      // Mobile (Capacitor): the native Reticulum presence bridge publishes the
      // same {onlineRemoteHubInterfaces, p2pActiveOverlayPeers} snapshot. Use it
      // so the core P2P-health indicator (and the voice-call gate) reflect the
      // real overlay state instead of staying 'unknown'.
      const snapshot = getMobileReticulumStatus();
      if (snapshot) applyReticulumStatus(snapshot);
      const unsub = onMobileReticulumStatus((s) => {
        if (!canceled) applyReticulumStatus(s);
      });
      return () => {
        canceled = true;
        unsub();
      };
    }

    void api
      .reticulumGetStatus()
      .then((status) => {
        if (!canceled) applyReticulumStatus(status);
      })
      .catch(() => {
        if (!canceled) applyReticulumStatus(null);
      });

    const unsubscribe =
      typeof api.onReticulumStatus === 'function'
        ? api.onReticulumStatus((status) => {
            if (!canceled) applyReticulumStatus(status);
          })
        : undefined;

    const reconciliationInterval = window.setInterval(() => {
      void api
        .reticulumGetStatus?.()
        .then((status) => {
          if (!canceled) applyReticulumStatus(status);
        })
        .catch(() => {
          if (!canceled) applyReticulumStatus(null);
        });
    }, 120000);

    return () => {
      canceled = true;
      unsubscribe?.();
      window.clearInterval(reconciliationInterval);
    };
  }, [applyReticulumStatus]);

  const renderSyncStatusIcon = () => {
    const {
      isSynchronizing = false,
      syncPercent = 0,
      isMintingPossible = false,
      height = 0,
      numberOfConnections = 0,
      numberOfDataConnections = 0,
    } = nodeInfos;
    const buildVersion = coreInfos?.buildVersion
      ? coreInfos?.buildVersion.substring(0, 20)
      : '';

    let imagePath = syncingImg;
    let message: string = '';

    if (isUsingGateway) {
      if (isSynchronizing && syncPercent !== 100) {
        imagePath = syncingImg;
        message = `${t(`core:minting.status.synchronizing`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.not_minting')}`;
      } else {
        imagePath = syncedImg;
        message = `${t(`core:minting.status.synchronized`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.not_minting')}`;
      }
    } else if (isMintingPossible) {
      if (isSynchronizing && syncPercent !== 100) {
        imagePath = syncingImg;
        message = `${t(`core:minting.status.synchronizing`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.minting')}`;
      } else {
        imagePath = syncedMintingImg;
        message = `${t(`core:minting.status.synchronized`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.minting')}`;
      }
    } else if (!isMintingPossible) {
      if (syncPercent == 100) {
        imagePath = syncedImg;
        message = `${t(`core:minting.status.synchronized`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.not_minting')}`;
      } else {
        imagePath = syncingImg;
        message = `${t(`core:minting.status.synchronizing`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.not_minting')}`;
      }
    }

    const iconNode = renderIcon || (
      <img
        src={imagePath}
        style={{ height: 'auto', width: '35px' }}
        alt="sync status"
      />
    );

    const p2pHealthColor =
      p2pHealth === 'bad'
        ? theme.palette.error.main
        : p2pHealth === 'low'
          ? theme.palette.warning.main
          : theme.palette.success.main;

    const mobilePanelNode = (
      <Box sx={{ width: '100%' }}>
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.9375rem',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            mb: 1.25,
            textAlign: 'left',
          }}
        >
          {t('core:core.information', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
        <Box sx={getDialogInfoCardSx(theme)}>
          <CoreInfoStatRow
            label={t('core:core.version', { postProcess: 'capitalizeFirstChar' })}
            value={buildVersion || '—'}
          />
          <CoreInfoStatRow
            label={t('core:minting.sync_status', { defaultValue: 'Sync status' })}
            value={message || '—'}
          />
          <CoreInfoStatRow
            label={t('core:core.block_height', {
              postProcess: 'capitalizeFirstChar',
            })}
            value={height ? String(height) : '—'}
          />
          <CoreInfoStatRow
            label={t('core:core.peers', { postProcess: 'capitalizeFirstChar' })}
            value={
              numberOfConnections != null ? String(numberOfConnections) : '—'
            }
          />
          <CoreInfoStatRow
            label={t('core:core.data_peers', {
              postProcess: 'capitalizeFirstChar',
            })}
            value={
              numberOfDataConnections != null
                ? String(numberOfDataConnections)
                : '—'
            }
          />
          {connectedRemoteInterfaces !== null && (
            <CoreInfoStatRow
              label={t('core:core.connected_remote_interfaces', {
                postProcess: 'capitalizeFirstChar',
              })}
              value={String(connectedRemoteInterfaces)}
            />
          )}
          {p2pActiveOverlayPeers !== null && (
            <CoreInfoStatRow
              label={t('core:core.p2p_active_overlay_peers', {
                postProcess: 'capitalizeFirstChar',
              })}
              value={String(p2pActiveOverlayPeers)}
            />
          )}
          {p2pHealth !== null && (
            <CoreInfoStatRow
              label={t('core:core.p2p_health', {
                postProcess: 'capitalizeFirstChar',
              })}
              value={t(`core:core.p2p_health_${p2pHealth}`, {
                postProcess: 'capitalizeFirstChar',
              })}
              valueColor={p2pHealthColor}
            />
          )}
          <CoreInfoStatRow
            label={t('auth:node.using', { postProcess: 'capitalizeFirstChar' })}
            value={nodeDisplay(nodeBase)}
            valueColor={
              isLocalNodeUrl(nodeBase)
                ? theme.palette.other.positive
                : theme.palette.primary.main
            }
          />
          <CoreInfoStatRow
            label={t('core:ui.version', { postProcess: 'capitalizeFirstChar' })}
            value={manifestData.version || '—'}
          />
        </Box>
      </Box>
    );

    const panelNode = (
      <Box
        className="core-panel"
        style={{
          right: 'unset',
          left: 'calc(100% + 16px)',
          top: '0px',
        }}
      >
        <h3>
          {t('core:core.information', { postProcess: 'capitalizeFirstChar' })}
        </h3>

        <h4 className="lineHeight">
          {t('core:core.version', { postProcess: 'capitalizeFirstChar' })}:{' '}
          <span style={{ color: theme.palette.primary.main }}>{buildVersion}</span>
        </h4>

        <h4 className="lineHeight">{message}</h4>

        <h4 className="lineHeight">
          {t('core:core.block_height', {
            postProcess: 'capitalizeFirstChar',
          })}
          : <span style={{ color: theme.palette.primary.main }}>{height || ''}</span>
        </h4>

        <h4 className="lineHeight">
          {t('core:core.peers', { postProcess: 'capitalizeFirstChar' })}:{' '}
          <span style={{ color: theme.palette.primary.main }}>{numberOfConnections || ''}</span>
        </h4>

        <h4 className="lineHeight">
          {t('core:core.data_peers', { postProcess: 'capitalizeFirstChar' })}:{' '}
          <span style={{ color: theme.palette.primary.main }}>
            {numberOfDataConnections || ''}
          </span>
        </h4>

        {connectedRemoteInterfaces !== null && (
          <h4 className="lineHeight">
            {t('core:core.connected_remote_interfaces', {
              postProcess: 'capitalizeFirstChar',
            })}
            :{' '}
            <span style={{ color: theme.palette.primary.main }}>
              {connectedRemoteInterfaces}
            </span>
          </h4>
        )}

        {p2pActiveOverlayPeers !== null && (
          <h4 className="lineHeight">
            {t('core:core.p2p_active_overlay_peers', {
              postProcess: 'capitalizeFirstChar',
            })}
            : <span style={{ color: theme.palette.primary.main }}>{p2pActiveOverlayPeers}</span>
          </h4>
        )}

        {p2pHealth !== null && (
          <h4 className="lineHeight">
            {t('core:core.p2p_health', { postProcess: 'capitalizeFirstChar' })}:{' '}
            <span
              style={{
                color:
                  p2pHealth === 'bad'
                    ? theme.palette.error.main
                    : p2pHealth === 'low'
                      ? theme.palette.warning.main
                      : theme.palette.success.main,
                fontWeight: 600,
              }}
            >
              {t(`core:core.p2p_health_${p2pHealth}`, {
                postProcess: 'capitalizeFirstChar',
              })}
            </span>
          </h4>
        )}

        <h4 className="lineHeight">
          {t('auth:node.using', {
            postProcess: 'capitalizeFirstChar',
          })}
          :{' '}
          <span
            style={{
              color: theme.palette.primary.main,
              ...(isLocalNodeUrl(nodeBase) && {
                fontWeight: 'bold',
                color: theme.palette.other.positive,
              }),
            }}
          >
            {nodeDisplay(nodeBase)}
          </span>
        </h4>

        <h4 className="lineHeight">
          {t('core:ui.version', { postProcess: 'capitalizeFirstChar' })}:{' '}
          <span style={{ color: theme.palette.primary.main }}>{manifestData.version}</span>
        </h4>
      </Box>
    );

    if (useExternalTooltip) {
      return (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            width: '100%',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>{iconNode}</Box>
          {mobilePanelNode}
        </Box>
      );
    }

    return (
      <Box
        className="tooltip"
        data-theme={theme.palette.mode}
        style={{ display: 'inline' }}
      >
        <span>{iconNode}</span>
        {panelNode}
      </Box>
    );
  };

  return <Box id="core-sync-status-id">{renderSyncStatusIcon()}</Box>;
};
