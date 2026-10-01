import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VirtualAppGrid } from '../AppsLibrary/VirtualAppGrid';

const SCROLLER_HEIGHT = 720;
let gridWidth = 400;

const apps = Array.from({ length: 100 }, (_, index) => ({
  name: `app${index}`,
  service: 'APP',
}));

const Harness = (
  props: Omit<
    React.ComponentProps<typeof VirtualAppGrid>,
    'apps' | 'renderApp' | 'scrollElement'
  >
) => {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  return (
    <div data-testid="scroller" ref={setScroller}>
      <VirtualAppGrid
        apps={apps}
        renderApp={(app) => <div data-testid="item">{app.name}</div>}
        scrollElement={scroller}
        {...props}
      />
    </div>
  );
};

const totalHeight = () =>
  (
    screen.getByTestId('scroller').firstElementChild?.firstElementChild as
      | HTMLElement
      | undefined
  )?.style.height;

beforeEach(() => {
  gridWidth = 400;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const height = this.dataset.testid === 'scroller' ? SCROLLER_HEIGHT : 0;
      return {
        bottom: height,
        height,
        left: 0,
        right: gridWidth,
        top: 0,
        width: gridWidth,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VirtualAppGrid', () => {
  it('renders only the rows in view, as siblings of one grid', () => {
    render(<Harness columns={1} gap={0} itemHeight={72} overscan={2} />);

    const items = screen.getAllByTestId('item');
    // 720px of 72px rows is 10 rows, plus a little overscan.
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.length).toBeLessThan(15);
    expect(items[0]).toHaveTextContent('app0');
    // Dividers rely on `:last-of-type`, so no per-row wrappers.
    expect(new Set(items.map((item) => item.parentElement)).size).toBe(1);
    expect(totalHeight()).toBe(`${100 * 72}px`);
  });

  it('fits as many columns as the width allows', () => {
    gridWidth = 1000;
    render(<Harness columns={{ minWidth: 320 }} gap={16} itemHeight={220} />);

    // (1000 + 16) / (320 + 16) → 3 columns, so 34 rows of 236px.
    expect(totalHeight()).toBe(`${34 * 236}px`);
    expect(screen.getAllByTestId('item').length % 3).toBe(0);
  });

  it('uses the fixed column count when given one', () => {
    render(<Harness columns={2} gap={12} itemHeight={72} />);

    expect(totalHeight()).toBe(`${50 * 84}px`);
  });

  it('renders nothing while disabled', () => {
    render(<Harness columns={1} enabled={false} gap={0} itemHeight={72} />);

    expect(screen.queryAllByTestId('item')).toHaveLength(0);
    expect(totalHeight()).toBe('0px');
  });
});
