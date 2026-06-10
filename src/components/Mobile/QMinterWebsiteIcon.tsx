import { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import { getQMinterWebsiteAvatarCandidates } from '../../utils/openQMinterWebsite';

type QMinterWebsiteIconProps = {
  size?: number;
};

/** Tries QDN avatar and website favicon URLs until one loads. */
export function QMinterWebsiteIcon({ size = 24 }: QMinterWebsiteIconProps) {
  const candidates = useMemo(() => getQMinterWebsiteAvatarCandidates(), []);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  if (failed || candidateIndex >= candidates.length) {
    return <SavingsRoundedIcon sx={{ fontSize: size * 0.65 }} />;
  }

  return (
    <Box
      alt="Q-Minter"
      component="img"
      src={candidates[candidateIndex]}
      onError={() => {
        if (candidateIndex + 1 < candidates.length) {
          setCandidateIndex((prev) => prev + 1);
          return;
        }
        setFailed(true);
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
