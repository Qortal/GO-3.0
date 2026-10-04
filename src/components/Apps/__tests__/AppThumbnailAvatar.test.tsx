import type { ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/events', () => ({ executeEvent: vi.fn() }));

import { qdnAvatarKey } from '../../../lib/qdnAvatars';
import { setQdnAvatarCacheForTests } from '../../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
  PNG_BYTES,
  statusResponse,
} from '../../../lib/qdnAvatars/testHarness';
import { AppThumbnailAvatar } from '../AppThumbnailAvatar';
import { AppCardCompact } from '../AppCard/AppCardCompact';
import { AppsDevModeTabComponent } from '../AppsDevModeTabComponent';
import TabComponent from '../TabComponent';
import { lightTheme } from '../../../styles/theme-light';

const Q_TUBE_SEED = '/seeds/q-tube.webp';

const never = () => new Promise<Response>(() => {});

function installHarness(
  options: Parameters<typeof createAvatarTestHarness>[0]
) {
  const harness = createAvatarTestHarness(options);
  setQdnAvatarCacheForTests(harness.cache);
  return harness;
}

const themed = (node: ReactNode) => (
  <ThemeProvider theme={lightTheme}>{node}</ThemeProvider>
);

const imageSources = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

const settle = () =>
  act(async () => {
    await flushAsync();
  });

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('AppThumbnailAvatar', () => {
  it('shows a cached icon at once, without asking the node', async () => {
    const h = installHarness({ handler: never });
    await h.cache.putImage('Q-Blog', PNG_BYTES);

    const { container } = render(<AppThumbnailAvatar appName="q-blog" />);

    expect(imageSources(container)).toEqual(['blob:test/1']);
    expect(h.calls).toHaveLength(0);
  });

  it('shows the icon GO ships while the node is slow', () => {
    installHarness({
      seeds: { [qdnAvatarKey('Q-Tube')!]: Q_TUBE_SEED },
      handler: never,
    });

    const { container } = render(<AppThumbnailAvatar appName="Q-Tube" />);

    expect(imageSources(container)).toEqual([Q_TUBE_SEED]);
  });

  it('replaces the shipped icon with the live one once fetched', async () => {
    installHarness({
      seeds: { [qdnAvatarKey('Q-Tube')!]: Q_TUBE_SEED },
      handler: () => imageResponse(),
    });

    const { container } = render(<AppThumbnailAvatar appName="Q-Tube" />);
    await settle();

    expect(imageSources(container)).toEqual(['blob:test/1']);
  });

  it('shows the Qortal logo while loading and when the app has no icon', async () => {
    const h = installHarness({ handler: never });
    const { container } = render(<AppThumbnailAvatar appName="New-App" />);

    expect(imageSources(container)).toHaveLength(1);
    expect(imageSources(container)[0]).toContain('LogoSelected');

    h.setHandler((_url, { kind }) =>
      kind === 'status'
        ? statusResponse('NOT_PUBLISHED')
        : notPublishedResponse('Other-App')
    );
    const other = render(<AppThumbnailAvatar appName="Other-App" />);
    await settle();
    expect(imageSources(other.container)[0]).toContain('LogoSelected');
  });

  it('uses a private app logo and does not fetch the name avatar', async () => {
    const h = installHarness({ handler: () => imageResponse() });

    const { container } = render(
      <AppThumbnailAvatar
        appName="Owner"
        privateLogo="data:image/png;base64,AAAA"
      />
    );
    await settle();

    expect(imageSources(container)).toEqual(['data:image/png;base64,AAAA']);
    expect(h.calls).toHaveLength(0);
  });

  it('asks the node at the given priority, without cache-busting URLs', async () => {
    const h = installHarness({ handler: () => imageResponse() });

    render(<AppThumbnailAvatar appName="Q-Mail" priority="high" />);
    await settle();

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(
      'http://node:12391/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true'
    );
  });
});

