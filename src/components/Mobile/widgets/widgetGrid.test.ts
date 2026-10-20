import { describe, expect, it } from 'vitest';
import {
  GRID_GAP_PX,
  GRID_ROW_PX,
  appendGridItem,
  clampRect,
  collapseEmptyRows,
  normalizeLayout,
  removeGridItem,
  gridCellAt,
  gridColumnPx,
  gridHeightPx,
  gridRectPx,
  gridRowsForPx,
  gridSizeFor,
  moveGridItem,
  resizeGridItem,
  type GridItem,
} from './widgetGrid';

const item = (key: string, x: number, y: number, w: number, h: number) => ({
  key,
  x,
  y,
  w,
  h,
});
const at = (items: GridItem[]) =>
  Object.fromEntries(items.map((i) => [i.key, [i.x, i.y, i.w, i.h]]));

describe('widgetGrid', () => {
  it('keeps blocks inside the grid', () => {
    expect(clampRect({ x: 3, y: -2, w: 4, h: 99 })).toEqual({
      x: 0,
      y: 0,
      w: 4,
      h: 14,
    });
    expect(clampRect({ x: 'a' as never, w: 0, h: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 2,
    });
  });

  it('closes empty rows but keeps holes beside blocks', () => {
    const layout = collapseEmptyRows([
      item('a', 0, 2, 2, 4),
      item('b', 2, 9, 2, 3),
    ]);
    expect(at(layout)).toEqual({ a: [0, 0, 2, 4], b: [2, 4, 2, 3] });
  });

  it('cleans a saved layout: no overlaps, no empty rows', () => {
    const layout = normalizeLayout([
      item('a', 0, 0, 4, 3),
      item('b', 1, 1, 2, 2),
      item('c', 0, 20, 9, 1),
    ]);
    expect(at(layout)).toEqual({
      a: [0, 0, 4, 3],
      b: [1, 3, 2, 2],
      c: [0, 5, 4, 2],
    });
  });

  it('swaps two full-width blocks, or pushes the other down', () => {
    const start = [item('a', 0, 0, 4, 5), item('b', 0, 5, 4, 5)];
    // Onto B's place: they swap.
    expect(at(moveGridItem(start, 'a', 0, 5))).toEqual({
      a: [0, 5, 4, 5],
      b: [0, 0, 4, 5],
    });
    // B dragged to the top.
    expect(at(moveGridItem(start, 'b', 0, 0))).toEqual({
      a: [0, 5, 4, 5],
      b: [0, 0, 4, 5],
    });
    // Half onto B: B can't fit back in A's place, so it moves down; the
    // rows A left empty close up.
    expect(at(moveGridItem(start, 'a', 0, 3))).toEqual({
      a: [0, 0, 4, 5],
      b: [0, 5, 4, 5],
    });
  });

  it('stays where it is dropped, with free room around it', () => {
    const start = [item('a', 0, 0, 2, 4), item('b', 2, 0, 2, 4)];
    // A dropped under B: the hole it leaves beside B stays.
    expect(at(moveGridItem(start, 'a', 0, 4))).toEqual({
      a: [0, 4, 2, 4],
      b: [2, 0, 2, 4],
    });
  });

  it('swaps two half-width blocks side by side', () => {
    const start = [item('a', 0, 0, 2, 4), item('b', 2, 0, 2, 4)];
    expect(at(moveGridItem(start, 'a', 2, 0))).toEqual({
      a: [2, 0, 2, 4],
      b: [0, 0, 2, 4],
    });
  });

  it('pushes the rest down when a block lands where nothing fits back', () => {
    const start = [
      item('a', 0, 0, 2, 4),
      item('b', 2, 0, 2, 2),
      item('c', 0, 4, 4, 3),
    ];
    // A (2×4) dropped onto C's row: C can't take A's place (B is beside it).
    expect(at(moveGridItem(start, 'a', 0, 4))).toEqual({
      a: [0, 2, 2, 4],
      b: [2, 0, 2, 2],
      c: [0, 6, 4, 3],
    });
  });

  it('never moves a block past the right edge', () => {
    const start = [item('a', 0, 0, 3, 2)];
    expect(at(moveGridItem(start, 'a', 3, 0)).a[0]).toBe(1);
  });

  it('resizes, pushing what is below further down', () => {
    const start = [item('a', 0, 0, 2, 3), item('b', 2, 0, 2, 3)];
    expect(at(resizeGridItem(start, 'a', 4, 3))).toEqual({
      a: [0, 0, 4, 3],
      b: [2, 3, 2, 3],
    });
    // Wider than fits from its column: it moves left.
    expect(at(resizeGridItem([item('a', 3, 0, 1, 2)], 'a', 3, 2)).a).toEqual([
      1, 0, 3, 2,
    ]);
  });

  it('closes the rows a removed block alone used', () => {
    const start = [item('a', 0, 0, 4, 3), item('b', 0, 3, 4, 2)];
    expect(at(removeGridItem(start, 'a'))).toEqual({ b: [0, 0, 4, 2] });
  });

  it('adds new blocks under everything', () => {
    const layout = appendGridItem(
      [item('a', 0, 0, 4, 5)],
      item('b', 2, 0, 2, 3)
    );
    expect(at(layout).b).toEqual([0, 5, 2, 3]);
  });

  it('turns cells into pixels and back', () => {
    const columnPx = gridColumnPx(351);
    expect(columnPx).toBeCloseTo((351 - 3 * GRID_GAP_PX) / 4);
    const px = gridRectPx({ x: 1, y: 2, w: 2, h: 3 }, columnPx);
    expect(px.left).toBeCloseTo(columnPx + GRID_GAP_PX);
    expect(px.top).toBe(2 * (GRID_ROW_PX + GRID_GAP_PX));
    expect(px.height).toBe(3 * GRID_ROW_PX + 2 * GRID_GAP_PX);
    expect(gridCellAt(px.left + 10, px.top - 10, columnPx, 2)).toEqual({
      x: 1,
      y: 2,
    });
    expect(gridSizeFor(px.width + 5, px.height - 5, columnPx, 1)).toEqual({
      w: 2,
      h: 3,
    });
    expect(gridHeightPx([{ x: 0, y: 0, w: 4, h: 2 }])).toBe(
      2 * GRID_ROW_PX + GRID_GAP_PX
    );
    expect(gridHeightPx([])).toBe(0);
  });

  it('gives a widget enough rows for the height it asks for', () => {
    expect(gridRowsForPx(GRID_ROW_PX * 3 + GRID_GAP_PX * 2)).toBe(3);
    expect(gridRowsForPx(GRID_ROW_PX * 3 + GRID_GAP_PX * 2 + 1)).toBe(4);
    expect(gridRowsForPx(10)).toBe(2);
    expect(gridRowsForPx(5000)).toBe(14);
  });
});
