import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  IMMERSIVE_MODES,
  immersiveModeAtom,
  type ImmersiveMode,
} from './immersiveMode';

const LABELS: Record<ImmersiveMode, [key: string, fallback: string]> = {
  off: ['immersive_off', 'Off'],
  auto: ['immersive_auto', 'Auto'],
  manual: ['immersive_manual', 'Manual'],
};

const DETAILS: Record<ImmersiveMode, [key: string, fallback: string]> = {
  off: ['immersive_off_desc', 'The top and bottom bars are always shown.'],
  auto: [
    'immersive_auto_desc',
    'The bars slide away when scrolling down and come back when scrolling up.',
  ],
  manual: [
    'immersive_manual_desc',
    'The bars stay hidden. Tap the floating button to show them for a few seconds.',
  ],
};

/**
 * System settings row for immersive mode (GO phones): Off / Auto / Manual,
 * with a short line on what the chosen one does.
 */
export const ImmersiveModeSetting = () => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const [mode, setMode] = useAtom(immersiveModeAtom);
  const reduceMotion = useReducedMotion();
  const isDark = theme.palette.mode === 'dark';
  const td = (key: string, defaultValue: string) =>
    t(`group:dashboard.${key}`, { defaultValue });
  const [detailKey, detailFallback] = DETAILS[mode];

  return (
    <Box sx={{ px: 1.35, py: 1.2 }}>
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '0.82rem',
          fontWeight: 700,
          letterSpacing: '0.01em',
        }}
      >
        {td('immersive_mode', 'Immersive mode')}
      </Typography>
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.75rem',
          lineHeight: 1.45,
          mt: 0.4,
        }}
      >
        {td(
          'immersive_mode_desc',
          'Hides the top bar, the bottom bar and the status bar so Q-Apps and websites fill the screen. Home and Chat keep their bars.'
        )}
      </Typography>

      <Box
        role="radiogroup"
        aria-label={td('immersive_mode', 'Immersive mode')}
        sx={{
          backgroundColor: isDark
            ? alpha(theme.palette.common.white, 0.05)
            : alpha(theme.palette.common.black, 0.05),
          border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          borderRadius: '12px',
          display: 'grid',
          gap: 0.4,
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          mt: 1.1,
          p: 0.4,
        }}
      >
        {IMMERSIVE_MODES.map((option) => {
          const selected = option === mode;
          const [labelKey, labelFallback] = LABELS[option];
          return (
            <ButtonBase
              key={option}
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(option)}
              sx={{
                borderRadius: '9px',
                color: selected
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
                fontSize: '0.8rem',
                fontWeight: selected ? 700 : 600,
                minHeight: 36,
                position: 'relative',
                transition: 'color 180ms ease',
              }}
            >
              {selected ? (
                <motion.span
                  layoutId="immersive-mode-highlight"
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
                {td(labelKey, labelFallback)}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>

      <Box sx={{ minHeight: '2.9em', mt: 0.9, position: 'relative' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.74rem',
                lineHeight: 1.45,
              }}
            >
              {td(detailKey, detailFallback)}
            </Typography>
          </motion.div>
        </AnimatePresence>
      </Box>
    </Box>
  );
};