/** A node whose answers the test releases one by one. */
function heldNode() {
  const held: { name: string; answer: () => void }[] = [];
  const h = installHarness({
    handler: (_url, { name }) =>
      new Promise<Response>((resolve) => {
        held.push({ name, answer: () => resolve(imageResponse()) });
      }),
  });
  const asked = () =>
    h.calls.filter((call) => call.kind === 'async').map((call) => call.name);
  /** Answers the oldest request still waiting. */
  const answerNext = async () => {
    const next = held.shift();
    await act(async () => {
      next?.answer();
      await flushAsync();
    });
  };
  return { h, asked, answerNext };
}

describe('fetch order', () => {
  it('asks for a higher priority first, even when it was mounted first', async () => {
    const { asked, answerNext } = heldNode();
    render(
      <>
        {['Busy-0', 'Busy-1', 'Busy-2'].map((name) => (
          <AppThumbnailAvatar key={name} appName={name} />
        ))}
        <AppThumbnailAvatar appName="Detail-App" priority="high" />
        <AppThumbnailAvatar appName="Row-App" />
      </>
    );
    await settle();
    expect(asked()).toEqual(['Busy-0', 'Busy-1', 'Busy-2']);

    await answerNext();

    expect(asked()[3]).toBe('Detail-App');
  });

  describe('with IntersectionObserver', () => {
    type FakeObserver = {
      callback: IntersectionObserverCallback;
      targets: Set<Element>;
    };
    let observers: FakeObserver[] = [];

    beforeEach(() => {
      observers = [];
      class FakeIntersectionObserver {
        targets = new Set<Element>();
        constructor(public callback: IntersectionObserverCallback) {
          observers.push(this);
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
        }
        takeRecords() {
          return [];
        }
      }
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const rowsOf = (container: HTMLElement) => [
      ...container.querySelectorAll('.MuiAvatar-root'),
    ];

    /** Rows coming on screen together, in one observer callback. */
    const comeOnScreen = (rows: Element[], all: Element[]) =>
      act(() => {
        for (const observer of observers) {
          const entries = rows
            .filter((row) => observer.targets.has(row))
            .map(
              (row) =>
                ({
                  target: row,
                  isIntersecting: true,
                  boundingClientRect: { top: all.indexOf(row) * 72, left: 0 },
                }) as unknown as IntersectionObserverEntry
            );
          if (entries.length) {
            observer.callback(
              entries,
              observer as unknown as IntersectionObserver
            );
          }
        }
      });

    const renderRows = (count: number) =>
      render(
        <>
          {Array.from({ length: count }, (_, i) => (
            <AppThumbnailAvatar key={i} appName={`App-${i}`} />
          ))}
        </>
      );

    it('asks for the icons on screen first, top row first', async () => {
      const { asked, answerNext } = heldNode();
      const { container } = renderRows(10);
      await settle();
      // Three requests run at once; the rest wait.
      expect(asked()).toEqual(['App-0', 'App-1', 'App-2']);

      const rows = rowsOf(container);
      comeOnScreen([rows[5], rows[6], rows[7]], rows);
      await settle();
      await answerNext();
      await answerNext();
      await answerNext();

      expect(asked().slice(3)).toEqual(['App-5', 'App-6', 'App-7']);
      // Rows off screen still get their icon, after the ones on screen.
      await answerNext();
      expect(asked()[6]).toMatch(/^App-[3489]$/);
    });

    it('asks first for a row that scrolls on screen while others wait', async () => {
      const { asked, answerNext } = heldNode();
      const { container } = renderRows(10);
      await settle();
      const rows = rowsOf(container);
      comeOnScreen([rows[3], rows[4]], rows);
      await settle();
      comeOnScreen([rows[8]], rows);
      await settle();

      await answerNext();

      expect(asked()[3]).toBe('App-8');
    });

    it('shows a cached icon at once, on screen or not', async () => {
      const h = installHarness({ handler: never });
      await h.cache.putImage('Q-Blog', PNG_BYTES);

      const { container } = render(<AppThumbnailAvatar appName="Q-Blog" />);

      expect(imageSources(container)).toEqual(['blob:test/1']);
      expect(h.calls).toHaveLength(0);
    });

    it('lets an icon on screen be replaced and freed', async () => {
      const h = installHarness({ handler: never });
      await h.cache.putImage('Q-Blog', PNG_BYTES);
      const { container } = render(<AppThumbnailAvatar appName="Q-Blog" />);
      const rows = rowsOf(container);
      comeOnScreen(rows, rows);
      await settle();

      await act(async () => {
        await h.cache.putImage('Q-Blog', PNG_BYTES);
      });
      expect(imageSources(container)).toEqual(['blob:test/2']);
      await act(async () => {
        await h.advance(60_000);
      });

      // Coming on screen must not keep the old icon in memory for good.
      expect(h.revoked).toContain('blob:test/1');
    });

    it('stops watching rows that are gone', async () => {
      heldNode();
      const { unmount } = renderRows(3);
      await settle();
      expect(observers[0].targets.size).toBe(3);

      unmount();

      expect(observers[0].targets.size).toBe(0);
    });
  });
});

describe('app cards', () => {
  it('show the cached icon in the compact card', async () => {
    const h = installHarness({ handler: never });
    await h.cache.putImage('Quitter', PNG_BYTES);

    const { container } = render(
      <AppCardCompact app={{ name: 'Quitter' }} myName="me" />
    );

    expect(imageSources(container)).toContain('blob:test/1');
  });
});

describe('AppsDevModeTabComponent', () => {
  it('shows the Qortal logo until the published app icon is cached', async () => {
    const h = installHarness({ handler: never });
    const { container, rerender } = render(
      themed(
        <AppsDevModeTabComponent
          isSelected={false}
          app={{ name: 'Dev-App', service: 'APP' }}
        />
      )
    );
    expect(imageSources(container)[0]).toContain('LogoSelected');

    await act(async () => {
      await h.cache.putImage('Dev-App', PNG_BYTES);
    });
    rerender(
      themed(
        <AppsDevModeTabComponent
          isSelected={false}
          app={{ name: 'Dev-App', service: 'APP' }}
        />
      )
    );
    expect(imageSources(container)).toEqual(['blob:test/1']);
  });

  it('keeps a custom icon and fetches nothing for it', async () => {
    const h = installHarness({ handler: () => imageResponse() });
    const { container } = render(
      themed(
        <AppsDevModeTabComponent
          isSelected={false}
          app={{ name: 'Dev-App', service: 'APP', customIcon: '/custom.png' }}
        />
      )
    );
    await settle();

    expect(imageSources(container)).toEqual(['/custom.png']);
    expect(h.calls).toHaveLength(0);
  });
});

describe('TabComponent', () => {
  const renderTab = (app: Record<string, unknown>) =>
    render(
      themed(
        <TabComponent
          app={{ tabId: 'tab-1', ...app }}
          isSelected={false}
          onClose={vi.fn()}
          onCloseAll={vi.fn()}
          onDuplicate={vi.fn()}
          onSelect={vi.fn()}
        />
      )
    );

  it('shows the cached icon of an app tab', async () => {
    const h = installHarness({ handler: never });
    await h.cache.putImage('Q-Mail', PNG_BYTES);

    const { container } = renderTab({ name: 'Q-Mail', service: 'APP' });

    expect(imageSources(container)).toEqual(['blob:test/1']);
  });

  it('keeps a private logo and fetches nothing for private or dev tabs', async () => {
    const h = installHarness({ handler: () => imageResponse() });

    const privateTab = renderTab({
      name: 'Owner',
      isPrivate: true,
      privateAppProperties: { logo: '/private.png', name: 'Mine' },
    });
    render(
      themed(
        <TabComponent
          app={{ tabId: 'dev-1', name: 'Dev', url: 'http://localhost:5173' }}
          isDevApp
          isSelected={false}
          onClose={vi.fn()}
          onCloseAll={vi.fn()}
          onDuplicate={vi.fn()}
          onSelect={vi.fn()}
        />
      )
    );
    await settle();

    expect(imageSources(privateTab.container)).toEqual(['/private.png']);
    expect(h.calls).toHaveLength(0);
  });
});
