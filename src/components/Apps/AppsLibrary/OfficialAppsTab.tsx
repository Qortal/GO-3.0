import { memo, useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Typography, styled, useMediaQuery, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppLibrarySubTitle, AppsList, AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { AppCardEnhanced, AppCardListItem, FeaturedAppBanner } from '../AppCard';
import { isFeaturedApp, officialAppList } from '../config/officialApps';
import {
  featuredRatingsMapAtomFamily,
  getCacheKey,
  useAppRatings,
} from '../../../hooks/useAppRatings';
import { useGoLayout } from '../../../layout/goLayout';
import {
  libraryListGridTemplate,
  selectGoLibraryWide,
} from '../../Mobile/tabsHome/goTabsGrid';

const AppsGrid = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ isMobile }) => ({
  display: 'grid',
  gridTemplateColumns: isMobile
    ? 'repeat(auto-fill, minmax(160px, 1fr))'
    : 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '16px',
  width: '100%',
}));

const SectionHeader = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  marginBottom: '20px',
});

interface OfficialAppsTabProps {
  availableQapps: any[];
  isMobile?: boolean;
  isActive?: boolean;
  myName?: string;
  searchValue?: string;
}

const OfficialAppsTabInner = ({
  availableQapps,
  isMobile = false,
  isActive = true,
  myName = '',
  searchValue = '',
}: OfficialAppsTabProps) => {
  const theme = useTheme();
  // Tablet tier (600-900px): show the app list in two columns to use the
  // extra width instead of a single narrow column.
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  // GO from 1000px wide: as many 340px columns as fit.
  const wideLibrary = useGoLayout(selectGoLibraryWide);
  const { t } = useTranslation(['core']);
  const { fetchRating } = useAppRatings();
  const fetchedAppsRef = useRef<Set<string>>(new Set());

  // Filter to get only official apps, then apply search
  const officialApps = useMemo(() => {
    let result = availableQapps.filter(
      (app) =>
        app.service === 'APP' &&
        officialAppList.includes(app?.name?.toLowerCase())
    );

    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower))
      );
    }

    return result;
  }, [availableQapps, searchValue]);

  // Featured app list (stable so we can subscribe only to their ratings)
  const featuredAppsBase = useMemo(
    () => officialApps.filter((app) => isFeaturedApp(app.name)),
    [officialApps]
  );

  // Stable key string for the set of featured app cache keys (order-independent)
  const featuredKeysStable = useMemo(() => {
    const keys = featuredAppsBase.map((a) =>
      getCacheKey(a.name, a.service)
    );
    return [...new Set(keys)].sort().join(',');
  }, [featuredAppsBase]);

  // Subscribe only to featured apps' ratings – re-render only when one of these changes
  const ratingsForFeaturedMap = useAtomValue(
    featuredRatingsMapAtomFamily(featuredKeysStable)
  );

  // Fetch ratings for official apps (limited set ~17 apps) - only once per app
  useEffect(() => {
    if (!isActive) return;
    officialApps.forEach((app) => {
      const key = getCacheKey(app.name, app.service);
      if (!fetchedAppsRef.current.has(key)) {
        fetchedAppsRef.current.add(key);
        fetchRating(app.name, app.service);
      }
    });
  }, [isActive, officialApps, fetchRating]);

  // Get featured apps sorted by rating (depends only on featured ratings map)
  const featuredApps = useMemo(() => {
    return [...featuredAppsBase].sort((a, b) => {
      const keyA = getCacheKey(a.name, a.service);
      const keyB = getCacheKey(b.name, b.service);
      const ratingA = ratingsForFeaturedMap[keyA];
      const ratingB = ratingsForFeaturedMap[keyB];

      const avgA = ratingA?.averageRating || 0;
      const avgB = ratingB?.averageRating || 0;

      if (avgB !== avgA) {
        return avgB - avgA;
      }

      const countA = ratingA?.totalVotes || 0;
      const countB = ratingB?.totalVotes || 0;
      return countB - countA;
    });
  }, [featuredAppsBase, ratingsForFeaturedMap]);

  return (
    <AppsWidthLimiter isMobile={isMobile}>
      {/* Featured Apps Carousel - Top 4 by rating */}
      {featuredApps.length > 0 && (
        <>
          <AppLibrarySubTitle
            sx={{
              fontSize: '20px',
              marginBottom: '24px',
            }}
          >
            {t('core:official_apps.featured', {
              postProcess: 'capitalizeFirstChar',
              defaultValue: 'Featured',
            })}
          </AppLibrarySubTitle>

          <FeaturedAppBanner featuredApps={featuredApps} isMobile={isMobile} />

          <Spacer height={isMobile ? '24px' : '40px'} />
        </>
      )}

      {/* All Official Apps Grid */}
      <SectionHeader>
        <AppLibrarySubTitle
          sx={{
            fontSize: '20px',
          }}
        >
          {t('core:apps_official', {
            postProcess: 'capitalizeFirstChar',
          })}{' '}
          <Typography
            component="span"
            sx={{
              fontSize: '16px',
              color: theme.palette.text.secondary,
              fontWeight: 400,
            }}
          >
            ({officialApps.length})
          </Typography>
        </AppLibrarySubTitle>
      </SectionHeader>

      {isMobile ? (
        <AppsList
          sx={
            isTablet
              ? {
                  display: 'grid',
                  gridTemplateColumns: libraryListGridTemplate(wideLibrary),
                  gap: '12px',
                }
              : undefined
          }
        >
          {officialApps.map((app) => (
            <AppCardListItem
              key={`${app?.service}-${app?.name}`}
              app={app}
              myName={myName}
            />
          ))}
        </AppsList>
      ) : (
        <AppsGrid isMobile={isMobile}>
          {officialApps.map((app) => (
            <AppCardEnhanced
              key={`${app?.service}-${app?.name}`}
              app={app}
              myName={myName}
            />
          ))}
        </AppsGrid>
      )}
    </AppsWidthLimiter>
  );
};

const officialTabPropsAreEqual = (
  prev: OfficialAppsTabProps,
  next: OfficialAppsTabProps
) => {
  if (!next.isActive && !prev.isActive) {
    return true;
  }

  return (
    prev.isActive === next.isActive &&
    prev.isMobile === next.isMobile &&
    prev.myName === next.myName &&
    prev.searchValue === next.searchValue &&
    prev.availableQapps === next.availableQapps
  );
};

export const OfficialAppsTab = memo(OfficialAppsTabInner, officialTabPropsAreEqual);
