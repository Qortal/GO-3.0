import { render } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setGoLayoutForTests } from '../../layout/goLayout';
import { SystemBarAppearanceSync, toRrggbb } from './SystemBarAppearanceSync';

const native = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('./immersive/immersiveNative', () => ({
  setSystemBarAppearance: (options: unknown) => {
    native.calls.push(options);
  },
}));

const themeOf = (mode: 'light' | 'dark', background: string) =>
  createTheme({ palette: { mode, background: { default: background } } });

const renderWith = (theme: ReturnType<typeof createTheme>) =>
  render(
    <ThemeProvider theme={theme}>
      <SystemBarAppearanceSync />
    </ThemeProvider>
  );

describe('SystemBarAppearanceSync', () => {
  beforeEach(() => {
    native.calls = [];
  });

  afterEach(() => {
    __setGoLayoutForTests(null);
  });

  it('asks for dark icons and the page colour on the light theme (GO)', () => {
    __setGoLayoutForTests({ go: true });
    renderWith(themeOf('light', '#DDD6CA'));
    expect(native.calls).toEqual([
      { lightStatus: true, lightNav: true, background: '#ddd6ca' },
    ]);
  });

  it('asks for light icons on the dark theme and follows theme changes', () => {
    __setGoLayoutForTests({ go: true });
    const view = renderWith(themeOf('dark', '#0E0F14'));
    expect(native.calls).toEqual([
      { lightStatus: false, lightNav: false, background: '#0e0f14' },
    ]);
    view.rerender(
      <ThemeProvider theme={themeOf('light', '#DDD6CA')}>
        <SystemBarAppearanceSync />
      </ThemeProvider>
    );
    expect(native.calls).toHaveLength(2);
    expect(native.calls[1]).toEqual({
      lightStatus: true,
      lightNav: true,
      background: '#ddd6ca',
    });
  });

  it('does not repeat the call when the theme object changes but not its values', () => {
    __setGoLayoutForTests({ go: true });
    const view = renderWith(themeOf('dark', '#0E0F14'));
    view.rerender(
      <ThemeProvider theme={themeOf('dark', '#0e0f14')}>
        <SystemBarAppearanceSync />
      </ThemeProvider>
    );
    expect(native.calls).toHaveLength(1);
  });

  it('leaves the background out when it cannot be read', () => {
    __setGoLayoutForTests({ go: true });
    renderWith(themeOf('dark', 'var(--page-bg)'));
    expect(native.calls).toEqual([{ lightStatus: false, lightNav: false }]);
  });

  it('does nothing off GO', () => {
    __setGoLayoutForTests({ go: false });
    renderWith(themeOf('light', '#DDD6CA'));
    expect(native.calls).toEqual([]);
  });

  describe('while the dark startup splash is up', () => {
    let splash: HTMLDivElement;

    beforeEach(() => {
      splash = document.createElement('div');
      splash.id = 'app-splash';
      document.body.appendChild(splash);
    });

    afterEach(() => {
      splash.remove();
    });

    // MutationObserver callbacks run as a microtask.
    const flush = () => Promise.resolve();

    it('waits for the splash to go, then sends the theme values', async () => {
      __setGoLayoutForTests({ go: true });
      renderWith(themeOf('light', '#DDD6CA'));
      expect(native.calls).toEqual([]);
      document.body.appendChild(document.createElement('span'));
      await flush();
      expect(native.calls).toEqual([]);
      splash.remove();
      await flush();
      expect(native.calls).toEqual([
        { lightStatus: true, lightNav: true, background: '#ddd6ca' },
      ]);
    });

    it('sends only the latest theme when it changed under the splash', async () => {
      __setGoLayoutForTests({ go: true });
      const view = renderWith(themeOf('dark', '#0E0F14'));
      view.rerender(
        <ThemeProvider theme={themeOf('light', '#DDD6CA')}>
          <SystemBarAppearanceSync />
        </ThemeProvider>
      );
      splash.remove();
      await flush();
      expect(native.calls).toEqual([
        { lightStatus: true, lightNav: true, background: '#ddd6ca' },
      ]);
    });

    it('sends nothing after unmounting under the splash', async () => {
      __setGoLayoutForTests({ go: true });
      const view = renderWith(themeOf('light', '#DDD6CA'));
      view.unmount();
      splash.remove();
      await flush();
      expect(native.calls).toEqual([]);
    });
  });
});

describe('toRrggbb', () => {
  it.each([
    ['#DDD6CA', '#ddd6ca'],
    ['#fff', '#ffffff'],
    ['#0e0f1480', '#0e0f14'],
    ['rgb(14, 15, 20)', '#0e0f14'],
    ['rgba(255, 0, 0, 0.5)', '#ff0000'],
    ['hsl(0, 100%, 50%)', '#ff0000'],
    [' #123456 ', '#123456'],
  ])('%s -> %s', (input, expected) => {
    expect(toRrggbb(input)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    'white',
    'var(--x)',
    'color(display-p3 1 0 0)',
    42,
  ])('unreadable %s -> null', (input) => {
    expect(toRrggbb(input)).toBeNull();
  });
});
