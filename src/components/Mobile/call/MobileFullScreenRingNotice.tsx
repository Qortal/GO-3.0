import { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Button, IconButton, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import PhoneLockedRoundedIcon from '@mui/icons-material/PhoneLockedRounded';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  mobileChatComposeActiveAtom,
  mobileEmojiPanelOpenAtom,
  mobileFullscreenComposerActiveAtom,
  mobileGroupPanelOpenAtom,
} from '../../../atoms/global';
import {
  getSoftKeyboardInset,
  subscribeSoftKeyboard,
} from '../../../hooks/useSoftKeyboardInset';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
} from '../../../utils/mobileSafeArea';
import { MOBILE_TAB_BAR_HEIGHT_PX } from '../mobileBarHeights';
import {
  openFullScreenRingSettings,
  useFullScreenRingAllowed,
} from './callBridgeAdapters';
import { CALL_FLOATING_STRIP_Z } from './goCallUi';

/** "Don't show again" for the notice (per device). */
export const FULL_SCREEN_RING_NOTICE_OFF_KEY = 'go.calls.fullScreenRingNotice';
/** Not straight at start-up, when GO has enough else going on. */
export const FULL_SCREEN_RING_NOTICE_DELAY_MS = 6_000;

// Closed (X or Allow) in this app session: not again until GO restarts.
let closedThisSession = false;

function readNoticeOff(): boolean {
  try {
    return localStorage.getItem(FULL_SCREEN_RING_NOTICE_OFF_KEY) === 'off';
  } catch {
    return false;
  }
}

function writeNoticeOff(): void {
  try {
    localStorage.setItem(FULL_SCREEN_RING_NOTICE_OFF_KEY, 'off');
  } catch {
    /* blocked storage: closed for this session only */
  }
}

/** Tests only. */
export function resetFullScreenRingNoticeForTests(): void {
  closedThisSession = false;
}

const keyboardUpNow = () => getSoftKeyboardInset() > 0;

/**
 * The user is typing or a panel fills the screen: the card would land just
 * above the keyboard, over the composer and its send button. True/false
 * only, so the card does not re-render while the keyboard animates.
 */
function useUserBusy(): boolean {
  const composing = useAtomValue(mobileChatComposeActiveAtom);
  const emojiPanel = useAtomValue(mobileEmojiPanelOpenAtom);
  const fullComposer = useAtomValue(mobileFullscreenComposerActiveAtom);
  const groupPanel = useAtomValue(mobileGroupPanelOpenAtom);
  const keyboardUp = useSyncExternalStore(
    subscribeSoftKeyboard,
    keyboardUpNow,
    () => false
  );
  return composing || emojiPanel || fullComposer || groupPanel || keyboardUp;
}

export type MobileFullScreenRingNoticeProps = {
  /**
   * Something else owns the screen now (a call, a ring, a lock, a section
   * other than Home). Typing and full-screen panels are checked here.
   */
  blocked: boolean;
};

/**
 * Android 14+ asks the user before an app may show an incoming call over
 * the lock screen. Without that OK a GO call only shows as a notification
 * while the phone is locked. This small card (not a dialog) says so once
 * per app start, with Allow (Android's own switch for GO), "Don't show
 * again" and a close button. Nothing on Android 13 and older, or when the
 * switch is already on. The Calls row in Home settings keeps an Allow
 * button for later.
 */
export function MobileFullScreenRingNotice({
  blocked,
}: MobileFullScreenRingNoticeProps) {
  const reduce = useReducedMotion();
  const [off, setOff] = useState(() => closedThisSession || readNoticeOff());
  const allowed = useFullScreenRingAllowed(!off);
  const [ready, setReady] = useState(false);
  const busy = useUserBusy();

  useEffect(() => {
    if (off) return undefined;
    const id = window.setTimeout(
      () => setReady(true),
      FULL_SCREEN_RING_NOTICE_DELAY_MS
    );
    return () => window.clearTimeout(id);
  }, [off]);

  const close = () => {
    closedThisSession = true;
    setOff(true);
  };

  // Waits (does not give up) while blocked or busy: the card comes up at the
  // next quiet moment on Home instead.
  const show = ready && !off && !blocked && !busy && allowed === false;

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="full-screen-ring-notice"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.3, 1] }}
          style={{
            bottom: `calc(${SAFE_AREA_BOTTOM} + ${MOBILE_TAB_BAR_HEIGHT_PX + 12}px)`,
            left: `calc(${SAFE_AREA_LEFT} + 12px)`,
            position: 'fixed',
            right: `calc(${SAFE_AREA_RIGHT} + 12px)`,
            zIndex: CALL_FLOATING_STRIP_Z,
          }}
        >
          <FullScreenRingNoticeCard
            onClose={close}
            onNever={() => {
              writeNoticeOff();
              close();
            }}
            onAllow={() => {
              close();
              void openFullScreenRingSettings();
            }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export type FullScreenRingNoticeCardProps = {
  onAllow: () => void;
  onNever: () => void;
  onClose: () => void;
};

/** The card itself (also drawn by the preview page). */
export function FullScreenRingNoticeCard({
  onAllow,
  onNever,
  onClose,
}: FullScreenRingNoticeCardProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Box
      role="region"
      aria-label={t('core:go_call.full_screen_title')}
      data-testid="call-full-screen-notice"
      sx={{
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
        borderRadius: '16px',
        boxShadow: `0 12px 32px ${alpha(theme.palette.common.black, 0.3)}`,
        color: theme.palette.text.primary,
        maxWidth: 480,
        mx: 'auto',
        pb: 1,
        pl: 1.75,
        pr: 0.75,
        pt: 1.25,
      }}
    >
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.25 }}>
        <PhoneLockedRoundedIcon
          sx={{
            color: theme.palette.primary.main,
            fontSize: 22,
            mt: 0.25,
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>
            {t('core:go_call.full_screen_title')}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.72),
              fontSize: 13,
              lineHeight: 1.45,
              mt: 0.4,
            }}
          >
            {t('core:go_call.full_screen_body')}
          </Typography>
        </Box>
        <IconButton
          aria-label={t('core:go_call.close')}
          data-testid="call-full-screen-notice-close"
          onClick={onClose}
          sx={{ height: 40, mt: -0.5, width: 40 }}
        >
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'flex-end',
          mt: 0.75,
          pr: 0.75,
        }}
      >
        <Button
          data-testid="call-full-screen-notice-never"
          onClick={onNever}
          sx={{ minHeight: 40, textTransform: 'none' }}
        >
          {t('core:go_call.dont_show_again')}
        </Button>
        <Button
          variant="contained"
          data-testid="call-full-screen-notice-allow"
          onClick={onAllow}
          sx={{ minHeight: 40, textTransform: 'none' }}
        >
          {t('core:go_call.full_screen_allow')}
        </Button>
      </Box>
    </Box>
  );
}
