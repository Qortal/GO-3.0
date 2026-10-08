import { describe, expect, it } from 'vitest';
import type { TabFolder } from '../mobileTabOrganization';
import {
  hitTestSlot,
  homeGridMetrics,
  moveId,
  planMosaic,
  rowPlacementForFlatOrder,
} from './homeGrid';

const folder = (id: string, row: number, order: number): TabFolder => ({
  id,
  name: id,
  tabKeys: [],
  order,
  row,
});

describe('homeGridMetrics', () => {
  it('uses four columns on a phone in portrait', () => {
    const metrics = homeGridMetrics(369);
    expect(metrics.columns).toBe(4);
    expect(metrics.cell).toBeCloseTo(92.25);
  });

  it('lines a large tile up with the small tiles of the cells it covers', () => {
    const m = homeGridMetrics(369);
    // Left edge of a small tile in column 0 and right edge in column 1.
    const smallLeft = (m.cell - m.icon) / 2;
    const smallRight = m.cell + (m.cell + m.icon) / 2;
    expect(m.largeWidth).toBeCloseTo(smallRight - smallLeft, 0);
    // Tile + label + gap of a large folder fills exactly two rows.
    expect(m.largeHeight + m.labelGap + m.labelHeight).toBeLessThanOrEqual(
      2 * m.row
    );
  });

  it('fits three inner icons across a large tile', () => {
    const m = homeGridMetrics(369);
    expect(3 * m.largeInnerIcon + 2 * m.largePadding).toBeLessThan(
      m.largeWidth
    );
    expect(3 * m.smallInnerIcon + 2 * m.smallPadding).toBeLessThanOrEqual(
      m.icon
    );
  });

  it('adds columns on wide screens', () => {
    expect(homeGridMetrics(800).columns).toBe(8);
    expect(homeGridMetrics(600).columns).toBe(6);
  });

  it('survives a zero width while hidden', () => {
    expect(homeGridMetrics(0).columns).toBe(4);
  });
});

describe('planMosaic', () => {
  const items = Array.from({ length: 12 }, (_, i) => i);

  it('shows up to nine minis in a small folder', () => {
    expect(planMosaic(items, 'small')).toEqual({
      shown: items.slice(0, 9),
      more: [],
    });
  });

  it('shows nine apps in a large folder that has nine', () => {
    expect(planMosaic(items.slice(0, 9), 'large')).toEqual({
      shown: items.slice(0, 9),
      more: [],
    });
  });

  it('turns the ninth cell into the rest past nine', () => {
    expect(planMosaic(items, 'large')).toEqual({
      shown: items.slice(0, 8),
      more: items.slice(8),
    });
  });
});

describe('moveId', () => {
  it('moves an id to an index', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'd', 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('leaves the list alone for an unknown id', () => {
    const ids = ['a', 'b'];
    expect(moveId(ids, 'x', 0)).toBe(ids);
  });
});

describe('rowPlacementForFlatOrder', () => {
  const folders = [
    folder('a', 0, 0),
    folder('b', 0, 1),
    folder('c', 1, 0),
    folder('d', 1, 1),
  ];

  it('goes in front of the folder that follows it, in that row', () => {
    expect(
      rowPlacementForFlatOrder(folders, ['a', 'd', 'b', 'c'], 'd')
    ).toEqual({ row: 0, beforeFolderId: 'b' });
    expect(
      rowPlacementForFlatOrder(folders, ['a', 'c', 'b', 'd'], 'b')
    ).toEqual({ row: 1, beforeFolderId: 'd' });
  });

  it('goes to the end of the last row when it ends up last', () => {
    expect(
      rowPlacementForFlatOrder(folders, ['b', 'c', 'd', 'a'], 'a')
    ).toEqual({ row: 1, beforeFolderId: null });
  });
});

describe('hitTestSlot', () => {
  const rects = [
    { id: 'a', rect: { left: 0, top: 0, right: 100, bottom: 100 } },
    { id: 'b', rect: { left: 100, top: 0, right: 200, bottom: 100 } },
  ];

  it('finds the item under the point', () => {
    expect(hitTestSlot(rects, 150, 50, 'a')).toBe('b');
  });

  it('skips the dragged item and the seams between items', () => {
    expect(hitTestSlot(rects, 50, 50, 'a')).toBeNull();
    expect(hitTestSlot(rects, 101, 50, 'a')).toBeNull();
  });
});
