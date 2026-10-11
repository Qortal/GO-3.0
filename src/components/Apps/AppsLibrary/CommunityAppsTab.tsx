import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import {
  Box,
  Typography,
  styled,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppLibrarySubTitle, AppsWidthLimiter } from '../Apps-styles';
import {
  AppCardEnhanced,
  AppCardListItem,
  FeaturedAppBanner,
} from '../AppCard';
import { FilterBar, SortOption, StatusFilterOption } from '../Filters';
import { officialAppList } from '../config/officialApps';
import { filterAndSortApps } from '../../../atoms/appsAtoms';
import { getCacheKey, ratingsStoreAtom } from '../../../hooks/useAppRatings';
import type { AppRatingData } from '../../../types/ratings';
import { Spacer } from '../../../common/Spacer';
import { pickTopRated } from '../../../utils/appRatingScore';
import { VirtualAppGrid } from './VirtualAppGrid';
import { isAppProbablyOnNode, useAppNodeStatusVersion } from '../appNodeStatus';
import { useGoLayout } from '../../../layout/goLayout';
import {
  libraryListColumns,
  selectGoLibraryWide,
} from '../../Mobile/tabsHome/goTabsGrid';

const CARD_MIN_WIDTH = 320;
const CARD_HEIGHT = 220;
const GRID_GAP = 16;
const LIST_ITEM_HEIGHT = 72;
const TABLET_LIST_GAP = 12;
const EMPTY_RATINGS_MAP = new Map<string, AppRatingData>();

const SectionHeader = styled(Box)({
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '20px',
  width: '100%',
});

interface CommunityAppsTabProps {
  availableQapps: any[];
  myName: string;
  searchValue: string;
  sortValue: SortOption;
  categoryValue: string;
  statusValue: StatusFilterOption;
  scrollParent?: HTMLElement | null;
  /** Mobile filter bar wiring (GO fork) — optional so desktop callers can omit. */
  isActive?: boolean;
  isMobile?: boolean;
  categories?: Array<{ id: string; name: string }>;
  onSortChange?: (value: SortOption) => void;
  onCategoryChange?: (value: string) => void;
  onStatusChange?: (value: StatusFilterOption) => void;
}

export const CommunityAppsTab = ({
  availableQapps,
  myName,
  searchValue,
  sortValue,
  categoryValue,
  statusValue,
  isActive,
  isMobile = false,
  categories = [],
  onSortChange,
  onCategoryChange,
  onStatusChange,
  scrollParent,
}: CommunityAppsTabProps) => {
  const theme = useTheme();
  // Tablet tier (600-900px): two columns of list items instead of one.
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  // GO from 1000px wide: as many 340px columns as fit.
  const wideLibrary = useGoLayout(selectGoLibraryWide);
  const { t } = useTranslation(['core']);
  const isRatingSort =
    sortValue === 'highest_rated' || sortValue === 'most_rated';
  // Featured needs every rating; the list only re-sorts on them when sorted
  // by rating.
  const ratingsStore = useAtomValue(ratingsStoreAtom);
  const ratingsForSort = isRatingSort ? ratingsStore : EMPTY_RATINGS_MAP;
  // The installed filter follows the node's live answers as they come in.
  const nodeStatusVersion = useAppNodeStatusVersion(statusValue !== 'all');

  // Filter out official apps to show only community apps
  const communityApps = useMemo(() => {
    return availableQapps.filter(
      (app) => !officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  // Apply all filters and sorting (ratings-aware)
  const filteredAndSortedApps = useMemo(() => {
    return filterAndSortApps(communityApps, {
      sort: sortValue,
      category: categoryValue,
      status: statusValue,
      search: searchValue,
      ratingsMap: ratingsForSort,
      isOnNode: isAppProbablyOnNode,
    });
    // nodeStatusVersion only triggers the re-filter; isOnNode reads the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    communityApps,
    searchValue,
    categoryValue,
    statusValue,
    sortValue,
    ratingsForSort,
    nodeStatusVersion,
  ]);

  // The best rated community apps, weighing how many voted; filters narrow
  // the list below, so Featured is only shown over the unfiltered list.
  const showFeatured = categoryValue === 'all' && statusValue === 'all';
  const featuredApps = useMemo(
    () =>
      showFeatured
        ? pickTopRated(communityApps, (app) =>
            ratingsStore.get(getCacheKey(app.name, app.service))
          )
        : [],
    [communityApps, ratingsStore, showFeatured]
  );
  const hasFeatured = featuredApps.length > 0;

  return (
    <AppsWidthLimiter isMobile={isMobile} sx={{ flex: 1, minHeight: 0 }}>
      {hasFeatured ? (
        <>
          <AppLibrarySubTitle sx={{ fontSize: '20px', marginBottom: '24px' }}>
            {t('core:official_apps.featured', {
              postProcess: 'capitalizeFirstChar',
              defaultValue: 'Featured',
            })}
          </AppLibrarySubTitle>
          <FeaturedAppBanner featuredApps={featuredApps} isMobile={isMobile} />
          <Spacer height={isMobile ? '24px' : '40px'} />
        </>
      ) : null}
      {isMobile && onSortChange && onCategoryChange && onStatusChange && (
        <FilterBar
          isMobile
          categories={categories}
          categoryValue={categoryValue}
          onCategoryChange={onCategoryChange}
          onSortChange={onSortChange}
          onStatusChange={onStatusChange}
          sortValue={sortValue}
          statusValue={statusValue}
        />
      )}
      {isMobile || hasFeatured ? (
        <SectionHeader>
          <AppLibrarySubTitle sx={{ fontSize: '20px' }}>
            {t('core:tabs.community_apps', {
              postProcess: 'capitalizeFirstChar',
            })}{' '}
            <Typography
              component="span"
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '16px',
                fontWeight: 400,
              }}
            >
              ({filteredAndSortedApps.length})
            </Typography>
          </AppLibrarySubTitle>
        </SectionHeader>
      ) : null}
      {filteredAndSortedApps.length > 0 ? (
        isMobile ? (
          <VirtualAppGrid
            apps={filteredAndSortedApps}
            columns={libraryListColumns(isTablet, wideLibrary)}
            enabled={isActive !== false}
            gap={isTablet ? TABLET_LIST_GAP : 0}
            itemHeight={LIST_ITEM_HEIGHT}
            overscan={4}
            renderApp={(app) => <AppCardListItem app={app} myName={myName} />}
            scrollElement={scrollParent ?? null}
          />
        ) : (
          <VirtualAppGrid
            apps={filteredAndSortedApps}
            columns={{ minWidth: CARD_MIN_WIDTH }}
            enabled={isActive !== false}
            gap={GRID_GAP}
            itemHeight={CARD_HEIGHT}
            renderApp={(app) => <AppCardEnhanced app={app} myName={myName} />}
            scrollElement={scrollParent ?? null}
          />
        )
      ) : (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            padding: '40px',
          }}
        >
          <Typography sx={{ color: theme.palette.text.secondary }}>
            {t('core:message.generic.no_results', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      )}
    </AppsWidthLimiter>
  );
};
