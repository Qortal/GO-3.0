import { createContext, useContext, useId, type ReactNode } from 'react';
import { Box, IconButton, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
} from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAndroidBack } from '../../../utils/androidBack';
import { SAFE_AREA_BOTTOM } from '../../../utils/mobileSafeArea';
import { CALL_SHEET_BACK_PRIORITY } from './goCallUi';

/**
 * Android back priority of the call sheets. The call screen raises it while
 * it is shown over a lock (nothing can be above it there); otherwise a Q-App
 * approval drawn over the call screen gets back first.
 */
export const CallSheetBackPriorityContext = createContext<number>(
  CALL_SHEET_BACK_PRIORITY
);

export type MobileCallSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
};

/**
 * Bottom sheet drawn inside the call layer (not an MUI modal), so it also
 * works while the call is shown over GO's lock screen. Tap outside, swipe
 * down, the X or Android back close it.
 */
export function MobileCallSheet({
  open,
  onClose,
  title,
  children,
  testId,
}: MobileCallSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const reduce = useReducedMotion();
  const titleId = useId();
  // Only the grab handle and title row drag the sheet, so a long list
  // (participants) still scrolls.
  const dragControls = useDragControls();
  const backPriority = useContext(CallSheetBackPriorityContext);

  useAndroidBack(
    () => {
      onClose();
      return true;
    },
    { enabled: open, priority: backPriority }
  );

  return (
    <AnimatePresence>
      {open ? (
        <Box
          key="sheet"
          // Touches here never start the call screen's own minimize swipe.
          onPointerDown={(event) => event.stopPropagation()}
          sx={{ inset: 0, position: 'absolute', zIndex: 5 }}
          data-testid={testId}
        >
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onClose}
            style={{
              background: alpha(theme.palette.common.black, 0.45),
              inset: 0,
              position: 'absolute',
            }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: 'spring', stiffness: 420, damping: 40 }
            }
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 80 || info.velocity.y > 500) onClose();
            }}
            style={{
              background: theme.palette.background.paper,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              bottom: 0,
              boxShadow: `0 -12px 36px ${alpha(theme.palette.common.black, 0.3)}`,
              left: 0,
              margin: '0 auto',
              maxHeight: '78%',
              maxWidth: 560,
              display: 'flex',
              flexDirection: 'column',
              position: 'absolute',
              right: 0,
            }}
          >
            <Box
              onPointerDown={(event) => dragControls.start(event)}
              sx={{ touchAction: 'none' }}
            >
              <Box
                aria-hidden
                sx={{
                  backgroundColor: alpha(theme.palette.text.primary, 0.22),
                  borderRadius: 2,
                  height: 4,
                  mx: 'auto',
                  mt: 1,
                  width: 36,
                }}
              />
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 1,
                  pl: 2.5,
                  pr: 1,
                  pt: 0.5,
                }}
              >
                <Typography
                  id={titleId}
                  sx={{ flex: 1, fontSize: 17, fontWeight: 700, minWidth: 0 }}
                >
                  {title}
                </Typography>
                <IconButton
                  aria-label={t('core:go_call.close')}
                  onClick={onClose}
                  sx={{ height: 48, width: 48 }}
                >
                  <CloseRoundedIcon />
                </IconButton>
              </Box>
            </Box>
            <Box
              sx={{
                overflowY: 'auto',
                pb: `calc(12px + ${SAFE_AREA_BOTTOM})`,
                pt: 0.5,
                touchAction: 'pan-y',
              }}
            >
              {children}
            </Box>
          </motion.div>
        </Box>
      ) : null}
    </AnimatePresence>
  );
}
