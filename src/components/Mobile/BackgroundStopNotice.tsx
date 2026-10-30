/**
 * "GO was stopped in the background": the phone's own battery manager froze
 * GO while background sync was on (vendorFreezeHintStore.ts decides when).
 * One component, two places:
 * - 'bell': a card at the top of the notifications panel (GeneralNotifications),
 *   with X and a swipe to close it;
 * - 'settings': a block in Background sync settings, with the same facts and
 *   steps, no X, and a way to turn the bell warnings back on.
 * Never a modal: it only shows where the user already looked.
 */
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Collapse,
  FormControlLabel,
  IconButton,
  Typography,
  alpha,
  useTheme,
  type Theme,
} from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SwipeToDismiss } from '../common/SwipeToDismiss';
import { displayManufacturer } from './backgroundSync';
import { vendorBatterySteps } from './vendorBatterySteps';
import {
  useVendorFreezeHint,
  vendorFreezeHintActions,
  type VendorFreezeHintSnapshot,
} from './vendorFreezeHintStore';

export type BackgroundStopNoticeVariant = 'bell' | 'settings';

export type BackgroundStopNoticeActions = Pick<
  typeof vendorFreezeHintActions,
  | 'allowInBackground'
  | 'closeCard'
  | 'expandSteps'
  | 'openBatterySettings'
  | 'setDontShowAgain'
>;

/** What the notice says; null when it has nothing to say. */
export type BackgroundStopNoticeContent = {
  kind: 'fixable' | 'exempt_still_frozen';
  /** Significant stops in the last 7 days (0: say "stopped", no number). */
  count: number;
  lastAt: number | null;
};

export const backgroundStopNoticeContent = (
  snapshot: VendorFreezeHintSnapshot,
  variant: BackgroundStopNoticeVariant
): BackgroundStopNoticeContent | null => {
  if (!snapshot.ready || snapshot.mode === 'off') return null;
  const { settings } = snapshot;
  if (variant === 'bell') {
    const { bell } = snapshot;
    if (!bell) return null;
    // The card can outlive the 7-day window it was raised for; the summary
    // only gives a number while it is still true "in the last 7 days".
    return {
      kind: bell.variant,
      count: settings.episodes7d,
      lastAt: bell.lastAt,
    };
  }
  if (settings.variant === 'none') return null;
  return {
    kind: settings.variant,
    count: settings.episodes7d,
    lastAt: settings.lastAt,
  };
};

const formatStoppedAt = (at: number, language: string): string => {
  const date = new Date(at);
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  };
  try {
    return date.toLocaleString(language || undefined, options);
  } catch {
    return date.toLocaleString(undefined, options);
  }
};

const MIN_TAP_PX = 44;

/** Link-coloured text that stays readable on the light theme's paper. */
const linkColor = (theme: Theme) =>
  theme.palette.mode === 'dark'
    ? theme.palette.primary.main
    : theme.palette.primary.dark;

type ViewProps = {
  variant: BackgroundStopNoticeVariant;
  snapshot: VendorFreezeHintSnapshot;
  actions: BackgroundStopNoticeActions;
};

