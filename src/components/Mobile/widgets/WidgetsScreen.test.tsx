import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import '../../../i18n/i18n';

vi.mock('./GoWidgetFrame', () => ({
  GoWidgetFrame: ({
    widget,
    interactive,
  }: {
    widget: { name: string };
    interactive: boolean;
  }) => (
    <div
      data-testid={`frame-${widget.name}`}
      data-interactive={String(interactive)}
    />
  ),
}));
vi.mock('../../Apps/AppThumbnailAvatar', () => ({
  AppThumbnailAvatar: () => <span />,
}));
// GO in the foreground or not, as usePageVisible tells it (a store).
const page = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    visible: true,
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    set(visible: boolean) {
      this.visible = visible;
      listeners.forEach((onChange) => onChange());
    },
  };
});
vi.mock('../../../hooks/usePageVisible', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePageVisible: () =>
      useSyncExternalStore(page.subscribe, () => page.visible),
  };
});
vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node.test',
}));
const fetched = vi.hoisted(() => ({
  widgets: [
    {
      name: 'Clock',
      identifier: null,
      title: 'Clock',
      description: 'The time',
      updated: 2,
    },
    {
      name: 'Torq',
      identifier: 'go-widget-news',
      title: 'Torq news',
      description: 'Latest posts',
      updated: 1,
    },
  ],
}));
vi.mock('./fetchGoWidgets', () => ({
  fetchGoWidgets: vi.fn(async () => fetched.widgets),
}));

import { WidgetsScreen } from './WidgetsScreen';
import { widgetHoldFeed } from './widgetSwipeZone';
import {
  GO_WIDGETS_STORAGE_KEY,
  goWidgetsEditingAtom,
  savedGoWidgetsAtom,
} from './goWidgets';

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
  }
}

const GRID_WIDTH = 351;
let widthDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  (window as unknown as { PointerEvent: unknown }).PointerEvent =
    FakePointerEvent;
  widthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth'
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => GRID_WIDTH,
  });
});

afterAll(() => {
  if (widthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientWidth',
      widthDescriptor
    );
  }
});

const setup = (active = true) => {
  const store = createStore();
  const view = render(
    <Provider store={store}>
      <WidgetsScreen active={active} />
    </Provider>
  );
  const rerender = (next: boolean) =>
    view.rerender(
      <Provider store={store}>
        <WidgetsScreen active={next} />
      </Provider>
    );
  return { store, rerender };
};

/** Holding an empty spot starts arranging. */
const holdEmptySpot = async () => {
  const background = document.querySelector(
    '[data-section-swipe-surface]'
  ) as HTMLElement;
  pointer('pointerDown', background, 200, 700);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
};

