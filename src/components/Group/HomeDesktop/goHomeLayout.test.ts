import { describe, expect, it } from 'vitest';
import { computeGoLayout } from '../../../layout/goLayout';
import { HOME_DASHBOARD_WIDGET_HEIGHT_PX } from './homeDesktopConstants';
import {
  GO_HOME_MAX_WIDTH_PX,
  goHomeMaxWidth,
  goHomeWidgetHeight,
} from './goHomeLayout';

/** The real store's answer for a window, so the table follows §3.0. */
const layoutFor = (width: number, stableHeight: number) =>
  computeGoLayout({
    go: true,
    width,
    stableHeight,
    deviceOrientation: width > stableHeight ? 'landscape' : 'portrait',
    largeScreen: Math.min(width, stableHeight) >= 600,
    epoch: 0,
    nativeMetrics: false,
  });

describe('goHomeMaxWidth', () => {
  it('keeps the Hub value off GO at every width', () => {
    for (const width of [0, 393, 760, 1280, 1848]) {
      expect(goHomeMaxWidth(false, width)).toBe('1320px');
    }
  });

  it('centres Home at 760 px on GO from 760 px wide', () => {
    expect(GO_HOME_MAX_WIDTH_PX).toBe(760);
    expect(goHomeMaxWidth(true, 759)).toBe('1320px');
    expect(goHomeMaxWidth(true, 760)).toBe('760px');
  });

  it.each([
    [393, 873, '1320px'], // phone portrait: as today
    [673, 841, '1320px'], // medium single: full width
    [600, 960, '1320px'],
    [640, 800, '1320px'],
    [780, 360, '760px'],
    [873, 393, '760px'],
    [1280, 400, '760px'],
    [840, 900, '760px'],
    [800, 1280, '760px'],
    [1280, 800, '760px'],
    [1848, 1140, '760px'],
  ])('%ix%i gives %s', (width, height, expected) => {
    const l = layoutFor(width, height);
    expect(goHomeMaxWidth(l.go, l.width)).toBe(expected);
  });
});

describe('goHomeWidgetHeight', () => {
  it('keeps 612 off GO, even for a short window', () => {
    expect(HOME_DASHBOARD_WIDGET_HEIGHT_PX).toBe(612);
    expect(goHomeWidgetHeight(false, true, 393)).toBe(612);
    expect(goHomeWidgetHeight(false, false, 873)).toBe(612);
  });

  it('keeps 612 on GO when the window is not short', () => {
    expect(goHomeWidgetHeight(true, false, 873)).toBe(612);
    expect(goHomeWidgetHeight(true, false, 600)).toBe(612);
  });

  it.each([
    [393, 873, 612], // phone portrait: as today
    [780, 360, 260], // floor
    [873, 393, 273],
    [915, 412, 292],
    [990, 440, 320],
    [1280, 400, 280],
    [960, 600, 612], // tablet landscape is not short
    [841, 701, 612],
  ])('%ix%i gives %i', (width, height, expected) => {
    const l = layoutFor(width, height);
    expect(goHomeWidgetHeight(l.go, l.short, l.stableHeight)).toBe(expected);
  });

  it('never exceeds 612 while short', () => {
    // A short window under the hysteresis band (stays short below 532).
    expect(goHomeWidgetHeight(true, true, 531)).toBe(411);
    expect(goHomeWidgetHeight(true, true, 2000)).toBe(612);
  });
});
