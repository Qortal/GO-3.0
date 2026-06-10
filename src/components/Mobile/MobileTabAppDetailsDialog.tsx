import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CircularProgress,
  Dialog,
  IconButton,
  Rating,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { StarEmptyIcon } from '../../assets/Icons/StarEmpty';
import { StarFilledIcon } from '../../assets/Icons/StarFilled';
import { AuthButton } from '../Auth/AuthShell';
import {
  dialogModalBackdropSx,
  getDialogInfoCardSx,
  getDialogPaperSx,
} from '../App/dialogSurface';
import { useAppRating } from '../../hooks/useAppRatings';
import { fetchTabAppDetails, type TabAppDetails } from './fetchTabAppDetails';
import { TabAvatar, colorFor } from './MobileTabsOverlay.shared';
import { buildTabQortalUrl } from './tabQortalLink';
import { MOBILE_TABS_DIALOG_Z } from './mobileLayout';
import type { OpenTab } from './useOpenTabs';

type MobileTabAppDetailsDialogProps = {
  open: boolean;
  tab: OpenTab | null;
  displayTitle: string;
  onClose: () => void;
  onOpenTabOptions?: (tab: OpenTab) => void;
};

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: typeof InfoOutlinedIcon;
  children: string;
}) {
  const theme = useTheme();

  return (
    <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.65, mb: 0.85 }}>
      <Icon sx={{ color: theme.palette.primary.main, fontSize: 16 }} />
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: 0.55,
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Typography>
    </Box>
  );
}

