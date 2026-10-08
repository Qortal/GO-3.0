import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
import {
  Box,
  Dialog,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddGroupList } from './AddGroupList';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { refreshReticulumGroupScores } from './reticulumGroupScore';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { MobilePanelHeader } from '../Mobile/MobilePanelHeader';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { SAFE_AREA_BOTTOM } from '../../utils/mobileSafeArea';

type FindGroupModalProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onOpenJoinedGroup: (group: unknown) => void;
};

export function FindGroupModal({
  open,
  setOpen,
  onOpenJoinedGroup,
}: FindGroupModalProps) {
  const { t } = useTranslation(['group']);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const theme = useTheme();
  // Phones: a full-screen panel like the other group panels (Members,
  // Calendar, Files), with the shared header; Android back closes it.
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  useAndroidBack(
    () => {
      setOpen(false);
      return true;
    },
    { priority: BACK_PRIORITY.dialog, enabled: open }
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timers: number[] = [];
    const refresh = () => {
      if (cancelled) return;
      void refreshReticulumGroupScores(true);
    };
    refresh();
    timers.push(window.setTimeout(refresh, 8_000));
    timers.push(window.setTimeout(refresh, 20_000));
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [open]);

  if (!open) return null;

  return (
    <Fragment>
      <Dialog
        fullWidth
        maxWidth={false}
        onClose={(_event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
            setOpen(false);
          }
        }}
        open={open}
        fullScreen={isPhone}
        PaperProps={{
          sx: isPhone
            ? {
                backgroundColor: 'background.paper',
                backgroundImage: 'none',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                paddingBottom: SAFE_AREA_BOTTOM,
              }
            : {
                backgroundColor: 'background.paper',
                backgroundImage: 'none',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '12px',
                boxShadow: '0 24px 70px rgba(0, 0, 0, 0.45)',
                display: 'flex',
                flexDirection: 'column',
                height: 'min(760px, calc(100vh - 32px))',
                m: 2,
                maxHeight: 'min(760px, calc(100vh - 32px))',
                maxWidth: 'none',
                overflow: 'hidden',
                width: 'min(920px, calc(100vw - 32px))',
              },
        }}
      >
        {isPhone ? (
          <MobilePanelHeader
            icon={<TravelExploreRoundedIcon />}
            title={t('group:find_groups.title')}
            onClose={() => setOpen(false)}
            safeAreaTop
          />
        ) : null}
        <Box
          component="header"
          sx={{
            display: isPhone ? 'none' : 'flex',
            justifyContent: 'space-between',
            px: { xs: 2.5, sm: 4 },
            pt: { xs: 2.5, sm: 3.5 },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              component="h2"
              sx={{
                color: 'text.primary',
                fontFamily:
                  'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontSize: { xs: 28, sm: 32 },
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
              }}
            >
              {t('group:find_groups.title')}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 15,
                fontWeight: 400,
                lineHeight: '22px',
                mt: 0.75,
              }}
            >
              {t('group:find_groups.subtitle')}
            </Typography>
          </Box>
          <IconButton
            aria-label={t('group:find_groups.close')}
            onClick={() => setOpen(false)}
            sx={{
              borderRadius: '7px',
              color: 'text.secondary',
              height: 32,
              mt: -0.25,
              width: 32,
              '&:hover': {
                backgroundColor: 'action.hover',
                color: 'text.primary',
              },
              '&:focus-visible': {
                outline: '2px solid #60a5fa',
                outlineOffset: 2,
              },
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>

        <Box
          sx={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            px: { xs: 1.5, sm: 4 },
            pb: isPhone ? 0 : 3,
            pt: isPhone ? 1.5 : 2.25,
          }}
        >
          <AddGroupList
            onJoinedGroupOpen={(group) => {
              setOpen(false);
              onOpenJoinedGroup(group);
            }}
            setOpenSnack={setOpenSnack}
            setInfoSnack={setInfoSnack}
          />
        </Box>

        <CustomizedSnackbars
          open={openSnack}
          setOpen={setOpenSnack}
          info={infoSnack}
          setInfo={setInfoSnack}
        />
      </Dialog>
    </Fragment>
  );
}

export function FindGroupOverviewModal() {
  const [group, setGroup] = useState<any>(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);

  useEffect(() => {
    const open = (event: CustomEvent) => setGroup(event.detail?.group ?? null);
    subscribeToEvent('openFindGroupOverview', open);
    return () => unsubscribeFromEvent('openFindGroupOverview', open);
  }, []);

  if (!group) return null;

  return (
    <Fragment>
      <AddGroupList
        initialSelectedGroup={group}
        onOverviewClose={() => setGroup(null)}
        overviewOnly
        setOpenSnack={setOpenSnack}
        setInfoSnack={setInfoSnack}
      />
      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </Fragment>
  );
}
