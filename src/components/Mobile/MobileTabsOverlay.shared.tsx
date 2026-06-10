import { useState } from 'react';
import { Box } from '@mui/material';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import { buildAppThumbnailUrl } from '../../utils/walletAvatarCache';
import type { OpenTab } from './useOpenTabs';

export const tabPalette = [
  '#5b8def',
  '#3ddc84',
  '#f5a623',
  '#e0567a',
  '#9b6dff',
  '#27c6c6',
];

export const colorFor = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  return tabPalette[Math.abs(h) % tabPalette.length];
};

/** Compact label for tab cards so long app/website names do not stretch the grid. */
export const shortenTabDisplayTitle = (
  title: string,
  maxLength = 22
): string => {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
};

export const TabAvatar = ({
  tab,
  title,
  color,
  size = 38,
}: {
  tab: OpenTab;
  title: string;
  color: string;
  size?: number;
}) => {
  const [failed, setFailed] = useState(false);
  const avatarUrl =
    !tab.internal && tab.name ? buildAppThumbnailUrl(String(tab.name)) : null;

  const fallback = (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: 1.5,
        backgroundColor: color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: size * 0.45,
        flexShrink: 0,
      }}
    >
      {tab.internal ? (
        <ChatRoundedIcon sx={{ fontSize: size * 0.55 }} />
      ) : (
        title.charAt(0).toUpperCase()
      )}
    </Box>
  );

  if (!avatarUrl || failed) return fallback;

  return (
    <Box
      component="img"
      src={avatarUrl}
      alt=""
      onError={() => setFailed(true)}
      sx={{
        width: size,
        height: size,
        borderRadius: 1.5,
        objectFit: 'cover',
        flexShrink: 0,
        backgroundColor: `${color}22`,
      }}
    />
  );
};
