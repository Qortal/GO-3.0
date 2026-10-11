import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import SettingsIcon from '@mui/icons-material/Settings';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import ClearAllRoundedIcon from '@mui/icons-material/ClearAllRounded';
import {
  Box,
  ButtonBase,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  MenuItem,
  Popover,
  Switch,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  customWebsocketSubscriptionsAtom,
  getNotificationPanelDismissKey,
  isNotificationPanelDismissed,
  isNotificationSeenInAppFromKeyTimes,
  lastPaymentSeenTimestampAtom,
  notificationPanelDismissalsAtom,
  notificationSeenInAppKeyTimesAtom,
  notificationSeenInAppKeysAtom,
  paymentNotificationsAtom,
  reticulumChatEnabledAtom,
  reticulumEnabledAtom,
  userInfoAtom,
} from '../atoms/global';
import { revokeAppNotificationRules } from '../qortal/get';
import LogoSelected from '../assets/svgs/LogoSelected.svg';
import {
  QdnDownloadsNotice,
  useQdnDownloadsBadge,
} from './Transfers/QdnDownloadsNotice';
import {
  hideSavedQdnFilesFromPanel,
  markSavedQdnFilesSeen,
} from '../utils/qdnDownloadNotifications';
import { recordNotificationHistory } from '../utils/notificationHistory';
import { openQWalletsTab } from '../utils/openQWalletsTab';
import {
  formatPaymentAmount,
  isPaymentNotification,
  paymentSenderLabel,
} from '../utils/paymentNotifications';
import { DragToClosePanel } from './Notifications/DragToClosePanel';
import {
  NotificationAppIdentity,
  RegisteredNameText,
} from './Notifications/NotificationAppIdentity';
import { NotificationHistoryDialog } from './Notifications/NotificationHistoryDialog';
import {
  getAppsWithNotificationPermission,
  getNotificationOsPushDisabledMap,
  getNotificationPermissionKey,
  setNotificationOsPushDisabled,
  setPermission,
} from '../qortal/qortal-requests';
import { extractComponents } from './Chat/MessageDisplay';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';
import { formatDate } from '../utils/time';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../utils/mobileSafeArea';
import { useSheetFullScreen } from '../layout/goLayout';

export type GeneralNotificationsHandle = {
  open: () => void;
};
import {
  getQChatMentionNotificationsEnabled,
  QCHAT_MENTION_NOTIFICATION_APP_NAME,
  QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
  setQChatMentionNotificationsEnabled,
} from '../utils/qChatMentionNotifications';
import { ReticulumUnreadCountBadge } from './common/ReticulumUnreadCountBadge';
import { SwipeToDismiss } from './common/SwipeToDismiss';
import { NotificationAppAvatar } from './Notifications/NotificationAppAvatar';
import { MobileBackgroundSyncSetting } from './Mobile/MobileBackgroundSyncSetting';
import { BackgroundStopNotice } from './Mobile/BackgroundStopNotice';
import {
  useVendorFreezeBellBadge,
  useVendorFreezeHint,
  vendorFreezeHintActions,
} from './Mobile/vendorFreezeHintStore';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';

const RESOURCE_EVENT = 'RESOURCE_PUBLISHED';

const isQChatMentionNotification = (notification) =>
  notification?.appName === QCHAT_MENTION_NOTIFICATION_APP_NAME &&
  notification?.data?.qChatMention === true;

const isReticulumDmMissedCallNotification = (notification) =>
  notification?.data?.reticulumDmMissedCall === true;

const isReticulumCalendarNotification = (notification) =>
  notification?.data?.reticulumCalendarReminder === true;

function toTimestampMs(value) {
  if (value == null || typeof value !== 'number') return null;
  return value < 1e12 ? value * 1000 : value;
}

function getNotificationTimestamp(notification) {
  return toTimestampMs(
    notification?.data?.created ??
      notification?.data?.timestamp ??
      notification?.timestamp
  );
}

function getNotificationMessage(messageObj, currentLang, fallback) {
  if (!messageObj || typeof messageObj !== 'object') return fallback;
  const lang = (currentLang || 'en').split('-')[0];
  return (
    messageObj[lang]?.trim() ||
    messageObj.en?.trim() ||
    Object.values(messageObj).find((value: any) => value?.trim()) ||
    fallback
  );
}

export const GeneralNotifications = forwardRef<
  GeneralNotificationsHandle,
  {
    tooltipPlacement?: 'left' | 'bottom' | 'right' | 'top';
    compact?: boolean;
    buttonSx?: object;
    iconSx?: object;
    hideTrigger?: boolean;
    badgeOutlineColor?: string;
  }
