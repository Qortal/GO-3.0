import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import {
  CHAT_HEADER_ACTION_DESKTOP_PX,
  CHAT_HEADER_ACTION_PHONE_PX,
  getChatHeaderActionMetrics,
  getChatHeaderActionSx,
  getChatHeaderBackSx,
  HOVER_CAPABLE_MEDIA,
} from './chatHeaderActionStyles';

const theme = createTheme();

describe('chat header actions', () => {
  it('gives phones 44px targets with 23px icons and keeps desktop at 36 / 19', () => {
    expect(getChatHeaderActionMetrics(true)).toEqual({
      sizePx: 44,
      iconPx: 23,
    });
    expect(getChatHeaderActionMetrics(false)).toEqual({
      sizePx: 36,
      iconPx: 19,
    });
  });

  it('never makes a phone action smaller than the desktop one', () => {
    const phone = getChatHeaderActionMetrics(true);
    const desktop = getChatHeaderActionMetrics(false);
    expect(phone.sizePx).toBeGreaterThanOrEqual(desktop.sizePx);
    expect(phone.iconPx).toBeGreaterThanOrEqual(desktop.iconPx);
    expect(CHAT_HEADER_ACTION_PHONE_PX).toBeGreaterThanOrEqual(
      CHAT_HEADER_ACTION_DESKTOP_PX
    );
  });

  it('sizes an icon-only action square and lets a labelled one grow', () => {
    const square = getChatHeaderActionSx(theme, { isMobile: true });
    expect(square.width).toBe(44);
    expect(square.height).toBe(44);
    expect(square['& .MuiSvgIcon-root'].fontSize).toBe(23);

    const labelled = getChatHeaderActionSx(theme, {
      isMobile: true,
      showLabel: true,
    });
    expect(labelled.width).toBe('auto');
    expect(labelled.height).toBe(44);
  });

  it('fills an active action with the given colour, else the primary one', () => {
    const custom = getChatHeaderActionSx(theme, {
      isMobile: false,
      active: true,
      activeBackground: 'rgb(1, 2, 3)',
    });
    expect(custom.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(custom.color).toBe(theme.palette.common.white);

    const primary = getChatHeaderActionSx(theme, {
      isMobile: false,
      active: true,
    });
    expect(primary.backgroundColor).toBe(theme.palette.primary.main);

    const idle = getChatHeaderActionSx(theme, { isMobile: false });
    expect(idle.backgroundColor).toBe('transparent');
    expect(idle.color).toBe(theme.palette.text.secondary);
  });

  it('puts the hover fill under (hover: hover), so a tap leaves no grey fill', () => {
    expect(HOVER_CAPABLE_MEDIA).toBe('@media (hover: hover)');
    const idle = getChatHeaderActionSx(theme, { isMobile: true });
    expect('&:hover' in idle).toBe(false);
    expect(idle[HOVER_CAPABLE_MEDIA]['&:hover']).toEqual({
      backgroundColor: theme.palette.action.hover,
      color: theme.palette.text.primary,
    });

    const active = getChatHeaderActionSx(theme, {
      isMobile: true,
      active: true,
      activeBackground: 'rgb(1, 2, 3)',
    });
    expect(active[HOVER_CAPABLE_MEDIA]['&:hover'].backgroundColor).toBe(
      'rgb(1, 2, 3)'
    );
  });

  it('sizes the back button like the actions and lines its arrow up', () => {
    expect(getChatHeaderBackSx(true)).toMatchObject({
      height: 44,
      ml: '-8px',
      width: 44,
    });
    expect(getChatHeaderBackSx(false)).toMatchObject({
      height: 36,
      width: 36,
    });
  });
});
