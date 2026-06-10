import { Box, Select, SelectChangeEvent, Typography } from '@mui/material';
import { ReactNode } from 'react';

type MobileLabeledSelectProps = {
  id: string;
  label: string;
  value: string;
  onChange: (event: SelectChangeEvent) => void;
  children: ReactNode;
};

export const MobileLabeledSelect = ({
  id,
  label,
  value,
  onChange,
  children,
}: MobileLabeledSelectProps) => (
  <Box sx={{ minWidth: 0, width: '100%' }}>
    <Typography
      component="label"
      htmlFor={id}
      sx={{
        color: 'text.secondary',
        display: 'block',
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.2,
        lineHeight: 1.2,
        mb: 0.5,
      }}
    >
      {label}
    </Typography>
    <Select
      fullWidth
      id={id}
      size="small"
      value={value}
      onChange={onChange}
      sx={{
        '& .MuiSelect-select': {
          fontSize: 12,
          minHeight: '24px',
          py: 0.75,
        },
        fontSize: 12,
      }}
    >
      {children}
    </Select>
  </Box>
);
