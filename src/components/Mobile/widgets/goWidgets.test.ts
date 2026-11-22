import { createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GO_WIDGETS_ENABLED_STORAGE_KEY,
  GO_WIDGETS_STORAGE_KEY,
  GO_WIDGET_LIMIT,
  addSavedWidget,
  applyWidgetAskedSize,
  applyWidgetLayout,
  goWidgetKey,
  goWidgetsEnabledAtom,
  normalizeSavedWidgets,
  removeSavedWidget,
  savedGoWidgetsAtom,
  toGoWidgetListing,
} from './goWidgets';

describe('toGoWidgetListing', () => {
  it('takes an APP tagged go-widget, in any letter case', () => {
    expect(
      toGoWidgetListing({
        name: 'Clock',
        service: 'APP',
        metadata: {
          title: 'Clock',
          description: 'The time',
          tags: ['time', ' GO-Widget '],
        },
        updated: 5,
      })
    ).toEqual({
      name: 'Clock',
      identifier: null,
      title: 'Clock',
      description: 'The time',
      updated: 5,
    });
  });

  it('takes a tagged APP under a go-widget identifier, next to its app', () => {
    expect(
      toGoWidgetListing({
        name: 'Torq',
        service: 'APP',
        identifier: 'go-widget-news',
        metadata: { tags: ['go-widget'] },
        created: 3,
      })
    ).toMatchObject({
      name: 'Torq',
      identifier: 'go-widget-news',
      title: 'Torq',
    });
  });

  it.each([
    [
      'an untagged app',
      { name: 'Q-Blog', service: 'APP', metadata: { tags: ['blog'] } },
    ],
    [
      'a website',
      { name: 'Site', service: 'WEBSITE', metadata: { tags: ['go-widget'] } },
    ],
    ['no name', { service: 'APP', metadata: { tags: ['go-widget'] } }],
    [
      'a tag that only contains it',
      { name: 'X', service: 'APP', metadata: { tags: ['not-go-widget'] } },
    ],
    [
      'an identifier that only contains it',
      { name: 'X', service: 'APP', identifier: 'my-go-widget' },
    ],
    [
      'a go-widget identifier without the tag',
      { name: 'Torq', service: 'APP', identifier: 'go-widget-news' },
    ],
    [
      'a retired widget (republished without the tag, e.g. "moved")',
      {
        name: 'Weather Now',
        service: 'APP',
        identifier: 'go-widget-now',
        metadata: { title: 'Moved to Q-Weather', tags: ['weather'] },
      },
    ],
    [
      'tags that are not a list',
      { name: 'X', service: 'APP', metadata: { tags: 'go-widget' } },
    ],
  ])('leaves out %s', (_label, resource) => {
    expect(toGoWidgetListing(resource as never)).toBeNull();
  });

  it("treats the 'default' identifier as the name's own app", () => {
    expect(
      toGoWidgetListing({
        name: 'Clock',
        service: 'APP',
        identifier: 'default',
        metadata: { tags: ['go-widget'] },
      })?.identifier
    ).toBeNull();
  });
});

