import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BackgroundStopNotice } from './BackgroundStopNotice';
import {
  BACKGROUND_SYNC_MODES,
  DEFAULT_BACKGROUND_SYNC_MODE,
  fetchBackgroundSyncState,
  isNativeAndroid,
  saveBackgroundSyncMode,
  subscribeBackgroundSyncEvents,
  type BackgroundSyncMode,
  type BackgroundSyncState,
} from './backgroundSync';
import { vendorFreezeHintActions } from './vendorFreezeHintStore';

// Charging / network changes are not pushed as events; a light poll keeps the
// status line honest while the settings screen is open.
const STATE_REFRESH_MS = 15000;

const MODE_LABEL_KEYS: Record<BackgroundSyncMode, string> = {
  off: 'core:background_sync.mode.off',
  charging: 'core:background_sync.mode.charging',
  always: 'core:background_sync.mode.always',
};

const MODE_HELP_KEYS: Record<BackgroundSyncMode, string> = {
  off: 'core:background_sync.help.off',
  charging: 'core:background_sync.help.charging',
  always: 'core:background_sync.help.always',
};

/**
 * "Background sync" setting (native Android only): Off / While charging /
 * Always, a live status line and, when the phone's own battery manager keeps
 * stopping GO, the facts and steps (BackgroundStopNotice, fed by
 * vendorFreezeHintStore). Renders nothing on web/desktop or when the APK
 * predates the native keep-alive plugin methods.
 */
