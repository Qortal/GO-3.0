import { useEffect, useMemo, useState } from 'react';
import {
  AppCardsGrid,
  AppLibrarySubTitle,
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
  AppsWidthLimiter,
} from './Apps-styles';
import {
  Box,
  ButtonBase,
  InputBase,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { Spacer } from '../../common/Spacer';
import { AppCardEnhanced, AppCardListItem, FeaturedAppBanner } from './AppCard';
import { useTranslation } from 'react-i18next';
import { ComposeP, ShowMessageReturnButton } from '../Group/Forum/Mail-styles';
import { executeEvent } from '../../utils/events';
import { ReturnIcon } from '../../assets/Icons/ReturnIcon';
import { useAtom, useAtomValue } from 'jotai';
import { appSortAtom, filterAndSortApps } from '../../atoms/appsAtoms';
import { getCacheKey, ratingsStoreAtom } from '../../hooks/useAppRatings';
import { pickTopRated } from '../../utils/appRatingScore';
import type { AppRatingData } from '../../types/ratings';
import { SortDropdown } from './Filters';
import { VirtualAppGrid } from './AppsLibrary/VirtualAppGrid';
import { withTabBarSpace } from '../Mobile/mobileBarHeights';
import { SECTION_SURFACE_TOUCH_ACTION } from '../Mobile/sectionSwipe/sectionSwipe';
import { useGoLayout } from '../../layout/goLayout';
import {
  libraryListColumns,
  selectGoLibraryWide,
} from '../Mobile/tabsHome/goTabsGrid';

const LIST_ITEM_HEIGHT = 72;
const TABLET_LIST_GAP = 12;
const EMPTY_RATINGS_MAP = new Map<string, AppRatingData>();

export const AppsCategoryDesktop = ({
  availableQapps,
  myName,
  category,
  isShow,
  isMobile = false,
  contentHeight,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [sortOption, setSortOption] = useAtom(appSortAtom);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null
  );
  const theme = useTheme();
  // Tablet tier (600-900px): two columns of list items instead of one.
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  // GO from 1000px wide: as many 340px columns as fit.
  const wideLibrary = useGoLayout(selectGoLibraryWide);
  const { t } = useTranslation(['core']);

  const title = t('core:app_category.title', {
    name:
      category?.id === 'all'
        ? t('core:all', { postProcess: 'capitalizeFirstChar' })
        : category?.name,
    postProcess: 'capitalizeFirstChar',
  });

  const categoryList = useMemo(() => {
    if (category?.id === 'all') return availableQapps;
    return availableQapps.filter(
      (app) => app?.metadata?.category === category?.id
    );
  }, [availableQapps, category]);

  const [debouncedValue, setDebouncedValue] = useState('');

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]);

  // Featured needs every rating; the list only re-sorts on them when sorted
  // by rating.
  const isRatingSort =
    sortOption === 'highest_rated' || sortOption === 'most_rated';
  const ratingsStore = useAtomValue(ratingsStoreAtom);
  const ratingsForSort = isRatingSort ? ratingsStore : EMPTY_RATINGS_MAP;

  const searchedAndSortedList = useMemo(
    () =>
      filterAndSortApps(categoryList, {
        category: 'all',
        ratingsMap: ratingsForSort,
        search: debouncedValue,
        sort: sortOption,
        status: 'all',
      }),
    [debouncedValue, categoryList, ratingsForSort, sortOption]
  );

  // The category's best rated apps; a search narrows the list, so it hides.
  const featuredApps = useMemo(
    () =>
      debouncedValue
        ? []
        : pickTopRated(categoryList, (app) =>
            ratingsStore.get(getCacheKey(app.name, app.service))
          ),
    [categoryList, debouncedValue, ratingsStore]
  );

  const featuredBlock =
    featuredApps.length > 0 ? (
      <>
        <AppLibrarySubTitle sx={{ fontSize: '20px', marginBottom: '24px' }}>
          {t('core:official_apps.featured', {
            postProcess: 'capitalizeFirstChar',
            defaultValue: 'Featured',
          })}
        </AppLibrarySubTitle>
        <FeaturedAppBanner
          featuredApps={featuredApps}
          isFromCategory
          isMobile={isMobile}
        />
        <Spacer height={isMobile ? '24px' : '40px'} />
      </>
    ) : null;

  const returnButton = (
    <ShowMessageReturnButton
      sx={{
        padding: '2px',
        // Flush with the title below instead of centred in a 120px box.
        ...(isMobile
          ? {
              alignSelf: 'flex-start',
              justifyContent: 'flex-start',
              minWidth: 0,
              padding: '6px 0',
            }
          : {}),
      }}
      onClick={() => {
        executeEvent('navigateBack', {});
        setSearchValue('');
      }}
    >
      <ReturnIcon />
      <ComposeP
        sx={{
          fontSize: isMobile ? '16px' : '18px',
        }}
      >
        {t('core:action.return', {
          postProcess: 'capitalizeFirstChar',
        })}
      </ComposeP>
    </ShowMessageReturnButton>
  );

  const searchBox = (
    <AppsSearchContainer
      sx={
        isMobile
          ? { boxSizing: 'border-box', flex: 1, minWidth: 0 }
          : { width: '412px' }
      }
    >
      <AppsSearchLeft
        sx={
          isMobile ? { flexShrink: 1, minWidth: 0, width: 'auto' } : undefined
        }
      >
        <SearchIcon />

        <InputBase
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          sx={{
            background: theme.palette.background.paper,
            borderRadius: '6px',
            flex: 1,
            ml: 1,
            paddingLeft: '12px',
            ...(isMobile ? { minWidth: 0 } : {}),
          }}
          placeholder={t('core:action.search_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
          inputProps={{
            'aria-label': t('core:action.search_apps', {
              postProcess: 'capitalizeFirstChar',
            }),
            fontSize: '16px',
            fontWeight: 400,
          }}
        />
      </AppsSearchLeft>

      <AppsSearchRight
        sx={isMobile ? { flexShrink: 0, width: 'auto' } : undefined}
      >
        {searchValue && (
          <ButtonBase
            onClick={() => {
              setSearchValue('');
            }}
          >
            <img src={IconClearInput} />
          </ButtonBase>
        )}
      </AppsSearchRight>
    </AppsSearchContainer>
  );

  if (isMobile) {
    return (
      <AppsLibraryContainer
        sx={{
          display: !isShow && 'none',
          height: contentHeight || '100%',
          overflow: 'hidden',
          padding: '0px',
        }}
      >
        <AppsDesktopLibraryHeader
          sx={{
            boxSizing: 'border-box',
            gap: '12px',
            pb: 2,
            pt: 1.5,
            px: 2,
          }}
        >
          {returnButton}

          <AppLibrarySubTitle sx={{ fontSize: '20px' }}>
            {title}{' '}
            <Typography
              component="span"
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '16px',
                fontWeight: 400,
              }}
            >
              ({searchedAndSortedList.length})
            </Typography>
          </AppLibrarySubTitle>

          <Box
            sx={{
              alignItems: 'flex-end',
              display: 'flex',
              gap: '8px',
              width: '100%',
            }}
          >
            {searchBox}
            <Box sx={{ flexShrink: 0, width: '136px' }}>
              <SortDropdown
                isMobile
                value={sortOption}
                onChange={setSortOption}
              />
            </Box>
          </Box>
        </AppsDesktopLibraryHeader>

        <AppsDesktopLibraryBody
          ref={setScrollElement}
          sx={{
            boxSizing: 'border-box',
            flex: 1,
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: 'auto',
            // A sideways start is the section swipe's, never a scroll; the
            // carousels inside keep their own sideways scrolling.
            touchAction: isMobile ? SECTION_SURFACE_TOUCH_ACTION : undefined,
            // Clear of the floating tab buttons while they are over it.
            pb: withTabBarSpace(
              32,
              'calc(32px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))'
            ),
            px: 2,
          }}
        >
          {/* Content-sized wrapper: VirtualAppGrid watches its parent to
              notice Featured appearing above it. */}
          <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            {featuredBlock}
            {searchedAndSortedList.length > 0 ? (
              <VirtualAppGrid
                apps={searchedAndSortedList}
                columns={libraryListColumns(isTablet, wideLibrary)}
                enabled={!!isShow}
                gap={isTablet ? TABLET_LIST_GAP : 0}
                itemHeight={LIST_ITEM_HEIGHT}
                overscan={4}
                renderApp={(app) => (
                  <AppCardListItem app={app} isFromCategory myName={myName} />
                )}
                scrollElement={scrollElement}
              />
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
          </Box>
        </AppsDesktopLibraryBody>
      </AppsLibraryContainer>
    );
  }

  return (
    <AppsLibraryContainer
      sx={{
        display: !isShow && 'none',
        height: contentHeight || '100%',
        overflow: 'hidden',
        padding: '0px',
        paddingTop: '30px',
      }}
    >
      <AppsDesktopLibraryHeader
        sx={{
          maxWidth: '1200px',
          width: '90%',
        }}
      >
        <AppsWidthLimiter
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            flexDirection: 'row',
          }}
        >
          {returnButton}
          {searchBox}
        </AppsWidthLimiter>
      </AppsDesktopLibraryHeader>

      <AppsDesktopLibraryBody
        sx={{
          alignItems: 'center',
          height: 'calc(100% - 36px)',
          overflow: 'auto',
          padding: '0px',
          width: '90%',
          maxWidth: '1200px',
        }}
      >
        <Spacer height="25px" />

        <AppsWidthLimiter>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <AppLibrarySubTitle>{title}</AppLibrarySubTitle>
            <SortDropdown value={sortOption} onChange={setSortOption} />
          </Box>

          <Spacer height="25px" />
        </AppsWidthLimiter>

        <AppsWidthLimiter>
          {featuredBlock}
          <AppCardsGrid>
            {searchedAndSortedList.map((app) => (
              <AppCardEnhanced
                key={`${app?.service}-${app?.name}`}
                app={app}
                myName={myName}
                isFromCategory={true}
              />
            ))}
          </AppCardsGrid>
          <Spacer height="25px" />
        </AppsWidthLimiter>
      </AppsDesktopLibraryBody>
    </AppsLibraryContainer>
  );
};