/** The notice drawn from a snapshot; BackgroundStopNotice feeds it the store. */
export const BackgroundStopNoticeView = ({
  variant,
  snapshot,
  actions,
}: ViewProps) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const titleId = useId();
  const stepsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  const content = backgroundStopNoticeContent(snapshot, variant);
  const isBell = variant === 'bell';

  const secondaryText = alpha(theme.palette.text.secondary, 0.9);
  const textSx = {
    color: secondaryText,
    fontSize: '0.8125rem',
    lineHeight: 1.45,
  };

  // Settings, warnings ticked off and nothing recent: only the way back.
  if (!content) {
    if (
      isBell ||
      !snapshot.ready ||
      snapshot.mode === 'off' ||
      !snapshot.dontShowAgain
    ) {
      return null;
    }
    return (
      <WarningsOffRow
        onTurnOn={() => void actions.setDontShowAgain(false)}
        textSx={textSx}
      />
    );
  }

  const manufacturer = displayManufacturer(snapshot.manufacturer);
  const steps = vendorBatterySteps(snapshot.manufacturer);
  const exempt = content.kind === 'exempt_still_frozen';
  const showAllow = !exempt && !snapshot.ignoringBatteryOptimizations;
  const accent = theme.palette.warning.main;
  const unseen = isBell && Boolean(snapshot.bell?.badge);

  const summary =
    content.count > 0
      ? t(
          manufacturer
            ? 'core:background_sync.vendor_freeze.summary'
            : 'core:background_sync.vendor_freeze.summary_unknown',
          { count: content.count, manufacturer }
        )
      : t(
          manufacturer
            ? 'core:background_sync.vendor_freeze.summary_recent'
            : 'core:background_sync.vendor_freeze.summary_recent_unknown',
          { manufacturer }
        );

  const toggleSteps = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) void actions.expandSteps();
  };

  const allowInBackground = async () => {
    setOpenFailed(false);
    const opened = await actions.allowInBackground();
    if (!opened) {
      setOpenFailed(true);
      setExpanded(true);
    }
  };

  const openBatterySettings = async () => {
    setOpenFailed(false);
    // Readable on the way back from the phone's settings.
    setExpanded(true);
    const opened = await actions.openBatterySettings();
    if (!opened) setOpenFailed(true);
  };

  const buttonSx = {
    borderRadius: '10px',
    boxShadow: 'none',
    // Side by side when they fit, else one full-width button per row.
    flex: '1 1 auto',
    fontSize: '0.8125rem',
    fontWeight: 700,
    lineHeight: 1.3,
    minHeight: MIN_TAP_PX,
    px: 1.6,
    textTransform: 'none',
  } as const;

  return (
    <Box
      aria-labelledby={titleId}
      component="section"
      sx={{
        // A card not acted on yet (it counts in the bell badge) stands out.
        backgroundColor: alpha(accent, unseen ? 0.13 : 0.07),
        border: `1px solid ${alpha(accent, unseen ? 0.55 : 0.36)}`,
        borderRadius: isBell ? '14px' : '12px',
        display: 'grid',
        gap: 1,
        minWidth: 0,
        px: isBell ? 1.35 : 1.3,
        py: 1.1,
        width: '100%',
      }}
    >
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.15 }}>
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(accent, 0.16),
            borderRadius: '10px',
            color: accent,
            display: 'flex',
            flexShrink: 0,
            height: 34,
            justifyContent: 'center',
            width: 34,
          }}
        >
          <WarningAmberRoundedIcon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, pt: 0.2 }}>
          <Typography
            component="h3"
            id={titleId}
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.9rem',
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {t('core:background_sync.vendor_freeze.title')}
          </Typography>
          <Typography sx={{ ...textSx, mt: 0.4 }}>{summary}</Typography>
        </Box>
        {isBell && (
          <IconButton
            aria-label={t('core:background_sync.vendor_freeze.dismiss')}
            onClick={(event) => {
              event.stopPropagation();
              void actions.closeCard();
            }}
            sx={{
              color: theme.palette.text.secondary,
              flexShrink: 0,
              height: MIN_TAP_PX,
              mr: -1,
              mt: -0.9,
              width: MIN_TAP_PX,
            }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Typography sx={textSx}>
        {exempt
          ? manufacturer
            ? t('core:background_sync.vendor_freeze.exempt_body', {
                manufacturer,
              })
            : t('core:background_sync.vendor_freeze.exempt_body_unknown')
          : t('core:background_sync.vendor_freeze.impact')}
      </Typography>

      {content.lastAt != null && (
        <Typography sx={{ ...textSx, color: theme.palette.text.secondary }}>
          {t('core:background_sync.vendor_freeze.last_stopped', {
            time: formatStoppedAt(content.lastAt, i18n.language),
          })}
        </Typography>
      )}

      <Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
          {showAllow && (
            <Button
              disableElevation
              onClick={(event) => {
                event.stopPropagation();
                void allowInBackground();
              }}
              variant="contained"
              sx={buttonSx}
            >
              {t('core:background_sync.vendor_freeze.allow_in_background')}
            </Button>
          )}
          <Button
            onClick={(event) => {
              event.stopPropagation();
              void openBatterySettings();
            }}
            variant="outlined"
            sx={{
              ...buttonSx,
              borderColor: alpha(theme.palette.primary.main, 0.45),
              color: theme.palette.text.primary,
            }}
          >
            {t('core:background_sync.vendor_freeze.open_battery_settings')}
          </Button>
        </Box>
        {/* Always mounted, so screen readers announce the text when it is
            put in (a live region inserted with its text is often missed). */}
        <Box aria-live="polite" role="status">
          {openFailed && (
            <Typography
              sx={{
                ...textSx,
                color: theme.palette.error.main,
                fontWeight: 600,
                mt: 1,
              }}
            >
              {t('core:background_sync.vendor_freeze.open_failed')}
            </Typography>
          )}
        </Box>
      </Box>

      <Box>
        <ButtonBase
          // The steps are unmounted while collapsed: point at them only
          // while they exist.
          aria-controls={expanded ? stepsId : undefined}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            toggleSteps();
          }}
          sx={{
            alignItems: 'center',
            borderRadius: '10px',
            color: linkColor(theme),
            display: 'flex',
            fontSize: '0.8125rem',
            fontWeight: 700,
            gap: 0.5,
            justifyContent: 'space-between',
            lineHeight: 1.3,
            minHeight: MIN_TAP_PX,
            mx: -0.5,
            px: 0.5,
            textAlign: 'left',
            width: 'calc(100% + 8px)',
          }}
        >
          <span>
            {steps.brandLabel
              ? t('core:background_sync.vendor_freeze.steps_toggle', {
                  brand: steps.brandLabel,
                })
              : t('core:background_sync.vendor_freeze.steps_toggle_generic')}
          </span>
          <ExpandMoreRoundedIcon
            sx={{
              flexShrink: 0,
              fontSize: 22,
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms ease',
            }}
          />
        </ButtonBase>
        <Collapse id={stepsId} in={expanded} unmountOnExit>
          <Box
            component="ol"
            sx={{
              color: theme.palette.text.primary,
              display: 'grid',
              gap: 0.6,
              m: 0,
              pb: 0.6,
              pl: 2.6,
              pt: 0.3,
            }}
          >
            {steps.stepKeys.map((key) => (
              <Typography
                component="li"
                key={key}
                sx={{
                  ...textSx,
                  color: theme.palette.text.primary,
                  overflowWrap: 'anywhere',
                }}
              >
                {t(key)}
              </Typography>
            ))}
          </Box>
          <Box sx={{ display: 'grid', gap: 0.4, mt: 0.4 }}>
            {steps.noteKeys.map((key) => (
              <Typography key={key} sx={textSx}>
                {t(key)}
              </Typography>
            ))}
          </Box>
        </Collapse>
      </Box>

      {!isBell && snapshot.dontShowAgain ? (
        <WarningsOffRow
          inline
          onTurnOn={() => void actions.setDontShowAgain(false)}
          textSx={textSx}
        />
      ) : (
        <FormControlLabel
          control={
            <Checkbox
              checked={snapshot.dontShowAgain}
              onChange={(event) =>
                void actions.setDontShowAgain(event.target.checked)
              }
              onClick={(event) => event.stopPropagation()}
              size="small"
              sx={{ height: MIN_TAP_PX, width: MIN_TAP_PX }}
            />
          }
          label={t('core:background_sync.vendor_freeze.dont_show_again')}
          sx={{
            alignSelf: 'start',
            minHeight: MIN_TAP_PX,
            ml: -1.2,
            mr: 0,
            '& .MuiFormControlLabel-label': {
              color: theme.palette.text.secondary,
              fontSize: '0.8125rem',
              fontWeight: 600,
            },
          }}
        />
      )}
    </Box>
  );
};

