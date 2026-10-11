import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/i18n';
import { __setGoLayoutForTests } from '../../layout/goLayout';
import {
  fullScreenChromeReservePx,
  ReticulumImageViewer,
} from './ReticulumImageViewer';

const setPhone = (phone: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const cssRulesFor = (element: Element) => {
  const classes = [...element.classList].filter((name) =>
    name.startsWith('css-')
  );
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (classes.some((name) => rule.cssText.includes(name))) {
        rules.push(rule.cssText);
      }
    }
  }
  return rules.join('\n');
};

const renderViewer = (containerElement: HTMLElement | null = null) => {
  const onClose = vi.fn();
  render(
    <ReticulumImageViewer
      containerElement={containerElement}
      onClose={onClose}
      open
      src="blob:picture"
    />
  );
  const overlay = document.querySelector(
    '[data-reticulum-image-viewer="true"]'
  ) as HTMLElement;
  return { onClose, overlay };
};

describe('ReticulumImageViewer', () => {
  const originalMatchMedia = window.matchMedia;

  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fills a phone screen and blurs and dims the chat behind', () => {
    setPhone(true);
    const { overlay } = renderViewer();
    expect(overlay).not.toBeNull();
    const rules = cssRulesFor(overlay);
    expect(rules).toMatch(/inset:\s*0/);
    expect(rules).toMatch(/backdrop-filter:\s*blur\(22px\)[^;]*brightness/);
  });

  it('puts the actions in one bar of finger-sized light buttons', () => {
    setPhone(true);
    renderViewer();
    const bar = screen.getByRole('toolbar', { name: 'Image actions' });
    const buttons = within(bar).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Download image',
      'Copy image',
      'Zoom out',
      'Zoom in',
    ]);
    for (const button of buttons) {
      expect(getComputedStyle(button).height).toBe('48px');
    }
    expect(getComputedStyle(buttons[0]).color).toBe('rgb(255, 255, 255)');
    // Nothing to zoom out of yet: shown, but faded.
    expect(buttons[2]).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Close image viewer' })
    ).toBeInTheDocument();
  });

  it('fades out before it closes', () => {
    vi.useFakeTimers();
    setPhone(true);
    const { onClose } = renderViewer();
    fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }));
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides and shows the buttons with one tap around the picture', () => {
    setPhone(true);
    const { overlay, onClose } = renderViewer();
    fireEvent.click(overlay);
    expect(overlay).toHaveAttribute('data-controls-hidden', 'true');
    // Faded and out of the way of fingers, not removed.
    const bar = screen.getByRole('toolbar', { name: 'Image actions' });
    expect(cssRulesFor(bar)).toMatch(/opacity:\s*0/);
    expect(cssRulesFor(bar)).toMatch(/pointer-events:\s*none/);
    fireEvent.click(overlay);
    expect(overlay).not.toHaveAttribute('data-controls-hidden');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides them with one tap on the picture, but zooms on two', () => {
    vi.useFakeTimers();
    setPhone(true);
    const { overlay } = renderViewer();
    const picture = overlay.querySelector('img')!;
    const tap = () => {
      fireEvent.touchStart(picture, {
        touches: [{ clientX: 50, clientY: 50 }],
      });
      fireEvent.touchEnd(picture, { touches: [] });
    };
    tap();
    expect(overlay).not.toHaveAttribute('data-controls-hidden');
    act(() => {
      vi.advanceTimersByTime(320);
    });
    expect(overlay).toHaveAttribute('data-controls-hidden', 'true');
    // A double tap zooms and leaves the buttons as they are.
    tap();
    tap();
    act(() => {
      vi.advanceTimersByTime(320);
    });
    expect(overlay).toHaveAttribute('data-controls-hidden', 'true');
    expect(cssRulesFor(picture)).toMatch(/scale\(2\.5\)/);
  });

  it('stays inside the chat panel on the desktop', () => {
    setPhone(false);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    panel.getBoundingClientRect = () =>
      ({ height: 500, left: 300, top: 60, width: 700 }) as DOMRect;
    const { overlay } = renderViewer(panel);
    const style = getComputedStyle(overlay);
    expect(style.left).toBe('300px');
    expect(style.width).toBe('700px');
    const bar = screen.getByRole('toolbar', { name: 'Image actions' });
    expect(
      within(bar).getByRole('button', { name: 'Close image viewer' })
    ).toBeInTheDocument();
  });
});

