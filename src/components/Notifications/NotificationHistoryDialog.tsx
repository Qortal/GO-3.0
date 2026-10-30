import { useMemo, useSyncExternalStore } from 'react';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import {
  clearNotificationHistory,
  getNotificationHistory,
  subscribeNotificationHistory,
  type NotificationHistoryEntry,
} from '../../utils/notificationHistory';
import {
  getSavedQdnFiles,
  subscribeQdnTransfers,
  type SavedQdnFile,
} from '../../utils/qdnDownloadNotifications';
import { useRegisteredName } from '../../utils/qdnNameDisplay';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { formatDate } from '../../utils/time';
import { AppThumbnailAvatar } from '../Apps/AppThumbnailAvatar';
import {
  isPaymentNotification,
  paymentSenderLabel,
} from '../../utils/paymentNotifications';
import { NotificationAppAvatar } from './NotificationAppAvatar';
import { SavedQdnFileRow } from '../Transfers/QdnDownloadsNotice';

type Row =
  | { kind: 'notification'; at: number; entry: NotificationHistoryEntry }
  | { kind: 'download'; at: number; file: SavedQdnFile };

type NotificationHistoryDialogProps = {
  open: boolean;
  onClose: () => void;
  address?: string;
  fullScreen?: boolean;
  /** Opens a notification the way the panel does. */
  onOpenNotification: (notification: Record<string, any>) => void;
  /** The notification's text in the current language. */
  describe: (notification: Record<string, any>) => string;
};

const isGroupItem = (notification: Record<string, any>) =>
  notification?.data?.qChatMention === true ||
  notification?.data?.reticulumCalendarReminder === true;

/**
 * `formats` holds the date formats made so far in one pass over the list
 * (one with the year, one without), so a long history does not build one
 * per row.
 */
function dayLabel(
  at: number,
  language: string,
  t: (key: string) => string,
  formats: Map<boolean, Intl.DateTimeFormat>
) {
  const day = new Date(at);
  const today = new Date();
  const startOf = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(day)) / 86_400_000);
  if (diffDays === 0) return t('core:notification_history.today');
  if (diffDays === 1) return t('core:notification_history.yesterday');
  try {
    const withYear = day.getFullYear() !== today.getFullYear();
    let format = formats.get(withYear);
    if (!format) {
      format = new Intl.DateTimeFormat(language, {
        day: 'numeric',
        month: 'long',
        ...(withYear ? { year: 'numeric' as const } : {}),
      });
      formats.set(withYear, format);
    }
    return format.format(day);
  } catch {
    return day.toLocaleDateString();
  }
}

