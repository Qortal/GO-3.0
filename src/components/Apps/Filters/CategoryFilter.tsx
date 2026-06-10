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

interface CategoryFilterProps {
  value: string;
  onChange: (value: string) => void;
  categories: Array<{ id: string; name: string }>;
  isMobile?: boolean;
}

const StyledFormControl = styled(FormControl, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile?: boolean }>(({ isMobile }) => ({
  flex: isMobile ? '1 1 0' : undefined,
  minWidth: isMobile ? 0 : '140px',
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

export const CategoryFilter = ({
  value,
  onChange,
  categories,
  isMobile = false,
}: CategoryFilterProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (event: SelectChangeEvent) => {
    onChange(event.target.value);
  };

  const label = t('core:category', {
    postProcess: 'capitalizeFirstChar',
  });

  if (isMobile) {
    return (
      <MobileLabeledSelect
        id="category-filter"
        label={label}
        value={value}
        onChange={handleChange}
      >
        <MenuItem value="all">
          {t('core:filter.all', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id}>
            {category.name}
          </MenuItem>
        ))}
      </MobileLabeledSelect>
    );
  }

  return (
    <StyledFormControl isMobile={isMobile} size="small">
      <InputLabel id="category-filter-label">{label}</InputLabel>
      <Select
        labelId="category-filter-label"
        id="category-filter"
        value={value}
        label={label}
        onChange={handleChange}
      >
        <MenuItem value="all">
          {t('core:filter.all', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id}>
            {category.name}
          </MenuItem>
        ))}
      </Select>
    </StyledFormControl>
  );
};
