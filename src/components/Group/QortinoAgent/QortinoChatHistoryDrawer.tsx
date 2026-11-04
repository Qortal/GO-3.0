import {
  Box,
  IconButton,
  SwipeableDrawer,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UNTITLED_CHAT_TITLE,
  type QortinoChatSession,
} from '../../../qortinoAgent/chatHistoryStore';
import type { QortinoInstallState } from '../../../qortinoAgent/store';
import { SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import { QortinoSettingsSection } from './QortinoSettingsSection';

type Props = {
  open: boolean;
  onClose: () => void;
  sessions: QortinoChatSession[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  install: QortinoInstallState;
  hasChats: boolean;
  onDeleteAllChats: () => void | Promise<void>;
  onRemoveQortino: () => Promise<void>;
};

const SWIPE_CLOSE_PX = 72;

export function QortinoChatHistoryDrawer({
  open,
  onClose,
  sessions,
  activeId,
  onNewChat,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
  install,
  hasChats,
  onDeleteAllChats,
  onRemoveQortino,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isDark = theme.palette.mode === 'dark';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragX, setDragX] = useState(0);
  const dragStartX = useRef<number | null>(null);
  const dragging = useRef(false);

  const resetDrag = () => {
    dragStartX.current = null;
    dragging.current = false;
    setDragX(0);
  };

  const titleOf = (session: QortinoChatSession) =>
    !session.titleCustom && session.title === UNTITLED_CHAT_TITLE
      ? t('core:qortino_agent.aria.new_chat')
      : session.title;

  /** An empty or unchanged name keeps the chat titled from its question. */
  const finishRename = (session: QortinoChatSession) => {
    const next = draft.trim();
    if (next && next !== titleOf(session)) onRename(session.id, next);
    setEditingId(null);
  };

  return (
    <SwipeableDrawer
      anchor="left"
      open={open}
      onClose={onClose}
      onOpen={() => {
        /* opened via button only */
      }}
      disableSwipeToOpen
      hysteresis={0.35}
      // Must sit above the fullscreen Qortino Dialog (MUI Dialog z-index 1300).
      sx={{ zIndex: 10000 }}
      ModalProps={{
        keepMounted: false,
        sx: { zIndex: 10000 },
      }}
      PaperProps={{
        onTouchStart: (e) => {
          dragStartX.current = e.touches[0]?.clientX ?? null;
          dragging.current = true;
        },
        onTouchMove: (e) => {
          if (!dragging.current || dragStartX.current == null) return;
          const x = e.touches[0]?.clientX ?? dragStartX.current;
          // Left drawer: swipe toward the left (negative delta) to dismiss.
          const delta = Math.min(0, x - dragStartX.current);
          setDragX(delta);
        },
        onTouchEnd: () => {
          if (dragX <= -SWIPE_CLOSE_PX) {
            onClose();
          }
          resetDrag();
        },
        onTouchCancel: resetDrag,
        sx: {
          background: isDark ? '#10131a' : '#f7f9fc',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          pt: SAFE_AREA_TOP,
          transform:
            open && dragX ? `translateX(${dragX}px) !important` : undefined,
          transition: dragX ? 'none' : undefined,
          width: 'min(320px, 86vw)',
          zIndex: 10001,
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
          display: 'flex',
          gap: 0.5,
          px: 1.25,
          py: 1,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>
            {t('core:qortino_agent.aria.history')}
          </Typography>
        </Box>
        <IconButton
          aria-label={t('core:qortino_agent.aria.new_chat')}
          size="small"
          onClick={() => {
            onNewChat();
            onClose();
          }}
          sx={{
            background: alpha('#7EB6FF', isDark ? 0.22 : 0.16),
            borderRadius: '10px',
          }}
        >
          <AddRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton
          aria-label={t('core:qortino_agent.history.close')}
          size="small"
          onClick={onClose}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 0.5,
          minHeight: 0,
          overflowY: 'auto',
          p: 1,
        }}
      >
        <QortinoSettingsSection
          install={install}
          hasChats={hasChats}
          onDeleteAllChats={onDeleteAllChats}
          onRemoveQortino={onRemoveQortino}
        />
        {!sessions.length ? (
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.55),
              fontSize: '0.85rem',
              px: 0.5,
              py: 1.5,
            }}
          >
            {t('core:qortino_agent.history.empty')}
          </Typography>
        ) : null}
        {sessions.map((s) => {
          const active = s.id === activeId;
          const editing = editingId === s.id;
          return (
            <Box
              key={s.id}
              sx={{
                background: active
                  ? alpha('#7EB6FF', isDark ? 0.22 : 0.14)
                  : alpha(theme.palette.background.paper, isDark ? 0.35 : 0.7),
                border: `1px solid ${
                  active
                    ? alpha('#7EB6FF', 0.55)
                    : alpha(theme.palette.divider, 0.45)
                }`,
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.45,
                p: 0.75,
              }}
            >
              {editing ? (
                <TextField
                  autoFocus
                  fullWidth
                  size="small"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      finishRename(s);
                    } else if (e.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                  onBlur={() => finishRename(s)}
                  inputProps={{ maxLength: 80 }}
                />
              ) : (
                <Box
                  component="button"
                  type="button"
                  onClick={() => {
                    onSelect(s.id);
                    onClose();
                  }}
                  onDoubleClick={() => {
                    setEditingId(s.id);
                    setDraft(titleOf(s));
                  }}
                  sx={{
                    appearance: 'none',
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontSize: '0.86rem',
                    fontWeight: active ? 800 : 600,
                    p: 0,
                    textAlign: 'left',
                    width: '100%',
                    wordBreak: 'break-word',
                  }}
                >
                  {s.pinned ? '📌 ' : ''}
                  {titleOf(s)}
                </Box>
              )}
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 0.15,
                  justifyContent: 'flex-end',
                }}
              >
                <IconButton
                  aria-label={t(
                    s.pinned
                      ? 'core:qortino_agent.history.unpin'
                      : 'core:qortino_agent.history.pin'
                  )}
                  size="small"
                  onClick={() => onTogglePin(s.id)}
                >
                  {s.pinned ? (
                    <PushPinRoundedIcon sx={{ fontSize: 18 }} />
                  ) : (
                    <PushPinOutlinedIcon sx={{ fontSize: 18 }} />
                  )}
                </IconButton>
                <IconButton
                  aria-label={t('core:qortino_agent.history.rename_chat')}
                  size="small"
                  onClick={() => {
                    setEditingId(s.id);
                    setDraft(titleOf(s));
                  }}
                  sx={{ fontSize: '0.72rem', fontWeight: 700, borderRadius: 0 }}
                >
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 800 }}>
                    {t('core:qortino_agent.history.rename')}
                  </Typography>
                </IconButton>
                <IconButton
                  aria-label={t('core:qortino_agent.history.delete_chat')}
                  size="small"
                  onClick={() => onDelete(s.id)}
                >
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
          );
        })}
      </Box>
    </SwipeableDrawer>
  );
}
