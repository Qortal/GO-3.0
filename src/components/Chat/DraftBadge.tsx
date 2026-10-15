import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';

/** Small orange "DRAFT" marker shown next to a conversation (or a group's
 * channel) that has an unsent draft message. Rendered inline at the top-right
 * of the group/user name, or among a channel row's badges. */
export const DraftBadge = ({ fontSize = 10 }: { fontSize?: number }) => {
  const { t } = useTranslation(['core']);
  return (
    <Box
      component="span"
      aria-label={t('core:composer.draft_unsent', {
        postProcess: 'capitalizeFirstChar',
      })}
      sx={{
        color: '#f5a623',
        flexShrink: 0,
        fontSize,
        fontWeight: 700,
        letterSpacing: '0.5px',
        lineHeight: 1.3,
        textTransform: 'uppercase',
      }}
    >
      {t('core:composer.draft')}
    </Box>
  );
};
