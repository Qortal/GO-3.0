import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Collapse,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import PhonelinkEraseRoundedIcon from '@mui/icons-material/PhonelinkEraseRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatBytes,
  qortinoLayoutForPath,
} from '../../../qortinoAgent/manifest';
import {
  QORTINO_ANSWER_LENGTHS,
  QORTINO_KEEP_READY,
  QORTINO_TEXT_SIZES,
  updateQortinoSettings,
  useQortinoSettings,
} from '../../../qortinoAgent/settings';
import type { QortinoInstallState } from '../../../qortinoAgent/store';

const ACCENT = '#7EB6FF';
/** Whether the section was left open, for the next time the panel opens. */
const OPEN_KEY = 'qortal-go:qortino-settings-open:v1';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    /* only for this visit */
  }
}

function reasonOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'errorMessage' in e) {
    return String((e as { errorMessage?: string }).errorMessage);
  }
  return String(e);
}

type Props = {
  install: QortinoInstallState;
  /** Some chat has messages in it. */
  hasChats: boolean;
  onDeleteAllChats: () => void | Promise<void>;
  onRemoveQortino: () => Promise<void>;
};

type ChoiceProps<T extends string> = {
  label: string;
  hint?: string;
  value: T;
  options: readonly T[];
  optionLabel: (option: T) => string;
  onChange: (next: T) => void;
};

