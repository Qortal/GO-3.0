import { useMemo } from 'react';
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  styled,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { MobileLabeledSelect } from './MobileLabeledSelect';

export type SortOption = 'newest' | 'oldest' | 'alphabetical' | 'highest_rated' | 'most_rated' | 'recently_updated';

interface SortDropdownProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
  isMobile?: boolean;
}

const StyledFormControl = styled(FormControl, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ isMobile }) => ({
  flex: isMobile ? '1 1 0' : undefined,
  minWidth: isMobile ? 0 : '160px',
  width: isMobile ? '100%' : 'auto',
  '& .MuiInputBase-root': {
    height: isMobile ? '34px' : '36px',
    fontSize: isMobile ? '12px' : '14px',
  },
  '& .MuiInputLabel-root': {
    fontSize: isMobile ? '12px' : '14px',
    transform: isMobile
      ? 'translate(10px, 8px) scale(1)'
      : 'translate(14px, 8px) scale(1)',
    '&.Mui-focused, &.MuiFormLabel-filled': {
      transform: isMobile
        ? 'translate(10px, -9px) scale(0.75)'
        : 'translate(14px, -9px) scale(0.75)',
    },
  },
  '& .MuiSelect-select': {
    padding: isMobile ? '6px 28px 6px 10px' : undefined,
  },
}));

const SORT_OPTIONS: SortOption[] = ['alphabetical', 'newest', 'oldest', 'highest_rated', 'most_rated', 'recently_updated'];

export const SortDropdown = ({ value, onChange, isMobile = false }: SortDropdownProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (event: SelectChangeEvent) => {
    onChange(event.target.value as SortOption);
  };

  // Sort options alphabetically based on translated labels
  const sortedOptions = useMemo(() => {
    return SORT_OPTIONS.map((option) => ({
      value: option,
      label: t(`core:sort.${option}`, {
        postProcess: 'capitalizeFirstChar',
      }),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [t]);

  const label = t('core:filter.sort_by', {
    postProcess: 'capitalizeFirstChar',
  });

  if (isMobile) {
    return (
      <MobileLabeledSelect
        id="sort-select"
        label={label}
        value={value}
        onChange={handleChange}
      >
        {sortedOptions.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </MobileLabeledSelect>
    );
  }

  return (
    <StyledFormControl isMobile={isMobile} size="small">
      <InputLabel id="sort-select-label">{label}</InputLabel>
      <Select
        labelId="sort-select-label"
        id="sort-select"
        value={value}
        label={label}
        onChange={handleChange}
      >
        {sortedOptions.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </StyledFormControl>
  );
};
