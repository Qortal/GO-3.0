import { Avatar, Box, IconButton, Typography, alpha, styled, useTheme } from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import {
  isAppPinnedAtomFamily,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import { executeEvent } from '../../../utils/events';
import { saveToLocalStorage } from '../AppsNavBarDesktop';
import { AppRating } from '../AppRating';
import { AppButton, AppButtonText } from '../Apps-styles';

const PINNED_KEY_SEP = '\0';

interface AppCardListItemProps {
  app: any;
  myName: string;
  isFromCategory?: boolean;
}

const ListItemContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '10px 2px',
  width: '100%',
  cursor: 'pointer',
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.45)}`,
  backgroundColor: 'transparent',
  transition: 'background-color 0.15s ease',
  '&:active': {
    backgroundColor: alpha(theme.palette.action.hover, 0.35),
  },
  '&:last-of-type': {
    borderBottom: 'none',
  },
}));

const AppIcon = styled(Box)(({ theme }) => ({
  width: '48px',
  height: '48px',
  borderRadius: '12px',
  backgroundColor: alpha(theme.palette.background.paper, 0.5),
  border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
}));

const ContentContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  gap: '2px',
});

const AppTitle = styled(Typography)(({ theme }) => ({
  fontSize: '15px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}));

const DeveloperName = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  color: theme.palette.text.secondary,
}));

const ActionsContainer = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  flexShrink: 0,
});

const AppCardListItemInner = ({
  app,
  myName,
  isFromCategory = false,
}: AppCardListItemProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isInstalled = app?.status?.status === 'READY';

  const pinnedKey = useMemo(
    () => `${app?.service ?? ''}${PINNED_KEY_SEP}${app?.name ?? ''}`,
    [app?.name, app?.service]
  );
  const isSelectedAppPinned = useAtomValue(isAppPinnedAtomFamily(pinnedKey));
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const handleCardClick = useCallback(() => {
    if (isFromCategory) {
      executeEvent('selectedAppInfoCategory', { data: app });
    } else {
      executeEvent('selectedAppInfo', { data: app });
    }
  }, [app, isFromCategory]);

  const handlePinClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const name = app?.name;
      const service = app?.service;
      setSortablePinnedApps((prev) => {
        const isPinned = !!prev?.find(
          (item) => item?.name === name && item?.service === service
        );
        const updatedApps = isPinned
          ? prev.filter(
              (item) => !(item?.name === name && item?.service === service)
            )
          : [...(prev ?? []), { name, service }];
        saveToLocalStorage(
          'ext_saved_settings',
          'sortablePinnedApps',
          updatedApps
        );
        return updatedApps;
      });
      setSettingsLocalLastUpdated(Date.now());
    },
    [
      app?.name,
      app?.service,
      setSortablePinnedApps,
      setSettingsLocalLastUpdated,
    ]
  );

  const handleOpenClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      executeEvent('addTab', { data: app });
    },
    [app]
  );

  return (
    <ListItemContainer onClick={handleCardClick}>
      <AppIcon>
        <Avatar
          sx={{
            height: '36px',
            width: '36px',
            '& img': { objectFit: 'fill' },
          }}
          alt={app?.name}
          src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${app?.name}/qortal_avatar?async=true`}
        >
          <img
            style={{ width: '24px', height: 'auto' }}
            src={LogoSelected}
            alt="app-icon"
          />
        </Avatar>
      </AppIcon>

      <ContentContainer>
        <AppTitle>{app?.metadata?.title || app?.name}</AppTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <DeveloperName>
            {t('core:app_detail.by_developer', {
              developer: app?.name,
              postProcess: 'capitalizeFirstChar',
              defaultValue: 'by @{{developer}}',
            })}
          </DeveloperName>
          <AppRating app={app} myName={myName} />
        </Box>
      </ContentContainer>

      <ActionsContainer>
        <IconButton
          size="small"
          onClick={handlePinClick}
          sx={{
            opacity: isSelectedAppPinned ? 0.7 : 0.45,
            color: isSelectedAppPinned
              ? theme.palette.primary.main
              : theme.palette.text.secondary,
          }}
          aria-label={
            isSelectedAppPinned
              ? t('core:action.unpin', { postProcess: 'capitalizeFirstChar' })
              : t('core:action.pin', { postProcess: 'capitalizeFirstChar' })
          }
        >
          {isSelectedAppPinned ? (
            <PushPinIcon sx={{ fontSize: '18px' }} />
          ) : (
            <PushPinOutlinedIcon sx={{ fontSize: '18px' }} />
          )}
        </IconButton>

        <AppButton
          onClick={handleOpenClick}
          sx={{
            minWidth: '72px',
            height: '32px',
            padding: '0 10px',
            backgroundColor: isInstalled
              ? theme.palette.primary.main
              : alpha(theme.palette.background.paper, 0.5),
            color: isInstalled
              ? theme.palette.primary.contrastText
              : theme.palette.text.primary,
            border: isInstalled
              ? 'none'
              : `1px solid ${alpha(theme.palette.divider, 0.5)}`,
          }}
        >
          <AppButtonText sx={{ fontSize: '12px' }}>
            {isInstalled
              ? t('core:action.open', { postProcess: 'capitalizeFirstChar' })
              : t('core:action.download', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </AppButtonText>
        </AppButton>
      </ActionsContainer>
    </ListItemContainer>
  );
};

export const AppCardListItem = memo(AppCardListItemInner);
