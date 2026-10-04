import {
  Box,
  IconButton,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import { useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../../utils/events';
import { AppRating } from '../AppRating';
import { AppThumbnailAvatar } from '../AppThumbnailAvatar';
import { AppButton, AppButtonText } from '../Apps-styles';
import { AppAvailabilityLabel } from '../AppAvailabilityLabel';
import { useAppNodeStatus } from '../appNodeStatus';
import { useLibraryAppPin } from '../useLibraryAppPin';

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
  // Fixed height keeps every row uniform so the virtualized grids (community
  // tab) don't jump/glitch when an app has an unusually long name, and the
  // multi-column grids line up evenly.
  height: '72px',
  boxSizing: 'border-box',
  overflow: 'hidden',
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
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
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
  const nodeStatus = useAppNodeStatus(app);
  const isInstalled = nodeStatus.availability === 'ready';

  const {
    isPinned: isSelectedAppPinned,
    target: pinTarget,
    togglePin,
  } = useLibraryAppPin(app);

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
      togglePin();
    },
    [togglePin]
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
        <AppThumbnailAvatar
          appName={app?.name}
          alt={app?.name}
          fallbackSize={24}
          sx={{ height: '36px', width: '36px' }}
        />
      </AppIcon>

      <ContentContainer>
        <AppTitle>{app?.metadata?.title || app?.name}</AppTitle>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'nowrap',
            minWidth: 0,
          }}
        >
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
          aria-label={t(
            pinTarget === 'tabs'
              ? isSelectedAppPinned
                ? 'core:action.unpin_from_tabs'
                : 'core:action.pin_to_tabs'
              : isSelectedAppPinned
                ? 'core:action.unpin'
                : 'core:action.pin',
            { postProcess: 'capitalizeFirstChar' }
          )}
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
            <AppAvailabilityLabel status={nodeStatus} />
          </AppButtonText>
        </AppButton>
      </ActionsContainer>
    </ListItemContainer>
  );
};

export const AppCardListItem = memo(AppCardListItemInner);
