import { Box, Tab, Tabs, styled } from '@mui/material';
import { useTranslation } from 'react-i18next';

export type AppsLibraryTabValue =
  | 'official'
  | 'community'
  | 'categories'
  | 'my-apps'
  | 'private';

interface AppsTabsProps {
  currentTab: AppsLibraryTabValue;
  isMobile?: boolean;
  isSearchActive?: boolean;
  onTabChange: (tab: AppsLibraryTabValue) => void;
}

const StyledTabs = styled(Tabs, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ theme, isMobile }) => ({
  backgroundColor: theme.palette.background.paper,
  borderRadius: '8px',
  minHeight: isMobile ? '40px' : '42px',
  padding: isMobile ? '3px' : '4px',
  width: isMobile ? '100%' : 'auto',
  '& .MuiTabs-indicator': {
    display: 'none',
  },
  '& .MuiTabs-flexContainer': {
    gap: isMobile ? '2px' : '4px',
  },
  '& .MuiTabs-scroller': {
    overflow: 'visible !important',
  },
}));

const StyledTab = styled(Tab, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ theme, isMobile }) => ({
  borderRadius: '6px',
  color: theme.palette.text.secondary,
  cursor: 'default',
  flexShrink: isMobile ? 1 : 0,
  fontSize: isMobile ? '10.5px' : '14px',
  fontWeight: 500,
  lineHeight: isMobile ? 1.15 : 1.4,
  minHeight: isMobile ? '36px' : '34px',
  minWidth: isMobile ? 0 : 'auto',
  padding: isMobile ? '6px 3px' : '8px 16px',
  textAlign: isMobile ? 'center' : 'inherit',
  textTransform: 'none',
  transition: 'all 0.2s ease',
  whiteSpace: isMobile ? 'normal' : 'nowrap',
  '&.Mui-selected': {
    backgroundColor: theme.palette.background.default,
    color: theme.palette.text.primary,
  },
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

const TabsContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ theme, isMobile }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  display: 'flex',
  justifyContent: 'center',
  overflowX: 'visible',
  padding: isMobile ? '4px 0 4px' : '16px 0',
  width: '100%',
}));

export const AppsTabs = ({
  currentTab,
  isMobile = false,
  isSearchActive = false,
  onTabChange,
}: AppsTabsProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (_event: React.SyntheticEvent, newValue: string) => {
    onTabChange(newValue as AppsLibraryTabValue);
  };

  return (
    <TabsContainer isMobile={isMobile}>
      <StyledTabs
        isMobile={isMobile}
        value={isSearchActive ? false : currentTab}
        onChange={handleChange}
        variant={isMobile ? 'fullWidth' : 'standard'}
        scrollButtons={false}
        aria-label={t('core:aria.apps_library_tabs', {
          defaultValue: 'Apps library navigation tabs',
        })}
        sx={{
          maxWidth: '100%',
          minHeight: isMobile ? '40px' : '42px',
          width: isMobile ? '100%' : 'auto',
        }}
      >
        <StyledTab
          isMobile={isMobile}
          value="official"
          label={t('core:tabs.official_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          isMobile={isMobile}
          value="community"
          label={t('core:tabs.community_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          isMobile={isMobile}
          value="categories"
          label={t('core:tabs.categories', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          isMobile={isMobile}
          value="my-apps"
          label={t('core:tabs.my_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          isMobile={isMobile}
          value="private"
          label={t('core:tabs.add_private', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
      </StyledTabs>
    </TabsContainer>
  );
};
