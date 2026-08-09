import { Box, type SxProps, type Theme } from '@mui/material';

export const RETICULUM_NOTIFICATION_RED = '#f23f42';

export const formatReticulumUnreadCount = (count: number) =>
  count > 99 ? '99+' : String(Math.max(0, count));

type ReticulumUnreadCountBadgeProps = {
  count?: number | null;
  outlineColor: string;
  size?: number;
  fontSize?: number;
  /** Defaults to the mention red; plain unread traffic passes the accent blue. */
  color?: string;
  sx?: SxProps<Theme>;
};

export const ReticulumUnreadCountBadge = ({
  count = null,
  outlineColor,
  size = 18,
  fontSize = 10,
  color = RETICULUM_NOTIFICATION_RED,
  sx,
}: ReticulumUnreadCountBadgeProps) => {
  const normalizedCount =
    count == null ? null : Math.max(0, Number(count) || 0);
  const label =
    normalizedCount == null ? '' : formatReticulumUnreadCount(normalizedCount);

  return (
    <Box
      aria-hidden
      component="span"
      sx={[
        {
          alignItems: 'center',
          backgroundColor: color,
          border: `2px solid ${outlineColor}`,
          borderRadius: '999px',
          boxSizing: 'content-box',
          color: '#ffffff',
          display: 'flex',
          fontSize,
          fontWeight: 800,
          height: size,
          justifyContent: 'center',
          lineHeight: 1,
          minWidth: size,
          px: normalizedCount != null && normalizedCount > 9 ? 0.45 : 0,
          pointerEvents: 'none',
          textAlign: 'center',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {label}
    </Box>
  );
};
