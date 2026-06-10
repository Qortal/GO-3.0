import { useMemo } from 'react';
import { Box, styled } from '@mui/material';
import { AppsList, AppsWidthLimiter } from '../Apps-styles';
import { executeEvent } from '../../../utils/events';
import { CategoryCard } from '../Categories';
import { AppCardEnhanced, AppCardListItem } from '../AppCard';
import { officialAppList } from '../config/officialApps';

interface Category {
  id: string;
  name: string;
}

interface CategoriesTabProps {
  categories: Category[];
  availableQapps: any[];
  isMobile?: boolean;
  myName?: string;
  searchValue?: string;
}

const CategoriesGrid = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ isMobile }) => ({
  display: 'grid',
  gridTemplateColumns: isMobile
    ? 'repeat(2, 1fr)'
    : 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: isMobile ? '12px' : '16px',
  width: '100%',
}));

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

export const CategoriesTab = ({
  categories,
  availableQapps,
  isMobile = false,
  myName = '',
  searchValue = '',
}: CategoriesTabProps) => {
  // Count apps per category
  const categoryAppCounts = useMemo(() => {
    const counts: Record<string, number> = { all: availableQapps.length };
    availableQapps.forEach((app) => {
      const categoryId = app?.metadata?.category;
      if (categoryId) {
        counts[categoryId] = (counts[categoryId] || 0) + 1;
      }
    });
    return counts;
  }, [availableQapps]);

  // Filtered community apps used when search is active
  const filteredCommunityApps = useMemo(() => {
    if (!searchValue) return [];
    const searchLower = searchValue.toLowerCase();
    return availableQapps.filter(
      (app) =>
        !officialAppList.includes(app?.name?.toLowerCase()) &&
        (app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower)))
    );
  }, [availableQapps, searchValue]);

  const handleCategoryClick = (category: Category) => {
    executeEvent('selectedCategory', {
      data: category,
    });
  };

  if (searchValue) {
    return (
      <AppsWidthLimiter isMobile={isMobile}>
        {isMobile ? (
          <AppsList>
            {filteredCommunityApps.map((app) => (
              <AppCardListItem
                key={`${app?.service}-${app?.name}`}
                app={app}
                myName={myName}
              />
            ))}
          </AppsList>
        ) : (
          <AppsGrid isMobile={isMobile}>
            {filteredCommunityApps.map((app) => (
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
  }

  return (
    <AppsWidthLimiter isMobile={isMobile}>
      <CategoriesGrid isMobile={isMobile}>
        {/* All category */}
        <CategoryCard
          category={{ id: 'all', name: 'All' }}
          appCount={categoryAppCounts.all || 0}
          onClick={handleCategoryClick}
        />

        {/* Dynamic categories */}
        {categories?.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            appCount={categoryAppCounts[category.id] || 0}
            onClick={handleCategoryClick}
          />
        ))}
      </CategoriesGrid>
    </AppsWidthLimiter>
  );
};
