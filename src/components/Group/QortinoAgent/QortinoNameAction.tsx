import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import {
  Avatar,
  Box,
  Menu,
  MenuItem,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import PersonSearchRoundedIcon from '@mui/icons-material/PersonSearchRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import { qAppAvatarUrl } from '../../../qortinoAgent/qAppCatalog';

type Props = {
  name: string;
  avatarUrl?: string;
  /** Show avatar beside the blue name */
  showAvatar?: boolean;
  /**
   * When true, hide the avatar entirely until the image loads successfully.
   * On error (no THUMBNAIL published), show no avatar and no letter fallback.
   */
  avatarHideIfMissing?: boolean;
  avatarSize?: number;
  /** Extra label after name (e.g. " · primary") — not part of copy/search */
  suffix?: ReactNode;
  fontSize?: string;
  fontWeight?: number;
  onSearchUser: (name: string) => void;
  /**
   * When set, tapping the avatar opens this instead of the name menu
   * (e.g. fullscreen avatar viewer). Name label still opens Copy / Search.
   */
  onAvatarClick?: (src: string) => void;
};

/**
 * Blue highlighted Qortal name. Tap opens: Copy name / Search user (who is).
 */
export function QortinoNameAction({
  name,
  avatarUrl,
  showAvatar = false,
  avatarHideIfMissing = false,
  avatarSize = 40,
  suffix,
  fontSize = '0.9rem',
  fontWeight = 700,
  onSearchUser,
  onAvatarClick,
}: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [copyHint, setCopyHint] = useState('');
  const [avatarOk, setAvatarOk] = useState(!avatarHideIfMissing);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const open = Boolean(anchor);
  const blue = isDark ? '#7EB6FF' : '#1A6FD4';
  const src = avatarUrl || qAppAvatarUrl(name);
  const renderAvatar =
    showAvatar &&
    !avatarFailed &&
    (!avatarHideIfMissing || avatarOk);
  const avatarOpensLightbox = typeof onAvatarClick === 'function';

  useEffect(() => {
    if (!showAvatar || !avatarHideIfMissing) {
      setAvatarOk(true);
      setAvatarFailed(false);
      return;
    }
    let cancelled = false;
    setAvatarOk(false);
    setAvatarFailed(false);
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setAvatarOk(true);
    };
    img.onerror = () => {
      if (!cancelled) {
        setAvatarFailed(true);
        setAvatarOk(false);
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [avatarHideIfMissing, showAvatar, src]);

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget);
  };

  const handleClose = () => {
    setAnchor(null);
    setCopyHint('');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setCopyHint('Copied');
      window.setTimeout(() => {
        handleClose();
      }, 650);
    } catch {
      setCopyHint('Copy failed');
      window.setTimeout(() => handleClose(), 900);
    }
  };

  const handleSearch = () => {
    handleClose();
    onSearchUser(name);
  };

  return (
    <>
      <Box
        sx={{
          alignItems: 'center',
          display: 'inline-flex',
          gap: renderAvatar ? 0.85 : 0,
          maxWidth: '100%',
          minWidth: 0,
          verticalAlign: 'baseline',
        }}
      >
        {renderAvatar ? (
          <Box
            component="button"
            type="button"
            aria-label={
              avatarOpensLightbox
                ? `View ${name} avatar fullscreen`
                : `Actions for ${name}`
            }
            onClick={(e: MouseEvent<HTMLElement>) => {
              if (avatarOpensLightbox) {
                onAvatarClick?.(src);
                return;
              }
              handleOpen(e);
            }}
            sx={{
              appearance: 'none',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              p: 0,
            }}
          >
            <Avatar
              alt={name}
              src={src}
              imgProps={{
                referrerPolicy: 'no-referrer',
                loading: 'lazy',
                decoding: 'async',
              }}
              sx={{
                border: `2px solid ${alpha(blue, 0.45)}`,
                flexShrink: 0,
                height: avatarSize,
                width: avatarSize,
              }}
            >
              {avatarHideIfMissing ? null : (
                <PersonRoundedIcon sx={{ fontSize: avatarSize * 0.55 }} />
              )}
            </Avatar>
          </Box>
        ) : null}
        <Box
          component="button"
          type="button"
          onClick={handleOpen}
          aria-haspopup="menu"
          aria-expanded={open ? 'true' : undefined}
          aria-label={`Actions for ${name}`}
          sx={{
            appearance: 'none',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            maxWidth: '100%',
            minWidth: 0,
            p: 0,
            textAlign: 'left',
            '&:hover .qortino-name-label': {
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
            },
          }}
        >
          <Typography
            component="span"
            className="qortino-name-label"
            sx={{
              color: blue,
              fontSize,
              fontWeight,
              lineHeight: 1.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
            {suffix}
          </Typography>
        </Box>
      </Box>
      <Menu
        anchorEl={anchor}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              borderRadius: '12px',
              minWidth: 180,
            },
          },
        }}
      >
        <MenuItem onClick={() => void handleCopy()} dense>
          <ContentCopyRoundedIcon sx={{ fontSize: 18, mr: 1.1, opacity: 0.85 }} />
          {copyHint || 'Copy name'}
        </MenuItem>
        <MenuItem onClick={handleSearch} dense>
          <PersonSearchRoundedIcon sx={{ fontSize: 18, mr: 1.1, opacity: 0.85 }} />
          Search user
        </MenuItem>
      </Menu>
    </>
  );
}
