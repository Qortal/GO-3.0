import { Box, ButtonBase, Tab, Tabs, styled, useTheme } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import type { SvgIconComponent } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export type AppsLibraryTabValue =
  | 'pinned'
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
  /** Tapping the tab that is already selected (MUI fires no onChange). */
  onTabReselect?: (tab: AppsLibraryTabValue) => void;
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
  // Touch WebViews keep :hover on the last tapped element, which painted the
  // newly selected tab in the hover colour instead of the selected one.
  '@media (hover: hover)': {
    '&:hover:not(.Mui-selected)': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  '&:active:not(.Mui-selected)': {
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

type MobileTabItem = {
  value: AppsLibraryTabValue;
  labelKey: string;
  icon: SvgIconComponent;
  tone: (theme: Theme) => string;
};

const MOBILE_TABS: MobileTabItem[] = [
  {
    value: 'pinned',
    labelKey: 'core:tabs.pinned',
    icon: PushPinRoundedIcon,
    tone: (theme) => theme.palette.warning.main,
  },
  {
    value: 'official',
    labelKey: 'core:tabs.official_apps',
    icon: VerifiedRoundedIcon,
    tone: (theme) => theme.palette.primary.main,
  },
  {
    value: 'community',
    labelKey: 'core:tabs.community_apps',
    icon: PublicRoundedIcon,
    tone: (theme) => theme.palette.success.main,
  },
  {
    value: 'categories',
    labelKey: 'core:tabs.categories',
    icon: CategoryRoundedIcon,
    tone: (theme) => theme.palette.info.main,
  },
  {
    value: 'my-apps',
    labelKey: 'core:tabs.my_apps',
    icon: RocketLaunchRoundedIcon,
    tone: (theme) => theme.palette.secondary.main,
  },
  {
    value: 'private',
    labelKey: 'core:tabs.add_private',
    icon: LockRoundedIcon,
    tone: (theme) => theme.palette.error.light,
  },
];

const MOBILE_TAB_GAP = 8;

/**
 * Phones: the library's sections as two rows of buttons, each with its own
 * coloured icon. A soft highlight glides to the chosen one.
 */
const MobileLibraryTabs = ({
  currentTab,
  isSearchActive,
  onTabChange,
  onTabReselect,
}: Omit<AppsTabsProps, 'isMobile'>) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const selectedIndex = isSearchActive
    ? -1
    : MOBILE_TABS.findIndex((item) => item.value === currentTab);
  const columns = 3;
  const column = Math.max(0, selectedIndex) % columns;
  const row = Math.floor(Math.max(0, selectedIndex) / columns);
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      role="tablist"
      aria-label={t('core:aria.apps_library_tabs', {
        defaultValue: 'Apps library navigation tabs',
      })}
      sx={{
        display: 'grid',
        gap: `${MOBILE_TAB_GAP}px`,
        // Equal rows, so the highlight fits whichever row it is on.
        gridAutoRows: '1fr',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        position: 'relative',
        py: 0.5,
        width: '100%',
      }}
    >
      {/* The highlight behind the chosen button, one cell in size. */}
      <Box
        aria-hidden
        sx={{
          backgroundColor: alpha(
            theme.palette.primary.main,
            isDark ? 0.16 : 0.12
          ),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
          borderRadius: '16px',
          boxShadow: `0 6px 18px ${alpha(theme.palette.primary.main, 0.18)}`,
          boxSizing: 'border-box',
          height: `calc((100% - ${theme.spacing(1)} - ${MOBILE_TAB_GAP}px) / 2)`,
          left: 0,
          opacity: selectedIndex === -1 ? 0 : 1,
          pointerEvents: 'none',
          position: 'absolute',
          top: theme.spacing(0.5),
          transform: `translate(calc(${column} * (100% + ${MOBILE_TAB_GAP}px)), calc(${row} * (100% + ${MOBILE_TAB_GAP}px)))`,
          transition:
            'transform 320ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 160ms ease',
          width: `calc((100% - ${2 * MOBILE_TAB_GAP}px) / 3)`,
          zIndex: 0,
        }}
      />
      {MOBILE_TABS.map((item, index) => {
        const selected = index === selectedIndex;
        const Icon = item.icon;
        const tone = item.tone(theme);
        return (
          <ButtonBase
            key={item.value}
            role="tab"
            aria-selected={selected}
            data-tab-value={item.value}
            onClick={() => {
              if (selected) onTabReselect?.(item.value);
              else onTabChange(item.value);
            }}
            sx={{
              alignItems: 'center',
              backgroundColor: selected
                ? 'transparent'
                : alpha(theme.palette.text.primary, isDark ? 0.05 : 0.04),
              border: `1px solid ${
                selected
                  ? 'transparent'
                  : alpha(theme.palette.text.primary, isDark ? 0.06 : 0.05)
              }`,
              borderRadius: '16px',
              color: selected ? 'text.primary' : 'text.secondary',
              display: 'flex',
              gap: 0.75,
              justifyContent: 'flex-start',
              minHeight: 50,
              minWidth: 0,
              px: 0.75,
              py: 0.75,
              textAlign: 'left',
              transition:
                'background-color 200ms ease, border-color 200ms ease, color 200ms ease, transform 140ms ease',
              zIndex: 1,
              '&:active': { transform: 'scale(0.96)' },
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: alpha(tone, selected ? 0.24 : 0.14),
                borderRadius: '10px',
                color: tone,
                display: 'flex',
                flexShrink: 0,
                height: 28,
                justifyContent: 'center',
                transition: 'background-color 200ms ease, transform 260ms ease',
                transform: selected ? 'scale(1.06)' : 'none',
                width: 28,
              }}
            >
              <Icon sx={{ fontSize: 17 }} />
            </Box>
            <Box
              component="span"
              sx={{
                display: '-webkit-box',
                fontSize: 12,
                fontWeight: selected ? 700 : 600,
                lineHeight: 1.2,
                minWidth: 0,
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
              }}
            >
              {t(item.labelKey, { postProcess: 'capitalizeFirstChar' })}
            </Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
};

export const AppsTabs = ({
  currentTab,
  isMobile = false,
  isSearchActive = false,
  onTabChange,
  onTabReselect,
}: AppsTabsProps) => {
  const { t } = useTranslation(['core']);

  if (isMobile) {
    return (
      <MobileLibraryTabs
        currentTab={currentTab}
        isSearchActive={isSearchActive}
        onTabChange={onTabChange}
        onTabReselect={onTabReselect}
      />
    );
  }

  const handleChange = (_event: React.SyntheticEvent, newValue: string) => {
    onTabChange(newValue as AppsLibraryTabValue);
  };

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    const value = event.currentTarget.getAttribute('data-tab-value');
    if (!isSearchActive && value === currentTab) {
      onTabReselect?.(currentTab);
    }
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
          data-tab-value="official"
          onClick={handleClick}
          label={t('core:tabs.official_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          isMobile={isMobile}
          value="community"
          data-tab-value="community"
          onClick={handleClick}
          label={t('core:tabs.community_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          isMobile={isMobile}
          value="categories"
          data-tab-value="categories"
          onClick={handleClick}
          label={t('core:tabs.categories', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          isMobile={isMobile}
          value="my-apps"
          data-tab-value="my-apps"
          onClick={handleClick}
          label={t('core:tabs.my_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          isMobile={isMobile}
          value="private"
          data-tab-value="private"
          onClick={handleClick}
          label={t('core:tabs.add_private', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
      </StyledTabs>
    </TabsContainer>
  );
};