describe('ReticulumImageViewer on short GO screens', () => {
  const originalMatchMedia = window.matchMedia;

  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    __setGoLayoutForTests(null);
  });

  const pictureMaxHeight = (overlay: HTMLElement) =>
    /max-height:\s*([^;]+);/.exec(
      cssRulesFor(overlay.querySelector('img')!)
    )?.[1] ?? '';

  it('keeps room for the buttons only while they show', () => {
    expect(fullScreenChromeReservePx(false, false)).toBe(168);
    expect(fullScreenChromeReservePx(false, true)).toBe(168);
    expect(fullScreenChromeReservePx(true, false)).toBe(96);
    expect(fullScreenChromeReservePx(true, true)).toBe(0);
  });

  it('gives the picture the whole height in phone landscape once tapped', () => {
    __setGoLayoutForTests({ go: true, width: 873, stableHeight: 393 });
    setPhone(true);
    const { overlay } = renderViewer();
    expect(pictureMaxHeight(overlay)).toMatch(/- 96px\)$/);
    fireEvent.click(overlay);
    expect(overlay).toHaveAttribute('data-controls-hidden', 'true');
    expect(pictureMaxHeight(overlay)).toMatch(/- 0px\)$/);
  });

  it('keeps the phone margin on a tall GO screen', () => {
    __setGoLayoutForTests({ go: true, width: 393, stableHeight: 873 });
    setPhone(true);
    const { overlay } = renderViewer();
    expect(pictureMaxHeight(overlay)).toMatch(/- 168px\)$/);
    fireEvent.click(overlay);
    expect(pictureMaxHeight(overlay)).toMatch(/- 168px\)$/);
  });

  it('keeps the phone margin on the Hub, buttons hidden or not', () => {
    __setGoLayoutForTests({ go: false });
    setPhone(true);
    const { overlay } = renderViewer();
    expect(pictureMaxHeight(overlay)).toMatch(/- 168px\)$/);
    fireEvent.click(overlay);
    expect(pictureMaxHeight(overlay)).toMatch(/- 168px\)$/);
  });
});

describe('ReticulumImageViewer gallery', () => {
  const originalMatchMedia = window.matchMedia;

  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
    delete (window as { reticulumResources?: unknown }).reticulumResources;
  });

  const items = [
    { key: 'a', messageKey: 'm1', fileHash: 'old', kind: 'image' as const },
    { key: 'gone', messageKey: 'm2', fileHash: 'gone', kind: 'image' as const },
    {
      key: 'b',
      messageKey: 'm3',
      fileHash: 'clip',
      kind: 'video' as const,
      fileName: 'clip.mp4',
    },
    { key: 'c', messageKey: 'm4', fileHash: 'new', kind: 'image' as const },
  ];

  const swipe = (fromX: number, toX: number) => {
    const track = document.querySelector('[data-viewer-track="true"]')!;
    fireEvent.touchStart(track, {
      touches: [{ clientX: fromX, clientY: 300 }],
    });
    fireEvent.touchMove(track, {
      touches: [{ clientX: (fromX + toX) / 2, clientY: 302 }],
    });
    fireEvent.touchMove(track, { touches: [{ clientX: toX, clientY: 304 }] });
    fireEvent.touchEnd(track, { touches: [] });
  };

  it('finds the next ones while a video is still reading in', async () => {
    setPhone(true);
    (window as { reticulumResources?: unknown }).reticulumResources = {
      getStatus: async (hash: string) => ({
        success: true,
        complete: hash !== 'gone',
      }),
      getUrl: (hash: string) =>
        hash === 'clip'
          ? new Promise(() => {})
          : Promise.resolve({ success: true, url: `blob:${hash}` }),
    };
    render(
      <ReticulumImageViewer
        containerElement={null}
        gallery={{ items, index: 3 }}
        onClose={() => {}}
        open
        src="blob:new"
      />
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slide="left"]')).not.toBeNull()
    );
    swipe(60, 500);
    await vi.waitFor(() =>
      expect(screen.getByText('3 / 4')).toBeInTheDocument()
    );
    // The video is still loading, yet the oldest picture already waits.
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-slide="left"] img')?.getAttribute('src')
      ).toBe('blob:old')
    );
  });

  it('swipes right to older ones, skipping what is not on the phone', async () => {
    setPhone(true);
    const getUrl = vi.fn(async (hash: string) => ({
      success: true,
      url: `blob:${hash}`,
    }));
    (window as { reticulumResources?: unknown }).reticulumResources = {
      getStatus: async (hash: string) => ({
        success: true,
        complete: hash !== 'gone',
      }),
      getUrl,
    };
    render(
      <ReticulumImageViewer
        containerElement={null}
        gallery={{ items, index: 3 }}
        onClose={() => {}}
        open
        src="blob:new"
      />
    );
    expect(screen.getByText('4 / 4')).toBeInTheDocument();
    // The video next to it is checked, not read in, until it is shown.
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slide="left"]')).not.toBeNull()
    );
    expect(getUrl).not.toHaveBeenCalledWith('clip');
    // Nothing newer: a swipe left springs back.
    swipe(500, 100);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.getByText('4 / 4')).toBeInTheDocument();
    swipe(60, 500);
    await vi.waitFor(() =>
      expect(screen.getByText('3 / 4')).toBeInTheDocument()
    );
    await vi.waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'blob:clip'
      )
    );
    // A video has nothing to copy or zoom.
    expect(
      screen.queryByRole('button', { name: 'Copy image' })
    ).not.toBeInTheDocument();
    // Past the one that is not on the phone, to the oldest. (The video
    // reading in slowly must not hold that up.)
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slide="left"]')).not.toBeNull()
    );
    swipe(60, 500);
    await vi.waitFor(() =>
      expect(screen.getByText('1 / 4')).toBeInTheDocument()
    );
    expect(
      document.querySelector('[data-slide="current"] img')?.getAttribute('src')
    ).toBe('blob:old');
  });
});
