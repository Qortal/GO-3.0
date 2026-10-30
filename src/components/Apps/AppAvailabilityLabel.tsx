import { CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AppNodeStatus } from './appNodeStatus';

// One percent format per language, not one per progress tick.
const percentFormats = new Map<string, Intl.NumberFormat>();
const percentFormat = (language: string): Intl.NumberFormat => {
  let format = percentFormats.get(language);
  if (!format) {
    format = new Intl.NumberFormat(language, { style: 'percent' });
    percentFormats.set(language, format);
  }
  return format;
};

/**
 * The text of an app's Open / Download button. The button does the same
 * thing either way (it opens the app, and the node fetches what it lacks);
 * the label only says how soon it will show.
 */
export const AppAvailabilityLabel = ({ status }: { status: AppNodeStatus }) => {
  const { t, i18n } = useTranslation(['core']);

  switch (status.availability) {
    case 'ready':
      return (
        <>{t('core:action.open', { postProcess: 'capitalizeFirstChar' })}</>
      );
    case 'downloading':
      return (
        <>
          {status.percent != null
            ? percentFormat(i18n.language).format(status.percent / 100)
            : t('core:message.generic.downloading', {
                postProcess: 'capitalizeFirstChar',
              })}
        </>
      );
    case 'checking':
      return (
        <CircularProgress
          aria-label={t('core:app_detail.status_checking', {
            postProcess: 'capitalizeFirstChar',
          })}
          color="inherit"
          size={14}
          thickness={5}
        />
      );
    default:
      return (
        <>{t('core:action.download', { postProcess: 'capitalizeFirstChar' })}</>
      );
  }
};
