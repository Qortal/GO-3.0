import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Tooltip,
  useTheme,
} from '@mui/material';
import AllInclusiveRoundedIcon from '@mui/icons-material/AllInclusiveRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { CustomStyledMenu } from '../ContextMenu';
import {
  formatReticulumExpiryDuration,
  isReticulumMessageExpiryOptionAllowed,
  RETICULUM_MESSAGE_EXPIRY_OPTIONS,
} from './reticulumMessageExpiry';

type ReticulumMessageExpiryButtonProps = {
  channelExpiryDurationMs?: number;
  direct?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Keep the chat composer focused so the Android keyboard stays up. */
  keepFocus?: () => void;
  onChange: (durationMs: number | undefined) => void;
  segmented?: boolean;
  value?: number | null;
};

const expiryMenuItemSx = {
  borderRadius: '6px',
  fontSize: 13,
  fontWeight: 600,
  minHeight: 36,
  px: 1,
  py: 0.65,
  transition: 'background-color 120ms ease',
  '&:hover': { backgroundColor: 'action.hover' },
  '& .MuiListItemIcon-root': {
    color: 'text.secondary',
    minWidth: 30,
  },
  '& .MuiListItemText-primary': {
    fontSize: 13,
    fontWeight: 600,
    lineHeight: '18px',
  },
  '& .MuiListItemText-secondary': {
    fontSize: 11,
    lineHeight: '15px',
  },
  '& .MuiSvgIcon-root': { fontSize: 18 },
};

const expiryIndicatorLabel = (durationMs?: number): string | null => {
  if (!durationMs) return null;
  const option = RETICULUM_MESSAGE_EXPIRY_OPTIONS.find(
    (candidate) => candidate.durationMs === durationMs
  );
  return option?.shortLabel ?? null;
};

