import { memo } from 'react';
import { Avatar, Box, keyframes, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useQdnAvatar } from '../../../lib/qdnAvatars/useQdnAvatar';

const ringOut = keyframes`
  0% { opacity: 0.55; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.55); }
`;

/** Stable colour per address (same formula as the Hub's call tiles). */
export function callAddressHue(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) {
    h = (h * 31 + address.charCodeAt(i)) & 0xffff;
  }
  return `hsl(${h % 360}, 58%, 46%)`;
}

export function callInitials(label: string, address: string): string {
  const compact = (label || '').replace(/[^\p{L}\p{N}]/gu, '');
  if (compact.length >= 2) return compact.slice(0, 2).toUpperCase();
  if (compact.length === 1) return compact.toUpperCase();
  return (address || '?').slice(0, 2).toUpperCase();
}

export type CallAvatarProps = {
  address: string;
  label: string;
  /** Registered name: the avatar is looked up by it. */
  avatarName?: string;
  /** Preview/tests: use this picture instead of the avatar cache. */
  srcOverride?: string;
  size: number;
  /** Expanding rings while calling / ringing. */
  pulsing?: boolean;
  /** Green ring while this person is talking. */
  speaking?: boolean;
  dimmed?: boolean;
};

/**
 * A caller / participant picture: the QDN avatar when there is one, else
 * initials on a colour from the address. Looping animations carry
 * data-hub-keep-animating so the idle pause never freezes them half-way.
 */
export const CallAvatar = memo(function CallAvatar({
  address,
  label,
  avatarName,
  srcOverride,
  size,
  pulsing = false,
  speaking = false,
  dimmed = false,
}: CallAvatarProps) {
  const theme = useTheme();
  const cached = useQdnAvatar(avatarName, {
    enabled: Boolean(avatarName) && !srcOverride,
  });
  const src = srcOverride || cached.src || undefined;
  const ringColor = theme.palette.success.main;
  const ringWidth = Math.max(2, Math.round(size / 28));

  return (
    <Box
      sx={{
        flexShrink: 0,
        height: size,
        opacity: dimmed ? 0.55 : 1,
        position: 'relative',
        transition: 'opacity 240ms ease',
        width: size,
      }}
    >
      {pulsing
        ? [0, 1].map((i) => (
            <Box
              key={i}
              aria-hidden
              data-hub-keep-animating=""
              sx={{
                animation: `${ringOut} 2.4s cubic-bezier(0.2, 0.6, 0.35, 1) ${
                  i * 1.2
                }s infinite`,
                border: `2px solid ${alpha(theme.palette.text.primary, 0.35)}`,
                borderRadius: '50%',
                inset: 0,
                position: 'absolute',
                '@media (prefers-reduced-motion: reduce)': {
                  animation: 'none',
                  opacity: 0,
                },
              }}
            />
          ))
        : null}
      {/* Speaking ring: a fade, not a loop, so a long group call costs no
          frames while people talk (and the idle pause has nothing to stop). */}
      <Box
        aria-hidden
        data-testid={speaking ? 'call-avatar-speaking' : undefined}
        sx={{
          borderRadius: '50%',
          boxShadow: `0 0 0 ${ringWidth}px ${ringColor}, 0 0 ${
            ringWidth * 6
          }px ${alpha(ringColor, 0.55)}`,
          inset: 0,
          opacity: speaking ? 1 : 0,
          position: 'absolute',
          transition: 'opacity 160ms ease',
        }}
      />
      <Avatar
        alt={label}
        src={src}
        sx={{
          bgcolor: callAddressHue(address || label),
          color: theme.palette.common.white,
          fontSize: Math.round(size * 0.36),
          fontWeight: 800,
          height: size,
          position: 'relative',
          width: size,
        }}
      >
        {src ? null : callInitials(label, address)}
      </Avatar>
    </Box>
  );
});