>(function GeneralNotifications(
  {
    tooltipPlacement = 'left',
    compact = false,
    buttonSx = undefined,
    iconSx = undefined,
    hideTrigger = false,
    badgeOutlineColor = undefined,
  },
  ref
) {
  const triggerRef = useRef<HTMLElement>(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'hub' | 'q-apps'>(
    'hub'
  );
  const [settingsApps, setSettingsApps] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [osPushDisabledMap, setOsPushDisabledMap] = useState<
    Record<string, boolean>
  >({});
  const [disablePushNotifications, setDisablePushNotifications] =
    useState(false);
  const [qChatMentionsEnabled, setQChatMentionsEnabled] = useState(true);
  const [syncEngineReady, setSyncEngineReady] = useState(false);
  const [syncPeers, setSyncPeers] = useState<
    Array<{ peerHash: string; supported: boolean; support?: string }>
  >([]);
  const reticulumEnabled = useAtomValue(reticulumEnabledAtom);
  const reticulumChatEnabled = useAtomValue(reticulumChatEnabledAtom);
  const myAddress = useAtomValue(userInfoAtom)?.address as string | undefined;
  const notifications = useAtomValue(paymentNotificationsAtom);
  const setNotifications = useSetAtom(paymentNotificationsAtom);
  const customSubscriptions = useAtomValue(customWebsocketSubscriptionsAtom);
  const setCustomSubscriptions = useSetAtom(customWebsocketSubscriptionsAtom);
  const lastSeenTimestamp = useAtomValue(lastPaymentSeenTimestampAtom);
  const setLastSeenTimestamp = useSetAtom(lastPaymentSeenTimestampAtom);
  const seenInAppKeyTimes = useAtomValue(notificationSeenInAppKeyTimesAtom);
  const setSeenKeys = useSetAtom(notificationSeenInAppKeysAtom);
  const [panelDismissals, updatePanelDismissals] = useAtom(
    notificationPanelDismissalsAtom
  );
  // "GO was stopped in the background" (native Android only): a card at the
  // top of the panel and +1 on the badge until one of its actions is used.
  // Opening the panel alone does not count as seeing it.
  const vendorFreezeCardShown = useVendorFreezeHint().bell != null;
  const vendorFreezeBadge = useVendorFreezeBellBadge();
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  // Phones (and short GO windows) get the settings full screen, like GO's
  // other settings screens.
  const isNarrowSettings = useSheetFullScreen();
  const { t, i18n } = useTranslation(['core', 'group']);

  useEffect(() => {
    const handler = (event: CustomEvent<{ enabled?: boolean }>) => {
      setQChatMentionsEnabled(event.detail?.enabled === true);
    };
    subscribeToEvent(
      QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
      handler as EventListener
    );
    return () =>
      unsubscribeFromEvent(
        QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
        handler as EventListener
      );
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail;
      if (!detail?.address) return;
      // Prefer the real mark times (needed for seen keys synced from another
      // device); fall back to the legacy keys-only payload.
      if (detail?.keyTimes && typeof detail.keyTimes === 'object') {
        setSeenKeys({ address: detail.address, keyTimes: detail.keyTimes });
      } else if (Array.isArray(detail?.keys)) {
        setSeenKeys({ address: detail.address, keys: detail.keys });
      }
    };
    subscribeToEvent('notification-seen-in-app-updated', handler);
    return () =>
      unsubscribeFromEvent('notification-seen-in-app-updated', handler);
  }, [setSeenKeys]);

  const resourceNotifications = useMemo(
    () =>
      (notifications ?? []).filter(
        (item) =>
          (item?.event === RESOURCE_EVENT ||
            isPaymentNotification(item) ||
            (reticulumEnabled &&
              (isQChatMentionNotification(item) ||
                isReticulumDmMissedCallNotification(item) ||
                isReticulumCalendarNotification(item)))) &&
          !isNotificationPanelDismissed(item, panelDismissals)
      ),
    [notifications, panelDismissals, reticulumEnabled]
  );
  // Everything that reaches the panel is also kept in the history, including
  // what is later swiped away or read.
  useEffect(() => {
    recordNotificationHistory(
      myAddress,
      (notifications ?? []).filter(
        (item) =>
          item?.event === RESOURCE_EVENT ||
          isPaymentNotification(item) ||
          (reticulumEnabled &&
            (isQChatMentionNotification(item) ||
              isReticulumDmMissedCallNotification(item) ||
              isReticulumCalendarNotification(item)))
      )
    );
  }, [notifications, myAddress, reticulumEnabled]);

  const dismissNotification = (notification) => {
    const key = getNotificationPanelDismissKey(notification);
    if (!key) {
      setNotifications((current) =>
        current.filter((item) => item !== notification)
      );
      return;
    }
    updatePanelDismissals({
      type: 'dismiss',
      key,
      mentionCount: isQChatMentionNotification(notification)
        ? Math.max(0, Number(notification?.data?.mentionCount) || 0)
        : undefined,
    });
  };
  /**
   * Clear all: every card leaves the panel the way a swipe takes it, so all of
   * it stays in the notification history. Running downloads stay put.
   */
  const clearAllNotifications = () => {
    const items: Array<{ key: string; mentionCount?: number }> = [];
    const keyless = new Set<unknown>();
    for (const notification of resourceNotifications) {
      const key = getNotificationPanelDismissKey(notification);
      if (!key) {
        keyless.add(notification);
        continue;
      }
      items.push({
        key,
        mentionCount: isQChatMentionNotification(notification)
          ? Math.max(0, Number(notification?.data?.mentionCount) || 0)
          : undefined,
      });
    }
    updatePanelDismissals({ type: 'dismissMany', items });
    if (keyless.size) {
      setNotifications((current) =>
        current.filter((item) => !keyless.has(item))
      );
    }
    hideSavedQdnFilesFromPanel();
    // The "GO was stopped" card goes too (X), like every other card.
    if (vendorFreezeCardShown) void vendorFreezeHintActions.closeCard();
    setLastSeenTimestamp(Date.now());
  };
  const unseenCount = useMemo(() => {
    return resourceNotifications.reduce((count, notification) => {
      const timestamp = getNotificationTimestamp(notification);
      if (timestamp == null) return count;
      if (isNotificationSeenInAppFromKeyTimes(notification, seenInAppKeyTimes))
        return count;
      if (lastSeenTimestamp && timestamp <= lastSeenTimestamp) return count;
      return (
        count +
        (isQChatMentionNotification(notification)
          ? Math.max(1, Number(notification?.data?.mentionCount) || 1)
          : 1)
      );
    }, 0);
  }, [resourceNotifications, seenInAppKeyTimes, lastSeenTimestamp]);
  // Downloads (running, or saved and not yet seen) sit at the top of the
  // list and count towards the badge like any other unread thing. App updates
  // have their own screen (GO 3.0 Updates), not a card here.
  const downloadsBadge = useQdnDownloadsBadge();
  const totalUnseenCount =
    unseenCount + downloadsBadge.unseen + vendorFreezeBadge;
  const hasAnyNotifications =
    resourceNotifications.length > 0 ||
    downloadsBadge.hasAny ||
    vendorFreezeCardShown;
  const canClearAll =
    resourceNotifications.length > 0 ||
    downloadsBadge.clearable > 0 ||
    vendorFreezeCardShown;

  const hasNewNotifications = totalUnseenCount > 0;
  const notificationsLabel = t('message.generic.notifications', {
    defaultValue: 'Notifications',
  });
  const notificationsAriaLabel = hasNewNotifications
    ? `${notificationsLabel}, ${totalUnseenCount} unread`
    : `${notificationsLabel}, no unread notifications`;
  const NotificationIcon = hasNewNotifications
    ? NotificationsActiveRoundedIcon
    : NotificationsRoundedIcon;

  const closePanel = () => {
    if (hasNewNotifications) setLastSeenTimestamp(Date.now());
    setAnchorEl(null);
  };

  const describeNotification = (notification) =>
    isPaymentNotification(notification)
      ? t('core:message.generic.new_payment_body', {
          amount: formatPaymentAmount(
            notification?.data?.amount ?? 0,
            i18n.language
          ),
        })
      : getNotificationMessage(
          notification?.message,
          i18n.language,
          t('message.generic.new_notification', {
            defaultValue: 'New notification',
          })
        );

  /** What tapping an item does, in the panel and in the history alike. */
  const openNotification = (notification) => {
    if (isQChatMentionNotification(notification)) {
      setNotifications((current) =>
        current.filter(
          (item) =>
            !(
              isQChatMentionNotification(item) &&
              Number(item?.data?.groupId) ===
                Number(notification?.data?.groupId)
            )
        )
      );
      setAnchorEl(null);
      executeEvent('openGroupMessage', {
        channelId: notification?.data?.channelId,
        eventId: notification?.data?.eventId,
        from: notification?.data?.groupId,
      });
      return;
    }
    if (isReticulumDmMissedCallNotification(notification)) {
      setNotifications((current) =>
        current.filter(
          (item) =>
            item?.data?.reticulumDmCallId !==
            notification?.data?.reticulumDmCallId
        )
      );
      setAnchorEl(null);
      executeEvent('openDirectMessageInternal', {
        address: notification?.data?.from,
        name: notification?.data?.name,
      });
      return;
    }
    if (isReticulumCalendarNotification(notification)) {
      setNotifications((current) =>
        current.filter(
          (item) => item?.notificationId !== notification?.notificationId
        )
      );
      setAnchorEl(null);
      executeEvent('openGroupMessage', {
        from: notification?.data?.groupId,
        eventId: notification?.data?.eventId,
        occurrenceStart: notification?.data?.occurrenceStart,
        timezone: notification?.data?.timezone,
        openCalendar: true,
      });
      return;
    }
    if (hasNewNotifications) setLastSeenTimestamp(Date.now());
    setAnchorEl(null);
    if (isPaymentNotification(notification)) {
      openQWalletsTab();
      return;
    }
    const link = notification?.link;
    if (!link) return;
    const data = extractComponents(link);
    if (!data) return;
    executeEvent('addTab', {
      data: { ...data, navigateIfAlreadyOpen: true },
    });
    executeEvent('open-apps-mode', {});
  };

  useImperativeHandle(ref, () => ({
    open: () => {
      if (triggerRef.current) setAnchorEl(triggerRef.current);
    },
  }));

  useEffect(() => {
    window
      .sendMessage?.('getUserSettings', {
        key: 'disable-push-notifications',
      })
      .then((response) => {
        if (!response?.error) {
          setDisablePushNotifications(Boolean(response));
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const handleDisablePushChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const next = event.target.checked;
    setDisablePushNotifications(next);
    window
      .sendMessage?.('addUserSettings', {
        keyValue: {
          key: 'disable-push-notifications',
          value: next,
        },
      })
      .catch((error) => {
        console.error(
          'Failed to update push notification setting:',
          error?.message || error
        );
      });
  };

  const loadSettings = () =>
    Promise.all([
      getAppsWithNotificationPermission(),
      getNotificationOsPushDisabledMap(),
      getQChatMentionNotificationsEnabled(),
    ]).then(([apps, disabledMap, mentionsEnabled]) => {
      setSettingsApps(
        apps.filter(
          (appName) => appName !== QCHAT_MENTION_NOTIFICATION_APP_NAME
        )
      );
      setOsPushDisabledMap(disabledMap || {});
      setQChatMentionsEnabled(mentionsEnabled);
    });

  const openSettings = () => {
    setSettingsSection('hub');
    setSettingsOpen(true);
    setSettingsLoading(true);
    loadSettings()
      .catch(() => undefined)
      .finally(() => setSettingsLoading(false));
  };

  // While the dialog is open, changes that arrive from another device (or
  // from a Q-app in another tab) refresh the lists without reopening.
  useEffect(() => {
    if (!settingsOpen) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        loadSettings().catch(() => undefined);
      }, 100);
    };
    const events = [
      'notification-permission-updated',
      'notification-os-push-updated',
      QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
      'notification-settings-changed',
    ];
    events.forEach((name) => subscribeToEvent(name, handler));
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((name) => unsubscribeFromEvent(name, handler));
    };
  }, [settingsOpen]);

  // Cross-device sync status (engine readiness + own devices), refreshed
  // every 10 s while the dialog is open.
  useEffect(() => {
    if (!settingsOpen || !reticulumChatEnabled) {
      setSyncEngineReady(false);
      setSyncPeers([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const engine = (
        window as unknown as {
          reticulumChat?: {
            getReadinessStatus?: () => Promise<{ state?: string }>;
            getDeviceStateSyncPeers?: (
              ownerAddress: string
            ) => Promise<
              Array<{ peerHash: string; supported: boolean; support?: string }>
            >;
          };
        }
      ).reticulumChat;
      let ready = false;
      try {
        const status = await engine?.getReadinessStatus?.();
        ready = status?.state === 'ready';
      } catch {
        ready = false;
      }
      let peers: Array<{
        peerHash: string;
        supported: boolean;
        support?: string;
      }> = [];
      if (ready && myAddress) {
        try {
          const result = await engine?.getDeviceStateSyncPeers?.(myAddress);
          peers = Array.isArray(result) ? result : [];
        } catch {
          peers = [];
        }
      }
      if (cancelled) return;
      setSyncEngineReady(ready);
      setSyncPeers(peers);
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [settingsOpen, reticulumChatEnabled, myAddress]);

  const syncSupportedCount = syncPeers.filter((peer) => peer?.supported).length;
  // A leased own device whose hello has not been seen yet in this process
  // (normal right after a restart) reports `support: 'unknown'`; only a peer
  // that greeted us WITHOUT ds1 is reported as outdated.
  const syncUnsupportedCount = syncPeers.filter(
    (peer) => peer && !peer.supported && peer.support === 'unsupported'
  ).length;
  const syncStatusText = !reticulumChatEnabled
    ? t('core:message.generic.notification_sync_status_off')
    : !syncEngineReady
      ? t('core:message.generic.notification_sync_status_waiting')
      : syncSupportedCount > 0
        ? t('core:message.generic.notification_sync_status_linked', {
            count: syncSupportedCount,
          })
        : syncUnsupportedCount > 0
          ? t('core:message.generic.notification_sync_status_unsupported')
          : t('core:message.generic.notification_sync_status_no_peer');

  return (
    <>
      <Box
        component="span"
        ref={triggerRef}
        sx={{
          display: 'inline-flex',
          overflow: 'visible',
          position: 'relative',
          ...(hideTrigger
            ? {
                opacity: 0,
                overflow: 'hidden',
                pointerEvents: 'none',
              }
            : {}),
        }}
      >
        <ButtonBase
          aria-label={notificationsAriaLabel}
          onClick={(event) => {
            event.stopPropagation();
            setAnchorEl(event.currentTarget);
            markSavedQdnFilesSeen();
          }}
          sx={{
            ...(buttonSx || {}),
          }}
        >
          <Tooltip
            arrow
            placement={tooltipPlacement}
            title={
              <span
                style={{
                  color: theme.palette.text.primary,
                  fontSize: '14px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                {notificationsLabel}
              </span>
            }
            slotProps={{
              arrow: { sx: { color: theme.palette.background.paper } },
              tooltip: {
                sx: {
                  backgroundColor: theme.palette.background.paper,
                  color: theme.palette.text.primary,
                },
              },
            }}
          >
            <NotificationsRoundedIcon
              sx={{
                color: theme.palette.text.secondary,
                fontSize: compact ? 20 : undefined,
                ...(iconSx || {}),
              }}
            />
          </Tooltip>
        </ButtonBase>
        {hasNewNotifications && (
          <ReticulumUnreadCountBadge
            count={totalUnseenCount}
            fontSize={9}
            outlineColor={badgeOutlineColor || theme.palette.background.surface}
            size={15}
            sx={{
              position: 'absolute',
              right: -5,
              top: -4,
              zIndex: 2,
            }}
          />
        )}
      </Box>

      <Popover
        anchorEl={anchorEl}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        onClose={closePanel}
        open={!!anchorEl}
        slotProps={{
          // The panel below draws itself so it can be dragged up and away;
          // the popover paper is only its frame.
          paper: {
            sx: {
              background: 'none',
              backgroundImage: 'none',
              boxShadow: 'none',
              mt: 1,
              overflow: 'visible',
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        <DragToClosePanel
          handleLabel={t('core:notification_history.drag_to_close')}
          onClose={closePanel}
          sx={
            isDarkMode
              ? {
                  background: '#111820',
                  border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
                  borderRadius: '16px',
                  boxShadow: `0 22px 46px ${alpha('#000', 0.44)}`,
                  overflow: 'hidden',
                }
              : {
                  background: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '16px',
                  boxShadow: `0 16px 40px ${alpha('#1E3248', 0.1)}`,
                  overflow: 'hidden',
                }
          }
          header={
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 0.25,
                justifyContent: 'flex-end',
                minHeight: 40,
                pr: 0.5,
                pt: 0.5,
              }}
            >
              <ButtonBase
                onClick={(event) => {
                  event.stopPropagation();
                  setHistoryOpen(true);
                  setAnchorEl(null);
                }}
                sx={{
                  borderRadius: 999,
                  color: theme.palette.text.secondary,
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  gap: 0.5,
                  px: 1,
                  py: 0.5,
                }}
              >
                <HistoryRoundedIcon sx={{ fontSize: 17 }} />
                {t('core:notification_history.open')}
              </ButtonBase>
              {canClearAll && (
                <ButtonBase
                  aria-label={t('core:notification_history.clear_all_hint')}
                  onClick={(event) => {
                    event.stopPropagation();
                    clearAllNotifications();
                  }}
                  sx={{
                    borderRadius: 999,
                    color: theme.palette.text.secondary,
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    gap: 0.5,
                    px: 1,
                    py: 0.5,
                  }}
                >
                  <ClearAllRoundedIcon sx={{ fontSize: 17 }} />
                  {t('core:notification_history.clear_all')}
                </ButtonBase>
              )}
              <IconButton
                aria-label="Notification settings"
                onClick={(event) => {
                  event.stopPropagation();
                  openSettings();
                }}
                size="small"
                sx={{ color: theme.palette.text.secondary }}
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Box>
          }
        >
          <Box
            sx={{
              alignItems: hasAnyNotifications ? 'stretch' : 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: hasAnyNotifications ? 1 : 1.2,
              maxHeight: '60vh',
              // Hidden on x so a row swiped sideways never adds a scrollbar.
              overflowX: 'hidden',
              overflowY: 'auto',
              ...(hasAnyNotifications
                ? { pb: 0.5, pl: 1, pr: 1, pt: 0.5 }
                : { p: '4px 20px 12px' }),
              position: 'relative',
              width: 360,
            }}
          >
            <BackgroundStopNotice variant="bell" />

            <Box
              sx={{
                alignItems: 'center',
                border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                borderRadius: '12px',
                display: 'flex',
                gap: 1,
                justifyContent: 'space-between',
                mt:
                  resourceNotifications.length || vendorFreezeCardShown
                    ? 0
                    : 1.5,
                px: 1.25,
                py: 0.75,
                width: '100%',
              }}
            >
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  lineHeight: 1.3,
                  pr: 1,
                }}
              >
                {t('group:action.disable_push_notifications', {
                  ns: 'group',
                  defaultValue: 'Disable push notifications',
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Switch
                checked={disablePushNotifications}
                onChange={handleDisablePushChange}
                size="small"
                onClick={(event) => event.stopPropagation()}
              />
            </Box>

            <QdnDownloadsNotice onClose={() => setAnchorEl(null)} />

            {!hasAnyNotifications && (
              <>
                <NotificationsRoundedIcon
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.82),
                    fontSize: 22,
                    mt: 2,
                  }}
                />
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '0.96rem',
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  {t('message.generic.no_app_notifications', {
                    defaultValue: 'No app notifications yet',
                  })}
                </Typography>
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.76),
                    fontSize: '0.78rem',
                    lineHeight: 1.5,
                    maxWidth: 250,
                    textAlign: 'center',
                  }}
                >
                  {t('message.generic.app_notifications_hint', {
                    defaultValue: 'Q-App notifications will appear here',
                  })}
                </Typography>
              </>
            )}

            <AnimatePresence initial={false}>
              {resourceNotifications.map((notification, index) => {
                const isQMail =
                  notification?.notificationId === 'q-mail-notification' ||
                  notification?.appName === 'Q-Mail';
                const isQChatMention = isQChatMentionNotification(notification);
                const isPayment = isPaymentNotification(notification);
                const timestamp = getNotificationTimestamp(notification);
                const unseen =
                  timestamp != null &&
                  (!lastSeenTimestamp || timestamp > lastSeenTimestamp) &&
                  !isNotificationSeenInAppFromKeyTimes(
                    notification,
                    seenInAppKeyTimes
                  );

                return (
                  <SwipeToDismiss
                    gapPx={8}
                    key={
                      getNotificationPanelDismissKey(notification) ||
                      notification?.data?.identifier ||
                      notification?.data?.created ||
                      index
                    }
                    onDismiss={() => dismissNotification(notification)}
                  >
                    <MenuItem
                      onClick={() => openNotification(notification)}
                      sx={{
                        borderRadius: '12px',
                        display: 'block',
                        p: 0,
                        whiteSpace: 'normal',
                        '&:hover': {
                          bgcolor: isDarkMode
                            ? alpha('#FFFFFF', 0.045)
                            : alpha(theme.palette.primary.main, 0.06),
                        },
                      }}
                    >
                      <Card
                        elevation={0}
                        sx={{
                          bgcolor: unseen
                            ? isDarkMode
                              ? alpha(theme.palette.other.unread, 0.11)
                              : alpha(theme.palette.other.unread, 0.12)
                            : isDarkMode
                              ? alpha('#FFFFFF', 0.025)
                              : theme.palette.action.hover,
                          border: `1px solid ${
                            unseen
                              ? alpha(theme.palette.other.unread, 0.36)
                              : isDarkMode
                                ? alpha('#A9BCD8', 0.12)
                                : alpha(theme.palette.divider, 0.95)
                          }`,
                          borderRadius: '12px',
                          display: 'flex',
                          gap: 1.2,
                          p: 1.35,
                        }}
                      >
                        <NotificationAppAvatar
                          alt={
                            isQChatMention
                              ? notification?.data?.groupName
                              : isPayment
                                ? paymentSenderLabel(notification)
                                : notification?.appName || 'App'
                          }
                          isQChatMention={isQChatMention}
                          isQMail={isQMail}
                          notification={notification}
                          sx={{
                            bgcolor: isDarkMode
                              ? alpha('#FFFFFF', 0.06)
                              : alpha(theme.palette.primary.main, 0.08),
                            height: 34,
                            width: 34,
                            '& img': { objectFit: 'contain' },
                          }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Box
                            sx={{
                              alignItems: 'center',
                              display: 'flex',
                              gap: 1,
                              justifyContent: 'space-between',
                            }}
                          >
                            <Typography
                              sx={{
                                color: theme.palette.text.primary,
                                fontSize: '0.86rem',
                                fontWeight: 650,
                              }}
                            >
                              {isQChatMention ? (
                                notification?.data?.groupName
                              ) : isPayment ? (
                                paymentSenderLabel(notification)
                              ) : (
                                <RegisteredNameText
                                  name={notification?.appName || 'Q-App'}
                                />
                              )}
                            </Typography>
                            {timestamp && (
                              <Typography
                                sx={{
                                  color: alpha(
                                    theme.palette.text.secondary,
                                    0.72
                                  ),
                                  fontSize: '0.72rem',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {formatDate(timestamp)}
                              </Typography>
                            )}
                          </Box>
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.secondary, 0.92),
                              fontSize: '0.8rem',
                              lineHeight: 1.45,
                              mt: 0.35,
                              wordBreak: 'break-word',
                            }}
                          >
                            {describeNotification(notification)}
                          </Typography>
                        </Box>
                      </Card>
                    </MenuItem>
                  </SwipeToDismiss>
                );
              })}
            </AnimatePresence>
          </Box>
        </DragToClosePanel>
      </Popover>

      <NotificationHistoryDialog
        address={myAddress}
        describe={describeNotification}
        fullScreen={isNarrowSettings}
        onClose={() => setHistoryOpen(false)}
        onOpenNotification={openNotification}
        open={historyOpen}
      />

      <Dialog
        fullScreen={isNarrowSettings}
        fullWidth
        maxWidth="sm"
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        PaperProps={{
          sx: {
            ...(isDarkMode
              ? {
                  background: '#121821',
                  backgroundImage: 'none',
                  border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
                  borderRadius: '18px',
                  boxShadow: `0 26px 56px ${alpha('#000', 0.46)}`,
                  overflow: 'hidden',
                }
              : {
                  background: theme.palette.background.paper,
                  backgroundImage: 'none',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '18px',
                  boxShadow: `0 20px 48px ${alpha('#1E3248', 0.12)}`,
                  overflow: 'hidden',
                }),
            ...(isNarrowSettings
              ? {
                  border: 'none',
                  borderRadius: 0,
                  boxShadow: 'none',
                  paddingBottom: SAFE_AREA_BOTTOM,
                  paddingTop: SAFE_AREA_TOP,
                }
              : {}),
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            borderBottom: `1px solid ${
              isDarkMode ? alpha('#A9BCD8', 0.1) : theme.palette.divider
            }`,
            color: theme.palette.text.primary,
            display: 'flex',
            fontSize: '1.08rem',
            fontWeight: 650,
            justifyContent: 'space-between',
            px: { xs: 2, sm: 3 },
            py: 2.35,
          }}
        >
          {t('message.generic.notification_settings', {
            defaultValue: 'Notification settings',
          })}
          <IconButton
            onClick={() => setSettingsOpen(false)}
            size="small"
            sx={{
              color: alpha(theme.palette.text.secondary, 0.92),
              '&:hover': {
                backgroundColor: isDarkMode
                  ? alpha('#FFFFFF', 0.05)
                  : alpha(theme.palette.action.active, 0.06),
                color: theme.palette.text.primary,
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            display: 'grid',
            gap: 1.9,
            // Without an explicit track the column grows to the widest row
            // and the whole dialog scrolls sideways on a phone.
            gridTemplateColumns: 'minmax(0, 1fr)',
            // Full screen on a phone: keep rows at their natural height
            // instead of stretching them over the spare space.
            alignContent: 'start',
            px: { xs: 2, sm: 3 },
            pb: 2.9,
            '&&': {
              pt: 3.1,
            },
          }}
        >
          <Box
            sx={{
              color: alpha(theme.palette.text.secondary, 0.82),
              fontSize: '0.84rem',
              lineHeight: 1.52,
            }}
          >
            {settingsSection === 'hub'
              ? t('message.generic.hub_notification_settings_desc', {
                  defaultValue:
                    'Choose which Hub features appear in your notification panel.',
                })
              : t('message.generic.notification_settings_desc', {
                  defaultValue:
                    'Choose which apps can send desktop alerts while keeping in-Hub activity visible.',
                })}
          </Box>
          <Box
            sx={{
              alignItems: 'flex-start',
              backgroundColor: isDarkMode
                ? alpha('#FFFFFF', 0.026)
                : theme.palette.action.hover,
              border: `1px solid ${
                isDarkMode ? alpha('#A9BCD8', 0.12) : theme.palette.divider
              }`,
              borderRadius: '14px',
              display: 'flex',
              gap: 1.2,
              px: 1.7,
              py: 1.4,
            }}
          >
            <InfoOutlinedIcon
              sx={{
                color: alpha(theme.palette.primary.light, 0.96),
                flexShrink: 0,
                fontSize: 20,
                mt: 0.2,
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '0.88rem',
                  fontWeight: 600,
                }}
              >
                {t('core:message.generic.notification_sync_title')}
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.76),
                  fontSize: '0.76rem',
                  lineHeight: 1.45,
                  mt: 0.3,
                }}
              >
                {t('core:message.generic.notification_sync_desc')}
              </Typography>
              <Typography
                aria-live="polite"
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.92),
                  fontSize: '0.76rem',
                  fontWeight: 500,
                  lineHeight: 1.45,
                  mt: 0.7,
                }}
              >
                {syncStatusText}
              </Typography>
            </Box>
          </Box>
          <MobileBackgroundSyncSetting />
          <Box
            role="tablist"
            sx={{
              backgroundColor: isDarkMode
                ? alpha('#05080D', 0.5)
                : alpha(theme.palette.action.active, 0.055),
              border: `1px solid ${
                isDarkMode ? alpha('#A9BCD8', 0.12) : theme.palette.divider
              }`,
              borderRadius: '11px',
              display: 'grid',
              gap: 0.5,
              gridTemplateColumns: '1fr 1fr',
              p: 0.5,
            }}
          >
            {(
              [
                ['hub', 'Hub'],
                ['q-apps', 'Q-Apps'],
              ] as const
            ).map(([value, label]) => {
              const selected = settingsSection === value;
              return (
                <ButtonBase
                  aria-selected={selected}
                  key={value}
                  onClick={() => setSettingsSection(value)}
                  role="tab"
                  sx={{
                    backgroundColor: selected
                      ? isDarkMode
                        ? alpha(theme.palette.primary.main, 0.2)
                        : alpha(theme.palette.primary.main, 0.12)
                      : 'transparent',
                    border: `1px solid ${
                      selected
                        ? alpha(theme.palette.primary.main, 0.34)
                        : 'transparent'
                    }`,
                    borderRadius: '8px',
                    color: selected
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary,
                    fontSize: '0.84rem',
                    fontWeight: selected ? 650 : 550,
                    minHeight: 36,
                    transition:
                      'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
                    '&:hover': {
                      backgroundColor: selected
                        ? isDarkMode
                          ? alpha(theme.palette.primary.main, 0.24)
                          : alpha(theme.palette.primary.main, 0.15)
                        : alpha(theme.palette.action.active, 0.06),
                    },
                  }}
                >
                  {label}
                </ButtonBase>
              );
            })}
          </Box>
          <List disablePadding sx={{ display: 'grid', gap: 1.2 }}>
            {settingsLoading ? (
              <Typography
                sx={{ color: alpha(theme.palette.text.secondary, 0.82) }}
              >
                {t('message.generic.loading', { defaultValue: 'Loading...' })}
              </Typography>
            ) : settingsSection === 'hub' ? (
              reticulumEnabled ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    backgroundColor: isDarkMode
                      ? alpha('#FFFFFF', 0.026)
                      : theme.palette.action.hover,
                    border: `1px solid ${
                      isDarkMode
                        ? alpha('#A9BCD8', 0.12)
                        : theme.palette.divider
                    }`,
                    borderRadius: '14px',
                    display: 'flex',
                    // Phones: text on top, controls on their own line below.
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'stretch', sm: 'center' },
                    gap: { xs: 1, sm: 2 },
                    justifyContent: 'space-between',
                    px: 1.7,
                    py: 1.55,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1.2,
                      minWidth: 0,
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        backgroundColor: alpha(
                          theme.palette.primary.main,
                          0.12
                        ),
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
                        borderRadius: '10px',
                        display: 'inline-flex',
                        height: 34,
                        justifyContent: 'center',
                        overflow: 'hidden',
                        width: 34,
                      }}
                    >
                      <Box
                        alt="Q-Chat"
                        component="img"
                        src={LogoSelected}
                        sx={{ height: 24, width: 24 }}
                      />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '0.92rem',
                          fontWeight: 600,
                        }}
                      >
                        Q-Chat
                      </Typography>
                      <Typography
                        sx={{
                          color: alpha(theme.palette.text.secondary, 0.76),
                          fontSize: '0.76rem',
                          lineHeight: 1.45,
                          mt: 0.3,
                        }}
                      >
                        Show Reticulum mention alerts in the Hub and on your
                        desktop.
                      </Typography>
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexShrink: 0,
                      gap: 1.2,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.secondary, 0.82),
                        fontSize: '0.78rem',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Mentions
                    </Typography>
                    <Switch
                      checked={qChatMentionsEnabled}
                      inputProps={{
                        'aria-label': 'Q-Chat mention notifications',
                      }}
                      onChange={(_, checked) => {
                        setQChatMentionsEnabled(checked);
                        void setQChatMentionNotificationsEnabled(checked).catch(
                          () => setQChatMentionsEnabled(!checked)
                        );
                      }}
                      size="small"
                    />
                  </Box>
                </Box>
              ) : (
                <Typography
                  sx={{ color: alpha(theme.palette.text.secondary, 0.82) }}
                >
                  No Hub notification settings are available.
                </Typography>
              )
            ) : (
              <>
                {settingsApps.length === 0 ? (
                  <Box
                    sx={{
                      alignItems: 'center',
                      border: `1px dashed ${
                        isDarkMode
                          ? alpha('#A9BCD8', 0.14)
                          : theme.palette.divider
                      }`,
                      borderRadius: '14px',
                      color: alpha(theme.palette.text.secondary, 0.8),
                      display: 'flex',
                      fontSize: '0.82rem',
                      justifyContent: 'center',
                      minHeight: 82,
                      px: 2,
                      textAlign: 'center',
                    }}
                  >
                    {t('message.generic.no_notification_apps', {
                      defaultValue:
                        'No Q-Apps have notification permission yet.',
                    })}
                  </Box>
                ) : (
                  settingsApps.map((appName) => (
                    <Box
                      key={appName}
                      sx={{
                        alignItems: 'center',
                        backgroundColor: isDarkMode
                          ? alpha('#FFFFFF', 0.026)
                          : theme.palette.action.hover,
                        border: `1px solid ${
                          isDarkMode
                            ? alpha('#A9BCD8', 0.12)
                            : theme.palette.divider
                        }`,
                        borderRadius: '14px',
                        display: 'flex',
                        // Phones: text on top, controls on their own line.
                        flexDirection: { xs: 'column', sm: 'row' },
                        alignItems: { xs: 'stretch', sm: 'center' },
                        gap: { xs: 1, sm: 2 },
                        justifyContent: 'space-between',
                        px: 1.7,
                        py: 1.55,
                      }}
                    >
                      <NotificationAppIdentity
                        appName={appName}
                        description={
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.secondary, 0.76),
                              fontSize: '0.76rem',
                              lineHeight: 1.45,
                              mt: 0.3,
                            }}
                          >
                            {t('message.generic.disable_os_push_desc', {
                              defaultValue:
                                'Mute desktop alerts for this app while keeping in-Hub activity visible.',
                            })}
                          </Typography>
                        }
                      />
                      <Box
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          flexShrink: 0,
                          gap: 1.2,
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Typography
                          sx={{
                            color: alpha(theme.palette.text.secondary, 0.82),
                            fontSize: '0.78rem',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {t('message.generic.disable_os_push', {
                            defaultValue: 'Disable OS push',
                          })}
                        </Typography>
                        <Switch
                          checked={osPushDisabledMap[appName] === true}
                          onChange={async (_, checked) => {
                            await setNotificationOsPushDisabled(
                              appName,
                              checked
                            );
                            setOsPushDisabledMap((prev) => ({
                              ...prev,
                              [appName]: checked,
                            }));
                          }}
                          size="small"
                        />
                        <ButtonBase
                          onClick={async () => {
                            // Remove the app's rules through the persisted
                            // list first (storage + socket + tombstones for
                            // the other devices), then drop the permission.
                            try {
                              await revokeAppNotificationRules(appName);
                            } catch (error) {
                              console.error(
                                'Failed to remove notification rules:',
                                error
                              );
                            }
                            setCustomSubscriptions((prev) =>
                              (prev ?? []).filter(
                                (sub) =>
                                  !(
                                    sub?.event === RESOURCE_EVENT &&
                                    (sub?.appName ?? '').toLowerCase() ===
                                      appName.toLowerCase()
                                  )
                              )
                            );
                            await setPermission(
                              getNotificationPermissionKey(appName),
                              false
                            );
                            executeEvent(
                              'notifications-websocket-reconnect',
                              undefined
                            );
                            setSettingsApps((prev) =>
                              prev.filter((name) => name !== appName)
                            );
                          }}
                          sx={{
                            borderRadius: '10px',
                            color: theme.palette.error.light,
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            px: 1.1,
                            py: 0.6,
                            '&:hover': {
                              backgroundColor: alpha(
                                theme.palette.error.main,
                                0.08
                              ),
                            },
                          }}
                        >
                          {t('message.generic.revoke_permission', {
                            defaultValue: 'Revoke',
                          })}
                        </ButtonBase>
                      </Box>
                    </Box>
                  ))
                )}
              </>
            )}
          </List>
        </DialogContent>
      </Dialog>
    </>
  );
});
