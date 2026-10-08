import { act, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
import { ImmersiveEdges, edgeControlsMode, edgeStrip } from './ImmersiveEdges';
import { immersiveEdgeColorAtom } from './immersiveMode';

const native = vi.hoisted(() => ({
  listening: 0,
  range: null as { fromCssPx?: number; toCssPx?: number } | null,
  emit: null as ((color: string) => void) | null,
}));

vi.mock('./immersiveNative', () => ({
  listenImmersiveEdge: (
    cb: (color: string) => void,
    range: { fromCssPx?: number; toCssPx?: number }
  ) => {
    native.listening += 1;
    native.range = range;
    native.emit = cb;
    return () => {
      native.listening -= 1;
      native.emit = null;
    };
  },
}));

const renderEdges = (
  props: Partial<Parameters<typeof ImmersiveEdges>[0]> = {},
  store = createStore()
) =>
  render(
    <Provider store={store}>
      <ImmersiveEdges
        barsShown={false}
        topBarHeight={91}
        tabBarSlot
        showMs={280}
        hideMs={240}
        {...props}
      />
    </Provider>
  );

describe('edgeStrip', () => {
  it('is solid, then fades to the same colour, clear, toward the content', () => {
    const top = edgeStrip('#1c1e24', 'bottom');
    expect(top).toContain('to bottom');
    expect(top).toContain('#1c1e24 calc(100% - 14px)');
    expect(top).toContain('rgba(28, 30, 36, 0) 100%');
    expect(edgeStrip('#1c1e24', 'top')).toContain('to top');
  });
});

describe('edgeControlsMode', () => {
  it('picks the theme whose text reads best on the page colour', () => {
    expect(edgeControlsMode('#0e0f14')).toBe('dark');
    expect(edgeControlsMode('#1c1e24')).toBe('dark');
    expect(edgeControlsMode('#ffffff')).toBe('light');
    expect(edgeControlsMode('#f2f2f2')).toBe('light');
    // A mid blue header: black text contrasts more than white.
    expect(edgeControlsMode('#5b8def')).toBe('light');
    expect(edgeControlsMode('#1d3b8a')).toBe('dark');
    expect(edgeControlsMode(null)).toBeNull();
    expect(edgeControlsMode('rgb(1, 2, 3)')).toBeNull();
  });
});

describe('ImmersiveEdges', () => {
  it('reads below the top bar while it is out, below the camera otherwise', () => {
    vi.useFakeTimers();
    const { rerender } = renderEdges({ barsShown: true });
    expect(native.range?.fromCssPx).toBe(91 + 14 + 2);
    rerender(
      <Provider store={createStore()}>
        <ImmersiveEdges
          barsShown={false}
          topBarHeight={91}
          tabBarSlot
          showMs={280}
          hideMs={240}
        />
      </Provider>
    );
    // Not while the bars slide away (the content moves through the band
    // read): only once they are gone.
    expect(native.listening).toBe(0);
    act(() => {
      vi.advanceTimersByTime(240 + 180);
    });
    expect(native.listening).toBe(1);
    expect(native.range?.fromCssPx).toBe(14 + 2);
    vi.useRealTimers();
  });

  it('shares the page colour and keeps at most two layers per strip', () => {
    const store = createStore();
    const { container, unmount } = renderEdges({}, store);
    const top = container.querySelector('[data-immersive-top-edge]')!;
    expect(top.children).toHaveLength(1);
    act(() => native.emit?.('#111111'));
    act(() => native.emit?.('#333333'));
    act(() => native.emit?.('#333333'));
    act(() => native.emit?.('#555555'));
    expect(top.children).toHaveLength(2);
    expect(store.get(immersiveEdgeColorAtom)).toBe('#555555');
    unmount();
    expect(store.get(immersiveEdgeColorAtom)).toBeNull();
  });
});
