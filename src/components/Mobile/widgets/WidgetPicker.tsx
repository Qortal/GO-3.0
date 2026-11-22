import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  InputAdornment,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BACK_PRIORITY, useAndroidBack } from '../../../utils/androidBack';
import { useCloseWithGoWindows } from '../../../utils/closeGoWindows';
import { getBaseApiReact } from '../../../utils/globalApi';
import { AppThumbnailAvatar } from '../../Apps/AppThumbnailAvatar';
import { MobilePanelHeader } from '../MobilePanelHeader';
import { fetchGoWidgets } from './fetchGoWidgets';
import {
  GO_WIDGET_LIMIT,
  goWidgetKey,
  type GoWidgetListing,
  type SavedGoWidget,
} from './goWidgets';

type WidgetPickerProps = {
  open: boolean;
  onClose: () => void;
  added: readonly SavedGoWidget[];
  onAdd: (listing: GoWidgetListing) => void;
};

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; widgets: GoWidgetListing[] };

/**
 * The widgets published on QDN (APPs tagged go-widget), to add to the
 * widgets screen. Nothing runs from here: a
 * widget only loads once it is on the screen.
 */
export const WidgetPicker = ({
  open,
  onClose,
  added,
  onAdd,
}: WidgetPickerProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const tw = (key: string, defaultValue: string, options = {}) =>
    t(`group:widgets.${key}`, { defaultValue, ...options });
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useAndroidBack(
    () => {
      onClose();
      return true;
    },
    { priority: BACK_PRIORITY.dialog, enabled: open }
  );
  useCloseWithGoWindows(open, onClose);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState((current) =>
      current.phase === 'ready' && attempt === 0
        ? current
        : { phase: 'loading' }
    );
    fetchGoWidgets(getBaseApiReact(), {
      signal: controller.signal,
      fresh: attempt > 0,
    })
      .then((widgets) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', widgets });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: 'error' });
      });
    return () => controller.abort();
  }, [open, attempt]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const addedKeys = useMemo(
    () => new Set(added.map((widget) => goWidgetKey(widget))),
    [added]
  );
  const full = added.length >= GO_WIDGET_LIMIT;

  const shown = useMemo(() => {
    if (state.phase !== 'ready') return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return state.widgets;
    return state.widgets.filter((widget) =>
      [widget.title, widget.name, widget.description, widget.identifier ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [state, query]);

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          backgroundColor: theme.palette.background.default,
          backgroundImage: 'none',
        },
      }}
    >
      <MobilePanelHeader
        safeAreaTop
        icon={<WidgetsRoundedIcon />}
        title={tw('picker_title', 'Add a widget')}
        onClose={onClose}
      />
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 1.5,
          minHeight: 0,
          overflowY: 'auto',
          pb: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          pt: 1.5,
          px: 2,
        }}
      >
        <Box
          sx={{
            alignItems: 'flex-start',
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
            border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
            borderRadius: '12px',
            display: 'flex',
            gap: 1,
            p: 1.25,
          }}
        >
          <ShieldOutlinedIcon
            sx={{ color: 'primary.main', fontSize: 20, mt: '1px' }}
          />
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: '0.78rem',
              lineHeight: 1.5,
            }}
          >
            {tw(
              'picker_note',
              "Widgets are Q-Apps made for GO. They can show things and open apps, but they can't pay, publish or sign anything."
            )}
          </Typography>
        </Box>

        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tw('picker_search', 'Search widgets')}
          inputProps={{ 'aria-label': tw('picker_search', 'Search widgets') }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
            sx: { borderRadius: '12px' },
          }}
        />

        {full ? (
          <Typography sx={{ color: 'warning.main', fontSize: '0.78rem' }}>
            {tw('limit', 'You can have up to {{max}} widgets.', {
              max: GO_WIDGET_LIMIT,
            })}
          </Typography>
        ) : null}

        {state.phase === 'loading' ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
            <CircularProgress size={28} />
          </Box>
        ) : state.phase === 'error' ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
              {tw(
                'picker_error',
                "Couldn't load the widgets. Check the node connection."
              )}
            </Typography>
            <Button
              onClick={() => setAttempt((n) => n + 1)}
              sx={{ fontWeight: 700, mt: 1 }}
            >
              {tw('retry', 'Try again')}
            </Button>
          </Box>
        ) : shown.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
              {state.widgets.length === 0
                ? tw('picker_empty', 'No widgets published yet.')
                : tw('picker_none_found', 'No widgets match.')}
            </Typography>
            {state.widgets.length === 0 ? (
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: '0.75rem',
                  lineHeight: 1.5,
                  mt: 1,
                  mx: 'auto',
                  maxWidth: 320,
                  opacity: 0.8,
                }}
              >
                {tw(
                  'picker_developers',
                  'Q-App developers: publish a widget as an APP with the tag go-widget, ideally with an identifier starting with go-widget.'
                )}
              </Typography>
            ) : null}
          </Box>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {shown.map((widget) => {
              const key = goWidgetKey(widget);
              const isAdded = addedKeys.has(key);
              return (
                <Box
                  component="li"
                  key={key}
                  sx={{
                    alignItems: 'center',
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    display: 'flex',
                    gap: 1.5,
                    py: 1.25,
                  }}
                >
                  <AppThumbnailAvatar
                    appName={widget.name}
                    fallbackSize={22}
                    sx={{ borderRadius: '12px', height: 44, width: 44 }}
                    variant="rounded"
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      noWrap
                      sx={{ fontSize: '0.92rem', fontWeight: 700 }}
                    >
                      {widget.title}
                    </Typography>
                    <Typography
                      noWrap
                      sx={{ color: 'text.secondary', fontSize: '0.74rem' }}
                    >
                      {tw('by', 'by {{name}}', { name: widget.name })}
                    </Typography>
                    {widget.description ? (
                      <Typography
                        sx={{
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          color: 'text.secondary',
                          display: '-webkit-box',
                          fontSize: '0.76rem',
                          lineHeight: 1.4,
                          mt: 0.25,
                          overflow: 'hidden',
                        }}
                      >
                        {widget.description}
                      </Typography>
                    ) : null}
                  </Box>
                  <Button
                    size="small"
                    variant={isAdded ? 'text' : 'contained'}
                    disabled={isAdded || full}
                    onClick={() => onAdd(widget)}
                    startIcon={isAdded ? <CheckRoundedIcon /> : undefined}
                    sx={{ borderRadius: 999, flexShrink: 0, fontWeight: 700 }}
                  >
                    {isAdded ? tw('added', 'Added') : tw('add_short', 'Add')}
                  </Button>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Dialog>
  );
};