function HistoryNotificationRow({
  entry,
  describe,
  onOpen,
}: {
  entry: NotificationHistoryEntry;
  describe: (notification: Record<string, any>) => string;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const notification = entry.notification;
  const group = isGroupItem(notification);
  const payment = isPaymentNotification(notification);
  const appName = useRegisteredName(
    group || payment ? '' : notification?.appName || 'Q-App'
  );
  const title = group
    ? String(notification?.data?.groupName || '')
    : payment
      ? paymentSenderLabel(notification)
      : appName || 'Q-App';
  const dark = theme.palette.mode === 'dark';

  return (
    <ButtonBase
      onClick={onOpen}
      sx={{
        alignItems: 'flex-start',
        backgroundColor: dark ? alpha('#FFFFFF', 0.025) : 'action.hover',
        border: `1px solid ${
          dark ? alpha('#A9BCD8', 0.12) : alpha(theme.palette.divider, 0.95)
        }`,
        borderRadius: '12px',
        display: 'flex',
        gap: 1.2,
        justifyContent: 'flex-start',
        p: 1.35,
        textAlign: 'left',
        width: '100%',
      }}
    >
      {group ? (
        <Avatar
          alt={title}
          sx={{
            bgcolor: dark
              ? alpha('#FFFFFF', 0.06)
              : alpha(theme.palette.primary.main, 0.08),
            height: 34,
            width: 34,
          }}
        >
          <img
            alt=""
            src={LogoSelected}
            style={{ height: 'auto', width: 20 }}
          />
        </Avatar>
      ) : payment ? (
        <NotificationAppAvatar
          alt={title}
          isQChatMention={false}
          isQMail={false}
          notification={notification}
          sx={{
            bgcolor: dark
              ? alpha('#FFFFFF', 0.06)
              : alpha(theme.palette.primary.main, 0.08),
            height: 34,
            width: 34,
          }}
        />
      ) : (
        <AppThumbnailAvatar
          alt={title}
          appName={appName}
          fallbackSize={20}
          sx={{ height: 34, width: 34 }}
        />
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1,
            justifyContent: 'space-between',
          }}
        >
          <Typography
            noWrap
            sx={{ color: 'text.primary', fontSize: '0.86rem', fontWeight: 650 }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.72),
              flexShrink: 0,
              fontSize: '0.72rem',
            }}
          >
            {formatDate(entry.at)}
          </Typography>
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
          {describe(notification)}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

/**
 * Everything that has been in the notifications panel over the last 30 days,
 * including what was swiped away, plus the files saved to the phone.
 */
export function NotificationHistoryDialog({
  open,
  onClose,
  address,
  fullScreen = false,
  onOpenNotification,
  describe,
}: NotificationHistoryDialogProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const dark = theme.palette.mode === 'dark';

  const entries = useSyncExternalStore(
    subscribeNotificationHistory,
    () => getNotificationHistory(address),
    () => getNotificationHistory(address)
  );
  const savedFiles = useSyncExternalStore(
    subscribeQdnTransfers,
    getSavedQdnFiles,
    getSavedQdnFiles
  );

  const days = useMemo(() => {
    const rows: Row[] = [
      ...entries.map(
        (entry): Row => ({ kind: 'notification', at: entry.at, entry })
      ),
      ...savedFiles.map(
        (file): Row => ({ kind: 'download', at: file.savedAt, file })
      ),
    ].sort((a, b) => b.at - a.at);
    const grouped: Array<{ label: string; rows: Row[] }> = [];
    const formats = new Map<boolean, Intl.DateTimeFormat>();
    for (const row of rows) {
      const label = dayLabel(row.at, i18n.language, t, formats);
      const last = grouped[grouped.length - 1];
      if (last && last.label === label) last.rows.push(row);
      else grouped.push({ label, rows: [row] });
    }
    return grouped;
  }, [entries, savedFiles, i18n.language, t]);

  return (
    <Dialog
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      onClose={onClose}
      open={open}
      PaperProps={{
        sx: {
          background: dark ? '#121821' : theme.palette.background.paper,
          backgroundImage: 'none',
          ...(fullScreen
            ? {
                borderRadius: 0,
                paddingBottom: SAFE_AREA_BOTTOM,
                paddingTop: SAFE_AREA_TOP,
              }
            : {
                border: `1px solid ${
                  dark ? alpha('#A9BCD8', 0.18) : theme.palette.divider
                }`,
                borderRadius: '18px',
              }),
        },
      }}
    >
      <DialogTitle
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${
            dark ? alpha('#A9BCD8', 0.1) : theme.palette.divider
          }`,
          display: 'flex',
          fontSize: '1.08rem',
          fontWeight: 700,
          gap: 1,
          px: 2,
          py: 1.4,
        }}
      >
        <HistoryRoundedIcon sx={{ color: 'text.secondary', fontSize: 22 }} />
        <Box component="span" sx={{ flex: 1 }}>
          {t('core:notification_history.title')}
        </Box>
        {entries.length > 0 && (
          <Button
            onClick={() => clearNotificationHistory(address)}
            size="small"
            sx={{ fontWeight: 600, textTransform: 'none' }}
          >
            {t('core:notification_history.clear')}
          </Button>
        )}
        <IconButton
          aria-label={t('core:notification_history.close')}
          onClick={onClose}
          size="small"
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 1.5, py: 1.5 }}>
        {days.length === 0 ? (
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.8),
              fontSize: '0.86rem',
              mt: 3,
              px: 2,
              textAlign: 'center',
            }}
          >
            {t('core:notification_history.empty')}
          </Typography>
        ) : (
          days.map((day) => (
            <Box key={day.label} sx={{ mb: 2 }}>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.8),
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  mb: 0.8,
                  mt: 1,
                  px: 0.5,
                }}
              >
                {day.label}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {day.rows.map((row) =>
                  row.kind === 'download' ? (
                    <SavedQdnFileRow
                      file={row.file}
                      key={row.file.id}
                      onOpened={onClose}
                    />
                  ) : (
                    <HistoryNotificationRow
                      describe={describe}
                      entry={row.entry}
                      key={row.entry.key}
                      onOpen={() => {
                        onClose();
                        onOpenNotification(row.entry.notification);
                      }}
                    />
                  )
                )}
              </Box>
            </Box>
          ))
        )}
      </DialogContent>
    </Dialog>
  );
}
