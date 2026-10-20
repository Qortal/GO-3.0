import { atom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';
import {
  GRID_DEFAULT_H,
  GRID_DEFAULT_W,
  appendGridItem,
  clampRect,
  normalizeLayout,
  removeGridItem,
  resizeGridItem,
  type GridItem,
  type GridRect,
} from './widgetGrid';

/**
 * GO 3.0 widgets: small Q-Apps made for GO, shown on their own screen left
 * of Home (time, weather, news from Torq, ...).
 *
 * A Q-App is a widget when it is published as an APP resource and either
 * - is tagged `go-widget` (any letter case), or
 * - has an identifier starting with `go-widget` (`go-widget-news`), which
 *   lets a name publish its widget next to its main app, and which Core can
 *   filter on the node (identifier prefix search) where tags cannot be.
 *
 * Nothing runs until the user adds it: the screen shows only the widgets in
 * the saved list, and the list only takes what the user picked.
 */
export const GO_WIDGET_TAG = 'go-widget';
export const GO_WIDGET_IDENTIFIER_PREFIX = 'go-widget';

/** One QDN APP resource, as /arbitrary/resources/search lists it. */
export interface QdnAppResource {
  name?: string;
  service?: string;
  identifier?: string | null;
  metadata?: {
    title?: string;
    description?: string;
    tags?: unknown;
  } | null;
  created?: number;
  updated?: number;
}

/** A widget the picker offers. */
export interface GoWidgetListing {
  name: string;
  /** null: the name's default APP resource. */
  identifier: string | null;
  title: string;
  description: string;
  updated: number;
}

/**
 * A widget on the screen: where it sits on the grid (widgetGrid) and how big
 * it is. `sizedBy` says who chose the size: GO's default, the widget (asked
 * through GO_WIDGET_SET_SIZE) or the user (dragged it), whose choice a
 * widget never overrides.
 */
export interface SavedGoWidget extends GridRect {
  name: string;
  identifier: string | null;
  /** Shown while it loads and in its menu. */
  title?: string;
  sizedBy: 'default' | 'widget' | 'user';
}

/** No more than this many widgets on the screen (each is a running Q-App). */
export const GO_WIDGET_LIMIT = 12;

const normalizeIdentifier = (identifier: unknown): string | null =>
  typeof identifier === 'string' &&
  identifier.trim() !== '' &&
  identifier !== 'default'
    ? identifier
    : null;

const hasWidgetTag = (tags: unknown): boolean =>
  Array.isArray(tags) &&
  tags.some(
    (tag) =>
      typeof tag === 'string' && tag.trim().toLowerCase() === GO_WIDGET_TAG
  );

const hasWidgetIdentifier = (identifier: string | null): boolean =>
  identifier !== null &&
  identifier.toLowerCase().startsWith(GO_WIDGET_IDENTIFIER_PREFIX);

/** The listing for `resource` when it is a GO widget, else null. */
export const toGoWidgetListing = (
  resource: QdnAppResource | null | undefined
): GoWidgetListing | null => {
  if (!resource || resource.service !== 'APP') return null;
  const name = typeof resource.name === 'string' ? resource.name.trim() : '';
  if (!name) return null;
  const identifier = normalizeIdentifier(resource.identifier);
  if (
    !hasWidgetTag(resource.metadata?.tags) &&
    !hasWidgetIdentifier(identifier)
  ) {
    return null;
  }
  const title =
    typeof resource.metadata?.title === 'string' &&
    resource.metadata.title.trim()
      ? resource.metadata.title.trim()
      : name;
  const description =
    typeof resource.metadata?.description === 'string'
      ? resource.metadata.description.trim()
      : '';
  return {
    name,
    identifier,
    title,
    description,
    updated: Number(resource.updated ?? resource.created ?? 0) || 0,
  };
};

/** One key per widget: a name may publish several (by identifier). */
export const goWidgetKey = (widget: {
  name: string;
  identifier: string | null;
}): string => `${widget.name}\u0000${widget.identifier ?? ''}`;

type Keyed = SavedGoWidget & { key: string };
const withKeys = (list: readonly SavedGoWidget[]): Keyed[] =>
  list.map((widget) => ({ ...widget, key: goWidgetKey(widget) }));
const withoutKeys = (list: readonly Keyed[]): SavedGoWidget[] =>
  list.map(({ key: _key, ...widget }) => widget);

/** The saved list, cleaned: known fields, no duplicates, no overlaps. */
export const normalizeSavedWidgets = (value: unknown): SavedGoWidget[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SavedGoWidget[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<SavedGoWidget>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;
    const widget: SavedGoWidget = {
      name,
      identifier: normalizeIdentifier(entry.identifier),
      ...clampRect(entry),
      sizedBy:
        entry.sizedBy === 'user' || entry.sizedBy === 'widget'
          ? entry.sizedBy
          : 'default',
    };
    if (typeof entry.title === 'string' && entry.title.trim()) {
      widget.title = entry.title.trim().slice(0, 80);
    }
    const key = goWidgetKey(widget);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(widget);
    if (out.length >= GO_WIDGET_LIMIT) break;
  }
  return withoutKeys(normalizeLayout(withKeys(out)));
};

/** Added under the others, full width, until it or the user sizes it. */
export const addSavedWidget = (
  list: readonly SavedGoWidget[],
  widget: { name: string; identifier: string | null; title?: string }
): SavedGoWidget[] => {
  const key = goWidgetKey(widget);
  if (list.some((saved) => goWidgetKey(saved) === key)) return [...list];
  if (list.length >= GO_WIDGET_LIMIT) return [...list];
  const added: Keyed = {
    key,
    name: widget.name,
    identifier: widget.identifier,
    ...(widget.title ? { title: widget.title } : {}),
    x: 0,
    y: 0,
    w: GRID_DEFAULT_W,
    h: GRID_DEFAULT_H,
    sizedBy: 'default',
  };
  return withoutKeys(appendGridItem(withKeys(list), added));
};

export const removeSavedWidget = (
  list: readonly SavedGoWidget[],
  key: string
): SavedGoWidget[] => withoutKeys(removeGridItem(withKeys(list), key));

/** Every widget's place from a laid-out grid (an edit drag's result). */
export const applyWidgetLayout = (
  list: readonly SavedGoWidget[],
  layout: readonly (GridItem & Partial<Pick<SavedGoWidget, 'sizedBy'>>)[]
): SavedGoWidget[] => {
  const byKey = new Map(layout.map((item) => [item.key, item]));
  return list.map((widget) => {
    const placed = byKey.get(goWidgetKey(widget));
    if (!placed) return widget;
    return {
      ...widget,
      x: placed.x,
      y: placed.y,
      w: placed.w,
      h: placed.h,
      sizedBy: placed.sizedBy ?? widget.sizedBy,
    };
  });
};

/**
 * The size a widget asks for (GO_WIDGET_SET_SIZE), taken only while nobody
 * but GO or the widget itself has sized it; the user's size always stays.
 * The same list back when nothing changes (nothing to save).
 */
export const applyWidgetAskedSize = (
  list: readonly SavedGoWidget[],
  key: string,
  asked: { w?: number | null; h: number }
): SavedGoWidget[] => {
  const widget = list.find((saved) => goWidgetKey(saved) === key);
  if (!widget || widget.sizedBy === 'user') return list as SavedGoWidget[];
  const w = asked.w ?? widget.w;
  if (widget.w === w && widget.h === asked.h) return list as SavedGoWidget[];
  const resized = resizeGridItem(withKeys(list), key, w, asked.h).map((item) =>
    item.key === key ? { ...item, sizedBy: 'widget' as const } : item
  );
  return withoutKeys(resized);
};

/** Device-wide, like the other GO screen settings. */
export const GO_WIDGETS_STORAGE_KEY = 'go_widgets';
export const GO_WIDGETS_ENABLED_STORAGE_KEY = 'go_widgets_enabled';

const localJsonStorage = <T>() =>
  createJSONStorage<T>(() => {
    try {
      return window.localStorage;
    } catch {
      return {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      } as unknown as Storage;
    }
  });

// Read on init so the first frame after login already has the right screens.
const widgetsEnabledStoredAtom = atomWithStorage<unknown>(
  GO_WIDGETS_ENABLED_STORAGE_KEY,
  true,
  localJsonStorage<unknown>(),
  { getOnInit: true }
);

/** Settings → System → Widgets screen (on until switched off). */
export const goWidgetsEnabledAtom = atom(
  (get): boolean => get(widgetsEnabledStoredAtom) !== false,
  (_get, set, next: boolean) => {
    set(widgetsEnabledStoredAtom, Boolean(next));
  }
);

const savedWidgetsStoredAtom = atomWithStorage<unknown>(
  GO_WIDGETS_STORAGE_KEY,
  [],
  localJsonStorage<unknown>(),
  { getOnInit: true }
);

/** The widgets on the screen, with their places. */
export const savedGoWidgetsAtom = atom(
  (get): SavedGoWidget[] => normalizeSavedWidgets(get(savedWidgetsStoredAtom)),
  (
    get,
    set,
    update: SavedGoWidget[] | ((current: SavedGoWidget[]) => SavedGoWidget[])
  ) => {
    const current = normalizeSavedWidgets(get(savedWidgetsStoredAtom));
    const next = typeof update === 'function' ? update(current) : update;
    if (next === current) return;
    set(savedWidgetsStoredAtom, normalizeSavedWidgets(next));
  }
);

/** The widgets screen is being arranged (edit mode): the section swipe and
 * GO's native swipe over widgets step aside meanwhile. */
export const goWidgetsEditingAtom = atom(false);