export function MobileTabAppDetailsDialog({
  open,
  tab,
  displayTitle,
  onClose,
  onOpenTabOptions,
}: MobileTabAppDetailsDialogProps) {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const [details, setDetails] = useState<TabAppDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const { rating, containerRef, refresh } = useAppRating(
    open && tab && !tab.internal && tab.name
      ? String(tab.name)
      : undefined,
    open && tab && !tab.internal && tab.service
      ? String(tab.service)
      : undefined
  );

  const link = useMemo(() => (tab ? buildTabQortalUrl(tab) : ''), [tab]);
  const infoCardSx = getDialogInfoCardSx(theme);
  const accentColor = colorFor(displayTitle);

  useEffect(() => {
    if (!open || !tab) {
      setDetails(null);
      setCopyHint('');
      return;
    }

    window.getSelection()?.removeAllRanges();

    let cancelled = false;
    setLoading(true);
    void fetchTabAppDetails(tab, displayTitle).then((result) => {
      if (!cancelled) {
        setDetails(result);
        setLoading(false);
      }
    });

    if (!tab.internal && tab.name && tab.service) {
      void refresh();
    }

    return () => {
      cancelled = true;
    };
  }, [displayTitle, open, refresh, tab]);

  const averageRating = rating?.averageRating ?? 0;
  const totalVotes = rating?.totalVotes ?? 0;

  const handleCopyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyHint('Link copied');
      window.setTimeout(() => setCopyHint(''), 1800);
    } catch {
      setCopyHint('Copy failed');
      window.setTimeout(() => setCopyHint(''), 1800);
    }
  };

  const title = details?.title || displayTitle;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
      slotProps={{
        backdrop: { sx: dialogModalBackdropSx },
      }}
      PaperProps={{
        sx: {
          ...getDialogPaperSx(theme, { maxWidth: 420, radius: 22 }),
          maxHeight: 'calc(100% - 32px)',
          mx: 'auto',
          overflow: 'hidden',
        },
      }}
    >
      <Box
        sx={{
          background: isLight
            ? `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, transparent 100%)`
            : `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.16)} 0%, transparent 100%)`,
          borderBottom: `1px solid ${alpha(theme.palette.divider, isLight ? 0.9 : 0.14)}`,
          px: 2,
          pt: 1.5,
          pb: 1.75,
          position: 'relative',
        }}
      >
        <IconButton
          aria-label="Close"
          onClick={onClose}
          size="small"
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            bgcolor: alpha(theme.palette.background.paper, isLight ? 0.75 : 0.35),
          }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>

        {!tab ? null : loading && !details ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <Box
            ref={containerRef}
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              pt: 0.5,
              textAlign: 'center',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                bgcolor: alpha(accentColor, 0.14),
                border: `2px solid ${alpha(accentColor, 0.28)}`,
                borderRadius: '18px',
                boxShadow: `0 10px 28px ${alpha(accentColor, 0.22)}`,
                display: 'flex',
                height: 72,
                justifyContent: 'center',
                mb: 1.25,
                width: 72,
              }}
            >
              <TabAvatar
                color={accentColor}
                tab={tab}
                title={displayTitle}
                size={56}
              />
            </Box>
            <Typography
              sx={{
                fontSize: '1.2rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
                maxWidth: '100%',
                overflow: 'hidden',
                px: 1,
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </Typography>
            {!details?.isInternal && details?.qortalName ? (
              <Box sx={{ mt: 0.55 }}>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.84rem' }}>
                  @{details.qortalName}
                </Typography>
                {details.primaryName ? (
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem', mt: 0.2 }}>
                    {details.primaryName}
                  </Typography>
                ) : null}
              </Box>
            ) : (
              <Typography sx={{ color: 'text.secondary', fontSize: '0.84rem', mt: 0.55 }}>
                Built-in Qortal GO tab
              </Typography>
            )}
            {!details?.isInternal ? (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 0.75,
                  justifyContent: 'center',
                  mt: 1,
                }}
              >
                <Rating
                  value={averageRating}
                  precision={0.1}
                  readOnly
                  size="small"
                  icon={<StarFilledIcon />}
                  emptyIcon={<StarEmptyIcon />}
                />
                <Typography sx={{ color: 'text.secondary', fontSize: '0.82rem' }}>
                  {averageRating > 0 ? averageRating.toFixed(1) : 'No rating yet'}
                  {totalVotes > 0 ? ` · ${totalVotes}` : ''}
                </Typography>
              </Box>
            ) : null}
          </Box>
        )}
      </Box>

      {tab && (!loading || details) ? (
        <Box sx={{ maxHeight: '52vh', overflowY: 'auto', px: 2, py: 1.75 }}>
          <Box sx={{ ...infoCardSx, mb: 1.25 }}>
            <SectionLabel icon={InfoOutlinedIcon}>Description</SectionLabel>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '0.9rem',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {details?.description?.trim() ||
                (details?.isInternal
                  ? 'This is a built-in Qortal GO tab.'
                  : 'No description available.')}
            </Typography>
          </Box>

          {!details?.isInternal && details?.primaryName ? (
            <Box sx={{ ...infoCardSx, mb: 1.25 }}>
              <SectionLabel icon={PersonOutlineRoundedIcon}>Publisher</SectionLabel>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {details.primaryName}
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.82rem', mt: 0.25 }}>
                @{details.qortalName}
              </Typography>
            </Box>
          ) : null}

          {!details?.isInternal && averageRating > 0 ? (
            <Box sx={{ ...infoCardSx, mb: 1.25 }}>
              <SectionLabel icon={StarOutlineRoundedIcon}>Rating</SectionLabel>
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
                <Rating
                  value={averageRating}
                  precision={0.1}
                  readOnly
                  size="small"
                  icon={<StarFilledIcon />}
                  emptyIcon={<StarEmptyIcon />}
                />
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  {averageRating.toFixed(1)}
                  {totalVotes > 0 ? ` (${totalVotes} ratings)` : ''}
                </Typography>
              </Box>
            </Box>
          ) : null}

          <Box sx={{ ...infoCardSx, mb: copyHint ? 0.5 : 1.5 }}>
            <SectionLabel icon={LinkRoundedIcon}>Qortal link</SectionLabel>
            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                gap: 0.75,
              }}
            >
              <Typography
                sx={{
                  flex: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-all',
                }}
              >
                {link}
              </Typography>
              <IconButton
                aria-label="Copy link"
                onClick={() => void handleCopyLink()}
                size="small"
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: theme.palette.primary.main,
                  flexShrink: 0,
                  mt: -0.25,
                }}
              >
                <ContentCopyRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Box>
          </Box>
          {copyHint ? (
            <Typography
              sx={{
                color: 'success.main',
                fontSize: '0.78rem',
                fontWeight: 600,
                mb: 1.25,
                textAlign: 'center',
              }}
            >
              {copyHint}
            </Typography>
          ) : null}

          {onOpenTabOptions ? (
            <AuthButton
              fullWidth
              onClick={() => {
                if (!tab) return;
                onOpenTabOptions(tab);
              }}
              primary
              prominence="subtle"
            >
              <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.75 }}>
                <TuneRoundedIcon sx={{ fontSize: 18 }} />
                Tab options
              </Box>
            </AuthButton>
          ) : null}
        </Box>
      ) : null}
    </Dialog>
  );
}
