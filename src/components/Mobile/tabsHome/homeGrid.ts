/**
 * Pure layout for the phone-style Pinned home (the full-screen Tabs folders in
 * the Q-Apps library) and its folder mosaics. Sizes follow a phone launcher:
 * four columns, small folders take one cell, large folders take two by two,
 * and every tile edge lines up with the icons in the cells next to it.
 */
import type { FolderSize, TabFolder } from '../mobileTabOrganization';

export type HomeGridMetrics = {
  columns: number;
  /** Width of one grid column. */
  cell: number;
  /** Side of a small folder tile (an app icon's size on a launcher). */
  icon: number;
  /** Height of one grid row: tile, label and the gap under it. */
  row: number;
  labelGap: number;
  labelHeight: number;
  largeWidth: number;
  largeHeight: number;
  /** Icons inside a large folder (three by three). */
  largeInnerIcon: number;
  largePadding: number;
  /** Mini icons inside a small folder (three by three). */
  smallInnerIcon: number;
  smallPadding: number;
  smallGap: number;
  smallRadius: number;
  largeRadius: number;
};

const LABEL_GAP = 6;
const LABEL_HEIGHT = 17;
const ROW_GAP = 18;

export function homeGridMetrics(width: number): HomeGridMetrics {
  const safeWidth = Math.max(240, width || 0);
  // Landscape phones and tablets get more columns, never fewer than four.
  const columns =
    safeWidth >= 560
      ? Math.max(5, Math.min(8, Math.floor(safeWidth / 100)))
      : 4;
  const cell = safeWidth / columns;
  const icon = Math.round(Math.min(68, Math.max(46, cell * 0.68)));
  const row = icon + LABEL_GAP + LABEL_HEIGHT + ROW_GAP;
  // A large tile's edges line up with the small tiles' edges in the cells
  // it covers: one cell plus one icon wide, one row plus one icon tall.
  const largeWidth = Math.round(cell + icon);
  const largeHeight = Math.round(row + icon);
  const largePadding = Math.round(largeWidth * 0.09);
  const largeGap = Math.round(largeWidth * 0.075);
  const largeInnerIcon = Math.floor(
    (largeWidth - 2 * largePadding - 2 * largeGap) / 3
  );
  const smallPadding = Math.max(5, Math.round(icon * 0.14));
  const smallGap = Math.max(2, Math.round(icon * 0.055));
  const smallInnerIcon = Math.floor(
    (icon - 2 * smallPadding - 2 * smallGap) / 3
  );
  return {
    columns,
    cell,
    icon,
    row,
    labelGap: LABEL_GAP,
    labelHeight: LABEL_HEIGHT,
    largeWidth,
    largeHeight,
    largeInnerIcon,
    largePadding,
    smallInnerIcon,
    smallPadding,
    smallGap,
    smallRadius: Math.round(icon * 0.27),
    largeRadius: Math.round(Math.min(30, largeWidth * 0.17)),
  };
}

type MosaicPlan<T> = {
  /** Shown in the tile itself, in folder order. */
  shown: T[];
  /**
   * Large folders only: the apps that did not fit, drawn as a tiny two by
   * two in the last cell, which opens the folder.
   */
  more: T[];
};

/**
 * What a folder tile shows. A small tile is a three by three of mini icons
 * and opens the folder. A large tile shows up to nine apps that open
 * directly; with more than nine, the ninth cell becomes the "more" cell.
 */
export function planMosaic<T>(items: T[], size: FolderSize): MosaicPlan<T> {
  if (size === 'small' || items.length <= 9) {
    return { shown: items.slice(0, 9), more: [] };
  }
  return { shown: items.slice(0, 8), more: items.slice(8) };
}

/** Moves `id` to `toIndex` in a list of ids; out-of-range indexes clamp. */
export function moveId(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const next = ids.filter((item) => item !== id);
  const index = Math.max(0, Math.min(next.length, toIndex));
  next.splice(index, 0, id);
  return next;
}

/**
 * Where a folder dragged around the flat home grid lands in the Tabs
 * overlay's rows: in front of the folder that now follows it, in that
 * folder's row; or, when it ends up last, at the end of the last folder's row.
 * Only the moved folder changes row, so the overlay's rows stay as arranged.
 */
export function rowPlacementForFlatOrder(
  folders: TabFolder[],
  order: string[],
  movedId: string
): { row: number; beforeFolderId: string | null } | null {
  const index = order.indexOf(movedId);
  if (index === -1) return null;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const nextId = order[index + 1];
  if (nextId && byId.has(nextId)) {
    return { row: byId.get(nextId)!.row ?? 0, beforeFolderId: nextId };
  }
  const prevId = order[index - 1];
  if (prevId && byId.has(prevId)) {
    return { row: byId.get(prevId)!.row ?? 0, beforeFolderId: null };
  }
  return { row: byId.get(movedId)?.row ?? 0, beforeFolderId: null };
}

/**
 * The folder slot under a point while dragging: the first other item whose
 * box holds the point, shrunk a little so a finger on a seam picks nothing
 * and the order does not flicker between two neighbours.
 */
export function hitTestSlot(
  rects: {
    id: string;
    rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;
  }[],
  x: number,
  y: number,
  excludeId: string,
  inset = 6
): string | null {
  for (const { id, rect } of rects) {
    if (id === excludeId) continue;
    if (
      x >= rect.left + inset &&
      x <= rect.right - inset &&
      y >= rect.top + inset &&
      y <= rect.bottom - inset
    ) {
      return id;
    }
  }
  return null;
}
