import { forwardRef, memo, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Typography, styled, useMediaQuery, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Virtuoso, VirtuosoGrid, GridComponents } from 'react-virtuoso';
import { AppLibrarySubTitle, AppsList, AppsWidthLimiter } from '../Apps-styles';
import { AppCardEnhanced, AppCardListItem } from '../AppCard';
import { FilterBar, SortOption, StatusFilterOption } from '../Filters';
import { officialAppList } from '../config/officialApps';
import { filterAndSortApps } from '../../../atoms/appsAtoms';
import { ratingsStoreAtom } from '../../../hooks/useAppRatings';

const GRID_GAP = 16;

const SectionHeader = styled(Box)({
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '20px',
  width: '100%',
});

interface CommunityAppsTabProps {
  availableQapps: any[];
  isMobile?: boolean;
  isActive?: boolean;
  myName: string;
  searchValue: string;
  sortValue: SortOption;
  categoryValue: string;
  statusValue: StatusFilterOption;
  categories: Array<{ id: string; name: string }>;
  scrollParent?: HTMLElement | null;
  onSortChange: (value: SortOption) => void;
  onCategoryChange: (value: string) => void;
  onStatusChange: (value: StatusFilterOption) => void;
}

const CommunityAppsTabInner = ({
  availableQapps,
  isMobile = false,
  myName,
  searchValue,
  sortValue,
  categoryValue,
  statusValue,
  categories,
  scrollParent = null,
  onSortChange,
  onCategoryChange,
  onStatusChange,
}: CommunityAppsTabProps) => {
  const cardMinWidth = isMobile ? 160 : 320;

  const gridComponents: GridComponents = useMemo(
    () => ({
      List: forwardRef(({ style, children, ...props }, ref) => (
        <Box
          ref={ref}
          {...props}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))`,
            // Only a column gap on the container; row spacing lives inside the
            // measured Item so VirtuosoGrid's height math stays correct and the
            // scroll doesn't drift/jump mid-scroll.
            columnGap: `${GRID_GAP}px`,
            width: '100%',
            ...style,
          }}
        >
          {children}
        </Box>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      )) as any,
      Item: ({ children, ...props }) => (
        <Box
          {...props}
          style={{
            width: '100%',
            minWidth: 0,
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
            paddingBottom: `${GRID_GAP}px`,
          }}
        >
          {children}
        </Box>
      ),
    }),
    [cardMinWidth]
  );

  const theme = useTheme();
  // Tablet tier (600-900px): two columns of list items instead of one.
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const tabletGridComponents: GridComponents = useMemo(
    () => ({
      List: forwardRef(({ style, children, ...props }, ref) => (
        <Box
          ref={ref}
          {...props}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            // Only a column gap; row spacing lives inside the measured Item so
            // VirtuosoGrid's height math stays correct and the scroll doesn't
            // drift/jump mid-scroll.
            columnGap: `${GRID_GAP}px`,
            width: '100%',
            ...style,
          }}
        >
          {children}
        </Box>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      )) as any,
      Item: ({ children, ...props }) => (
        <Box
          {...props}
          style={{
            width: '100%',
            minWidth: 0,
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
            paddingBottom: `${GRID_GAP}px`,
          }}
        >
          {children}
        </Box>
      ),
    }),
    []
  );
  const { t } = useTranslation(['core']);
  const ratingsStore = useAtomValue(ratingsStoreAtom);

  const communityApps = useMemo(() => {
    return availableQapps.filter(
      (app) => !officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  const filteredAndSortedApps = useMemo(() => {
    return filterAndSortApps(communityApps, {
      sort: sortValue,
      category: categoryValue,
      status: statusValue,
      search: searchValue,
      ratingsMap: ratingsStore,
    });
  }, [
    communityApps,
    searchValue,
    categoryValue,
    statusValue,
    sortValue,
    ratingsStore,
  ]);

  const useExternalScroll = isMobile && Boolean(scrollParent);

  return (
    <AppsWidthLimiter
      isMobile={isMobile}
      sx={
        isMobile
          ? undefined
          : {
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }
      }
    >
      {isMobile ? (
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
      ) : null}

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

      {filteredAndSortedApps.length > 0 ? (
        isMobile && isTablet ? (
          <VirtuosoGrid
            customScrollParent={useExternalScroll ? scrollParent ?? undefined : undefined}
            components={tabletGridComponents}
            itemContent={(index) => {
              const app = filteredAndSortedApps[index];
              return (
                <AppCardListItem
                  key={`${app?.service}-${app?.name}`}
                  app={app}
                  myName={myName}
                />
              );
            }}
            overscan={12}
            style={{ width: '100%' }}
            totalCount={filteredAndSortedApps.length}
          />
        ) : isMobile ? (
          <Virtuoso
            customScrollParent={useExternalScroll ? scrollParent ?? undefined : undefined}
            itemContent={(index) => {
              const app = filteredAndSortedApps[index];
              return (
                <AppCardListItem
                  key={`${app?.service}-${app?.name}`}
                  app={app}
                  myName={myName}
                />
              );
            }}
            overscan={6}
            style={{ width: '100%' }}
            totalCount={filteredAndSortedApps.length}
            components={{
              List: AppsList,
            }}
          />
        ) : (
          <VirtuosoGrid
            components={gridComponents}
            itemContent={(index) => {
              const app = filteredAndSortedApps[index];
              return (
                <AppCardEnhanced
                  key={`${app?.service}-${app?.name}`}
                  app={app}
                  myName={myName}
                />
              );
            }}
            overscan={20}
            style={{
              flex: 1,
              minHeight: 0,
              msOverflowStyle: 'none',
              overflow: 'auto',
              scrollbarWidth: 'auto',
              width: '100%',
            }}
            totalCount={filteredAndSortedApps.length}
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

const communityTabPropsAreEqual = (
  prev: CommunityAppsTabProps,
  next: CommunityAppsTabProps
) => {
  if (!next.isActive && !prev.isActive) {
    return true;
  }

  return (
    prev.isActive === next.isActive &&
    prev.isMobile === next.isMobile &&
    prev.myName === next.myName &&
    prev.searchValue === next.searchValue &&
    prev.sortValue === next.sortValue &&
    prev.categoryValue === next.categoryValue &&
    prev.statusValue === next.statusValue &&
    prev.scrollParent === next.scrollParent &&
    prev.availableQapps === next.availableQapps &&
    prev.categories === next.categories &&
    prev.onSortChange === next.onSortChange &&
    prev.onCategoryChange === next.onCategoryChange &&
    prev.onStatusChange === next.onStatusChange
  );
};

export const CommunityAppsTab = memo(CommunityAppsTabInner, communityTabPropsAreEqual);
