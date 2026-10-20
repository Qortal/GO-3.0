/**
 * The widgets screen's grid: 4 columns as wide as the screen allows, rows of
 * a fixed height. A widget is a block of cells (x, y, w, h), placed where the
 * user puts it, as on a phone's home screen: blocks never overlap, a block
 * dropped onto others pushes them down (or swaps with one that fits in its
 * old place), and growing one pushes what is below further down. Holes
 * beside blocks stay (they are the user's), but rows with nothing in them
 * close up, so no empty band is left between widgets. Pure: the screen and
 * the saved list both use it.
 */
export const GRID_COLUMNS = 4;
export const GRID_ROW_PX = 40;
export const GRID_GAP_PX = 12;
export const GRID_MIN_W = 1;
export const GRID_MIN_H = 2;
export const GRID_MAX_H = 14;
export const GRID_DEFAULT_W = GRID_COLUMNS;
export const GRID_DEFAULT_H = 5;

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridItem extends GridRect {
  key: string;
}

const int = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Inside the grid: whole cells, sizes within bounds, never past the edge. */
export const clampRect = (rect: Partial<GridRect>): GridRect => {
  const w = clamp(int(rect.w, GRID_DEFAULT_W), GRID_MIN_W, GRID_COLUMNS);
  const h = clamp(int(rect.h, GRID_DEFAULT_H), GRID_MIN_H, GRID_MAX_H);
  const x = clamp(int(rect.x, 0), 0, GRID_COLUMNS - w);
  const y = Math.max(0, int(rect.y, 0));
  return { x, y, w, h };
};

