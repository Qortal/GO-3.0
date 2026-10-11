import { describe, expect, it } from 'vitest';
import { computeGoLayout, type GoLayout } from '../../../layout/goLayout';
import {
  GO_LIBRARY_COLUMN_MIN_PX,
  GO_TABS_CARD_MIN_PX,
  GO_TABS_FOLDER_ICON_MIN_PX,
  LIBRARY_SCROLLER_MAX_PX,
  folderPanelGeometry,
  libraryListColumns,
  libraryListGridTemplate,
  libraryScrollerMaxWidth,
  selectGoFolderPanelWide,
  selectGoLibraryWide,
  tabsCardColumnsTemplate,
  tabsFolderIconColumnsTemplate,
} from './goTabsGrid';

const layoutFor = (width: number, stableHeight: number, go = true) =>
  computeGoLayout({
    go,
    width,
    stableHeight,
    deviceOrientation: width > stableHeight ? 'landscape' : 'portrait',
    largeScreen: Math.min(width, stableHeight) >= 600,
    epoch: 0,
    nativeMetrics: false,
  });

/**
 * What CSS `repeat(auto-fill, minmax(min(minPx, pct% - subPx), 1fr))` lays
 * out in a grid `width` wide with `gap` between columns.
 */
const autoFillColumns = (
  width: number,
  minPx: number,
  pct: number,
  subPx: number,
  gap: number
) => {
  const track = Math.min(minPx, (width * pct) / 100 - subPx);
  return Math.max(1, Math.floor((width + gap) / (track + gap)));
};

// The overlay's list has 16 px padding each side; cards have a 10 px gap,
// folder icons an 8 px column gap.
const cardColumns = (innerWidth: number) =>
  autoFillColumns(innerWidth - 32, GO_TABS_CARD_MIN_PX, 50, 5, 10);
const folderIconColumns = (innerWidth: number) =>
  autoFillColumns(innerWidth - 32, GO_TABS_FOLDER_ICON_MIN_PX, 25, 6, 8);

describe('Tabs overlay templates', () => {
  it('keeps the Hub templates off GO', () => {
    expect(tabsCardColumnsTemplate(false, false)).toBe(
      'repeat(2, minmax(0, 1fr))'
    );
    expect(tabsCardColumnsTemplate(false, true)).toBe(
      'repeat(4, minmax(0, 1fr))'
    );
    expect(tabsFolderIconColumnsTemplate(false, false)).toBe(
      'repeat(4, minmax(0, 1fr))'
    );
    expect(tabsFolderIconColumnsTemplate(false, true)).toBe(
      'repeat(6, minmax(0, 1fr))'
    );
  });

  it('uses width-based templates on GO whatever the orientation', () => {
    const cards = 'repeat(auto-fill, minmax(min(166px, calc(50% - 5px)), 1fr))';
    const icons = 'repeat(auto-fill, minmax(min(84px, calc(25% - 6px)), 1fr))';
    expect(tabsCardColumnsTemplate(true, false)).toBe(cards);
    expect(tabsCardColumnsTemplate(true, true)).toBe(cards);
    expect(tabsFolderIconColumnsTemplate(true, false)).toBe(icons);
    expect(tabsFolderIconColumnsTemplate(true, true)).toBe(icons);
  });

  it.each([320, 360, 393, 412, 430])(
    'phone portrait %i px: exactly 2 cards and 4 folder icons, as today',
    (width) => {
      expect(cardColumns(width)).toBe(2);
      expect(folderIconColumns(width)).toBe(4);
    }
  );

  // Section 3.0's Tabs cards column.
  it.each([
    [780, 4],
    [873, 4],
    [915, 5],
    [990, 5],
    [1280, 7],
    [673, 3],
    [600, 3],
    [640, 3],
    [840, 4],
    [800, 4],
    [1024, 5],
    [900, 4],
    [841, 4],
    [960, 5],
    [1366, 7],
    [1848, 10],
  ])('%i px wide shows %i cards per row', (width, columns) => {
    expect(cardColumns(width)).toBe(columns);
  });
});

