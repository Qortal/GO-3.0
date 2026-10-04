import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import {
  useAccountStatusDisplay,
  useAccountStatusOptions,
} from './accountStatus';

/**
 * The "Status" card with the Online / Busy / Offline pills, used in the Hub
 * account menu and the GO avatar menu. A pick here is synced to the account's
 * other devices (see `utils/presenceStatusSync.ts`).
 */
export function AccountStatusPicker({ labelId }: { labelId: string }) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const { myStatus, setMyStatus } = useAccountStatusDisplay();
  const accountStatusOptions = useAccountStatusOptions();
  const isDarkMode = theme.palette.mode === 'dark';
  // The app themes define `border`; a bare MUI theme (tests) does not.
  const subtleBorder = theme.palette.border?.subtle ?? theme.palette.divider;

  return (
    <Box
      sx={{
        backgroundColor: isDarkMode
          ? alpha(theme.palette.common.white, 0.04)
          : alpha(theme.palette.common.black, 0.035),
        border: `1px solid ${subtleBorder}`,
        borderRadius: '10px',
        mt: 0.5,
        p: 1,
      }}
    >
      <Typography
        id={labelId}
        sx={{
          color: theme.palette.text.secondary,
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1,
          mb: 0.75,
          textTransform: 'uppercase',
        }}
      >
        {t('core:message.generic.status', {
          defaultValue: 'Status',
        })}
      </Typography>
      <Box
        role="group"
        aria-labelledby={labelId}
        sx={{ display: 'flex', gap: 0.75 }}
      >
        {accountStatusOptions.map((option) => {
          const isSelected = option.key === myStatus;

          return (
            <ButtonBase
              key={option.key}
              aria-pressed={isSelected}
              onClick={() => setMyStatus(option.key)}
              sx={{
                alignItems: 'center',
                backgroundColor: isSelected
                  ? alpha(theme.palette.primary.main, isDarkMode ? 0.2 : 0.12)
                  : 'transparent',
                border: `1px solid ${
                  isSelected
                    ? alpha(theme.palette.primary.main, 0.45)
                    : subtleBorder
                }`,
                borderRadius: '999px',
                color: isSelected
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
                display: 'flex',
                flex: 1,
                gap: 0.65,
                justifyContent: 'center',
                minHeight: 30,
                minWidth: 0,
                px: 1,
                transition:
                  'background-color 140ms ease, border-color 140ms ease, color 140ms ease',
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                },
                '&:focus-visible': {
                  outline: `1px solid ${theme.palette.primary.main}`,
                  outlineOffset: '2px',
                },
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  backgroundColor: option.color,
                  borderRadius: '50%',
                  flexShrink: 0,
                  height: 8,
                  width: 8,
                }}
              />
              <Typography
                sx={{
                  fontSize: 12.5,
                  fontWeight: isSelected ? 700 : 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {option.label}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