export const collides = (a: GridRect, b: GridRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const layoutRows = (items: readonly GridRect[]): number =>
  items.reduce((rows, item) => Math.max(rows, item.y + item.h), 0);

/** Rows with nothing in them close up: everything below moves up. */
export const collapseEmptyRows = <T extends GridItem>(
  items: readonly T[]
): T[] => {
  const rows = layoutRows(items);
  const used = new Array<boolean>(rows).fill(false);
  for (const item of items) {
    for (let row = item.y; row < item.y + item.h; row += 1) used[row] = true;
  }
  const emptyAbove: number[] = [];
  let empty = 0;
  for (let row = 0; row < rows; row += 1) {
    emptyAbove[row] = empty;
    if (!used[row]) empty += 1;
  }
  if (empty === 0) return [...items];
  return items.map((item) => {
    const shift = emptyAbove[item.y] ?? 0;
    return shift ? { ...item, y: item.y - shift } : item;
  });
};

/**
 * `fixed` stays where it is; anything it overlaps moves down to just below
 * it, and anything that move makes overlap moves down in turn.
 */
const pushApart = <T extends GridItem>(
  items: readonly T[],
  fixed: string
): T[] => {
  const result = items.map((item) => ({ ...item }));
  const start = result.find((item) => item.key === fixed);
  if (!start) return result;
  const queue: T[] = [start];
  while (queue.length > 0) {
    const mover = queue.shift() as T;
    const others = result
      .filter((item) => item.key !== mover.key && item.key !== fixed)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    for (const other of others) {
      if (!collides(other, mover)) continue;
      other.y = mover.y + mover.h;
      queue.push(other);
    }
  }
  return result;
};

const settleAround = <T extends GridItem>(items: readonly T[], key: string) =>
  collapseEmptyRows(pushApart(items, key));

/**
 * No overlaps (earlier blocks in reading order keep their place) and no
 * empty rows: for a saved layout, which may come from anywhere.
 */
export const normalizeLayout = <T extends GridItem>(
  items: readonly T[]
): T[] => {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: T[] = [];
  for (const item of ordered) {
    const probe = { ...item, ...clampRect(item) };
    while (placed.some((other) => collides(probe, other))) probe.y += 1;
    placed.push(probe);
  }
  const byKey = new Map(
    collapseEmptyRows(placed).map((item) => [item.key, item])
  );
  return items.map((item) => byKey.get(item.key) ?? item);
};

/**
 * `key` moved to cell (x, y), from `items` as they were when the drag began
 * (each step is worked out from there, so the others go back as the finger
 * goes back). A block it lands on takes its old place when that is free (two
 * the same size swap); anything else moves down out of its way.
 */
export const moveGridItem = <T extends GridItem>(
  items: readonly T[],
  key: string,
  x: number,
  y: number
): T[] => {
  const moving = items.find((item) => item.key === key);
  if (!moving) return [...items];
  const target = { ...moving, ...clampRect({ ...moving, x, y }) };
  const next = items.map((item) => {
    if (item.key === key) return target;
    if (!collides(item, target)) return item;
    const swapped = {
      ...item,
      x: clamp(moving.x, 0, GRID_COLUMNS - item.w),
      y: moving.y,
    };
    const fits =
      !collides(swapped, target) &&
      !items.some(
        (other) =>
          other.key !== key &&
          other.key !== item.key &&
          collides(swapped, other)
      );
    return fits ? swapped : item;
  });
  return settleAround(next, key);
};

/** `key` made w × h cells (keeping its top left corner where it fits). */
export const resizeGridItem = <T extends GridItem>(
  items: readonly T[],
  key: string,
  w: number,
  h: number
): T[] => {
  const next = items.map((item) => {
    if (item.key !== key) return item;
    const width = clamp(int(w, item.w), GRID_MIN_W, GRID_COLUMNS);
    const rect = clampRect({
      x: Math.min(item.x, GRID_COLUMNS - width),
      y: item.y,
      w: width,
      h,
    });
    return { ...item, ...rect };
  });
  return settleAround(next, key);
};

/** A block taken away: the rows it alone used close up. */
export const removeGridItem = <T extends GridItem>(
  items: readonly T[],
  key: string
): T[] => collapseEmptyRows(items.filter((item) => item.key !== key));

/** Where a new block goes: under everything, at the left. */
export const appendGridItem = <T extends GridItem>(
  items: readonly T[],
  item: T
): T[] => [
  ...items,
  { ...item, ...clampRect({ ...item, x: 0, y: layoutRows(items) }) },
];

/** Column width for a grid this many CSS px wide. */
export const gridColumnPx = (widthPx: number): number =>
  Math.max(1, (widthPx - (GRID_COLUMNS - 1) * GRID_GAP_PX) / GRID_COLUMNS);

export const gridRectPx = (rect: GridRect, columnPx: number) => ({
  left: rect.x * (columnPx + GRID_GAP_PX),
  top: rect.y * (GRID_ROW_PX + GRID_GAP_PX),
  width: rect.w * columnPx + (rect.w - 1) * GRID_GAP_PX,
  height: rect.h * GRID_ROW_PX + (rect.h - 1) * GRID_GAP_PX,
});

export const gridHeightPx = (items: readonly GridRect[]): number => {
  const rows = layoutRows(items);
  return rows > 0 ? rows * (GRID_ROW_PX + GRID_GAP_PX) - GRID_GAP_PX : 0;
};

/** The cell a block's top left corner at (left, top) px snaps to. */
export const gridCellAt = (
  left: number,
  top: number,
  columnPx: number,
  w: number
) => ({
  x: clamp(Math.round(left / (columnPx + GRID_GAP_PX)), 0, GRID_COLUMNS - w),
  y: Math.max(0, Math.round(top / (GRID_ROW_PX + GRID_GAP_PX))),
});

/** The size in cells a block width × height px snaps to. */
export const gridSizeFor = (
  widthPx: number,
  heightPx: number,
  columnPx: number,
  x: number
) => ({
  w: clamp(
    Math.round((widthPx + GRID_GAP_PX) / (columnPx + GRID_GAP_PX)),
    GRID_MIN_W,
    GRID_COLUMNS - x
  ),
  h: clamp(
    Math.round((heightPx + GRID_GAP_PX) / (GRID_ROW_PX + GRID_GAP_PX)),
    GRID_MIN_H,
    GRID_MAX_H
  ),
});

/** Rows for a height in px a widget asks for (enough to hold it). */
export const gridRowsForPx = (heightPx: number): number =>
  clamp(
    Math.ceil((heightPx + GRID_GAP_PX) / (GRID_ROW_PX + GRID_GAP_PX)),
    GRID_MIN_H,
    GRID_MAX_H
  );

/** Columns for a widget's asked width: 'full' (4), 'half' (2), 'small' (1). */
export const gridColumnsForWidth = (width: unknown): number | null =>
  width === 'full'
    ? GRID_COLUMNS
    : width === 'half'
      ? GRID_COLUMNS / 2
      : width === 'small'
        ? 1
        : null;
