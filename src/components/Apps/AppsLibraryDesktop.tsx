import { useState, useEffect, useCallback, useMemo, useTransition } from 'react';
import {
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsList,
  AppsWidthLimiter,
} from './Apps-styles';
import {
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  Tooltip,
  styled,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { QappLibraryText } from '../../assets/Icons/QappLibraryText.tsx';
import { Spacer } from '../../common/Spacer';
import { executeEvent } from '../../utils/events';
import { ComposeP, ShowMessageReturnButton } from '../Group/Forum/Mail-styles';
import { ReturnIcon } from '../../assets/Icons/ReturnIcon.tsx';
import { useTranslation } from 'react-i18next';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { useAtom } from 'jotai';
import { appSortAtom } from '../../atoms/appsAtoms';
import { filterAndSortApps } from '../../atoms/appsAtoms';
import {
  SortDropdown,
  CategoryFilter,
  StatusFilter,
  StatusFilterOption,
} from './Filters';
import {
  AppsTabs,
  AppsLibraryTabValue,
  OfficialAppsTab,
  CommunityAppsTab,
  CategoriesTab,
  MyAppsTab,
  PrivateTab,
} from './AppsLibrary';
import { LibraryTabPanel } from './AppsLibrary/LibraryTabPanel';
import { AppCardEnhanced, AppCardListItem } from './AppCard';

const SearchContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  borderRadius: '8px',
  padding: '0 12px',
  height: '36px',
  width: '300px',
  minWidth: '200px',
}));