describe('folderPanelGeometry', () => {
  it('keeps the Hub and compact sizes', () => {
    expect(folderPanelGeometry(393, false)).toEqual({
      panelWidth: 357,
      columns: 4,
    });
    expect(folderPanelGeometry(320, false)).toEqual({
      panelWidth: 284,
      columns: 3,
    });
    expect(folderPanelGeometry(1280, false)).toEqual({
      panelWidth: 400,
      columns: 4,
    });
  });

  it('grows to 560 px and up to 6 columns when wide', () => {
    expect(folderPanelGeometry(873, true)).toEqual({
      panelWidth: 560,
      columns: 6,
    });
    expect(folderPanelGeometry(600, true)).toEqual({
      panelWidth: 560,
      columns: 6,
    });
    // Narrower than 560 + margins: as many 88 px cells as fit, at least 3.
    expect(folderPanelGeometry(420, true)).toEqual({
      panelWidth: 384,
      columns: 4,
    });
    expect(folderPanelGeometry(300, true).columns).toBe(3);
  });

  it('is wide only on GO outside the compact class', () => {
    expect(selectGoFolderPanelWide(layoutFor(393, 873))).toBe(false);
    expect(selectGoFolderPanelWide(layoutFor(873, 393))).toBe(true);
    expect(selectGoFolderPanelWide(layoutFor(673, 841))).toBe(true);
    expect(selectGoFolderPanelWide(layoutFor(1280, 800, false))).toBe(false);
  });
});

describe('Apps library columns', () => {
  it('keeps 1 column on phones and 2 on tablets unless wide', () => {
    expect(libraryListColumns(false, false)).toBe(1);
    expect(libraryListColumns(false, true)).toBe(1);
    expect(libraryListColumns(true, false)).toBe(2);
    expect(libraryListColumns(true, true)).toEqual({
      minWidth: GO_LIBRARY_COLUMN_MIN_PX,
    });
    expect(libraryListGridTemplate(false)).toBe('repeat(2, 1fr)');
    expect(libraryListGridTemplate(true)).toBe(
      'repeat(auto-fill, minmax(340px, 1fr))'
    );
  });

  it('is wide only on GO from 1000 px', () => {
    expect(selectGoLibraryWide(layoutFor(999, 800))).toBe(false);
    expect(selectGoLibraryWide(layoutFor(1000, 800))).toBe(true);
    expect(selectGoLibraryWide(layoutFor(1848, 1140, false))).toBe(false);
  });

  it('keeps the Hub 1500 px scroller cap unless the GO library is wide', () => {
    expect(libraryScrollerMaxWidth(false)).toBe('1500px');
    expect(libraryScrollerMaxWidth(true)).toBe('none');
    expect(
      libraryScrollerMaxWidth(selectGoLibraryWide(layoutFor(1848, 1140, false)))
    ).toBe('1500px');
  });

  // Columns that VirtualAppGrid (and the Official tab's auto-fill grid, same
  // 12 px gap) lays out in a grid `gridWidth` wide.
  const columnsIn = (gridWidth: number, l: GoLayout) => {
    const columns = libraryListColumns(l.width >= 600, selectGoLibraryWide(l));
    if (typeof columns === 'number') return columns;
    const gap = 12;
    return Math.max(
      1,
      Math.floor((gridWidth + gap) / (columns.minWidth + gap))
    );
  };
  // The library scroller: capped by libraryScrollerMaxWidth (border-box),
  // padding 24 px each side when short (compact header), else 16 px.
  const libraryGridWidth = (l: GoLayout) => {
    const cap = libraryScrollerMaxWidth(selectGoLibraryWide(l));
    const scroller =
      cap === 'none' ? l.width : Math.min(l.width, LIBRARY_SCROLLER_MAX_PX);
    return scroller - 2 * (l.short ? 24 : 16);
  };
  // The category drill-down: no cap, 16 px padding each side.
  const categoryGridWidth = (l: GoLayout) => l.width - 32;

  // Section 3.0's Library column; the library and the category drill-down
  // must agree on the same screen.
  it.each([
    [393, 873, 1],
    [780, 360, 2],
    [873, 393, 2],
    [915, 412, 2],
    [990, 440, 2],
    [1280, 400, 3],
    [673, 841, 2],
    [600, 960, 2],
    [640, 800, 2],
    [840, 900, 2],
    [800, 1280, 2],
    [1024, 1366, 2],
    [900, 840, 2],
    [841, 701, 2],
    [960, 600, 2],
    [1280, 800, 3],
    [1366, 1024, 3],
    [1848, 1140, 5],
  ])('%ix%i shows %i columns', (width, height, expected) => {
    const l = layoutFor(width, height);
    expect(columnsIn(libraryGridWidth(l), l)).toBe(expected);
    expect(columnsIn(categoryGridWidth(l), l)).toBe(expected);
  });
});
