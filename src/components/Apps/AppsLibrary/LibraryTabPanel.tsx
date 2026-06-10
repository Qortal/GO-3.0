import { ReactNode } from 'react';
import { Box } from '@mui/material';
import type { AppsLibraryTabValue } from './AppsTabs';

type LibraryTabPanelProps = {
  tab: AppsLibraryTabValue;
  activeTab: AppsLibraryTabValue;
  isSearchActive: boolean;
  isMounted: boolean;
  children: ReactNode;
};

export const LibraryTabPanel = ({
  tab,
  activeTab,
  isSearchActive,
  isMounted,
  children,
}: LibraryTabPanelProps) => {
  if (!isMounted) return null;

  const isActive = !isSearchActive && activeTab === tab;

  return (
    <Box
      aria-hidden={!isActive}
      sx={{
        display: isActive ? 'block' : 'none',
        width: '100%',
      }}
    >
      {children}
    </Box>
  );
};
