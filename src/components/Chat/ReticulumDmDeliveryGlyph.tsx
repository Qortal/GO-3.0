import { useEffect, useId, useReducer } from 'react';
import {
  Box,
  darken,
  Tooltip,
  Typography,
  useTheme,
  type Theme,
} from '@mui/material';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { useTranslation } from 'react-i18next';
import { isCapacitor } from '../../utils/platform';
import {
  getReticulumDmDeliveryState,
  reticulumDmDeliveryBoundaryAt,
  waitForReticulumDmDeliveryBoundary,
  type ReticulumDmDeliveryState,
} from './reticulumDmDeliveryState';

const GLYPHS: Record<ReticulumDmDeliveryState, typeof ScheduleRoundedIcon> = {
  sending: ScheduleRoundedIcon,
  only_on_this_phone: CloudOffRoundedIcon,
  on_other_device: DevicesRoundedIcon,
  delivered: DoneAllRoundedIcon,
};

type Props = {
  message: any;
  myAddress: string;
};

/**
 * The 'delivered' tick colour. On the light chat background primary.main is
 * about 1.6:1; darkened it is about 3.4:1 (3:1 is the floor for icons).
 */
export const deliveredGlyphColor = (theme: Theme): string =>
  theme.palette.mode === 'light'
    ? darken(theme.palette.primary.main, 0.35)
    : theme.palette.primary.main;

/**
 * Small static status glyph for the user's own Reticulum DM. No spinner: a
 * message can stay pending for hours, so every state is a still icon. The
 * only clock is the shared one-shot boundary timer ('sending' ->
 * 'only on this phone' after ~30 s).
 */
export const ReticulumDmDeliveryGlyph = ({ message, myAddress }: Props) => {
  const { t } = useTranslation(['reticulum']);
  const theme = useTheme();
  const [, wake] = useReducer((tick: number) => tick + 1, 0);
  const state = getReticulumDmDeliveryState(message, myAddress, Date.now());
  const boundaryAt = reticulumDmDeliveryBoundaryAt(message, state);

  useEffect(() => {
    if (boundaryAt == null) return;
    if (boundaryAt <= Date.now()) {
      // Rendered just before the boundary; show the new state now.
      wake();
      return;
    }
    return waitForReticulumDmDeliveryBoundary(boundaryAt, wake);
  }, [boundaryAt]);

  if (!state) return null;
  // The desktop Hub renders the same list; it is not a phone there.
  const labelState =
    state === 'only_on_this_phone' && !isCapacitor()
      ? 'only_on_this_device'
      : state;
  const label = t(`reticulum:dm.delivery.${labelState}.label`, {
    postProcess: 'capitalizeFirstChar',
  });
  const hint = t(`reticulum:dm.delivery.${state}.hint`, {
    postProcess: 'capitalizeFirstChar',
  });
  const color =
    state === 'delivered'
      ? deliveredGlyphColor(theme)
      : state === 'only_on_this_phone'
        ? theme.palette.warning.main
        : theme.palette.text.secondary;

  return (
    <ReticulumDeliveryGlyphView
      color={color}
      hint={hint}
      Icon={GLYPHS[state]}
      label={label}
      state={state}
    />
  );
};

type ViewProps = {
  color: string;
  hint: string;
  Icon: typeof ScheduleRoundedIcon;
  /** 'post' for group posts and Saved Messages (ReticulumPostDeliveryGlyph). */
  kind?: 'dm' | 'post';
  label: string;
  state: string;
};

/**
 * The still icon with its tooltip, touch target and accessible name and
 * description, shared by the DM and the post delivery glyphs.
 */
export const ReticulumDeliveryGlyphView = ({
  color,
  hint,
  Icon,
  kind = 'dm',
  label,
  state,
}: ViewProps) => {
  const theme = useTheme();
  const hintId = useId();

  return (
    <Tooltip
      enterTouchDelay={0}
      leaveTouchDelay={4000}
      title={
        <>
          <Typography
            component="span"
            sx={{ display: 'block' }}
            variant="caption"
          >
            <strong>{label}</strong>
          </Typography>
          <Typography
            component="span"
            sx={{ display: 'block' }}
            variant="caption"
          >
            {hint}
          </Typography>
        </>
      }
    >
      {/* Focusable so the tooltip opens from the keyboard; the hint is also
          the accessible description. Padding with a matching negative margin
          gives a 25 px target around the 13 px icon without moving it. A tap
          shows the tooltip only, not the row's quick-action bar. */}
      <Box
        aria-describedby={hintId}
        aria-label={label}
        component="span"
        data-delivery-kind={kind}
        data-delivery-state={state}
        onClick={(event) => event.stopPropagation()}
        role="img"
        tabIndex={0}
        sx={{
          alignItems: 'center',
          borderRadius: '50%',
          color,
          cursor: 'help',
          display: 'inline-flex',
          flexShrink: 0,
          lineHeight: 1,
          margin: '-6px',
          marginLeft: '-2px',
          padding: '6px',
          verticalAlign: 'middle',
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: '-2px',
          },
        }}
      >
        <Icon aria-hidden sx={{ fontSize: '13px' }} />
        <Box
          component="span"
          id={hintId}
          sx={{
            border: 0,
            clip: 'rect(0 0 0 0)',
            height: '1px',
            margin: '-1px',
            overflow: 'hidden',
            padding: 0,
            position: 'absolute',
            whiteSpace: 'nowrap',
            width: '1px',
          }}
        >
          {hint}
        </Box>
      </Box>
    </Tooltip>
  );
};
