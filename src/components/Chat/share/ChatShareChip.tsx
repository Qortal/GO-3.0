import { Box, IconButton, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import MovieRoundedIcon from '@mui/icons-material/MovieRounded';
import NotesRoundedIcon from '@mui/icons-material/NotesRounded';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHAT_LIST_TOUCH_TARGET } from '../../Group/chatListRowStyles';
import type { PreparedChatShare } from './chatShareIntake';

const sentence = { postProcess: 'capitalizeFirstChar' };

type ChatShareKind = 'photo' | 'video' | 'file' | 'link' | 'text';

const LINK = /^(https?:\/\/|www\.)\S+$/i;

/** What the share is, for its icon and label. */
function chatShareKind(share: PreparedChatShare): ChatShareKind {
  const item = share.items[0];
  if (!item) return LINK.test(share.text.trim()) ? 'link' : 'text';
  const mime = item.mimeType ?? '';
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

const KIND_ICONS = {
  file: InsertDriveFileRoundedIcon,
  link: LinkRoundedIcon,
  photo: ImageRoundedIcon,
  text: NotesRoundedIcon,
  video: MovieRoundedIcon,
} as const;

/** The shared picture, once read (cleaned) from the native copy. */
function useSharedPicture(share: PreparedChatShare): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!share.items[0]?.mimeType?.startsWith('image/')) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void share.files.then((files) => {
      const picture = files.find((file) => file.type?.startsWith('image/'));
      if (cancelled || !picture) return;
      objectUrl = URL.createObjectURL(picture);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [share]);
  return url;
}

/**
 * What was shared from another app, while it waits for a chat: in the phone
 * Q-Chat header, where the search, new and settings buttons are. A picture
 * shows as a thumbnail, anything else as its kind; the X drops the share.
 * The chat tapped in the list below takes it; in a group's channel step
 * (`picking` 'channel'), the channel tapped.
 */
export function ChatShareChip({
  share,
  picking = 'chat',
  onCancel,
}: {
  share: PreparedChatShare;
  picking?: 'chat' | 'channel';
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['reticulum']);
  const picture = useSharedPicture(share);
  const kind = chatShareKind(share);
  const Icon = KIND_ICONS[kind];
  const item = share.items[0];
  const title =
    kind === 'file' && item?.name
      ? item.name
      : kind === 'link' || kind === 'text'
        ? share.text.trim()
        : t(`reticulum:share.kind_${kind}`, sentence);
  const what = t(`reticulum:share.kind_${kind}`);

  return (
    <Box
      role="group"
      aria-label={t(
        picking === 'channel'
          ? 'reticulum:share.chip_label_channel'
          : 'reticulum:share.chip_label',
        { ...sentence, what }
      )}
      data-chat-share-chip=""
      sx={{
        '@keyframes chatShareChipIn': {
          from: { opacity: 0, transform: 'scale(0.92)' },
          to: { opacity: 1, transform: 'none' },
        },
        alignItems: 'center',
        animation: 'chatShareChipIn 180ms cubic-bezier(0.2, 0, 0, 1)',
        backgroundColor: alpha(theme.palette.primary.main, 0.12),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
        borderRadius: '11px',
        boxSizing: 'border-box',
        display: 'flex',
        // Only the room the Groups / DMs switch leaves: its labels fit their
        // text exactly, so any squeeze would cut them. A long name is cut
        // here instead.
        flex: '1 1 0px',
        gap: 1,
        height: CHAT_LIST_TOUCH_TARGET,
        maxWidth: 210,
        minWidth: 0,
        pl: '3px',
      }}
    >
      <Box
        aria-hidden
        sx={{
          alignItems: 'center',
          backgroundColor: alpha(theme.palette.primary.main, 0.16),
          backgroundImage: picture ? `url("${picture}")` : 'none',
          backgroundPosition: 'center',
          backgroundSize: 'cover',
          borderRadius: '8px',
          color: 'primary.main',
          display: 'flex',
          flexShrink: 0,
          height: 36,
          justifyContent: 'center',
          width: 36,
        }}
      >
        {picture ? null : <Icon sx={{ fontSize: 20 }} />}
      </Box>
      <Box sx={{ flex: '1 1 auto', lineHeight: 1.2, minWidth: 0 }}>
        <Typography
          noWrap
          sx={{
            color: 'text.primary',
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.25,
          }}
        >
          {title}
        </Typography>
        <Typography
          noWrap
          sx={{ color: 'text.secondary', fontSize: 11.5, lineHeight: 1.25 }}
        >
          {t(
            picking === 'channel'
              ? 'reticulum:share.pick_channel'
              : 'reticulum:share.pick_chat',
            sentence
          )}
        </Typography>
      </Box>
      <IconButton
        aria-label={t('reticulum:share.cancel', sentence)}
        onClick={onCancel}
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          height: 40,
          width: 40,
        }}
      >
        <CloseRoundedIcon sx={{ fontSize: 20 }} />
      </IconButton>
    </Box>
  );
}
