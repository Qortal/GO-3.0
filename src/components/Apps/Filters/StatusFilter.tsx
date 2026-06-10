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

export type StatusFilterOption = 'all' | 'installed' | 'not_installed';

interface StatusFilterProps {
  value: StatusFilterOption;
  onChange: (value: StatusFilterOption) => void;
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

export const StatusFilter = ({ value, onChange, isMobile = false }: StatusFilterProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (event: SelectChangeEvent) => {
    onChange(event.target.value as StatusFilterOption);
  };

  const label = t('core:filter.status', {
    postProcess: 'capitalizeFirstChar',
  });

  if (isMobile) {
    return (
      <MobileLabeledSelect
        id="status-filter"
        label={label}
        value={value}
        onChange={handleChange}
      >
        <MenuItem value="all">
          {t('core:filter.all', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        <MenuItem value="installed">
          {t('core:filter.installed', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        <MenuItem value="not_installed">
          {t('core:filter.not_installed', {
            postProcess: 'capitalizeFirstChar',
          })}
        </MenuItem>
      </MobileLabeledSelect>
    );
  }

  return (
    <StyledFormControl isMobile={isMobile} size="small">
      <InputLabel id="status-filter-label">{label}</InputLabel>
      <Select
        labelId="status-filter-label"
        id="status-filter"
        value={value}
        label={label}
        onChange={handleChange}
      >
        <MenuItem value="all">
          {t('core:filter.all', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        <MenuItem value="installed">
          {t('core:filter.installed', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        <MenuItem value="not_installed">
          {t('core:filter.not_installed', {
            postProcess: 'capitalizeFirstChar',
          })}
        </MenuItem>
      </Select>
    </StyledFormControl>
  );
};
