import { useEffect, useRef, useState } from 'react';
import { getBaseApiReact, getBaseApiReactSocket } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { coreWebsocketPingMs } from '../../utils/coreWebsocketPing';
import i18n, { supportedLanguages } from '../../i18n/i18n';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  extStateAtom,
  paymentNotificationsAtom,
  customWebsocketSubscriptionsAtom,
  dmFriendsByAddressAtom,
  notificationPanelDismissalsAtom,
  reticulumChatEnabledAtom,
} from '../../atoms/global';
import {
  dismissOsNotificationByKey,
  fireOsNotificationPayment,
} from '../../background/background';
import {
  CHAT_ALERT_CATCH_UP_SETTLE_MS,
  chatAlertFloor,
  createChatAlertCoalescer,
  isChatAlertCatchUp,
  readChatAlertLastRunMark,
  rememberShownAlert,
  reticulumDmAlertKey,
  reticulumDmMissedCallAlertKey,
  reticulumMentionAlertKey,
  unreadDirectMessageCount,
  wasAlertShown,
  writeChatAlertLastRunMark,
  type ChatAlertCoalescer,
} from '../../utils/reticulumChatAlerts';
import { isCapacitor } from '../../utils/platform';
import { isGlareCallId } from '../../lib/call/glareCallIds';
import {
  getNotificationPermissionKey,
  getPermission,
} from '../../qortal/qortal-requests';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import {
  getQChatMentionNotificationsEnabled,
  QCHAT_MENTION_NOTIFICATION_APP_NAME,
  QCHAT_MENTION_NOTIFICATION_EVENT,
  QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
} from '../../utils/qChatMentionNotifications';
import {
  isHubBeingViewed,
  shouldNotifyForReticulumDm,
} from '../../utils/reticulumDmNotifications';
import { getReticulumNotificationChannelLabel } from '../../utils/reticulumNotificationChannel';
import {
  getNotificationOwnerApp,
  getNotificationOwnerSpelling,
  pinNotificationToOwnerApp,
} from '../../utils/notificationOwnerApp';
import {
  applyKnownPaymentSenders,
  formatPaymentAmount,
  lookupPaymentSenderName,
  PAYMENT_ALERT_TYPE,
  PAYMENT_RECEIVED_EVENT,
  paymentAvatarPath,
  paymentSenderLabel,
  resolvePaymentSenders,
} from '../../utils/paymentNotifications';

const isQChatMentionNotification = (notification: any) =>
  notification?.appName === QCHAT_MENTION_NOTIFICATION_APP_NAME &&
  notification?.data?.qChatMention === true;

const isReticulumCalendarNotification = (notification: any) =>
  notification?.data?.reticulumCalendarReminder === true;

const NOTIFICATION_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const QCHAT_MENTION_OS_NOTIFICATION_MAX_TRACKED = 500;
const RETICULUM_DM_OS_NOTIFICATION_MAX_TRACKED = 500;
const RETICULUM_DM_ALERT_DISMISS_DEBOUNCE_MS = 250;
/** A missed call reported later than this after it ended stays in the bell only. */
const MISSED_CALL_OS_ALERT_MAX_AGE_MS = 2 * 60 * 1000;
/** Wait this long before a missed-call tray alert (answered elsewhere, seen). */
const MISSED_CALL_OS_ALERT_SETTLE_MS = 4_000;

const getNotificationCreatorTimestamp = (notification: {
  data?: { created?: number; timestamp?: number };
  timestamp?: number;
}) =>
  notification?.data?.created ??
  notification?.data?.timestamp ??
  notification?.timestamp;

const trimNotificationsToLast3Days = <
  T extends {
    data?: { created?: number; timestamp?: number };
    timestamp?: number;
  },
>(
  notifications: T[]
): T[] => {
  const cutoff = Date.now() - NOTIFICATION_AGE_MS;
  return notifications.filter((notification) => {
    const timestamp = getNotificationCreatorTimestamp(notification);
    return timestamp == null || timestamp >= cutoff;
  });
};

/** Message object with "You got a new qmail" in all supported languages (for Q-Mail subscription). */
function getNewQmailMessage(): Record<string, string> {
  const message: Record<string, string> = {};
  for (const lng of Object.keys(supportedLanguages)) {
    message[lng] = i18n.t('core:message.generic.new_qmail', { lng });
  }
  return message;
}

function getCalendarReminderMessage(title: string): Record<string, string> {
  const message: Record<string, string> = {};
  for (const lng of Object.keys(supportedLanguages)) {
    message[lng] = `${i18n.t('core:calendar.reminder', { lng })}: ${title}`;
  }
  return message;
}

/** Picks message in current language, else en, else first available; not reactive. */
function getNotificationMessage(
  messageObj: Record<string, string> | undefined
): string {
  const fallback = 'New notification';
  if (!messageObj || typeof messageObj !== 'object') return fallback;
  const lang = (i18n.language || 'en').split('-')[0];
  const current = messageObj[lang];
  if (typeof current === 'string' && current.trim()) return current.trim();
  const en = messageObj.en;
  if (typeof en === 'string' && en.trim()) return en.trim();
  const first = Object.values(messageObj).find(
    (v) => typeof v === 'string' && (v as string).trim()
  );
  return typeof first === 'string' ? (first as string).trim() : fallback;
}

