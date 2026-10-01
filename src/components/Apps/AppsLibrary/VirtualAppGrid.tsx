import {
  Fragment,
  ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box } from '@mui/material';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualAppGridProps {
  apps: any[];
  /** The element that scrolls; the grid may sit anywhere inside it. */
  scrollElement: HTMLElement | null;
  /**
   * Off while the grid is hidden: it then renders no items and stops
   * listening to a scroller that other views may share.
   */
  enabled?: boolean;
  /** Every item must render exactly this tall. */
  itemHeight: number;
  gap: number;
  /** A fixed column count, or the narrowest a column may get. */
  columns: number | { minWidth: number };
  overscan?: number;
  renderApp: (app: any) => ReactNode;
}

const getAppKey = (app: any) => `${app?.service}-${app?.name}`;

/**
 * Fixed-height app items in a virtualized grid. The visible items are direct
 * siblings of one grid, so list-item dividers (`:last-of-type`) and column
 * gaps look the same as in the unvirtualized lists.
 *
 * Give it a content-sized parent, not the scroller itself: content added
 * above the grid is only noticed through the parent growing.
 */
export const VirtualAppGrid = ({
  apps,
  scrollElement,
  enabled = true,
  itemHeight,
  gap,
  columns,
  overscan = 5,
  renderApp,
}: VirtualAppGridProps) => {
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  // Where the grid starts inside the scroller (headers and filters above it).
  const [scrollMargin, setScrollMargin] = useState(0);
  // A hidden scroller forgets its position; re-enabling starts from here.
  const lastScrollOffsetRef = useRef(0);

  useLayoutEffect(() => {
    if (!gridElement || !scrollElement) return;

    const measure = () => {
      const gridRect = gridElement.getBoundingClientRect();
      // A hidden (display: none) grid measures 0; keep the last layout so
      // showing it again does not flash a single column.
      if (gridRect.width === 0) return;
      const scrollRect = scrollElement.getBoundingClientRect();
      setGridWidth(gridRect.width);
      setScrollMargin(
        gridRect.top -
          scrollRect.top -
          scrollElement.clientTop +
          scrollElement.scrollTop
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(gridElement);
    // Content above the grid growing moves it without resizing it.
    if (gridElement.parentElement) observer.observe(gridElement.parentElement);
    return () => observer.disconnect();
  }, [gridElement, scrollElement]);

  let columnCount = 1;
  if (typeof columns === 'number') {
    columnCount = columns;
  } else if (gridWidth > 0) {
    columnCount = Math.max(
      1,
      Math.floor((gridWidth + gap) / (columns.minWidth + gap))
    );
  }

  const rowHeight = itemHeight + gap;

  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(apps.length / columnCount),
    enabled,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    // Sizes are never measured, so keys only need to change with the layout
    // to make the virtualizer recompute row positions.
    getItemKey: useCallback(
      (index: number) => `${columnCount}:${rowHeight}:${index}`,
      [columnCount, rowHeight]
    ),
    getScrollElement: () => scrollElement,
    initialOffset: () => lastScrollOffsetRef.current,
    onChange: (instance) => {
      if (instance.options.enabled && instance.scrollOffset != null) {
        lastScrollOffsetRef.current = instance.scrollOffset;
      }
    },
    overscan,
    scrollMargin,
  });

  const rows = rowVirtualizer.getVirtualItems();
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const visibleApps = firstRow
    ? apps.slice(
        firstRow.index * columnCount,
        (lastRow.index + 1) * columnCount
      )
    : [];

  return (
    <Box ref={setGridElement} sx={{ paddingBottom: '20px', width: '100%' }}>
      <Box
        style={{ height: rowVirtualizer.getTotalSize() }}
        sx={{ position: 'relative', width: '100%' }}
      >
        {firstRow ? (
          <Box
            style={{
              transform: `translateY(${firstRow.start - rowVirtualizer.options.scrollMargin}px)`,
            }}
            sx={{
              columnGap: `${gap}px`,
              display: 'grid',
              gridAutoRows: `${itemHeight}px`,
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              left: 0,
              position: 'absolute',
              rowGap: `${gap}px`,
              top: 0,
              width: '100%',
            }}
          >
            {visibleApps.map((app) => (
              <Fragment key={getAppKey(app)}>{renderApp(app)}</Fragment>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};