export const MobileBackgroundSyncSetting = () => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const titleId = useId();
  const [supported] = useState(isNativeAndroid);
  const [state, setState] = useState<BackgroundSyncState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Every read is stamped; a local change (mode write) bumps the stamp so reads
  // already in flight cannot undo it. Reads are skipped while a native write
  // is still running and redone once it settles.
  const readStampRef = useRef(0);
  const writesInFlightRef = useRef(0);

  const refresh = useCallback(async () => {
    if (writesInFlightRef.current > 0) return;
    const stamp = ++readStampRef.current;
    const next = await fetchBackgroundSyncState();
    if (!next || stamp !== readStampRef.current) return;
    setState(next);
  }, []);

  const runLocalWrite = useCallback(
    async <T,>(write: () => Promise<T>): Promise<T> => {
      readStampRef.current += 1;
      writesInFlightRef.current += 1;
      try {
        return await write();
      } finally {
        writesInFlightRef.current -= 1;
        readStampRef.current += 1;
      }
    },
    []
  );

  useEffect(() => {
    if (!supported) return undefined;
    void refresh();
    // The stop notice below reads the app-wide store: fresh facts on open.
    void vendorFreezeHintActions.refresh();
    const interval = setInterval(() => void refresh(), STATE_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = subscribeBackgroundSyncEvents({
      onRelayProfileChanged: (relayProfile) => {
        setState((prev) => (prev ? { ...prev, relayProfile } : prev));
      },
    });
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  }, [refresh, supported]);

  const selectMode = useCallback(
    async (mode: BackgroundSyncMode) => {
      if (!state || state.mode === mode) return;
      const previous = state.mode;
      setSaveFailed(false);
      setSaving(true);
      setState((prev) => (prev ? { ...prev, mode } : prev));
      const ok = await runLocalWrite(() => saveBackgroundSyncMode(mode));
      setSaving(false);
      if (!ok) {
        setState((prev) => (prev ? { ...prev, mode: previous } : prev));
        setSaveFailed(true);
        return;
      }
      void refresh();
      // 'Off' hides the stop notice at once (and other modes may bring it).
      void vendorFreezeHintActions.refresh();
    },
    [refresh, runLocalWrite, state]
  );

  // Hidden until the native side answers: an older APK has no such setting.
  if (!supported || !state) return null;

  const mode = state.mode ?? DEFAULT_BACKGROUND_SYNC_MODE;

  const handleRadioKeyDown = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const count = BACKGROUND_SYNC_MODES.length;
    const nextIndex = (index + step + count) % count;
    radioRefs.current[nextIndex]?.focus();
    void selectMode(BACKGROUND_SYNC_MODES[nextIndex]);
  };

  // keepAliveActive is only true while GO is off screen, so while this card is
  // visible the line follows the keep-alive rule inputs instead.
  const syncingInBackground =
    state.keepAliveActive ||
    mode === 'always' ||
    (mode === 'charging' && state.charging);

  const statusLines: string[] = [];
  if (syncingInBackground) {
    statusLines.push(t('core:background_sync.status.syncing_now'));
  }
  if (state.relayProfile === 'full') {
    statusLines.push(t('core:background_sync.status.relaying'));
  }

  const secondaryText = alpha(theme.palette.text.secondary, 0.82);

  return (
    <Box
      aria-labelledby={titleId}
      role="group"
      sx={{
        backgroundColor: theme.palette.action.hover,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '14px',
        display: 'grid',
        gap: 1.1,
        minWidth: 0,
        px: 1.7,
        py: 1.4,
      }}
    >
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.2 }}>
        <SyncRoundedIcon
          sx={{
            color: theme.palette.primary.main,
            flexShrink: 0,
            fontSize: 20,
            mt: 0.2,
          }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id={titleId}
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.88rem',
              fontWeight: 600,
            }}
          >
            {t('core:background_sync.title')}
          </Typography>
          <Typography
            sx={{
              color: secondaryText,
              fontSize: '0.76rem',
              lineHeight: 1.45,
              mt: 0.3,
            }}
          >
            {t('core:background_sync.description')}
          </Typography>
        </Box>
      </Box>

      <Box
        aria-labelledby={titleId}
        role="radiogroup"
        sx={{
          backgroundColor: alpha(theme.palette.action.active, 0.055),
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '11px',
          display: 'grid',
          gap: 0.5,
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          p: 0.5,
        }}
      >
        {BACKGROUND_SYNC_MODES.map((value, index) => {
          const selected = mode === value;
          return (
            <ButtonBase
              aria-checked={selected}
              disabled={saving && !selected}
              key={value}
              onClick={() => void selectMode(value)}
              onKeyDown={(event) => handleRadioKeyDown(event, index)}
              ref={(node) => {
                radioRefs.current[index] = node;
              }}
              role="radio"
              tabIndex={selected ? 0 : -1}
              sx={{
                backgroundColor: selected
                  ? alpha(theme.palette.primary.main, 0.16)
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
                fontSize: '0.8rem',
                fontWeight: selected ? 650 : 550,
                lineHeight: 1.25,
                minHeight: 40,
                minWidth: 0,
                overflowWrap: 'anywhere',
                px: 0.6,
                py: 0.6,
                textAlign: 'center',
                transition:
                  'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
                '&:hover': {
                  backgroundColor: selected
                    ? alpha(theme.palette.primary.main, 0.2)
                    : alpha(theme.palette.action.active, 0.06),
                },
              }}
            >
              {t(MODE_LABEL_KEYS[value], {
                postProcess: 'capitalizeFirstChar',
              })}
            </ButtonBase>
          );
        })}
      </Box>

      <Box sx={{ display: 'grid', gap: 0.6 }}>
        <Typography
          sx={{ color: secondaryText, fontSize: '0.76rem', lineHeight: 1.45 }}
        >
          {t(MODE_HELP_KEYS[mode])}
        </Typography>
        {/* The battery grace only matters in 'While charging': 'Always'
            keeps syncing anyway and 'Off' has none. */}
        {mode === 'charging' && (
          <Typography
            sx={{ color: secondaryText, fontSize: '0.76rem', lineHeight: 1.45 }}
          >
            {t('core:background_sync.help.outbox')}
          </Typography>
        )}
        {/* Relaying on charger + Wi-Fi does not depend on the mode. */}
        <Typography
          sx={{ color: secondaryText, fontSize: '0.76rem', lineHeight: 1.45 }}
        >
          {t('core:background_sync.help.relay')}
        </Typography>
      </Box>

      {(statusLines.length > 0 || saveFailed) && (
        <Box aria-live="polite" sx={{ display: 'grid', gap: 0.3 }}>
          {statusLines.map((line) => (
            <Typography
              key={line}
              sx={{
                color: theme.palette.success.main,
                fontSize: '0.76rem',
                fontWeight: 600,
                lineHeight: 1.45,
              }}
            >
              {line}
            </Typography>
          ))}
          {saveFailed && (
            <Typography
              role="alert"
              sx={{
                color: theme.palette.error.main,
                fontSize: '0.76rem',
                fontWeight: 600,
                lineHeight: 1.45,
              }}
            >
              {t('core:background_sync.error.save_failed')}
            </Typography>
          )}
        </Box>
      )}

      <BackgroundStopNotice variant="settings" />
    </Box>
  );
};

export default MobileBackgroundSyncSetting;