export const WebSocketNotifications = ({ myAddress, userName }) => {
  const extState = useAtomValue(extStateAtom);
  const extStateRef = useRef(extState);
  extStateRef.current = extState;
  const dmFriendsByAddress = useAtomValue(dmFriendsByAddressAtom);
  const dmFriendsByAddressRef = useRef(dmFriendsByAddress);
  dmFriendsByAddressRef.current = dmFriendsByAddress;
  const reticulumChatEnabled = useAtomValue(reticulumChatEnabledAtom);
  const myAddressRef = useRef(myAddress);
  myAddressRef.current = myAddress;
  const setPaymentNotifications = useSetAtom(paymentNotificationsAtom);
  const updatePanelDismissals = useSetAtom(notificationPanelDismissalsAtom);
  const customSubscriptions = useAtomValue(customWebsocketSubscriptionsAtom);
  const setCustomSubscriptions = useSetAtom(customWebsocketSubscriptionsAtom);

  const [socketOpen, setSocketOpen] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef(0);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const historyRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const namesAbortControllerRef = useRef<AbortController | null>(null);
  const listOfMyNamesRef = useRef<string[]>([]);
  const initWebsocketRef = useRef<(() => Promise<void>) | null>(null);
  const qChatMentionOsNotifiedEventIdsRef = useRef<Set<string>>(new Set());
  const reticulumDmOsNotifiedEventIdsRef = useRef<Set<string>>(new Set());
  const missedCallOsNotifiedRef = useRef<Set<string>>(new Set());
  // Catch-up DM and mention tray alerts (phone only) share one coalescer: at
  // most one sounding alert per 60 s, however many messages a catch-up
  // delivers at once. Live alerts post at once, as before.
  const chatAlertCoalescerRef = useRef<ChatAlertCoalescer | null>(null);
  if (!chatAlertCoalescerRef.current) {
    chatAlertCoalescerRef.current = createChatAlertCoalescer();
  }
  const chatAlertCoalescer = chatAlertCoalescerRef.current;
  // Catch-up gate for this account: when this session started listening and
  // when GO last ran before it (read once; see chatAlertFloor). Catch-up
  // alerts are for the phone, whose page is frozen or killed in the
  // background; desktop keeps the listening-time gate (lastRunMark null).
  const chatAlertWindowRef = useRef<{
    listeningSince: number;
    lastRunMark: number | null;
    catchUpAlerts: boolean;
  } | null>(null);

  useEffect(() => {
    if (!myAddress) return;
    const catchUpAlerts = isCapacitor();
    chatAlertWindowRef.current = {
      listeningSince: Date.now(),
      lastRunMark: catchUpAlerts ? readChatAlertLastRunMark(myAddress) : null,
      catchUpAlerts,
    };
    if (!catchUpAlerts) return;
    // Written only when GO leaves the screen or unloads, never on a timer.
    // On the phone document.hidden follows Android's foreground state.
    const markLastRun = () => writeChatAlertLastRunMark(myAddress);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markLastRun();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', markLastRun);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', markLastRun);
      // Alerts still waiting belong to this account.
      chatAlertCoalescer.clear();
    };
  }, [chatAlertCoalescer, myAddress]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const listeningSince = Date.now();
    // The mark read when this account's session started: a hide since then
    // must not narrow the catch-up window if chat is enabled late.
    const alertWindow = chatAlertWindowRef.current;
    const catchUpAlerts = alertWindow?.catchUpAlerts ?? isCapacitor();
    const lastRunMark = !catchUpAlerts
      ? null
      : alertWindow
        ? alertWindow.lastRunMark
        : readChatAlertLastRunMark(myAddress);
    reticulumDmOsNotifiedEventIdsRef.current.clear();
    const off = window.reticulumChat?.onDirectEvent?.(({ event }) => {
      if (!event || typeof event !== 'object') return;
      const directEvent = event as {
        eventId?: string;
        eventType?: string;
        senderAddress?: string;
        recipientAddress?: string;
        timestamp?: number;
        readByOwner?: boolean;
      };
      const eventId = String(directEvent.eventId || '');
      if (
        !eventId ||
        reticulumDmOsNotifiedEventIdsRef.current.has(eventId) ||
        !shouldNotifyForReticulumDm({
          event: directEvent,
          friendsByAddress: dmFriendsByAddressRef.current,
          listeningSince,
          lastRunMark,
          myAddress,
          hubIsBeingViewed: isHubBeingViewed(),
        })
      ) {
        return;
      }

      reticulumDmOsNotifiedEventIdsRef.current.add(eventId);
      if (
        reticulumDmOsNotifiedEventIdsRef.current.size >
        RETICULUM_DM_OS_NOTIFICATION_MAX_TRACKED
      ) {
        const oldestEventId = reticulumDmOsNotifiedEventIdsRef.current
          .values()
          .next().value;
        if (oldestEventId) {
          reticulumDmOsNotifiedEventIdsRef.current.delete(oldestEventId);
        }
      }

      const sender = String(directEvent.senderAddress || '');
      const alertKey = reticulumDmAlertKey(sender);
      const postDmAlert = () => {
        const friend = dmFriendsByAddressRef.current[sender];
        const senderName = friend?.name?.trim() || 'a friend';
        void fireOsNotificationPayment(
          {
            appName: 'Q-Chat',
            appService: 'INTERNAL',
            event: 'RETICULUM_DM_MESSAGE',
          },
          `New message from ${senderName}`,
          'Open Q-Chat to view it.',
          LogoSelected,
          undefined,
          {
            from: sender,
            name: friend?.name,
            reticulumDirectMessage: true,
          },
          {
            alertKey,
            fromAddress: sender,
            notificationType: 'direct',
          }
        );
      };
      if (
        !catchUpAlerts ||
        !isChatAlertCatchUp({ timestamp: Number(directEvent.timestamp) })
      ) {
        postDmAlert();
        return;
      }
      // Catch-up: the message may have been read on another device, and
      // that read sync is a separate wire that can land after the events.
      // Wait a short settle (a read cancels the waiting alert through
      // scheduleDmAlertDismiss), then post only if the chat is still unread
      // and GO is not on screen.
      chatAlertCoalescer.offer(
        alertKey,
        async (isCancelled) => {
          if (isHubBeingViewed()) return false;
          const summaries = await Promise.resolve(
            window.reticulumChat?.getDirectSummaries?.(myAddress, sender)
          ).catch(() => null);
          if (isCancelled() || isHubBeingViewed()) return false;
          if (unreadDirectMessageCount(summaries, sender) <= 0) return false;
          postDmAlert();
          return true;
        },
        { settleMs: CHAT_ALERT_CATCH_UP_SETTLE_MS }
      );
    });

    // When a DM conversation is read (locally or on another device via
    // read_sync) its summary changes; if the peer no longer has unread
    // messages, cancel the tray alert we showed for it. Debounced per peer
    // because a burst of events reports one summary change each.
    const dmAlertDismissTimers = new Map<string, number>();
    const scheduleDmAlertDismiss = (peer: string) => {
      const alertKey = reticulumDmAlertKey(peer);
      const alertWanted = () =>
        wasAlertShown(alertKey) || chatAlertCoalescer.isPending(alertKey);
      if (!alertWanted()) return;
      const pending = dmAlertDismissTimers.get(peer);
      if (pending) window.clearTimeout(pending);
      dmAlertDismissTimers.set(
        peer,
        window.setTimeout(() => {
          dmAlertDismissTimers.delete(peer);
          if (!alertWanted()) return;
          void window.reticulumChat
            ?.getDirectSummaries?.(myAddress, peer)
            .then((summaries) => {
              // Messages only: the missed-call alert is a separate one.
              if (unreadDirectMessageCount(summaries, peer) <= 0) {
                chatAlertCoalescer.cancel(alertKey);
                dismissOsNotificationByKey(alertKey);
              }
            })
            .catch(() => undefined);
        }, RETICULUM_DM_ALERT_DISMISS_DEBOUNCE_MS)
      );
    };

    const missedCallAlertTimers = new Set<number>();
    const postMissedCallAlert = async (callId: string, peerAddress: string) => {
      const unread = await Promise.resolve(
        window.reticulumChat?.getDirectCallHistory?.(
          myAddress,
          peerAddress,
          10,
          true
        )
      ).catch(() => null);
      const stillMissed =
        Array.isArray(unread) &&
        unread.some(
          (item: any) =>
            item?.callId === callId &&
            item?.outcome === 'missed' &&
            !(item?.readAt > 0)
        );
      if (!stillMissed || isHubBeingViewed()) return;
      const friend = dmFriendsByAddressRef.current[peerAddress];
      const senderName = friend?.name?.trim() || peerAddress;
      void fireOsNotificationPayment(
        {
          appName: 'Q-Chat',
          appService: 'INTERNAL',
          event: 'RETICULUM_DM_MISSED_CALL',
        },
        i18n.t('core:go_call.missed_call_title', { name: senderName }),
        i18n.t('core:go_call.missed_call_body'),
        LogoSelected,
        undefined,
        {
          from: peerAddress,
          name: friend?.name,
          reticulumDirectMessage: true,
        },
        {
          alertKey: reticulumDmMissedCallAlertKey(peerAddress),
          fromAddress: peerAddress,
          notificationType: 'direct',
        }
      );
    };

    const addMissedCallNotification = (record: any, live = false) => {
      if (
        record?.ownerAddress !== myAddress ||
        record?.direction !== 'incoming' ||
        record?.outcome !== 'missed' ||
        record?.readAt > 0
      )
        return;
      const callId = String(record.callId || '');
      const peerAddress = String(record.peerAddress || '');
      if (!callId || !peerAddress) return;
      const friend = dmFriendsByAddressRef.current[peerAddress];
      const senderName = friend?.name?.trim() || peerAddress;
      // GO: a call missed just now also goes to the phone's tray (once per
      // call), like a phone's missed call; tapping it opens the DM. Older
      // missed calls found at start only show in the bell.
      const endedAt = Number(record.endedAt || 0);
      if (
        live &&
        isCapacitor() &&
        !missedCallOsNotifiedRef.current.has(callId) &&
        endedAt > 0 &&
        Date.now() - endedAt <= MISSED_CALL_OS_ALERT_MAX_AGE_MS
      ) {
        missedCallOsNotifiedRef.current.add(callId);
        // Settle first: a call answered on another device of the account
        // (its history syncs here) or seen meanwhile is not missed.
        const timer = window.setTimeout(() => {
          missedCallAlertTimers.delete(timer);
          void postMissedCallAlert(callId, peerAddress);
        }, MISSED_CALL_OS_ALERT_SETTLE_MS);
        missedCallAlertTimers.add(timer);
      }
      setPaymentNotifications((previous) => [
        ...previous.filter((item) => item?.data?.reticulumDmCallId !== callId),
        {
          appName: 'Q-Chat',
          appService: 'INTERNAL',
          event: 'RETICULUM_DM_MISSED_CALL',
          notificationId: `reticulum-dm-call-${callId}`,
          image: LogoSelected,
          message: { en: `Missed voice call from ${senderName}` },
          timestamp: Number(record.endedAt || Date.now()),
          data: {
            created: Number(record.endedAt || Date.now()),
            from: peerAddress,
            name: friend?.name,
            reticulumDmMissedCall: true,
            reticulumDmCallId: callId,
          },
        },
      ]);
    };
    void window.reticulumChat
      ?.getDirectCallHistory(myAddress, undefined, 50, true)
      .then((records) =>
        records.forEach((record) => addMissedCallNotification(record))
      )
      .catch(() => undefined);
    const offCalls = window.reticulumChat?.onDirectCallHistory?.(
      ({ record }: any) => {
        if (record?.ownerAddress !== myAddress) return;
        if (record?.outcome === 'missed') {
          // Call glare: they cancelled theirs to answer ours; not missed.
          if (isGlareCallId(String(record?.callId || ''))) return;
          addMissedCallNotification(record, true);
          return;
        }
        const callId = String(record?.callId || '');
        if (!callId) return;
        setPaymentNotifications((previous) =>
          previous.filter((item) => item?.data?.reticulumDmCallId !== callId)
        );
      }
    );
    const offCallSummary = window.reticulumChat?.onDirectSummaryChanged?.(
      ({ peerAddress }: any) => {
        const peer = String(peerAddress || '');
        if (!peer) return;
        scheduleDmAlertDismiss(peer);
        void window.reticulumChat
          ?.getDirectCallHistory(myAddress, peer, 1, true)
          .then((records) => {
            if (records.length > 0) return;
            dismissOsNotificationByKey(reticulumDmMissedCallAlertKey(peer));
            setPaymentNotifications((previous) =>
              previous.filter(
                (item) =>
                  !(
                    item?.data?.reticulumDmMissedCall === true &&
                    item?.data?.from === peer
                  )
              )
            );
          })
          .catch(() => undefined);
      }
    );

    return () => {
      off?.();
      offCalls?.();
      offCallSummary?.();
      missedCallAlertTimers.forEach((timer) => window.clearTimeout(timer));
      missedCallAlertTimers.clear();
      dmAlertDismissTimers.forEach((timer) => window.clearTimeout(timer));
      dmAlertDismissTimers.clear();
      // Chat turned off or account changed: waiting alerts are stale.
      chatAlertCoalescer.clear();
    };
  }, [
    chatAlertCoalescer,
    myAddress,
    reticulumChatEnabled,
    setPaymentNotifications,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const off = window.reticulumChat?.onCalendarReminderDue?.((payload) => {
      if (!payload || typeof payload !== 'object') return;
      const reminder = payload as {
        ownerAddress?: string;
        groupId?: number;
        eventId?: string;
        occurrence?: ReticulumCalendarOccurrence;
      };
      if (reminder.ownerAddress !== myAddress || !reminder.occurrence) return;
      const occurrence = reminder.occurrence;
      const notificationId = `reticulum-calendar-${occurrence.occurrenceId}`;
      setPaymentNotifications((previous) =>
        trimNotificationsToLast3Days([
          {
            appName: 'Q-Chat',
            appService: 'INTERNAL',
            event: 'RETICULUM_CALENDAR_REMINDER',
            notificationId,
            image: LogoSelected,
            message: getCalendarReminderMessage(occurrence.title),
            timestamp: Date.now(),
            data: {
              created: Date.now(),
              eventId: reminder.eventId,
              groupId: reminder.groupId,
              occurrenceStart: occurrence.occurrenceStart,
              timezone: occurrence.timezone,
              identifier: notificationId,
              reticulumCalendarReminder: true,
            },
          },
          ...previous.filter(
            (item) =>
              !(
                isReticulumCalendarNotification(item) &&
                item?.notificationId === notificationId
              )
          ),
        ])
      );
      if (!isHubBeingViewed()) {
        void fireOsNotificationPayment(
          {
            appName: 'Q-Chat',
            appService: 'INTERNAL',
            event: 'RETICULUM_CALENDAR_REMINDER',
          },
          occurrence.title,
          occurrence.allDay
            ? i18n.t('core:calendar.allDay')
            : `${i18n.t('core:calendar.starts')} ${new Date(
                occurrence.occurrenceStart
              ).toLocaleString()}`,
          LogoSelected,
          undefined,
          {
            from: reminder.groupId,
            eventId: reminder.eventId,
            occurrenceStart: occurrence.occurrenceStart,
            timezone: occurrence.timezone,
            openCalendar: true,
          }
        );
      }
    });
    return () => off?.();
  }, [myAddress, reticulumChatEnabled, setPaymentNotifications]);

  const forceCloseWebSocket = () => {
    connectionIdRef.current += 1;
    setSocketOpen(false);
    namesAbortControllerRef.current?.abort();
    namesAbortControllerRef.current = null;
    clearTimeout(historyRequestTimeoutRef.current);
    clearTimeout(reconnectTimeoutRef.current);
    clearTimeout(timeoutIdRef.current);
    clearTimeout(pingTimeoutRef.current);
    historyRequestTimeoutRef.current = null;
    reconnectTimeoutRef.current = null;
    timeoutIdRef.current = null;
    pingTimeoutRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.close(1000, 'forced');
    }
  };

  const logoutEventFunc = () => {
    forceCloseWebSocket();
  };

  useEffect(() => {
    subscribeToEvent('logout-event', logoutEventFunc);

    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      forceCloseWebSocket();
      setSocketOpen(false);
      if (initWebsocketRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          void initWebsocketRef.current?.();
        }, 0);
      }
    };
    subscribeToEvent('notifications-websocket-reconnect', handler);
    return () =>
      unsubscribeFromEvent('notifications-websocket-reconnect', handler);
  }, []);

  useEffect(() => {
    const handler = (e) => setCustomSubscriptions(e.detail ?? []);
    subscribeToEvent('custom-ws-subscriptions-updated', handler);
    return () =>
      unsubscribeFromEvent('custom-ws-subscriptions-updated', handler);
  }, [setCustomSubscriptions]);

  useEffect(() => {
    const handleQChatMention = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        mentionCount?: number;
        syncUnreadCount?: boolean;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      const isUnreadCountSync = detail?.syncUnreadCount === true;
      if ((!eventId && !isUnreadCountSync) || !Number.isFinite(groupId)) {
        return;
      }
      // Mentions were read (here or on another device): drop the tray alert.
      // Runs before the enabled check so an alert shown earlier still clears
      // after mention notifications get disabled.
      if (
        isUnreadCountSync &&
        Math.max(0, Number(detail?.mentionCount) || 0) === 0
      ) {
        chatAlertCoalescer.cancel(reticulumMentionAlertKey(groupId));
        dismissOsNotificationByKey(reticulumMentionAlertKey(groupId));
      }
      // A mention card swiped out of the bell panel stays hidden until the
      // group has more unread mentions than it had then; reads lower that bar.
      if (isUnreadCountSync) {
        updatePanelDismissals({
          type: 'mentionCount',
          groupId,
          mentionCount: Math.max(0, Number(detail?.mentionCount) || 0),
        });
      }
      if (!(await getQChatMentionNotificationsEnabled())) return;

      const timestamp = Number(detail?.timestamp || Date.now());
      const groupName =
        String(detail?.groupName || '').trim() || `Group ${groupId}`;
      const channelId = String(detail?.channelId || 'general');
      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      if (!isUnreadCountSync || Number(detail?.mentionCount || 0) > 0) {
        try {
          const channels = await window.reticulumChat?.getChannels?.(
            groupId,
            true
          );
          channelName = getReticulumNotificationChannelLabel(
            channelId,
            channels
          );
        } catch {
          // The stable ID remains a useful fallback while metadata is syncing.
        }
      }
      setPaymentNotifications((previous) => {
        const trimmed = trimNotificationsToLast3Days(previous);
        const existing = trimmed.find(
          (notification) =>
            isQChatMentionNotification(notification) &&
            Number(notification?.data?.groupId) === groupId
        );
        if (isUnreadCountSync) {
          const mentionCount = Math.max(0, Number(detail?.mentionCount) || 0);
          if (mentionCount === 0) {
            return trimmed.filter(
              (notification) =>
                !(
                  isQChatMentionNotification(notification) &&
                  Number(notification?.data?.groupId) === groupId
                )
            );
          }
          const syncedNotification = {
            appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
            appService: 'INTERNAL',
            data: {
              channelId,
              channelName,
              created: timestamp,
              eventId: existing?.data?.eventId || '',
              eventIds: existing?.data?.eventIds || [],
              groupId,
              groupName,
              identifier: `q-chat-mention-${groupId}`,
              mentionCount,
              qChatMention: true,
            },
            event: QCHAT_MENTION_NOTIFICATION_EVENT,
            image: '',
            message: {
              en: mentionCount === 1 ? '1 mention' : `${mentionCount} mentions`,
            },
            notificationId: `q-chat-mention-${groupId}`,
          };
          return [
            syncedNotification,
            ...trimmed.filter(
              (notification) =>
                !(
                  isQChatMentionNotification(notification) &&
                  Number(notification?.data?.groupId) === groupId
                )
            ),
          ];
        }
        const eventIds = Array.isArray(existing?.data?.eventIds)
          ? existing.data.eventIds
          : existing?.data?.eventId
            ? [existing.data.eventId]
            : [];
        if (eventIds.includes(eventId)) return trimmed;

        const nextEventIds = [...eventIds, eventId].slice(-100);
        const mentionCount = Math.max(
          nextEventIds.length,
          Number(existing?.data?.mentionCount) || 0
        );
        const nextNotification = {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          data: {
            channelId,
            channelName,
            created: timestamp,
            eventId,
            eventIds: nextEventIds,
            groupId,
            groupName,
            identifier: `q-chat-mention-${groupId}`,
            mentionCount,
            qChatMention: true,
          },
          event: QCHAT_MENTION_NOTIFICATION_EVENT,
          image: '',
          message: {
            en: mentionCount === 1 ? '1 mention' : `${mentionCount} mentions`,
          },
          notificationId: `q-chat-mention-${groupId}`,
        };
        return [
          nextNotification,
          ...trimmed.filter(
            (notification) =>
              !(
                isQChatMentionNotification(notification) &&
                Number(notification?.data?.groupId) === groupId
              )
          ),
        ];
      });

      // Unread-count synchronization rebuilds the Hub notification state and
      // must not replay old mentions as OS notifications. On the phone,
      // mentions older than the catch-up window (see chatAlertFloor) are
      // history, not news; desktop is unchanged.
      const alertWindow = chatAlertWindowRef.current;
      const catchUpAlerts = alertWindow?.catchUpAlerts === true;
      const withinAlertWindow =
        !alertWindow?.catchUpAlerts || timestamp >= chatAlertFloor(alertWindow);
      if (
        !isUnreadCountSync &&
        withinAlertWindow &&
        !qChatMentionOsNotifiedEventIdsRef.current.has(eventId)
      ) {
        qChatMentionOsNotifiedEventIdsRef.current.add(eventId);
        if (
          qChatMentionOsNotifiedEventIdsRef.current.size >
          QCHAT_MENTION_OS_NOTIFICATION_MAX_TRACKED
        ) {
          const oldestEventId = qChatMentionOsNotifiedEventIdsRef.current
            .values()
            .next().value;
          if (oldestEventId) {
            qChatMentionOsNotifiedEventIdsRef.current.delete(oldestEventId);
          }
        }
        const alertKey = reticulumMentionAlertKey(groupId);
        const postMentionAlert = () => {
          void fireOsNotificationPayment(
            {
              appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
              appService: 'INTERNAL',
              event: QCHAT_MENTION_NOTIFICATION_EVENT,
            },
            `Mention in ${groupName}`,
            `You were mentioned in #${channelName}`,
            LogoSelected,
            undefined,
            {
              channelId,
              eventId,
              from: groupId,
              qChatMention: true,
            },
            {
              alertKey,
              fromAddress: String(groupId),
              notificationType: 'group',
            }
          );
        };
        if (!catchUpAlerts || !isChatAlertCatchUp({ timestamp })) {
          postMentionAlert();
          return;
        }
        // Catch-up: wait a short settle; an unread sync with no mentions
        // left (read on another device) cancels the waiting alert. The
        // timer may fire on resume, so re-check the screen at post time.
        chatAlertCoalescer.offer(
          alertKey,
          (isCancelled) => {
            if (isCancelled() || isHubBeingViewed()) return false;
            postMentionAlert();
            return true;
          },
          { settleMs: CHAT_ALERT_CATCH_UP_SETTLE_MS }
        );
      }
    };

    const handleMentionSettingUpdated = (
      event: CustomEvent<{ enabled?: boolean }>
    ) => {
      if (event.detail?.enabled !== false) return;
      setPaymentNotifications((previous) =>
        previous.filter(
          (notification) => !isQChatMentionNotification(notification)
        )
      );
    };

    subscribeToEvent(
      'q-chat-mention-notification',
      handleQChatMention as EventListener
    );
    subscribeToEvent(
      QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
      handleMentionSettingUpdated as EventListener
    );
    void getQChatMentionNotificationsEnabled().then((enabled) => {
      if (enabled) return;
      setPaymentNotifications((previous) =>
        previous.filter(
          (notification) => !isQChatMentionNotification(notification)
        )
      );
    });
    return () => {
      unsubscribeFromEvent(
        'q-chat-mention-notification',
        handleQChatMention as EventListener
      );
      unsubscribeFromEvent(
        QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
        handleMentionSettingUpdated as EventListener
      );
    };
  }, [chatAlertCoalescer, setPaymentNotifications, updatePanelDismissals]);

  // Seen-in-app keys are not pruned against the subscription rules here. The
  // built-in Q-Mail subscription is not a custom rule, rules can still be
  // hydrating, and the setter can only add marks, so pruning re-wrote the
  // record forever and starved every startTransition in the app. Marks
  // expire after 3 days on their own, and a mark whose rule is gone hides
  // nothing new.

  useEffect(() => {
    const handler = (e) => {
      const notificationIds = e.detail;
      if (
        !notificationIds?.length ||
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      )
        return;
      socketRef.current.send(
        JSON.stringify({ action: 'unsubscribe', notificationIds })
      );
    };
    subscribeToEvent('custom-ws-unsubscribe', handler);
    return () => unsubscribeFromEvent('custom-ws-unsubscribe', handler);
  }, []);

  useEffect(() => {
    if (
      !socketOpen ||
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN
    )
      return;
    if (!customSubscriptions?.length) return;
    socketRef.current.send(
      JSON.stringify({
        action: 'subscribe',
        subscriptions: customSubscriptions,
      })
    );
  }, [socketOpen, customSubscriptions]);

  useEffect(() => {
    if (!myAddress || extState === 'not-authenticated' || !userName) return;

    /** Remove RESOURCE_PUBLISHED rules whose appName does not have qAPPNotification permission. */
    const filterSubscriptionsByNotificationPermission = async (
      subscriptions
    ) => {
      if (!Array.isArray(subscriptions)) return [];
      const result = [];
      for (const sub of subscriptions) {
        if (sub?.event !== 'RESOURCE_PUBLISHED') {
          result.push(sub);
          continue;
        }
        const appName = sub?.appName;
        if (!appName) continue;
        const allowed = await getPermission(
          getNotificationPermissionKey(appName)
        );
        if (allowed === true) result.push(sub);
      }
      return result;
    };

    let effectActive = true;

    const pingHeads = (
      socket: WebSocket,
      isCurrentConnection: (socket?: WebSocket | null) => boolean
    ) => {
      try {
        if (
          isCurrentConnection(socket) &&
          socket.readyState === WebSocket.OPEN
        ) {
          socket.send('ping');
          timeoutIdRef.current = setTimeout(() => {
            timeoutIdRef.current = null;
            if (isCurrentConnection(socket)) {
              socket.close();
              clearTimeout(pingTimeoutRef.current);
              pingTimeoutRef.current = null;
            }
          }, 5000);
        }
      } catch (error) {
        console.error('Error during ping (notifications):', error);
      }
    };

    const initWebsocketNotifications = async () => {
      forceCloseWebSocket();
      const connectionId = connectionIdRef.current;
      const isCurrentConnection = (socket?: WebSocket | null) => {
        if (!effectActive || connectionIdRef.current !== connectionId) {
          return false;
        }
        if (socket && socketRef.current !== socket) return false;
        return true;
      };
      const currentAddress = myAddress;
      if (extStateRef.current === 'not-authenticated') return;
      if (currentAddress !== myAddressRef.current) return;

      const namesAbortController = new AbortController();
      namesAbortControllerRef.current = namesAbortController;
      try {
        const getNamesUrl = `${getBaseApiReact()}/names/address/${currentAddress}?limit=0`;
        const namesResponse = await fetch(getNamesUrl, {
          signal: namesAbortController.signal,
        });
        const namesData = await namesResponse.json();
        if (!isCurrentConnection()) return;
        listOfMyNamesRef.current = namesData.map(
          (n: { name: string }) => n.name
        );
        const query = `qortal_qmail_${userName.slice(0, 20)}_${currentAddress.slice(-6)}_mail_`;
        const socketLink = `${getBaseApiReactSocket()}/websockets/notifications`;
        const NOTIFICATION_AGE_MS = 3 * 24 * 60 * 60 * 1000;
        const getNotificationCreatorTimestamp = (n: {
          data?: { created?: number; timestamp?: number };
          timestamp?: number;
        }) => n?.data?.created ?? n?.data?.timestamp ?? n?.timestamp;
        const trimNotificationsToLast3Days = <
          T extends {
            data?: { created?: number; timestamp?: number };
            timestamp?: number;
          },
        >(
          list: T[]
        ): T[] => {
          const cutoff = Date.now() - NOTIFICATION_AGE_MS;
          return list.filter((n) => {
            const ts = getNotificationCreatorTimestamp(n);
            return ts == null || ts >= cutoff;
          }) as T[];
        };
        const socket = new WebSocket(socketLink);
        socketRef.current = socket;

        socket.onopen = () => {
          if (!isCurrentConnection(socket)) {
            socket.close(1000, 'superseded');
            return;
          }
          setSocketOpen(true);
          socket.send(
            JSON.stringify({
              action: 'subscribe',
              subscriptions: [
                {
                  event: 'PAYMENT_RECEIVED',
                  notificationId: 'payment-notification',

                  filters: {
                    recipient: currentAddress,
                  },
                },
                {
                  event: 'RESOURCE_PUBLISHED',
                  resourceFilter: {
                    service: 'MAIL_PRIVATE',
                    identifier: query, // same variable you're using in the fetch
                    excludeBlocked: true,
                    mode: 'ALL',
                  },
                  image: `/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true`,
                  link: 'qortal://app/Q-Mail',
                  notificationId: 'q-mail-notification',
                  appName: 'Q-Mail',
                  appService: 'APP',
                  message: getNewQmailMessage(),
                },
              ],
            })
          );
          historyRequestTimeoutRef.current = setTimeout(() => {
            historyRequestTimeoutRef.current = null;
            if (
              !isCurrentConnection(socket) ||
              socket.readyState !== WebSocket.OPEN
            )
              return;
            const after = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago (ms)
            socket.send(
              JSON.stringify({
                action: 'notification-history',
                paymentReceivedLimit: 5,
                after,
              })
            );
          }, 1000);
          pingTimeoutRef.current = setTimeout(
            () => pingHeads(socket, isCurrentConnection),
            50
          );
        };

        socket.onmessage = (e) => {
          if (!isCurrentConnection(socket)) return;
          try {
            if (e.data === 'pong') {
              clearTimeout(timeoutIdRef.current);
              timeoutIdRef.current = null;
              pingTimeoutRef.current = setTimeout(
                () => pingHeads(socket, isCurrentConnection),
                coreWebsocketPingMs()
              );
            } else {
              const data = JSON.parse(e.data);

              if (data?.type === 'history' && data?.results) {
                const filtered = data.results.filter(
                  (n) =>
                    !(
                      n?.event === 'RESOURCE_PUBLISHED' &&
                      listOfMyNamesRef.current.includes(n?.data?.name)
                    )
                );
                setPaymentNotifications((previous) =>
                  applyKnownPaymentSenders([
                    ...previous.filter(isQChatMentionNotification),
                    ...trimNotificationsToLast3Days(filtered),
                  ])
                );
                void resolvePaymentSenders(filtered).then((found) => {
                  if (found && isCurrentConnection(socket)) {
                    setPaymentNotifications(applyKnownPaymentSenders);
                  }
                });
              }
              if (data?.event === PAYMENT_RECEIVED_EVENT && data?.data) {
                const signature = data.data.signature;
                const sender = String(data.data.sender ?? '').trim();
                const alertKey = signature ? `payment-${signature}` : undefined;
                setPaymentNotifications((prev) => {
                  const trimmed = trimNotificationsToLast3Days(prev);
                  const alreadyExists = trimmed.some(
                    (n) =>
                      n?.event === PAYMENT_RECEIVED_EVENT &&
                      n?.data?.signature === signature
                  );
                  if (alreadyExists) return trimmed;
                  return applyKnownPaymentSenders([data, ...trimmed]);
                });
                // One tray alert per payment, however often Core sends it.
                const alertDue = !alertKey || !wasAlertShown(alertKey);
                if (alertKey) rememberShownAlert(alertKey);
                if (alertDue)
                  void (async () => {
                    // Who paid: name and avatar, when the node knows them in
                    // time; otherwise the short address and the Q-Wallets icon.
                    const senderName = sender
                      ? await lookupPaymentSenderName(sender)
                      : '';
                    if (!isCurrentConnection(socket)) return;
                    if (senderName) {
                      setPaymentNotifications(applyKnownPaymentSenders);
                    }
                    const tx = applyKnownPaymentSenders([data])[0];
                    const label = paymentSenderLabel(tx);
                    fireOsNotificationPayment(
                      tx,
                      label
                        ? i18n.t('core:message.generic.new_payment_from', {
                            name: label,
                          })
                        : i18n.t('core:message.generic.new_payment_received'),
                      i18n.t('core:message.generic.new_payment_body', {
                        amount: formatPaymentAmount(
                          tx?.data?.amount ?? 0,
                          i18n.language
                        ),
                      }),
                      `${getBaseApiReact()}${paymentAvatarPath(senderName)}`,
                      undefined,
                      { openWallets: true },
                      {
                        alertKey,
                        fromAddress: sender || 'Q-Wallets',
                        notificationType: PAYMENT_ALERT_TYPE,
                      }
                    );
                  })();
              }
              if (data?.event === 'RESOURCE_PUBLISHED' && data?.data) {
                const tx = { ...data };
                if (listOfMyNamesRef.current.includes(tx?.data?.name)) return;
                if (tx.data && tx.data.created == null) {
                  tx.data = { ...tx.data, created: Date.now() };
                }
                setPaymentNotifications((prev) => {
                  const trimmed = trimNotificationsToLast3Days(prev);
                  const alreadyExists = trimmed.some(
                    (n) =>
                      n?.event === 'RESOURCE_PUBLISHED' &&
                      n?.data?.identifier === tx.data?.identifier
                  );
                  if (alreadyExists) return trimmed;
                  return [tx, ...trimmed];
                });
                // The alert shows and opens the Q-App that asked for it,
                // under its registered name.
                void (async () => {
                  const owner = getNotificationOwnerApp(tx);
                  const spelling = owner
                    ? await getNotificationOwnerSpelling(owner.name)
                    : '';
                  if (!isCurrentConnection(socket)) return;
                  const owned = pinNotificationToOwnerApp(tx, spelling);
                  fireOsNotificationPayment(
                    owned,
                    i18n.t('core:message.generic.new_notification_from', {
                      appName: spelling || tx.appName || 'App',
                    }),
                    getNotificationMessage(owned.message),
                    `${getBaseApiReact()}${owned.image}`,
                    owned?.link
                  );
                })();
              }
            }
          } catch (error) {
            console.error('Error parsing notifications message:', error);
          }
        };

        socket.onclose = (event) => {
          if (!isCurrentConnection(socket)) return;
          socketRef.current = null;
          setSocketOpen(false);
          clearTimeout(historyRequestTimeoutRef.current);
          historyRequestTimeoutRef.current = null;
          clearTimeout(pingTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          console.warn(
            `Notifications WebSocket closed: ${event.reason || 'unknown reason'}`
          );
          if (extStateRef.current === 'not-authenticated') return;
          if (event.reason !== 'forced' && event.code !== 1000) {
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              if (isCurrentConnection()) {
                void initWebsocketNotifications();
              }
            }, 10000);
          }
        };

        socket.onerror = (error) => {
          if (!isCurrentConnection(socket)) return;
          console.error('Notifications WebSocket error:', error);
          clearTimeout(pingTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          socket.close();
        };
      } catch (error) {
        if (namesAbortController.signal.aborted) return;
        console.error('Error initializing notifications WebSocket:', error);
      } finally {
        if (namesAbortControllerRef.current === namesAbortController) {
          namesAbortControllerRef.current = null;
        }
      }
    };

    initWebsocketRef.current = initWebsocketNotifications;

    (async () => {
      const filtered = await filterSubscriptionsByNotificationPermission(
        customSubscriptions ?? []
      );
      if (!effectActive) return;
      setCustomSubscriptions(filtered);
      void initWebsocketNotifications();
    })();

    return () => {
      effectActive = false;
      initWebsocketRef.current = null;
      forceCloseWebSocket();
    };
  }, [myAddress, extState, userName]);

  return null;
};
