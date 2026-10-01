import { CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AppNodeStatus } from './appNodeStatus';

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
            ? new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(
                status.percent / 100
              )
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