function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  optionLabel,
  onChange,
}: ChoiceProps<T>) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const labelId = useId();
  return (
    <Box>
      <Typography
        id={labelId}
        sx={{ fontSize: '0.78rem', fontWeight: 700, mb: 0.5 }}
      >
        {label}
      </Typography>
      <ToggleButtonGroup
        aria-labelledby={labelId}
        exclusive
        fullWidth
        size="small"
        value={value}
        onChange={(_, next: T | null) => {
          if (next) onChange(next);
        }}
      >
        {options.map((option) => (
          <ToggleButton
            key={option}
            value={option}
            sx={{
              borderColor: alpha(theme.palette.divider, 0.6),
              color: alpha(theme.palette.text.primary, 0.75),
              fontSize: '0.72rem',
              fontWeight: 700,
              lineHeight: 1.15,
              px: 0.5,
              py: 0.6,
              textTransform: 'none',
              whiteSpace: 'normal',
              '&.Mui-selected, &.Mui-selected:hover': {
                background: alpha(ACCENT, isDark ? 0.26 : 0.2),
                color: theme.palette.text.primary,
              },
            }}
          >
            {optionLabel(option)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {hint ? (
        <Typography
          sx={{
            color: alpha(theme.palette.text.primary, 0.6),
            fontSize: '0.7rem',
            lineHeight: 1.35,
            mt: 0.5,
          }}
        >
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

type ConfirmProps = {
  text: string;
  action: string;
  working?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function Confirm({ text, action, working, onCancel, onConfirm }: ConfirmProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Box
      role="alertdialog"
      aria-label={text}
      sx={{
        background: alpha(theme.palette.error.main, 0.08),
        border: `1px solid ${alpha(theme.palette.error.main, 0.4)}`,
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        p: 1,
      }}
    >
      <Typography sx={{ fontSize: '0.78rem', lineHeight: 1.4 }}>
        {text}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'flex-end' }}>
        <Button
          disabled={working}
          onClick={onCancel}
          size="small"
          sx={{ textTransform: 'none' }}
        >
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          color="error"
          disabled={working}
          onClick={onConfirm}
          size="small"
          startIcon={
            working ? <CircularProgress color="inherit" size={14} /> : null
          }
          sx={{ textTransform: 'none' }}
          variant="contained"
        >
          {action}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * Qortino's settings, at the top of the chat history panel: how answers are
 * written and shown, how long the model stays loaded, and the two deletes —
 * every chat, or Qortino itself.
 */
export function QortinoSettingsSection({
  install,
  hasChats,
  onDeleteAllChats,
  onRemoveQortino,
}: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core']);
  const settings = useQortinoSettings();
  const [open, setOpen] = useState(readOpen);
  const [confirming, setConfirming] = useState<'chats' | 'remove' | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const bodyId = useId();

  const model = qortinoLayoutForPath(install.llmPath);
  const size = formatBytes(
    model.parts.reduce((sum, part) => sum + part.sizeBytes, 0)
  );

  const remove = async () => {
    setRemoving(true);
    setRemoveError('');
    try {
      // On success the chat gives way to the download screen.
      await onRemoveQortino();
    } catch (e) {
      setRemoveError(
        t('core:qortino_agent.settings.remove.failed', { reason: reasonOf(e) })
      );
      setRemoving(false);
    }
  };

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    saveOpen(next);
    if (!next) setConfirming(null);
  };

  return (
    <Box
      sx={{
        background: alpha(theme.palette.background.paper, isDark ? 0.35 : 0.7),
        border: `1px solid ${alpha(theme.palette.divider, 0.45)}`,
        borderRadius: '12px',
        flexShrink: 0,
        mb: 0.5,
      }}
    >
      <ButtonBase
        aria-controls={bodyId}
        aria-expanded={open}
        onClick={toggleOpen}
        sx={{
          alignItems: 'center',
          borderRadius: '12px',
          display: 'flex',
          gap: 1,
          justifyContent: 'flex-start',
          px: 1,
          py: 0.85,
          width: '100%',
        }}
      >
        <SettingsRoundedIcon sx={{ color: ACCENT, fontSize: 20 }} />
        <Typography
          sx={{
            flex: 1,
            fontSize: '0.88rem',
            fontWeight: 800,
            textAlign: 'left',
          }}
        >
          {t('core:qortino_agent.settings.title')}
        </Typography>
        <ExpandMoreRoundedIcon
          sx={{
            fontSize: 20,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease',
          }}
        />
      </ButtonBase>

      <Collapse in={open} unmountOnExit>
        <Box
          id={bodyId}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
            pb: 1.25,
            pt: 0.25,
            px: 1,
          }}
        >
          <Choice
            label={t('core:qortino_agent.settings.answer_length.label')}
            hint={t('core:qortino_agent.settings.answer_length.hint')}
            value={settings.answerLength}
            options={QORTINO_ANSWER_LENGTHS}
            optionLabel={(option) =>
              t(`core:qortino_agent.settings.answer_length.${option}`)
            }
            onChange={(answerLength) => updateQortinoSettings({ answerLength })}
          />
          <Choice
            label={t('core:qortino_agent.settings.text_size.label')}
            value={settings.textSize}
            options={QORTINO_TEXT_SIZES}
            optionLabel={(option) =>
              t(`core:qortino_agent.settings.text_size.${option}`)
            }
            onChange={(textSize) => updateQortinoSettings({ textSize })}
          />
          <Choice
            label={t('core:qortino_agent.settings.keep_ready.label')}
            hint={t('core:qortino_agent.settings.keep_ready.hint')}
            value={settings.keepReady}
            options={QORTINO_KEEP_READY}
            optionLabel={(option) =>
              t(`core:qortino_agent.settings.keep_ready.${option}`)
            }
            onChange={(keepReady) => updateQortinoSettings({ keepReady })}
          />

          <Box
            component="label"
            sx={{
              alignItems: 'center',
              cursor: 'pointer',
              display: 'flex',
              gap: 1,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>
                {t('core:qortino_agent.settings.enter_sends.label')}
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.primary, 0.6),
                  fontSize: '0.7rem',
                  lineHeight: 1.35,
                }}
              >
                {t('core:qortino_agent.settings.enter_sends.hint')}
              </Typography>
            </Box>
            <Switch
              checked={settings.enterSends}
              onChange={(e) =>
                updateQortinoSettings({ enterSends: e.target.checked })
              }
              size="small"
            />
          </Box>

          <Box
            sx={{
              borderTop: `1px solid ${alpha(theme.palette.divider, 0.45)}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              pt: 1.25,
            }}
          >
            {confirming === 'chats' ? (
              <Confirm
                text={t('core:qortino_agent.settings.delete_chats.confirm')}
                action={t('core:action.delete', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onCancel={() => setConfirming(null)}
                onConfirm={() => {
                  setConfirming(null);
                  void onDeleteAllChats();
                }}
              />
            ) : (
              <Button
                disabled={!hasChats || removing}
                onClick={() => setConfirming('chats')}
                size="small"
                startIcon={<DeleteSweepRoundedIcon />}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                variant="outlined"
              >
                {t('core:qortino_agent.settings.delete_chats.button')}
              </Button>
            )}

            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.6),
                fontSize: '0.7rem',
                lineHeight: 1.35,
                mt: 0.5,
              }}
            >
              {t('core:qortino_agent.settings.remove.on_phone', {
                model: model.label,
                size,
              })}
            </Typography>
            {confirming === 'remove' ? (
              <Confirm
                text={t('core:qortino_agent.settings.remove.confirm', { size })}
                action={
                  removing
                    ? t('core:qortino_agent.settings.remove.removing')
                    : t('core:action.remove', {
                        postProcess: 'capitalizeFirstChar',
                      })
                }
                working={removing}
                onCancel={() => setConfirming(null)}
                onConfirm={() => void remove()}
              />
            ) : (
              <Button
                color="error"
                onClick={() => {
                  setRemoveError('');
                  setConfirming('remove');
                }}
                size="small"
                startIcon={<PhonelinkEraseRoundedIcon />}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                variant="outlined"
              >
                {t('core:qortino_agent.settings.remove.button')}
              </Button>
            )}
            {removeError ? (
              <Typography
                role="alert"
                sx={{ color: theme.palette.error.main, fontSize: '0.72rem' }}
              >
                {removeError}
              </Typography>
            ) : null}
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
