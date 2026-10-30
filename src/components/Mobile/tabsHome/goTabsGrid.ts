import type { GoLayout } from '../../../layout/goLayout';

/**
 * Grid rules for GO's Tabs overlay and Apps library on tablets and in
 * landscape. Columns follow the width, not the orientation, so a fold or a
 * tablet in landscape is not treated like a short phone. A phone in portrait
 * keeps exactly today's 2 cards and 4 folder icons per row. Off GO every
 * helper returns the Hub's value.
 */

/**
 * Narrowest tab card. With the overlay's 16 px padding and 10 px gap this
 * gives 4 cards at 873 px, 5 at 915 px and 7 at 1280 px.
 */
export const GO_TABS_CARD_MIN_PX = 166;
/** Narrowest folder icon cell. */
export const GO_TABS_FOLDER_ICON_MIN_PX = 84;

/**
 * Tab cards in the overlay (gap 10 px). `min(…, 50% - 5px)` keeps two cards
 * per row on the narrowest phones, where 166 px would not fit twice.
 */
export function tabsCardColumnsTemplate(
  go: boolean,
  landscape: boolean
): string {
  if (go) {
    return `repeat(auto-fill, minmax(min(${GO_TABS_CARD_MIN_PX}px, calc(50% - 5px)), 1fr))`;
  }
  return landscape ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))';
}

/** App icons inside an open folder (column gap 8 px): at least 4 per row. */
export function tabsFolderIconColumnsTemplate(
  go: boolean,
  landscape: boolean
): string {
  if (go) {
    return `repeat(auto-fill, minmax(min(${GO_TABS_FOLDER_ICON_MIN_PX}px, calc(25% - 6px)), 1fr))`;
  }
  return landscape ? 'repeat(6, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))';
}

/**
 * The open-folder panel on the Pinned home. `wide` (GO, not compact) lets it
 * grow to 560 px with up to 6 columns; otherwise today's 400 px and 4.
 */
export function folderPanelGeometry(
  viewportWidth: number,
  wide: boolean
): { panelWidth: number; columns: number } {
  if (wide) {
    const panelWidth = Math.min(viewportWidth - 36, 560);
    const columns = Math.min(
      6,
      Math.max(3, Math.floor((panelWidth - 24) / 88))
    );
    return { panelWidth, columns };
  }
  const panelWidth = Math.min(viewportWidth - 36, 400);
  return { panelWidth, columns: panelWidth >= 300 ? 4 : 3 };
}

/** True on GO when the open-folder panel may grow (see folderPanelGeometry). */
export const selectGoFolderPanelWide = (l: GoLayout): boolean =>
  l.go && l.widthClass !== 'compact';

// ---- Apps library -------------------------------------------------------

/** From this width GO's library list fills the row with 340 px columns. */
const GO_LIBRARY_WIDE_MIN_PX = 1000;
export const GO_LIBRARY_COLUMN_MIN_PX = 340;
const GO_LIBRARY_WIDE_COLUMNS: { minWidth: number } = Object.freeze({
  minWidth: GO_LIBRARY_COLUMN_MIN_PX,
});

export const selectGoLibraryWide = (l: GoLayout): boolean =>
  l.go && l.width >= GO_LIBRARY_WIDE_MIN_PX;

/**
 * VirtualAppGrid columns for the library's list rows: 1 on phones, 2 on
 * tablets (GO: 600 px and up), as many 340 px columns as fit when `wide`.
 */
export function libraryListColumns(
  isTablet: boolean,
  wide: boolean
): number | { minWidth: number } {
  if (!isTablet) return 1;
  return wide ? GO_LIBRARY_WIDE_COLUMNS : 2;
}

/** The same rule for the Official tab, which is a plain CSS grid. */
export function libraryListGridTemplate(wide: boolean): string {
  return wide
    ? `repeat(auto-fill, minmax(${GO_LIBRARY_COLUMN_MIN_PX}px, 1fr))`
    : 'repeat(2, 1fr)';
}

/** The Hub centres its library in at most this width. */
export const LIBRARY_SCROLLER_MAX_PX = 1500;

/**
 * Max width of the library's scroller. A wide GO library spans the screen
 * like the category drill-down, so both show the same columns on one screen
 * (the 1500 px cap would leave 4 at 1848 px where the category shows 5).
 */
export function libraryScrollerMaxWidth(wide: boolean): string {
  return wide ? 'none' : `${LIBRARY_SCROLLER_MAX_PX}px`;
}
