import { useEffect, useReducer } from 'react';
import { useTheme } from '@mui/material';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { useTranslation } from 'react-i18next';
import { useOwnPostDelivery } from '../../reticulumChat/ownPostDeliveryStore';
import {
  deliveredGlyphColor,
  ReticulumDeliveryGlyphView,
} from './ReticulumDmDeliveryGlyph';
import {
  getReticulumPostDelivery,
  reticulumPostDeliveryBoundaryAt,
  reticulumPostDeliveryEventId,
  reticulumPostDeliveryTextKey,
  waitForReticulumPostDeliveryBoundary,
  type ReticulumPostDeliveryState,
} from './reticulumPostDeliveryState';

const GLYPHS: Record<ReticulumPostDeliveryState, typeof ScheduleRoundedIcon> = {
  sending: ScheduleRoundedIcon,
  not_picked_up: CloudOffRoundedIcon,
  delivered: DoneAllRoundedIcon,
};

type Props = {
  message: any;
  myAddress: string;
};

/**
 * Still status glyph for the user's own group post or Saved Message written
 * on this phone (GO). Same look and behaviour as the DM glyph. A fetch proof
 * that arrives after the row was read comes from ownPostDeliveryStore and
 * re-renders this glyph only. The one clock is the shared one-shot boundary
 * timer ('sending' -> 'not picked up yet' after 12 s).
 */
export const ReticulumPostDeliveryGlyph = ({ message, myAddress }: Props) => {
  const { t } = useTranslation(['reticulum']);
  const theme = useTheme();
  const [, wake] = useReducer((tick: number) => tick + 1, 0);
  const proof = useOwnPostDelivery(reticulumPostDeliveryEventId(message));
  const now = Date.now();
  const delivery = getReticulumPostDelivery(message, myAddress, now, proof);
  const boundaryAt = reticulumPostDeliveryBoundaryAt(
    message,
    delivery?.state ?? null,
    now
  );

  useEffect(() => {
    if (boundaryAt == null) return;
    if (boundaryAt <= Date.now()) {
      // Rendered just before the boundary; show the new state now.
      wake();
      return;
    }
    return waitForReticulumPostDeliveryBoundary(boundaryAt, wake);
  }, [boundaryAt]);

  if (!delivery) return null;
  const textKey = reticulumPostDeliveryTextKey(delivery);
  const label = t(`reticulum:post_delivery.${textKey}.label`, {
    postProcess: 'capitalizeFirstChar',
  });
  const hint = t(`reticulum:post_delivery.${textKey}.hint`, {
    postProcess: 'capitalizeFirstChar',
  });
  const color =
    delivery.state === 'delivered'
      ? deliveredGlyphColor(theme)
      : delivery.state === 'not_picked_up'
        ? theme.palette.warning.main
        : theme.palette.text.secondary;

  return (
    <ReticulumDeliveryGlyphView
      color={color}
      hint={hint}
      Icon={GLYPHS[delivery.state]}
      kind="post"
      label={label}
      state={delivery.state}
    />
  );
};
