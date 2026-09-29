import {
  Box,
  Button,
  FormControlLabel,
  IconButton,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useTranslation } from 'react-i18next';
import {
  TORQ_MAX_POLL_OPTION_LENGTH,
  TORQ_MAX_POLL_OPTIONS,
  TORQ_MIN_POLL_OPTIONS,
} from './torqPublish';

type TorqPollEditorProps = {
  choices: string[];
  anonymous: boolean;
  disabled?: boolean;
  onChoicesChange: (choices: string[]) => void;
  onAnonymousChange: (anonymous: boolean) => void;
  onRemove: () => void;
};

export const TorqPollEditor = ({
  choices,
  anonymous,
  disabled = false,
  onChoicesChange,
  onAnonymousChange,
  onRemove,
}: TorqPollEditorProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);

  const setChoice = (index: number, value: string) => {
    onChoicesChange(
      choices.map((choice, i) =>
        i === index ? value.slice(0, TORQ_MAX_POLL_OPTION_LENGTH) : choice
      )
    );
  };

  return (
    <Box
      sx={{
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 1.25,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 650 }}>
            {t('group:home_composer.poll_title', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
          >
            {t('group:home_composer.poll_hint', {
              min: TORQ_MIN_POLL_OPTIONS,
              max: TORQ_MAX_POLL_OPTIONS,
            })}
          </Typography>
        </Box>
        <IconButton
          size="small"
          aria-label={t('group:home_composer.poll_remove', {
            postProcess: 'capitalizeFirstChar',
          })}
          disabled={disabled}
          onClick={onRemove}
        >
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      {choices.map((choice, index) => (
        <Box
          key={index}
          sx={{ alignItems: 'center', display: 'flex', gap: 0.5 }}
        >
          <TextField
            size="small"
            fullWidth
            disabled={disabled}
            value={choice}
            placeholder={t('group:home_composer.poll_choice', {
              number: index + 1,
              postProcess: 'capitalizeFirstChar',
            })}
            inputProps={{
              'aria-label': t('group:home_composer.poll_choice', {
                number: index + 1,
                postProcess: 'capitalizeFirstChar',
              }),
              maxLength: TORQ_MAX_POLL_OPTION_LENGTH,
            }}
            onChange={(event) => setChoice(index, event.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '10px',
                fontSize: 14,
              },
            }}
          />
          {choices.length > TORQ_MIN_POLL_OPTIONS ? (
            <IconButton
              size="small"
              aria-label={t('group:home_composer.poll_remove_choice', {
                number: index + 1,
                postProcess: 'capitalizeFirstChar',
              })}
              disabled={disabled}
              onClick={() =>
                onChoicesChange(choices.filter((_, i) => i !== index))
              }
            >
              <CloseRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          ) : null}
        </Box>
      ))}

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'space-between',
        }}
      >
        <Button
          size="small"
          startIcon={<AddRoundedIcon />}
          disabled={disabled || choices.length >= TORQ_MAX_POLL_OPTIONS}
          onClick={() => onChoicesChange([...choices, ''])}
          sx={{ borderRadius: '10px', textTransform: 'none' }}
        >
          {t('group:home_composer.poll_add_choice', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={anonymous}
              disabled={disabled}
              onChange={(event) => onAnonymousChange(event.target.checked)}
            />
          }
          label={t('group:home_composer.poll_anonymous', {
            postProcess: 'capitalizeFirstChar',
          })}
          sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: 13 } }}
        />
      </Box>
      {anonymous ? (
        <Typography
          sx={{
            backgroundColor: alpha(theme.palette.info.main, 0.08),
            borderRadius: '8px',
            color: theme.palette.text.secondary,
            fontSize: 12,
            px: 1,
            py: 0.75,
          }}
        >
          {t('group:home_composer.poll_anonymous_hint')}
        </Typography>
      ) : null}
    </Box>
  );
};
