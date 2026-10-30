/**
 * "GO runs slower with WebView JIT off" (GrapheneOS only): a calm card at the
 * top of the bell panel (GeneralNotifications), fed by
 * webViewJitNoticeStore.ts, which decides when it shows. It says what the
 * setting costs, that it is a security setting and the user's choice, and
 * how to change it in the phone's settings. Never a modal, no outside links;
 * X or a swipe closes it.
 */
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SpeedRoundedIcon from '@mui/icons-material/SpeedRounded';
import {
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SwipeToDismiss } from '../common/SwipeToDismiss';
import {
  useWebViewJitNotice,
  webViewJitNoticeActions,
  type WebViewJitNoticeSnapshot,
} from './webViewJitNoticeStore';

export type WebViewJitNoticeActions = Pick<
  typeof webViewJitNoticeActions,
  'closeCard' | 'setDontShowAgain'
>;

/** Every text the card shows, in order (also used by the tests). */
export const WEBVIEW_JIT_NOTICE_TEXT_KEYS = [
  'core:webview_jit_notice.title',
  'core:webview_jit_notice.body',
  'core:webview_jit_notice.choice',
  'core:webview_jit_notice.steps_title',
  'core:webview_jit_notice.step_1',
  'core:webview_jit_notice.step_2',
  'core:webview_jit_notice.dont_show_again',
  'core:webview_jit_notice.dismiss',
] as const;

const STEP_KEYS = [
  'core:webview_jit_notice.step_1',
  'core:webview_jit_notice.step_2',
] as const;

const MIN_TAP_PX = 44;

/** The card drawn from a snapshot; WebViewJitNotice feeds it the store. */
export const WebViewJitNoticeView = ({
  snapshot,
  actions,
}: {
  snapshot: WebViewJitNoticeSnapshot;
  actions: WebViewJitNoticeActions;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const titleId = useId();
  if (!snapshot.ready || !snapshot.card) return null;

  // Advice, not an alarm: the calm info colour, never the warning one.
  const accent = theme.palette.info.main;
  const unseen = snapshot.card.badge;
  const textSx = {
    color: alpha(theme.palette.text.secondary, 0.9),
    fontSize: '0.8125rem',
    lineHeight: 1.45,
  };

  return (
    <Box
      aria-labelledby={titleId}
      component="section"
      sx={{
        backgroundColor: alpha(accent, unseen ? 0.11 : 0.06),
        border: `1px solid ${alpha(accent, unseen ? 0.45 : 0.3)}`,
        borderRadius: '14px',
        display: 'grid',
        gap: 1,
        minWidth: 0,
        px: 1.35,
        py: 1.1,
        width: '100%',
      }}
    >
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.15 }}>
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(accent, 0.14),
            borderRadius: '10px',
            color: accent,
            display: 'flex',
            flexShrink: 0,
            height: 34,
            justifyContent: 'center',
            width: 34,
          }}
        >
          <SpeedRoundedIcon sx={{ fontSize: 20 }} />
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
            {t('core:webview_jit_notice.title')}
          </Typography>
          <Typography sx={{ ...textSx, mt: 0.4 }}>
            {t('core:webview_jit_notice.body')}
          </Typography>
        </Box>
        <IconButton
          aria-label={t('core:webview_jit_notice.dismiss')}
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
      </Box>

      <Typography sx={textSx}>{t('core:webview_jit_notice.choice')}</Typography>

      <Box>
        <Typography
          sx={{
            ...textSx,
            color: theme.palette.text.primary,
            fontWeight: 700,
          }}
        >
          {t('core:webview_jit_notice.steps_title')}
        </Typography>
        <Box
          component="ol"
          sx={{
            color: theme.palette.text.primary,
            display: 'grid',
            gap: 0.5,
            m: 0,
            pl: 2.6,
            pt: 0.4,
          }}
        >
          {STEP_KEYS.map((key) => (
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
      </Box>

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
        label={t('core:webview_jit_notice.dont_show_again')}
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
    </Box>
  );
};

/**
 * The bell card, fed by the store: renders nothing until the store raises
 * a card, and swipes away like the panel's other cards.
 */
export const WebViewJitNotice = () => {
  const snapshot = useWebViewJitNotice();
  return (
    <AnimatePresence initial={false}>
      {snapshot.ready && snapshot.card && (
        <SwipeToDismiss
          gapPx={8}
          key="webview-jit-notice"
          onDismiss={() => void webViewJitNoticeActions.closeCard()}
        >
          <WebViewJitNoticeView
            actions={webViewJitNoticeActions}
            snapshot={snapshot}
          />
        </SwipeToDismiss>
      )}
    </AnimatePresence>
  );
};
