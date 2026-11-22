import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import {
  Box,
  ButtonBase,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode, Ref } from 'react';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
} from '../Group/dashboardPanelEffects';

export type WidgetDisplayMode = 'compact' | 'expanded';

/**
 * What the frame itself takes of `height`: its padding (8 + 10), the title
 * row (28, its buttons' height) and the gap under it (8).
 */
export const DASHBOARD_WIDGET_FRAME_CHROME_PX = 54;

type DashboardWidgetFrameProps = {
  actionIcon?: ReactNode;
  actionLabel?: string;
  /** Null for a frame with only a title and `top`. */
  children?: ReactNode;
  contentBackground?: ReactNode;
  contentBorderRadius?: number | string;
  height: number;
  onAction?: () => void;
  onRefresh?: () => void;
  onSwap?: () => void;
  order?: number;
  panelRef?: Ref<HTMLDivElement>;
  refreshing?: boolean;
  subtitle?: string;
  title: string;
  /**
   * Shown under the title, above the content, as tall as it is (Home's
   * composer above the Torq feed). The frame grows by it and the content
   * keeps the room it has without it.
   */
  top?: ReactNode;
  widgetId?: string;
};

export const DashboardWidgetFrame = ({
  actionIcon,
  actionLabel,
  children = null,
  contentBackground = null,
  contentBorderRadius = 5,
  height,
  onAction,
  onRefresh,
  onSwap,
  order,
  panelRef,
  refreshing = false,
  subtitle,
  title,
  top = null,
  widgetId,
}: DashboardWidgetFrameProps) => {
  const theme = useTheme();
  // With something on top the frame follows its height; the content keeps a
  // fixed one, so a list in it still scrolls inside.
  const growsWithTop = top != null;
  const contentHeightPx = growsWithTop
    ? Math.max(0, height - DASHBOARD_WIDGET_FRAME_CHROME_PX)
    : null;

  return (
    <Box
      ref={panelRef}
      data-widget-id={widgetId}
      sx={{
        ...dashboardPanelSx(theme, 'base'),
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        height: growsWithTop ? 'auto' : `${height}px`,
        minHeight: growsWithTop ? undefined : `${height}px`,
        minWidth: 0,
        order,
        overflow: 'hidden',
        p: '8px 10px 10px',
        width: '100%',
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
      <Box
        sx={{
          alignItems: { xs: 'flex-start', sm: 'center' },
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.88rem',
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography
              sx={{
                color:
                  theme.palette.mode === 'dark'
                    ? 'rgba(223, 228, 238, 0.56)'
                    : 'rgba(72, 78, 92, 0.58)',
                fontSize: '0.68rem',
                mt: '1px',
              }}
            >
              {subtitle}
            </Typography>
          ) : null}
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'inline-flex',
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: '5px',
            justifyContent: 'flex-end',
            ml: { sm: 'auto' },
          }}
        >
          {onRefresh ? (
            <Tooltip title="Refresh">
              <IconButton
                aria-label="Refresh widget"
                data-refreshing={refreshing ? 'true' : 'false'}
                disabled={refreshing}
                onClick={onRefresh}
                size="small"
                sx={{
                  borderRadius: '999px',
                  color: theme.palette.text.secondary,
                  height: 28,
                  width: 28,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <Box
                  sx={{
                    display: 'inline-flex',
                    position: 'relative',
                  }}
                >
                  <RefreshRoundedIcon
                    sx={{
                      color: refreshing
                        ? alpha(theme.palette.text.secondary, 0.88)
                        : undefined,
                      fontSize: '1rem',
                    }}
                  />
                  {refreshing ? (
                    <Box
                      sx={{
                        bgcolor: theme.palette.primary.main,
                        border: `2px solid ${theme.palette.background.paper}`,
                        borderRadius: '50%',
                        bottom: -2,
                        boxShadow: `0 0 0 1px ${alpha(
                          theme.palette.primary.main,
                          0.18
                        )}, 0 0 10px ${alpha(theme.palette.primary.main, 0.22)}`,
                        height: 8,
                        position: 'absolute',
                        right: -2,
                        width: 8,
                      }}
                    />
                  ) : null}
                </Box>
              </IconButton>
            </Tooltip>
          ) : null}

          {onSwap ? (
            <Tooltip title="Swap position">
              <IconButton
                aria-label="Swap widget position"
                onClick={onSwap}
                size="small"
                sx={{
                  borderRadius: '999px',
                  color: theme.palette.text.secondary,
                  height: 28,
                  width: 28,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <SwapHorizRoundedIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>
          ) : null}

          {actionLabel && onAction ? (
            <ButtonBase
              disableRipple
              onClick={onAction}
              sx={{
                alignItems: 'center',
                border: `1px solid ${alpha(
                  theme.palette.border.main,
                  theme.palette.mode === 'dark' ? 0.24 : 0.14
                )}`,
                borderRadius: '999px',
                color: theme.palette.text.secondary,
                display: 'inline-flex',
                flexShrink: 0,
                fontSize: '0.68rem',
                fontWeight: 600,
                gap: '5px',
                minHeight: '28px',
                px: 0.95,
                transition:
                  'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease',
                whiteSpace: 'nowrap',
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  borderColor: alpha(
                    theme.palette.border.main,
                    theme.palette.mode === 'dark' ? 0.36 : 0.22
                  ),
                  color: theme.palette.text.primary,
                  transform: 'translateY(-1px)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
            >
              {actionIcon}
              {actionLabel}
            </ButtonBase>
          ) : null}
        </Box>
      </Box>

      {top != null ? (
        <Box
          data-widget-top=""
          sx={{
            borderTop: `1px solid ${alpha(
              theme.palette.border.main,
              theme.palette.mode === 'dark' ? 0.12 : 0.08
            )}`,
            flexShrink: 0,
            minWidth: 0,
            position: 'relative',
            pt: '8px',
            width: '100%',
          }}
        >
          {top}
        </Box>
      ) : null}

      {children != null ? (
        <Box
          sx={{
            borderTop: `1px solid ${alpha(
              theme.palette.border.main,
              theme.palette.mode === 'dark' ? 0.12 : 0.08
            )}`,
            boxSizing: 'border-box',
            display: 'flex',
            flex: contentHeightPx != null ? '0 0 auto' : '1 1 auto',
            height:
              contentHeightPx != null ? `${contentHeightPx}px` : undefined,
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
            pt: '8px',
            width: '100%',
          }}
        >
          {contentBackground}
          {children}
        </Box>
      ) : null}
    </Box>
  );
};
