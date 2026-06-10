import { Box, styled } from '@mui/material';
import { SortDropdown, SortOption } from './SortDropdown';
import { CategoryFilter } from './CategoryFilter';
import { StatusFilter, StatusFilterOption } from './StatusFilter';

const FilterBarContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ isMobile }) => ({
  alignItems: 'center',
  display: 'flex',
  justifyContent: isMobile ? 'stretch' : 'center',
  marginBottom: isMobile ? '20px' : '20px',
  width: '100%',
}));

const FiltersRow = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ isMobile }) => ({
  alignItems: isMobile ? 'flex-start' : 'center',
  display: isMobile ? 'grid' : 'flex',
  gap: isMobile ? '12px 8px' : '12px',
  gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : undefined,
  flexWrap: isMobile ? undefined : 'wrap',
  width: '100%',
}));

interface FilterBarProps {
  sortValue: SortOption;
  onSortChange: (value: SortOption) => void;
  categoryValue: string;
  onCategoryChange: (value: string) => void;
  categories: Array<{ id: string; name: string }>;
  statusValue: StatusFilterOption;
  onStatusChange: (value: StatusFilterOption) => void;
  isMobile?: boolean;
}

export const FilterBar = ({
  sortValue,
  onSortChange,
  categoryValue,
  onCategoryChange,
  categories,
  statusValue,
  onStatusChange,
  isMobile = false,
}: FilterBarProps) => {
  return (
    <FilterBarContainer isMobile={isMobile}>
      <FiltersRow isMobile={isMobile}>
        <SortDropdown
          isMobile={isMobile}
          value={sortValue}
          onChange={onSortChange}
        />
        <CategoryFilter
          isMobile={isMobile}
          value={categoryValue}
          onChange={onCategoryChange}
          categories={categories}
        />
        <StatusFilter
          isMobile={isMobile}
          value={statusValue}
          onChange={onStatusChange}
        />
      </FiltersRow>
    </FilterBarContainer>
  );
};
