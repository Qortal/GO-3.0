import { useEffect, useState } from 'react';
import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import PhoneLockedRoundedIcon from '@mui/icons-material/PhoneLockedRounded';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  openFullScreenRingSettings,
  useCallTransportPreference,
  useFullScreenRingAllowed,
  type CallTransportPreference,
} from './callBridgeAdapters';
import { useGoCallInProgressKind } from './goCallUi';

const OPTIONS: CallTransportPreference[] = ['webrtc', 'reticulum'];

const LABEL_KEYS: Record<CallTransportPreference, string> = {
  webrtc: 'core:go_call.settings_direct',
  reticulum: 'core:go_call.settings_private',
};

const DETAIL_KEYS: Record<CallTransportPreference, string> = {
  webrtc: 'core:go_call.settings_direct_desc',
  reticulum: 'core:go_call.settings_private_desc',
};

/**
 * GO Home settings row: how 1:1 calls connect. Direct (WebRTC first, local
 * addresses never sent, Reticulum fallback) or Private (Reticulum only).
 * A 1:1 call that runs keeps its way of connecting: changed during one, the
 * row says it applies from the next call. A group call takes the change
 * right away (mobileAudioSurface re-syncs its WebRTC edges, the bridge shows
 * or hides groupCall.sendRtcSignal), so nothing is said then. On Android
 * 14+ it also says when calls cannot show over the lock screen, with Allow
 * (Android's switch).
 */
export type GoCallPrivacySettingProps = {
  /** Preview only: show this full-screen ring state instead of Android's. */
  fullScreenRingAllowed?: boolean | null;
};

export function GoCallPrivacySetting({
  fullScreenRingAllowed: fullScreenRingOverride,
}: GoCallPrivacySettingProps = {}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [preference, setPreference] = useCallTransportPreference();
  const reduceMotion = useReducedMotion();
  const isDark = theme.palette.mode === 'dark';
  // Only a running 1:1 call keeps its transport until it ends.
  const inDirectCall = useGoCallInProgressKind() === 'direct';
  const [changedInCall, setChangedInCall] = useState(false);
  useEffect(() => {
    if (!inDirectCall) setChangedInCall(false);
  }, [inDirectCall]);
  const nativeFullScreenRing = useFullScreenRingAllowed(
    fullScreenRingOverride === undefined
  );
  const fullScreenRingAllowed =
    fullScreenRingOverride !== undefined
      ? fullScreenRingOverride
      : nativeFullScreenRing;

  return (
    <Box sx={{ px: 1.35, py: 1.2 }} data-testid="go-call-privacy-setting">
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '0.82rem',
          fontWeight: 700,
          letterSpacing: '0.01em',
        }}
      >
        {t('core:go_call.settings_title')}
      </Typography>
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.75rem',
          lineHeight: 1.45,
          mt: 0.4,
        }}
      >
        {t('core:go_call.settings_desc')}
      </Typography>

      <Box
        role="radiogroup"
        aria-label={t('core:go_call.settings_title')}
        sx={{
          backgroundColor: isDark
            ? alpha(theme.palette.common.white, 0.05)
            : alpha(theme.palette.common.black, 0.05),
          border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          borderRadius: '12px',
          display: 'grid',
          gap: 0.4,
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          mt: 1.1,
          p: 0.4,
        }}
      >
        {OPTIONS.map((option) => {
          const selected = option === preference;
          return (
            <ButtonBase
              key={option}
              role="radio"
              aria-checked={selected}
              data-testid={`go-call-transport-${option}`}
              onClick={() => {
                if (option === preference) return;
                setPreference(option);
                if (inDirectCall) setChangedInCall(true);
              }}
              sx={{
                borderRadius: '9px',
                color: selected
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
                fontSize: '0.8rem',
                fontWeight: selected ? 700 : 600,
                minHeight: 40,
                position: 'relative',
                transition: 'color 180ms ease',
              }}
            >
              {selected ? (
                <motion.span
                  layoutId="go-call-transport-highlight"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 520, damping: 38 }
                  }
                  style={{
                    background: isDark
                      ? alpha(theme.palette.primary.main, 0.22)
                      : theme.palette.background.paper,
                    borderRadius: 9,
                    boxShadow: isDark
                      ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.45)}`
                      : '0 1px 4px rgba(15,20,30,0.14)',
                    inset: 0,
                    position: 'absolute',
                  }}
                />
              ) : null}
              <Box component="span" sx={{ position: 'relative' }}>
                {t(LABEL_KEYS[option])}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>

      <Box sx={{ minHeight: '2.9em', mt: 0.9, position: 'relative' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={preference}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            <Typography
              data-testid="go-call-transport-detail"
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.74rem',
                lineHeight: 1.45,
              }}
            >
              {t(DETAIL_KEYS[preference])}
            </Typography>
          </motion.div>
        </AnimatePresence>
      </Box>

      {changedInCall && inDirectCall ? (
        <Typography
          role="status"
          data-testid="go-call-transport-next-call"
          sx={{
            color: theme.palette.warning.main,
            fontSize: '0.74rem',
            fontWeight: 600,
            lineHeight: 1.45,
            mt: 0.5,
          }}
        >
          {t('core:go_call.settings_next_call')}
        </Typography>
      ) : null}

      {fullScreenRingAllowed === false ? (
        <Box
          data-testid="go-call-full-screen-off"
          sx={{
            alignItems: 'center',
            borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
            display: 'flex',
            gap: 1,
            mt: 1,
            pt: 1,
          }}
        >
          <PhoneLockedRoundedIcon
            sx={{ color: theme.palette.warning.main, fontSize: 18 }}
          />
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              flex: 1,
              fontSize: '0.74rem',
              lineHeight: 1.45,
              minWidth: 0,
            }}
          >
            {t('core:go_call.full_screen_off')}
          </Typography>
          <ButtonBase
            data-testid="go-call-full-screen-allow"
            onClick={() => void openFullScreenRingSettings()}
            sx={{
              borderRadius: 999,
              color: theme.palette.primary.main,
              flexShrink: 0,
              fontSize: '0.78rem',
              fontWeight: 700,
              minHeight: 36,
              px: 1.25,
            }}
          >
            {t('core:go_call.full_screen_allow')}
          </ButtonBase>
        </Box>
      ) : null}
    </Box>
  );
}