export function ReticulumMessageExpiryButton({
  channelExpiryDurationMs,
  direct = false,
  disabled = false,
  disabledReason,
  keepFocus,
  onChange,
  segmented = false,
  value,
}: ReticulumMessageExpiryButtonProps) {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const keepFocusRef = useRef(keepFocus);
  keepFocusRef.current = keepFocus;
  const effectiveExpiryDurationMs =
    value === null ? undefined : (value ?? channelExpiryDurationMs);
  const indicatorLabel = expiryIndicatorLabel(effectiveExpiryDurationMs);
  const channelDefaultSummary = channelExpiryDurationMs
    ? `Maximum ${formatReticulumExpiryDuration(channelExpiryDurationMs)}`
    : 'No expiry';
  const channelDefaultLabel = useMemo(
    () =>
      channelExpiryDurationMs
        ? `Channel default (${formatReticulumExpiryDuration(channelExpiryDurationMs)})`
        : 'Channel default (no expiry)',
    [channelExpiryDurationMs]
  );
  const tooltip = disabled
    ? disabledReason || 'Message expiry is unavailable'
    : segmented
      ? 'Message expiry'
      : value === null
        ? 'Message expiry: No expiry'
        : value
          ? `Message expiry: ${formatReticulumExpiryDuration(value)}`
          : `Message expiry: ${channelDefaultLabel}`;

  useEffect(() => {
    if (disabled) setAnchorEl(null);
  }, [disabled]);

  useEffect(() => {
    if (!anchorEl) return;
    keepFocusRef.current?.();
  }, [anchorEl]);

  const select = (durationMs: number | undefined) => {
    onChange(durationMs);
    setAnchorEl(null);
    keepFocusRef.current?.();
  };

  return (
    <>
      <Tooltip title={tooltip}>
        <Box
          component="span"
          sx={
            segmented
              ? {
                  display: 'flex',
                  height: '100%',
                }
              : undefined
          }
        >
          <IconButton
            aria-label="Set message expiry"
            aria-haspopup="menu"
            aria-expanded={anchorEl ? 'true' : undefined}
            disabled={disabled}
            onClick={(event: MouseEvent<HTMLElement>) => {
              setAnchorEl(event.currentTarget);
              keepFocusRef.current?.();
            }}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => event.preventDefault()}
            size="small"
            tabIndex={-1}
            sx={{
              alignItems: 'center',
              display: 'inline-flex',
              justifyContent: 'center',
              // MUI's default padding plus the segment divider pull the short
              // label ("1M") off-centre inside the button.
              padding: 0,
              backgroundColor: segmented
                ? theme.palette.background.default
                : value !== undefined
                  ? theme.palette.action.selected
                  : 'transparent',
              border: segmented ? 'none' : `1px solid ${theme.palette.divider}`,
              borderRadius: segmented ? 0 : '8px',
              color:
                value !== undefined
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
              flexShrink: 0,
              // Fill the segmented container rather than assuming its height:
              // a fixed 38px inside the 34px mobile group clipped the label and
              // pushed it off centre.
              height: segmented ? '100%' : 34,
              position: 'relative',
              width: segmented ? 40 : 34,
              '&::after': segmented
                ? {
                    backgroundColor: theme.palette.divider,
                    content: '""',
                    height: 20,
                    position: 'absolute',
                    right: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '1px',
                  }
                : undefined,
              '&:hover': segmented
                ? {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  }
                : undefined,
              '&.Mui-focusVisible': {
                boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
              },
            }}
          >
            {indicatorLabel ? (
              <Box
                component="span"
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: '11px',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 800,
                  height: '100%',
                  justifyContent: 'center',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  // The segment divider eats the right edge; offset the label by
                  // its width so it reads as centred in the visible area.
                  paddingRight: segmented ? '1px' : 0,
                  textAlign: 'center',
                  width: '100%',
                }}
              >
                {indicatorLabel}
              </Box>
            ) : (
              <AllInclusiveRoundedIcon
                sx={{ color: 'inherit' }}
                titleAccess="No expiry"
              />
            )}
          </IconButton>
        </Box>
      </Tooltip>
      <CustomStyledMenu
        reticulumMenu
        anchorEl={anchorEl}
        disableAutoFocus
        disableAutoFocusItem
        disableEnforceFocus
        disableRestoreFocus
        disableScrollLock
        onClose={() => {
          setAnchorEl(null);
          keepFocusRef.current?.();
        }}
        open={Boolean(anchorEl)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            onMouseDown: (event) => event.preventDefault(),
            sx: {
              backgroundColor: `${theme.palette.background.paper} !important`,
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <MenuItem
            selected={direct ? value === null : value === undefined}
            onClick={() => select(undefined)}
            onMouseDown={(event) => event.preventDefault()}
            sx={expiryMenuItemSx}
          >
            <ListItemIcon>
              {direct ? (
                value === null ? (
                  <CheckRoundedIcon />
                ) : null
              ) : value === undefined ? (
                <CheckRoundedIcon />
              ) : null}
            </ListItemIcon>
            <ListItemText
              primary={direct ? 'No expiry' : 'Channel default'}
              secondary={direct ? 'Do not auto-delete' : channelDefaultSummary}
            />
          </MenuItem>
          {RETICULUM_MESSAGE_EXPIRY_OPTIONS.map((option) => {
            const allowed = isReticulumMessageExpiryOptionAllowed(
              option.durationMs,
              channelExpiryDurationMs
            );
            return (
              <MenuItem
                disabled={!allowed}
                key={option.durationMs}
                selected={value === option.durationMs}
                onClick={() => select(option.durationMs)}
                onMouseDown={(event) => event.preventDefault()}
                sx={expiryMenuItemSx}
              >
                <ListItemIcon>
                  {value === option.durationMs ? <CheckRoundedIcon /> : null}
                </ListItemIcon>
                <ListItemText
                  primary={option.label}
                  secondary={
                    allowed || !channelExpiryDurationMs
                      ? undefined
                      : `Channel maximum is ${formatReticulumExpiryDuration(
                          channelExpiryDurationMs
                        )}`
                  }
                />
              </MenuItem>
            );
          })}
        </Box>
      </CustomStyledMenu>
    </>
  );
}
