import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useRegisteredName } from '../../utils/qdnNameDisplay';
import { AppThumbnailAvatar } from '../Apps/AppThumbnailAvatar';

/**
 * A Q-App or website as its owner published it: its avatar and its registered
 * name ("Simon James", not "simon%20james").
 */
export function NotificationAppIdentity({
  appName,
  description,
}: {
  appName: string;
  description?: ReactNode;
}) {
  const name = useRegisteredName(appName);
  return (
    <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.2, minWidth: 0 }}>
      <AppThumbnailAvatar
        alt={name}
        appName={name}
        fallbackSize={20}
        sx={{ borderRadius: '10px', flexShrink: 0, height: 34, width: 34 }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            color: 'text.primary',
            fontSize: '0.92rem',
            fontWeight: 600,
            overflowWrap: 'anywhere',
          }}
        >
          {name}
        </Typography>
        {description}
      </Box>
    </Box>
  );
}

/** Just the registered name, as text. */
export function RegisteredNameText({ name }: { name: string }) {
  return <>{useRegisteredName(name)}</>;
}
