import type { ReactNode } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useTranslation } from 'react-i18next';
import { SAFE_AREA_TOP } from '../../utils/mobileSafeArea';

/** The header row, without the status-bar inset or the divider under it. */
const MOBILE_PANEL_HEADER_HEIGHT_PX = 56;

/** Where a panel's content starts under a header drawn with `safeAreaTop`. */
export const MOBILE_PANEL_HEADER_OFFSET = `calc(${
  MOBILE_PANEL_HEADER_HEIGHT_PX + 1
}px + ${SAFE_AREA_TOP})`;

type MobilePanelHeaderProps = {
  icon: ReactNode;
  title: ReactNode;
  /** Sits between the title and the close button, like Calendar's Add event. */
  actions?: ReactNode;
  onClose: () => void;
  /**
   * Pad for the status bar. Panels that hide the app's top bar start at the
   * top of the screen; full-screen dialogs already pad their paper.
   */
  safeAreaTop?: boolean;
};

/**
 * The one header every group panel uses on phones (Members, Calendar, Files,
 * Admin keys, Threads, Qortal Land): icon, title, optional action, and the
 * close X in the same top-right spot. Modelled on the Group Calendar header.
 */
export function MobilePanelHeader({
  icon,
  title,
  actions,
  onClose,
  safeAreaTop = false,
}: MobilePanelHeaderProps) {
  const { t } = useTranslation(['core']);

  return (
    <Box
      component="header"
      sx={{
        alignItems: 'center',
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        boxSizing: 'content-box',
        color: 'text.primary',
        display: 'flex',
        flexShrink: 0,
        gap: 1,
        height: MOBILE_PANEL_HEADER_HEIGHT_PX,
        paddingTop: safeAreaTop ? SAFE_AREA_TOP : 0,
        px: 1.5,
      }}
    >
      <Box
        aria-hidden
        sx={{
          color: 'primary.main',
          display: 'inline-flex',
          flexShrink: 0,
          '& .MuiSvgIcon-root': { fontSize: 24 },
        }}
      >
        {icon}
      </Box>
      <Typography
        component="h2"
        noWrap
        sx={{ flex: 1, fontSize: 16, fontWeight: 700, minWidth: 0 }}
      >
        {title}
      </Typography>
      {actions}
      <IconButton
        aria-label={t('core:action.close', {
          postProcess: 'capitalizeFirstChar',
        })}
        onClick={onClose}
        sx={{ flexShrink: 0 }}
      >
        <CloseRoundedIcon />
      </IconButton>
    </Box>
  );
}