describe('saved widgets', () => {
  const clock = { name: 'Clock', identifier: null };
  const news = { name: 'Torq', identifier: 'go-widget-news', title: 'News' };
  const place = (list: ReturnType<typeof addSavedWidget>) =>
    list.map((w) => [w.name, w.x, w.y, w.w, w.h, w.sizedBy]);

  it('adds once, each under the last, full width', () => {
    let list = addSavedWidget([], clock);
    list = addSavedWidget(list, news);
    list = addSavedWidget(list, clock);
    expect(place(list)).toEqual([
      ['Clock', 0, 0, 4, 5, 'default'],
      ['Torq', 0, 5, 4, 5, 'default'],
    ]);
    expect(list[1].title).toBe('News');
  });

  it('closes the gap a removed widget leaves', () => {
    const list = addSavedWidget(addSavedWidget([], clock), news);
    expect(place(removeSavedWidget(list, goWidgetKey(clock)))).toEqual([
      ['Torq', 0, 0, 4, 5, 'default'],
    ]);
  });

  it('keeps a name’s widgets apart by identifier', () => {
    const other = { name: 'Torq', identifier: 'go-widget-weather' };
    expect(addSavedWidget(addSavedWidget([], news), other)).toHaveLength(2);
  });

  it('stops at the limit', () => {
    let list = addSavedWidget([], clock);
    for (let i = 0; i < GO_WIDGET_LIMIT + 2; i += 1) {
      list = addSavedWidget(list, { name: `W${i}`, identifier: null });
    }
    expect(list).toHaveLength(GO_WIDGET_LIMIT);
  });

  it('takes the places from an arranged grid', () => {
    const list = addSavedWidget(addSavedWidget([], clock), news);
    const arranged = applyWidgetLayout(list, [
      { key: goWidgetKey(clock), x: 2, y: 0, w: 2, h: 3, sizedBy: 'user' },
      { key: goWidgetKey(news), x: 0, y: 0, w: 2, h: 5 },
    ]);
    expect(place(arranged)).toEqual([
      ['Clock', 2, 0, 2, 3, 'user'],
      ['Torq', 0, 0, 2, 5, 'default'],
    ]);
  });

  it('takes the size a widget asks for until the user sizes it', () => {
    let list = addSavedWidget(addSavedWidget([], clock), news);
    list = applyWidgetAskedSize(list, goWidgetKey(clock), { w: 2, h: 3 });
    expect(place(list)[0]).toEqual(['Clock', 0, 0, 2, 3, 'widget']);
    // The news widget below moved up into the rows the clock gave back.
    expect(place(list)[1]).toEqual(['Torq', 0, 3, 4, 5, 'default']);
    // Asking for the same again changes nothing (nothing to save).
    expect(applyWidgetAskedSize(list, goWidgetKey(clock), { w: 2, h: 3 })).toBe(
      list
    );
    // Once the user has sized it, the widget no longer can.
    const userSized = applyWidgetLayout(list, [
      { key: goWidgetKey(clock), x: 0, y: 0, w: 4, h: 2, sizedBy: 'user' },
    ]);
    expect(
      applyWidgetAskedSize(userSized, goWidgetKey(clock), { w: 1, h: 9 })
    ).toBe(userSized);
  });

  it('cleans what it reads back: fields, duplicates, overlaps', () => {
    expect(
      normalizeSavedWidgets([
        {
          name: ' Clock ',
          identifier: '',
          x: 0,
          y: 0,
          w: 4,
          h: 3,
          title: ' T ',
        },
        { name: 'Clock', identifier: null },
        { name: '' },
        'junk',
        {
          name: 'Torq',
          identifier: 'go-widget-news',
          x: 0,
          y: 1,
          w: 9,
          h: 1,
          sizedBy: 'odd',
        },
      ])
    ).toEqual([
      {
        name: 'Clock',
        identifier: null,
        x: 0,
        y: 0,
        w: 4,
        h: 3,
        sizedBy: 'default',
        title: 'T',
      },
      {
        name: 'Torq',
        identifier: 'go-widget-news',
        x: 0,
        y: 3,
        w: 4,
        h: 2,
        sizedBy: 'default',
      },
    ]);
    expect(normalizeSavedWidgets({})).toEqual([]);
  });
});

describe('widget atoms', () => {
  beforeEach(() => {
    window.localStorage.removeItem(GO_WIDGETS_STORAGE_KEY);
    window.localStorage.removeItem(GO_WIDGETS_ENABLED_STORAGE_KEY);
  });

  it('has the screen on until switched off, and remembers', async () => {
    const store = createStore();
    expect(store.get(goWidgetsEnabledAtom)).toBe(true);
    store.set(goWidgetsEnabledAtom, false);
    expect(window.localStorage.getItem(GO_WIDGETS_ENABLED_STORAGE_KEY)).toBe(
      'false'
    );
    vi.resetModules();
    const fresh = await import('./goWidgets');
    expect(createStore().get(fresh.goWidgetsEnabledAtom)).toBe(false);
  });

  it('saves the list cleaned, and updates it from the current one', () => {
    const store = createStore();
    store.set(savedGoWidgetsAtom, (list) =>
      addSavedWidget(list, { name: 'Clock', identifier: null })
    );
    store.set(savedGoWidgetsAtom, (list) =>
      addSavedWidget(list, { name: 'Torq', identifier: 'go-widget-news' })
    );
    expect(
      JSON.parse(window.localStorage.getItem(GO_WIDGETS_STORAGE_KEY)!).map(
        (w: { name: string; y: number }) => [w.name, w.y]
      )
    ).toEqual([
      ['Clock', 0],
      ['Torq', 5],
    ]);
  });
});
