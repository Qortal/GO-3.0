import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { reticulumChatTextScaleAtom } from '../../atoms/global';
import {
  RETICULUM_CHAT_TEXT_SCALES,
  RETICULUM_CHAT_TEXT_SCALE_FACTOR,
  qchatMetaTextSize,
  qchatTextSize,
  reticulumChatTextScaleClassName,
} from './reticulumChatTextScale';

/** The sample message's clock, written the way the reader's language does. */
const PREVIEW_TIME = new Date(2026, 0, 1, 9, 41);

/** The size step animates in the preview, so the change is easy to follow. */
const PREVIEW_TEXT_TRANSITION = 'font-size 140ms ease, line-height 140ms ease';

/**
 * Chat settings → Text size: a sample of the chat at the chosen size and the
 * three sizes to choose from. The sample uses the chat's own size rules
 * (reticulumChatTextScale.ts), so it shows exactly what the chat will do.
 */
export function ReticulumTextSizeSettings() {
  const theme = useTheme();
  const { i18n, t } = useTranslation(['reticulum']);
  const [textScale, setTextScale] = useAtom(reticulumChatTextScaleAtom);
  const sender = t('reticulum:settings.text_size.preview.sender');
  const time = PREVIEW_TIME.toLocaleTimeString(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <>
      <Typography
        component="h2"
        sx={{
          color: 'text.primary',
          fontSize: 20,
          fontWeight: 650,
          lineHeight: '26px',
        }}
      >
        {t('reticulum:settings.text_size.title')}
      </Typography>
      <Typography
        sx={{
          color: 'text.secondary',
          fontSize: 14,
          fontWeight: 400,
          lineHeight: '20px',
          maxWidth: 460,
          mt: 0.75,
        }}
      >
        {t('reticulum:settings.text_size.description')}
      </Typography>

      <Box
        aria-label={t('reticulum:settings.text_size.preview.label')}
        className={reticulumChatTextScaleClassName(textScale)}
        data-testid="reticulum-text-size-preview"
        role="group"
        sx={{
          backgroundColor: 'background.default',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          mt: 2.5,
          px: 1.75,
          py: 1.5,
        }}
      >
        <Box>
          <Box sx={{ alignItems: 'center', display: 'flex', gap: '7px' }}>
            <Box
              aria-hidden
              sx={{
                alignItems: 'center',
                backgroundColor: alpha(theme.palette.primary.main, 0.18),
                borderRadius: '50%',
                color: 'text.primary',
                display: 'flex',
                flexShrink: 0,
                fontSize: 14,
                fontWeight: 650,
                height: 32,
                justifyContent: 'center',
                width: 32,
              }}
            >
              {sender.slice(0, 1).toUpperCase()}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <Typography
                sx={{
                  color: 'text.primary',
                  fontSize: qchatTextSize(15.5),
                  fontWeight: 600,
                  lineHeight: 1.3,
                  transition: PREVIEW_TEXT_TRANSITION,
                }}
              >
                {sender}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: qchatMetaTextSize(11),
                  lineHeight: 1,
                  transition: PREVIEW_TEXT_TRANSITION,
                }}
              >
                {time}
              </Typography>
            </Box>
          </Box>
          <Typography
            sx={{
              color: 'text.primary',
              fontSize: qchatTextSize(16),
              lineHeight: 1.5,
              mt: '4px',
              transition: PREVIEW_TEXT_TRANSITION,
            }}
          >
            {t('reticulum:settings.text_size.preview.incoming')}
          </Typography>
        </Box>
        <Typography
          sx={{
            alignSelf: 'flex-end',
            color: 'text.primary',
            fontSize: qchatTextSize(16),
            lineHeight: 1.5,
            maxWidth: '88%',
            textAlign: 'right',
            transition: PREVIEW_TEXT_TRANSITION,
          }}
        >
          {t('reticulum:settings.text_size.preview.outgoing')}
        </Typography>
      </Box>

      <Box
        aria-label={t('reticulum:settings.text_size.title')}
        role="radiogroup"
        sx={{ display: 'grid', gap: 1, mt: 2 }}
      >
        {RETICULUM_CHAT_TEXT_SCALES.map((option) => {
          const selected = textScale === option;
          return (
            <ButtonBase
              aria-checked={selected}
              key={option}
              onClick={() => setTextScale(option)}
              role="radio"
              sx={{
                alignItems: 'center',
                backgroundColor: selected
                  ? theme.palette.action.hover
                  : 'background.default',
                border: `1px solid ${
                  selected ? theme.palette.primary.main : theme.palette.divider
                }`,
                borderRadius: '10px',
                display: 'flex',
                gap: 1.5,
                justifyContent: 'flex-start',
                minHeight: 60,
                px: 1.5,
                py: 1,
                textAlign: 'left',
                transition: 'background-color 120ms ease, border-color 120ms',
              }}
            >
              {/* The size itself, so the choice reads at a glance. */}
              <Box
                aria-hidden
                sx={{
                  color: selected ? 'primary.main' : 'text.secondary',
                  flexShrink: 0,
                  fontSize: 16 * RETICULUM_CHAT_TEXT_SCALE_FACTOR[option],
                  fontWeight: 650,
                  lineHeight: 1,
                  textAlign: 'center',
                  width: 36,
                }}
              >
                {t('reticulum:settings.text_size.sample')}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{
                    color: 'text.primary',
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: '20px',
                  }}
                >
                  {t(`reticulum:settings.text_size.${option}.label`)}
                </Typography>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: 13,
                    lineHeight: '18px',
                    mt: 0.25,
                  }}
                >
                  {t(`reticulum:settings.text_size.${option}.detail`)}
                </Typography>
              </Box>
              <Box
                aria-hidden
                sx={{
                  alignItems: 'center',
                  border: `2px solid ${
                    selected
                      ? theme.palette.primary.main
                      : theme.palette.text.secondary
                  }`,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexShrink: 0,
                  height: 20,
                  justifyContent: 'center',
                  width: 20,
                }}
              >
                {selected && (
                  <Box
                    sx={{
                      backgroundColor: 'primary.main',
                      borderRadius: '50%',
                      height: 10,
                      width: 10,
                    }}
                  />
                )}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </>
  );
}
