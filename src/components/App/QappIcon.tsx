import { type ReactNode, useState } from 'react';
import { Box } from '@mui/material';
import { useQdnAvatar } from '../../lib/qdnAvatars';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';

/** The icon box with the Qortal logo, and the app's icon on top once loaded. */
export function QappIconFrame({
  sx,
  children,
  showLogo = true,
  logoWidth = 30,
}: {
  sx: Record<string, unknown>;
  children?: ReactNode;
  showLogo?: boolean;
  logoWidth?: number;
}) {
  return (
    <Box
      sx={{
        ...sx,
        alignItems: 'center',
        display: 'flex',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {showLogo ? (
        <img
          src={LogoSelected}
          alt=""
          style={{
            height: 'auto',
            objectFit: 'contain',
            width: `${logoWidth}px`,
          }}
        />
      ) : null}
      {children}
    </Box>
  );
}

/**
 * A Q-App's icon from GO's avatar cache (or the icon GO ships for well-known
 * Q-Apps), fetched first when not cached yet. The Qortal logo shows until it
 * has loaded, and when there is none: an icon that is still loading (or never
 * answers) never shows as an empty box.
 */
export function QappIcon({
  name,
  sx,
  testId,
  logoWidth,
}: {
  name: string;
  sx: Record<string, unknown>;
  /** data-testid of the icon; the one it replaces gets `-previous`. */
  testId?: string;
  logoWidth?: number;
}) {
  const { src } = useQdnAvatar(name, { priority: 'high' });
  // Per src, so the live icon replacing the bundled one gets its own chance.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showIcon = Boolean(src) && failedSrc !== src;
  const loaded = showIcon && loadedSrc === src;
  // The icon on screen (e.g. the bundled one) stays under a new one until
  // that has loaded, so the swap never flashes the Qortal logo.
  const previous = !loaded && loadedSrc && loadedSrc !== src ? loadedSrc : null;
  const layers: { layerSrc: string; current: boolean }[] = [];
  if (previous) layers.push({ layerSrc: previous, current: false });
  if (showIcon && src) layers.push({ layerSrc: src, current: true });
  return (
    <QappIconFrame
      sx={sx}
      showLogo={!loaded && !previous}
      logoWidth={logoWidth}
    >
      {/* Keyed by src: the loaded image stays the same element underneath. */}
      {layers.map(({ layerSrc, current }) => (
        <img
          key={layerSrc}
          src={layerSrc}
          alt=""
          data-testid={
            testId ? (current ? testId : `${testId}-previous`) : undefined
          }
          onLoad={current ? () => setLoadedSrc(layerSrc) : undefined}
          onError={current ? () => setFailedSrc(layerSrc) : undefined}
          style={{
            height: '100%',
            inset: 0,
            objectFit: 'cover',
            opacity: current && !loaded ? 0 : 1,
            position: 'absolute',
            width: '100%',
          }}
        />
      ))}
    </QappIconFrame>
  );
}