export const AppsLibraryDesktop = ({
  availableQapps,
  setMode,
  myName,
  myAddress,
  isShow,
  isMobile = false,
  categories,
  getQapps,
  externalSearchRequest,
  contentHeight,
}) => {
  const [currentTab, setCurrentTab] = useState<AppsLibraryTabValue>('official');
  const [mountedTabs, setMountedTabs] = useState<Set<AppsLibraryTabValue>>(
    () => new Set(['official'])
  );
  const [, startTabTransition] = useTransition();
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearchValue, setDebouncedSearchValue] = useState('');
  const [sortOption, setSortOption] = useAtom(appSortAtom);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all');
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
  const theme = useTheme();
  // In landscape the big library logo wastes scarce vertical space, so hide it
  // and let the app grid start higher.
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const compactHeader = isMobile && isLandscape;
  const isSearchActive = searchValue.trim().length > 0;
  const showLibraryScrollbar = currentTab === 'community' && !isSearchActive;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchValue(searchValue);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchValue]);

  useEffect(() => {
    setSearchValue(externalSearchRequest?.query || '');
    setDebouncedSearchValue(externalSearchRequest?.query || '');
  }, [externalSearchRequest?.nonce]);

  const handleTabChange = useCallback((tab: AppsLibraryTabValue) => {
    startTabTransition(() => {
      setCurrentTab(tab);
      setMountedTabs((prev) => {
        if (prev.has(tab)) return prev;
        const next = new Set(prev);
        next.add(tab);
        return next;
      });
    });
  }, []);

  const bindScrollContainer = useCallback((node: HTMLDivElement | null) => {
    setScrollParent(node);
  }, []);

  const isSearchResultsActive = debouncedSearchValue.trim().length > 0;

  const searchResults = useMemo(() => {
    if (!isSearchResultsActive) return [];
    return filterAndSortApps(availableQapps, {
      sort: sortOption,
      category: 'all',
      status: 'all',
      search: debouncedSearchValue,
    });
  }, [availableQapps, debouncedSearchValue, isSearchResultsActive, sortOption]);

  const renderTabContent = () => {
    if (isSearchResultsActive) {
      return (
        <AppsWidthLimiter isMobile={isMobile}>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <Box
              sx={{
                color: theme.palette.text.primary,
                fontSize: '20px',
                fontWeight: 600,
              }}
            >
              {t('core:action.search_apps', {
                postProcess: 'capitalizeFirstChar',
              })}{' '}
              ({searchResults.length})
            </Box>
          </Box>

          {isMobile ? (
            <AppsList>
              {searchResults.map((app) => (
                <AppCardListItem
                  key={`${app?.service}-${app?.name}`}
                  app={app}
                  myName={myName}
                />
              ))}
            </AppsList>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: '16px',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                width: '100%',
              }}
            >
              {searchResults.map((app) => (
                <AppCardEnhanced
                  key={`${app?.service}-${app?.name}`}
                  app={app}
                  myName={myName}
                />
              ))}
            </Box>
          )}
        </AppsWidthLimiter>
      );
    }

    const isTabActive = (tab: AppsLibraryTabValue) => currentTab === tab;

    return (
      <>
        <LibraryTabPanel
          activeTab={currentTab}
          isMounted={mountedTabs.has('official')}
          isSearchActive={isSearchResultsActive}
          tab="official"
        >
          <OfficialAppsTab
            availableQapps={availableQapps}
            isActive={isTabActive('official')}
            isMobile={isMobile}
            myName={myName}
            searchValue={debouncedSearchValue}
          />
        </LibraryTabPanel>

        <LibraryTabPanel
          activeTab={currentTab}
          isMounted={mountedTabs.has('community')}
          isSearchActive={isSearchResultsActive}
          tab="community"
        >
          <CommunityAppsTab
            availableQapps={availableQapps}
            categories={categories}
            categoryValue={categoryFilter}
            isActive={isTabActive('community')}
            isMobile={isMobile}
            myName={myName}
            onCategoryChange={setCategoryFilter}
            onSortChange={setSortOption}
            onStatusChange={setStatusFilter}
            scrollParent={scrollParent}
            searchValue={debouncedSearchValue}
            sortValue={sortOption}
            statusValue={statusFilter}
          />
        </LibraryTabPanel>

        <LibraryTabPanel
          activeTab={currentTab}
          isMounted={mountedTabs.has('categories')}
          isSearchActive={isSearchResultsActive}
          tab="categories"
        >
          <CategoriesTab
            availableQapps={availableQapps}
            categories={categories}
            isMobile={isMobile}
            myName={myName}
            searchValue={debouncedSearchValue}
          />
        </LibraryTabPanel>

        <LibraryTabPanel
          activeTab={currentTab}
          isMounted={mountedTabs.has('my-apps')}
          isSearchActive={isSearchResultsActive}
          tab="my-apps"
        >
          <MyAppsTab
            availableQapps={availableQapps}
            isMobile={isMobile}
            myName={myName}
            searchValue={debouncedSearchValue}
            setMode={setMode}
          />
        </LibraryTabPanel>

        <LibraryTabPanel
          activeTab={currentTab}
          isMounted={mountedTabs.has('private')}
          isSearchActive={isSearchResultsActive}
          tab="private"
        >
          <PrivateTab myAddress={myAddress} myName={myName} />
        </LibraryTabPanel>
      </>
    );
  };

  return (
    <AppsLibraryContainer
      sx={{
        display: !isShow && 'none',
        padding: '0px',
        height: contentHeight || '100%',
        overflow: 'hidden',
        paddingTop: isMobile ? 0 : '30px',
      }}
    >
      {/* Fixed Header Section */}
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          backgroundColor: 'background.default',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <AppsDesktopLibraryHeader
          sx={{
            maxWidth: '1500px',
            width: isMobile ? '100%' : '90%',
            px: isMobile ? 1.5 : 0,
            mb: isMobile ? 0 : 0,
          }}
        >
          {isMobile ? (
            compactHeader ? null : (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'center',
                  pb: 2.5,
                  pt: 3.5,
                  width: '100%',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    lineHeight: 0,
                    width: '100%',
                    '& svg': {
                      display: 'block',
                      height: 'auto',
                      margin: '0 auto',
                      maxWidth: 'min(100%, 301px)',
                    },
                  }}
                >
                  <QappLibraryText />
                </Box>
              </Box>
            )
          ) : (
            <AppsWidthLimiter isMobile={isMobile}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'flex-start',
                  width: '100%',
                }}
              >
                <QappLibraryText />
              </Box>
            </AppsWidthLimiter>
          )}
        </AppsDesktopLibraryHeader>

        <Box
          sx={{
            maxWidth: '1500px',
            width: isMobile ? '100%' : '90%',
            px: isMobile ? (compactHeader ? 3 : 1.5) : 0,
          }}
        >
          {!isMobile ? <Spacer height="20px" /> : null}

          {!isMobile ? (
            <ShowMessageReturnButton
              sx={{ padding: '2px' }}
              onClick={() => {
                executeEvent('navigateBack', {});
              }}
            >
              <ReturnIcon />
              <ComposeP sx={{ fontSize: '18px' }}>
                {t('core:action.return_apps_dashboard', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </ComposeP>
            </ShowMessageReturnButton>
          ) : null}

          {!isMobile ? <Spacer height="20px" /> : null}

          {/* Tabs + Search/Filter — single column, shared center axis */}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: isMobile ? '12px' : '12px',
              width: '100%',
            }}
          >
            <AppsTabs
              currentTab={currentTab}
              isMobile={isMobile}
              isSearchActive={isSearchActive}
              onTabChange={handleTabChange}
            />

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                justifyContent: isMobile ? 'flex-start' : 'center',
                width: '100%',
              }}
            >
              {!isMobile && currentTab !== 'private' && (
                <>
                  <SearchContainer>
                    <SearchIcon sx={{ color: theme.palette.text.secondary }} />
                    <InputBase
                      value={searchValue}
                      onChange={(e) => setSearchValue(e.target.value)}
                      sx={{ flex: 1, ml: 1, fontSize: '14px' }}
                      placeholder={t('core:action.search_apps', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    />
                    {searchValue && (
                      <ButtonBase onClick={() => setSearchValue('')}>
                        <img src={IconClearInput} alt="clear" />
                      </ButtonBase>
                    )}
                  </SearchContainer>

                  {getQapps && (
                    <Tooltip
                      title={t('core:action.refetch_apps_websites_list', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    >
                      <IconButton
                        onClick={() => getQapps()}
                        aria-label={t(
                          'core:action.refetch_apps_websites_list',
                          {
                            postProcess: 'capitalizeFirstChar',
                          }
                        )}
                        sx={{ color: theme.palette.text.secondary }}
                      >
                        <RefreshIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              )}

              {currentTab === 'community' && !isMobile ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '12px',
                    justifyContent: 'center',
                    width: '100%',
                  }}
                >
                  <SortDropdown value={sortOption} onChange={setSortOption} />
                  <CategoryFilter
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                    categories={categories}
                  />
                  <StatusFilter
                    value={statusFilter}
                    onChange={setStatusFilter}
                  />
                </Box>
              ) : null}
            </Box>
          </Box>

          <Spacer height={isMobile ? '16px' : '20px'} />
        </Box>
      </Box>

      {/* Scrollable Content Section */}
      <AppsDesktopLibraryBody
        sx={{
          alignItems: 'center',
          flex: 1,
          overflow: 'hidden',
          padding: '0px',
        }}
      >
        <AppsDesktopLibraryBody
          ref={bindScrollContainer}
          sx={{
            alignItems: 'center',
            boxSizing: 'border-box',
            flex: 1,
            maxWidth: '1500px',
            minHeight: 0,
            msOverflowStyle: 'none',
            // Only scroll vertically; clipping horizontal overflow keeps app
            // cards inside the padded area (no spill past the right edge) and
            // stops the width jitter that made the community grid glitch.
            overflowX: 'hidden',
            overflowY: 'auto',
            // Landscape has spare width; pull the content in from the edges.
            px: isMobile ? (compactHeader ? 3 : 2) : 0,
            pb: isMobile
              ? 'calc(32px + env(safe-area-inset-bottom, 0px))'
              : 0,
            scrollbarWidth: showLibraryScrollbar ? 'auto' : 'none',
            width: isMobile ? '100%' : '90%',
            '& > *': isMobile
              ? {
                  maxWidth: '100%',
                  width: '100%',
                }
              : undefined,
            '&::-webkit-scrollbar': {
              display: showLibraryScrollbar ? 'initial' : 'none',
            },
          }}
        >
          {renderTabContent()}
        </AppsDesktopLibraryBody>
      </AppsDesktopLibraryBody>
    </AppsLibraryContainer>
  );
};