/** Settings: the bell warnings were ticked off; one tap turns them back on. */
const WarningsOffRow = ({
  inline = false,
  onTurnOn,
  textSx,
}: {
  inline?: boolean;
  onTurnOn: () => void;
  textSx: Record<string, unknown>;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Box
      sx={{
        alignItems: 'center',
        columnGap: 1,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        ...(inline
          ? { borderTop: `1px solid ${theme.palette.divider}`, pt: 0.6 }
          : {
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '12px',
              px: 1.3,
              py: 0.4,
            }),
      }}
    >
      <Typography sx={{ ...textSx, flex: '1 1 160px', py: 0.6 }}>
        {t('core:background_sync.vendor_freeze.warnings_off')}
      </Typography>
      <Button
        onClick={(event) => {
          event.stopPropagation();
          onTurnOn();
        }}
        sx={{
          borderRadius: '10px',
          color: linkColor(theme),
          fontSize: '0.8125rem',
          fontWeight: 700,
          minHeight: MIN_TAP_PX,
          px: 1.2,
          textTransform: 'none',
        }}
        variant="text"
      >
        {t('core:background_sync.vendor_freeze.warnings_on')}
      </Button>
    </Box>
  );
};

/**
 * The notice, fed by the store. 'bell' renders nothing until the policy
 * raises a card, and swipes away like the panel's other cards.
 */
export const BackgroundStopNotice = ({
  variant,
}: {
  variant: BackgroundStopNoticeVariant;
}) => {
  const snapshot = useVendorFreezeHint();
  const view = (
    <BackgroundStopNoticeView
      actions={vendorFreezeHintActions}
      snapshot={snapshot}
      variant={variant}
    />
  );
  if (variant !== 'bell') return view;
  return (
    <AnimatePresence initial={false}>
      {backgroundStopNoticeContent(snapshot, 'bell') && (
        <SwipeToDismiss
          gapPx={8}
          key="background-stop-notice"
          onDismiss={() => void vendorFreezeHintActions.closeCard()}
        >
          {view}
        </SwipeToDismiss>
      )}
    </AnimatePresence>
  );
};