const addFromPicker = async (title: string) => {
  // An empty screen offers Add; otherwise it is in the arranging bar.
  if (!screen.queryByRole('button', { name: 'Add widget' })) {
    await holdEmptySpot();
  }
  fireEvent.click(screen.getAllByRole('button', { name: 'Add widget' })[0]);
  const row = (await screen.findByText(title)).closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Add' }));
  // The picker closes (the page is hidden from screen readers until then).
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

const dragOverlay = (name: string) =>
  screen
    .getByRole('listitem', { name })
    .querySelector('[data-widget-drag]') as HTMLElement;

const pointer = (
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  el: Element,
  x: number,
  y: number
) => {
  act(() => {
    fireEvent[type](el, { clientX: x, clientY: y, pointerId: 1 });
  });
};

describe('WidgetsScreen', () => {
  beforeEach(() => {
    window.localStorage.removeItem(GO_WIDGETS_STORAGE_KEY);
  });

  it('starts empty, then adds what the picker offers', async () => {
    const { store } = setup();
    // Nothing but a round + (and how arranging works).
    expect(
      screen.getByRole('button', { name: 'Add widget' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/hold a widget or an empty spot/)
    ).toBeInTheDocument();
    await addFromPicker('Clock');
    expect(store.get(savedGoWidgetsAtom).map((w) => w.name)).toEqual(['Clock']);
    // The picker closed; the widget is on the screen, loading.
    expect(
      await screen.findByRole('listitem', { name: 'Clock' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('frame-Clock').dataset.interactive).toBe('true');
  });

  it('shows only the widgets: no title, no corner button', async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    expect(screen.queryByText('Widgets')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add widget' })).toBeNull();
    // Holding an empty spot arranges, with Add and Done in a bar.
    await holdEmptySpot();
    expect(store.get(goWidgetsEditingAtom)).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Add widget' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(store.get(goWidgetsEditingAtom)).toBe(false);
  });

  it('shows a widget already added as Added', async () => {
    setup();
    await addFromPicker('Clock');
    await holdEmptySpot();
    fireEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    const row = (await screen.findByText('Torq news')).closest('li')!;
    const dialog = screen.getByRole('dialog');
    expect(
      within(within(dialog).getByText('Clock').closest('li')!).getByRole(
        'button',
        { name: 'Added' }
      )
    ).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('arranges: drag a widget onto another to swap them', async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    await addFromPicker('Torq news');
    await holdEmptySpot();
    expect(store.get(goWidgetsEditingAtom)).toBe(true);
    // While arranging, GO takes the touches, not the widgets.
    expect(screen.getByTestId('frame-Clock').dataset.interactive).toBe('false');

    const overlay = dragOverlay('Clock');
    pointer('pointerDown', overlay, 100, 100);
    pointer('pointerMove', overlay, 100, 130);
    pointer('pointerMove', overlay, 100, 360);
    pointer('pointerUp', overlay, 100, 360);
    const placed = store
      .get(savedGoWidgetsAtom)
      .map((w) => [w.name, w.x, w.y, w.w, w.h]);
    expect(placed).toEqual([
      ['Clock', 0, 5, 4, 5],
      ['Torq', 0, 0, 4, 5],
    ]);
  });

  it('arranges: drag the corner to resize, which the widget keeps', async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    await holdEmptySpot();
    const handle = screen.getAllByRole('button', { name: 'Resize' })[0];
    pointer('pointerDown', handle, 351, 248);
    pointer('pointerMove', handle, 300, 200);
    pointer('pointerMove', handle, 171, 144);
    pointer('pointerUp', handle, 171, 144);
    const [clock] = store.get(savedGoWidgetsAtom);
    expect([clock.w, clock.h, clock.sizedBy]).toEqual([2, 3, 'user']);
  });

  it("while arranging, drags are the widgets': no Tabs pull or section swipe", async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    const section = document.querySelector(
      '[data-go-section="widgets"]'
    ) as HTMLElement;
    expect(section.hasAttribute('data-section-swipe-ignore')).toBe(false);

    await holdEmptySpot();
    expect(store.get(goWidgetsEditingAtom)).toBe(true);
    // tabsPull and the section swipe leave touches in here alone.
    const handle = screen.getAllByRole('button', { name: 'Resize' })[0];
    expect(handle.closest('[data-section-swipe-ignore]')).toBe(section);
    // The handle shows a two-way arrow, not a dot.
    expect(
      within(handle).getByTestId('OpenInFullRoundedIcon')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(section.hasAttribute('data-section-swipe-ignore')).toBe(false);
  });

  it('a tap while arranging opens the widget menu; Remove takes it away', async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    await holdEmptySpot();
    const overlay = dragOverlay('Clock');
    pointer('pointerDown', overlay, 100, 100);
    pointer('pointerUp', overlay, 101, 101);
    expect(
      await screen.findByRole('menuitem', { name: 'Open Clock' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(store.get(savedGoWidgetsAtom)).toEqual([]);
  });

  it('removes with the × badge too', async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    await holdEmptySpot();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(store.get(savedGoWidgetsAtom)).toEqual([]);
  });

  it("Android's long press on a widget picks it up; dropped on Remove, it goes", async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    const card = screen.getByRole('listitem', { name: 'Clock' });
    const inside = card.querySelector('[data-testid="frame-Clock"]')!;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => inside;
    try {
      act(() => widgetHoldFeed.emit({ type: 'hold', x: 100, y: 100 }));
      expect(store.get(goWidgetsEditingAtom)).toBe(true);
      // Held: the Remove target replaces the Add / Done bar.
      const target = await screen.findByRole('status');
      expect(target).toHaveTextContent('Remove');
      target.getBoundingClientRect = () =>
        ({
          top: 700,
          bottom: 744,
          left: 120,
          right: 260,
          width: 140,
          height: 44,
        }) as DOMRect;
      act(() => widgetHoldFeed.emit({ type: 'move', x: 150, y: 500 }));
      act(() => widgetHoldFeed.emit({ type: 'move', x: 180, y: 720 }));
      act(() => widgetHoldFeed.emit({ type: 'end', x: 180, y: 720 }));
      expect(store.get(savedGoWidgetsAtom)).toEqual([]);
    } finally {
      document.elementFromPoint = original;
    }
  });

  it("Android's long press moves a widget when let go elsewhere", async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    await addFromPicker('Torq news');
    act(() => store.set(goWidgetsEditingAtom, false));
    const inside = screen
      .getByRole('listitem', { name: 'Clock' })
      .querySelector('[data-testid="frame-Clock"]')!;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => inside;
    try {
      act(() => widgetHoldFeed.emit({ type: 'hold', x: 100, y: 100 }));
      act(() => widgetHoldFeed.emit({ type: 'move', x: 100, y: 230 }));
      act(() => widgetHoldFeed.emit({ type: 'move', x: 100, y: 360 }));
      act(() => widgetHoldFeed.emit({ type: 'end', x: 100, y: 360 }));
    } finally {
      document.elementFromPoint = original;
    }
    expect(store.get(savedGoWidgetsAtom).map((w) => [w.name, w.y])).toEqual([
      ['Clock', 5],
      ['Torq', 0],
    ]);
    // Still arranging, with Add at hand.
    expect(store.get(goWidgetsEditingAtom)).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Add widget' })
    ).toBeInTheDocument();
  });

  it("Android's long press on empty space just starts arranging", async () => {
    const { store } = setup();
    await addFromPicker('Clock');
    const original = document.elementFromPoint;
    document.elementFromPoint = () => document.body;
    try {
      act(() => widgetHoldFeed.emit({ type: 'hold', x: 100, y: 700 }));
      act(() => widgetHoldFeed.emit({ type: 'end', x: 100, y: 700 }));
    } finally {
      document.elementFromPoint = original;
    }
    expect(store.get(goWidgetsEditingAtom)).toBe(true);
    expect(store.get(savedGoWidgetsAtom)).toHaveLength(1);
  });

  it('stops arranging when the screen is left', async () => {
    const { store, rerender } = setup();
    await addFromPicker('Clock');
    await holdEmptySpot();
    expect(store.get(goWidgetsEditingAtom)).toBe(true);
    rerender(false);
    expect(store.get(goWidgetsEditingAtom)).toBe(false);
  });

  describe('loading', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      page.visible = true;
      window.localStorage.setItem(
        GO_WIDGETS_STORAGE_KEY,
        JSON.stringify([
          { name: 'Clock', identifier: null, x: 0, y: 0, w: 4, h: 3 },
        ])
      );
    });
    afterEach(() => {
      vi.useRealTimers();
      page.visible = true;
    });

    it('loads the widgets soon after start, out of sight, and keeps them', () => {
      const { rerender } = setup(false);
      // Not in GO's own start.
      expect(screen.queryByTestId('frame-Clock')).toBeNull();
      act(() => vi.advanceTimersByTime(5_000));
      // There before the first swipe to the screen.
      expect(screen.getByTestId('frame-Clock')).toBeTruthy();
      // Seen, then left for a long while: still loaded.
      rerender(true);
      rerender(false);
      act(() => vi.advanceTimersByTime(30 * 60_000));
      expect(screen.getByTestId('frame-Clock')).toBeTruthy();
    });

    it('loads at once when the screen shows first', () => {
      setup(true);
      expect(screen.getByTestId('frame-Clock')).toBeTruthy();
    });

    it('waits while GO is in the background', () => {
      page.visible = false;
      setup(false);
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.queryByTestId('frame-Clock')).toBeNull();
      act(() => page.set(true));
      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByTestId('frame-Clock')).toBeTruthy();
    });
  });
});
