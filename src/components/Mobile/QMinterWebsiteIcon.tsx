import { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import { useQdnAvatar } from '../../lib/qdnAvatars';
import {
  getQMinterWebsiteAvatarCandidates,
  Q_MINTER_WEBSITE_NAME,
} from '../../utils/openQMinterWebsite';

type QMinterWebsiteIconProps = {
  size?: number;
};

/**
 * The Q-Minter icon from GO's avatar cache (or the icon GO ships), updated
 * when the live one arrives; if that image fails, the node's QDN avatar and
 * the website favicons are tried in turn.
 */
export function QMinterWebsiteIcon({ size = 24 }: QMinterWebsiteIconProps) {
  const { src: cachedSrc } = useQdnAvatar(Q_MINTER_WEBSITE_NAME);
  const fallbacks = useMemo(() => getQMinterWebsiteAvatarCandidates(), []);
  const [failedSrcs, setFailedSrcs] = useState<string[]>([]);

  const src = [cachedSrc, ...fallbacks].find(
    (candidate): candidate is string =>
      Boolean(candidate) && !failedSrcs.includes(candidate as string)
  );

  if (!src) {
    return <SavingsRoundedIcon sx={{ fontSize: size * 0.65 }} />;
  }

  return (
    <Box
      alt="Q-Minter"
      component="img"
      src={src}
      onError={() => {
        setFailedSrcs((prev) => (prev.includes(src) ? prev : [...prev, src]));
      }}
      sx={{
        borderRadius: '50%',
        flexShrink: 0,
        height: size,
        objectFit: 'cover',
        width: size,
      }}
    />
  );
}
