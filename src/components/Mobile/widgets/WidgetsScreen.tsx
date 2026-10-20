import {
  Box,
  Button,
  ButtonBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useAtom } from 'jotai';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { usePageVisible } from '../../../hooks/usePageVisible';
import { BACK_PRIORITY, useAndroidBack } from '../../../utils/androidBack';
import { executeEvent } from '../../../utils/events';
import { AppThumbnailAvatar } from '../../Apps/AppThumbnailAvatar';
import { dashboardPanelSx } from '../../Group/dashboardPanelEffects';
import { GO_TAB_BAR_SPACE, withTabBarSpace } from '../mobileBarHeights';
import {
  SECTION_ATTR,
  SECTION_SURFACE_TOUCH_ACTION,
  SECTION_SWIPE_SURFACE_ATTR,
} from '../sectionSwipe/sectionSwipe';
import {
  GO_WIDGET_LIMIT,
  addSavedWidget,
  applyWidgetAskedSize,
  applyWidgetLayout,
  goWidgetKey,
  goWidgetsEditingAtom,
  removeSavedWidget,
  savedGoWidgetsAtom,
  type GoWidgetListing,
  type SavedGoWidget,
} from './goWidgets';
import { GoWidgetFrame } from './GoWidgetFrame';
import {
  GRID_GAP_PX,
  GRID_MAX_H,
  GRID_MIN_H,
  GRID_ROW_PX,
  gridCellAt,
  gridColumnPx,
  gridHeightPx,
  gridRectPx,
  gridSizeFor,
  moveGridItem,
  resizeGridItem,
  type GridItem,
} from './widgetGrid';
import { WidgetPicker } from './WidgetPicker';
import { useWidgetSwipeZone, widgetHoldFeed } from './widgetSwipeZone';

/** Widgets stay loaded this long after their screen was last seen. */
export const WIDGET_UNLOAD_AFTER_MS = 3 * 60_000;
const LONG_PRESS_MS = 450;
const MOVE_SLOP_PX = 8;
const AUTO_SCROLL_EDGE_PX = 72;
const AUTO_SCROLL_MAX_PX = 14;
const GRID_MAX_WIDTH_PX = 560;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const RADIUS_PX = 16;

type LayoutItem = GridItem & { sizedBy: SavedGoWidget['sizedBy'] };

const toLayout = (widgets: readonly SavedGoWidget[]): LayoutItem[] =>
  widgets.map((widget) => ({
    key: goWidgetKey(widget),
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    sizedBy: widget.sizedBy,
  }));

const sameLayout = (a: readonly GridItem[], b: readonly GridItem[]) =>
  a.length === b.length &&
  a.every((item, i) => {
    const other = b[i];
    return (
      other &&
      item.key === other.key &&
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h
    );
  });

interface Drag {
  kind: 'move' | 'resize';
  key: string;
  pointerId: number;
  start: LayoutItem[];
  startX: number;
  startY: number;
  containerLeft: number;
  containerTop: number;
  rect: { left: number; top: number; width: number; height: number };
  lastX: number;
  lastY: number;
  moved: boolean;
  layout: LayoutItem[];
  /** Over the Remove target at the bottom (moving only). */
  overRemove: boolean;
}

/** Where a drag's finger is: a pointer event, or Android's long press. */
type DragPoint = { pointerId: number; clientX: number; clientY: number };
/** The pointer id of a drag Android's long press started. */
const HOLD_POINTER = -1;

type WidgetsScreenProps = {
  /** The widgets screen is the section showing. */
  active: boolean;
};

/**
 * The screen left of Home (phones, GO): the user's widgets on a grid
 * (widgetGrid), each a Q-App made for GO in a frame of its own
 * (GoWidgetFrame). Edit arranges them: drag a widget to move it, its corner
 * to resize it, × to take it away. Widgets load the first time the screen is
 * shown and are let go a few minutes after it was last seen.
 */
export const WidgetsScreen = memo(({ active }: WidgetsScreenProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const tw = (key: string, defaultValue: string, options = {}) =>
    t(`group:widgets.${key}`, { defaultValue, ...options });
  const [widgets, setWidgets] = useAtom(savedGoWidgetsAtom);
  const [editing, setEditing] = useAtom(goWidgetsEditingAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const pageVisible = usePageVisible();
  const live = active && pageVisible;

  // Loaded the first time the screen shows; let go once it has been out of
  // sight a while (each widget is a running Q-App).
  const [framesMounted, setFramesMounted] = useState(false);
  useEffect(() => {
    if (live) {
      setFramesMounted(true);
      return;
    }
    const id = window.setTimeout(
      () => setFramesMounted(false),
      WIDGET_UNLOAD_AFTER_MS
    );
    return () => window.clearTimeout(id);
  }, [live]);

  // Requests that ask or open something only while it is really in view.
  const onScreenRef = useRef(false);
  onScreenRef.current = live && !pickerOpen && !editing;
  const isOnScreen = useCallback(() => onScreenRef.current, []);

  // Leaving the screen ends arranging.
  useEffect(() => {
    if (!active && editing) setEditing(false);
  }, [active, editing, setEditing]);
  useEffect(() => () => setEditing(false), [setEditing]);
  useAndroidBack(
    () => {
      setEditing(false);
      return true;
    },
    { priority: BACK_PRIORITY.overlay, enabled: active && editing }
  );

  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!framesMounted) setLoaded({});
  }, [framesMounted]);
  const onLoaded = useCallback(
    (key: string) => setLoaded((prev) => ({ ...prev, [key]: true })),
    []
  );
  const onAskSize = useCallback(
    (key: string, size: { w: number | null; h: number }) =>
      setWidgets((list) => applyWidgetAskedSize(list, key, size)),
    [setWidgets]
  );

  // Grid geometry.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => setGridWidth(grid.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [widgets.length > 0]);
  const columnPx = gridColumnPx(gridWidth || 1);

  // Horizontal swipes over the widgets switch sections natively (their
  // frames take every touch on them); not while arranging or picking.
  // A long press there arranges (see widgetHoldFeed below), so the zone stays
  // while arranging too; only swipes and long presses are not taken then.
  const claimsRef = useRef(false);
  claimsRef.current = !editing;
  const canClaim = useCallback(() => claimsRef.current, []);
  useWidgetSwipeZone(scrollerRef, active && !pickerOpen, canClaim);

  const savedLayout = useMemo(() => toLayout(widgets), [widgets]);
  const [dragLayout, setDragLayout] = useState<LayoutItem[] | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<Drag['kind'] | null>(null);
  const layout = dragLayout ?? savedLayout;
  const layoutByKey = useMemo(
    () => new Map(layout.map((item) => [item.key, item])),
    [layout]
  );

  const cardRefs = useRef(new Map<string, HTMLDivElement | null>());
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const autoScrollRef = useRef<number | null>(null);

  const [menu, setMenu] = useState<{
    key: string;
    anchor: HTMLElement;
  } | null>(null);

  const stopAutoScroll = () => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  };

  /** Works the drag out from where the finger is now. */
  const follow = () => {
    const drag = dragRef.current;
    const grid = gridRef.current;
    if (!drag || !grid) return;
    const box = grid.getBoundingClientRect();
    // The grid moves with the page as it scrolls under a held widget.
    const dx = drag.lastX - drag.startX - (box.left - drag.containerLeft);
    const dy = drag.lastY - drag.startY - (box.top - drag.containerTop);
    const item = drag.start.find((entry) => entry.key === drag.key);
    if (!item) return;
    let next: LayoutItem[];
    if (drag.kind === 'move') {
      const left = drag.rect.left + dx;
      const top = drag.rect.top + dy;
      const card = cardRefs.current.get(drag.key);
      if (card) {
        card.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${
          drag.overRemove ? 0.9 : 1.03
        })`;
        card.style.opacity = drag.overRemove ? '0.55' : '';
      }
      const cell = gridCellAt(left, top, columnPx, item.w);
      next = moveGridItem(drag.start, drag.key, cell.x, cell.y);
    } else {
      const maxWidth = gridWidth - drag.rect.left;
      const width = Math.max(
        columnPx,
        Math.min(maxWidth, drag.rect.width + dx)
      );
      const height = Math.max(
        GRID_MIN_H * GRID_ROW_PX + (GRID_MIN_H - 1) * GRID_GAP_PX,
        Math.min(
          GRID_MAX_H * GRID_ROW_PX + (GRID_MAX_H - 1) * GRID_GAP_PX,
          drag.rect.height + dy
        )
      );
      const ghost = ghostRef.current;
      if (ghost) {
        ghost.style.width = `${width}px`;
        ghost.style.height = `${height}px`;
      }
      const size = gridSizeFor(width, height, columnPx, item.x);
      next = resizeGridItem(drag.start, drag.key, size.w, size.h).map(
        (entry) =>
          entry.key === drag.key
            ? { ...entry, sizedBy: 'user' as const }
            : entry
      );
    }
    if (!sameLayout(next, drag.layout)) {
      drag.layout = next;
      setDragLayout(next);
    }
  };

  /** Near the top or bottom edge, the page scrolls under a held widget. */
  const autoScroll = () => {
    autoScrollRef.current = null;
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    if (!drag || !scroller) return;
    const box = scroller.getBoundingClientRect();
    let speed = 0;
    if (drag.lastY < box.top + AUTO_SCROLL_EDGE_PX) {
      speed = -(
        (box.top + AUTO_SCROLL_EDGE_PX - drag.lastY) /
        AUTO_SCROLL_EDGE_PX
      );
    } else if (drag.lastY > box.bottom - AUTO_SCROLL_EDGE_PX) {
      speed =
        (drag.lastY - (box.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX;
    }
    if (speed === 0) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += Math.max(-1, Math.min(1, speed)) * AUTO_SCROLL_MAX_PX;
    if (scroller.scrollTop !== before) follow();
    autoScrollRef.current = requestAnimationFrame(autoScroll);
  };

  /** The widget is held: from here it follows the finger. */
  const lift = (drag: Drag) => {
    drag.moved = true;
    setDragKey(drag.key);
    setDragKind(drag.kind);
    setDragLayout(drag.start);
    setMenu(null);
  };

  const startDrag = (
    point: DragPoint,
    key: string,
    kind: Drag['kind'],
    lifted = false
  ) => {
    const grid = gridRef.current;
    const item = savedLayout.find((entry) => entry.key === key);
    if (!grid || !item) return;
    const box = grid.getBoundingClientRect();
    const drag: Drag = {
      kind,
      key,
      pointerId: point.pointerId,
      start: savedLayout,
      startX: point.clientX,
      startY: point.clientY,
      containerLeft: box.left,
      containerTop: box.top,
      rect: gridRectPx(item, columnPx),
      lastX: point.clientX,
      lastY: point.clientY,
      moved: false,
      layout: savedLayout,
      overRemove: false,
    };
    dragRef.current = drag;
    if (lifted) {
      lift(drag);
      follow();
    }
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    key: string,
    kind: Drag['kind']
  ) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();
    try {
      // The finger stays this element's even when it leaves it.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* not a live pointer: the moves still come while it is over it */
    }
    startDrag(event, key, kind);
  };

  const removeTargetRef = useRef<HTMLDivElement | null>(null);
  const [overRemove, setOverRemove] = useState(false);

  const moveDrag = (point: DragPoint) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== point.pointerId) return;
    drag.lastX = point.clientX;
    drag.lastY = point.clientY;
    if (!drag.moved) {
      if (
        Math.hypot(point.clientX - drag.startX, point.clientY - drag.startY) <
        MOVE_SLOP_PX
      ) {
        return;
      }
      lift(drag);
    }
    // Dragged onto the Remove target at the bottom.
    if (drag.kind === 'move') {
      const target = removeTargetRef.current?.getBoundingClientRect();
      const over = Boolean(
        target &&
        target.width > 0 &&
        point.clientY >= target.top - 12 &&
        point.clientY <= target.bottom + 24 &&
        point.clientX >= target.left - 24 &&
        point.clientX <= target.right + 24
      );
      if (over !== drag.overRemove) {
        drag.overRemove = over;
        setOverRemove(over);
      }
    }
    follow();
    if (autoScrollRef.current === null && !drag.overRemove) {
      autoScrollRef.current = requestAnimationFrame(autoScroll);
    }
  };

  const endDrag = (point: DragPoint, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== point.pointerId) return;
    dragRef.current = null;
    stopAutoScroll();
    setOverRemove(false);
    if (!drag.moved) {
      // A tap on a widget while arranging: its menu.
      if (!cancelled && drag.kind === 'move') {
        const card = cardRefs.current.get(drag.key);
        if (card) setMenu({ key: drag.key, anchor: card });
      }
      return;
    }
    const card = cardRefs.current.get(drag.key);
    if (!cancelled && drag.overRemove) {
      setWidgets((list) => removeSavedWidget(list, drag.key));
    } else if (!cancelled) {
      const result = drag.layout;
      setWidgets((list) => applyWidgetLayout(list, result));
    }
    // The held card glides from under the finger into its place.
    if (card) {
      card.style.transform = '';
      card.style.opacity = '';
    }
    setDragLayout(null);
    setDragKey(null);
    setDragKind(null);
  };

  // Android's long press on the screen (widgetSwipeZone): arranging starts,
  // and a widget under the finger is picked up to move (or drop on Remove).
  const holdRef = useRef({ startDrag, moveDrag, endDrag });
  holdRef.current = { startDrag, moveDrag, endDrag };
  useEffect(
    () =>
      widgetHoldFeed.subscribe((touch) => {
        const point = {
          pointerId: HOLD_POINTER,
          clientX: touch.x,
          clientY: touch.y,
        };
        const {
          startDrag: start,
          moveDrag: move,
          endDrag: end,
        } = holdRef.current;
        if (touch.type === 'hold') {
          if (pressRef.current) window.clearTimeout(pressRef.current.timer);
          pressRef.current = null;
          setEditing(true);
          const card = document
            .elementFromPoint(touch.x, touch.y)
            ?.closest<HTMLElement>('[role="listitem"]');
          const key = [...cardRefs.current].find(
            ([, node]) => node && node === card
          )?.[0];
          if (key) start(point, key, 'move', true);
        } else if (touch.type === 'move') {
          move(point);
        } else {
          end(point, touch.type === 'cancel');
        }
      }),
    [setEditing]
  );

  useEffect(() => () => stopAutoScroll(), []);

  // A long press on the screen's empty space starts arranging.
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const cancelPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };
  const onBackgroundPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (editing || widgets.length === 0) return;
    if (event.target !== event.currentTarget) return;
    cancelPress();
    pressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        pressRef.current = null;
        setEditing(true);
      }, LONG_PRESS_MS),
    };
  };
  const onBackgroundPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const press = pressRef.current;
    if (
      press &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) >
        MOVE_SLOP_PX
    ) {
      cancelPress();
    }
  };

  const addWidget = (listing: GoWidgetListing) => {
    setWidgets((list) =>
      addSavedWidget(list, {
        name: listing.name,
        identifier: listing.identifier,
        title: listing.title,
      })
    );
    setPickerOpen(false);
    // The new one is at the bottom: show it.
    window.setTimeout(() => {
      const scroller = scrollerRef.current;
      scroller?.scrollTo?.({ top: scroller.scrollHeight, behavior: 'smooth' });
    }, 80);
  };

  const removeWidget = (key: string) => {
    setMenu(null);
    setWidgets((list) => removeSavedWidget(list, key));
  };

  const reloadWidget = (key: string) => {
    setMenu(null);
    setLoaded((prev) => ({ ...prev, [key]: false }));
    setReloadKeys((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  };

  const openWidgetApp = (widget: SavedGoWidget) => {
    setMenu(null);
    setEditing(false);
    // The name's own app (the widget itself when it is that app).
    executeEvent('addTab', { data: { service: 'APP', name: widget.name } });
  };

  useEffect(() => {
    if (!editing) setMenu(null);
  }, [editing]);

  const isDark = theme.palette.mode === 'dark';
  const rows = gridHeightPx(layout);
  const draggedItem = dragKey ? layoutByKey.get(dragKey) : undefined;
  // Room below while moving one, to drop it under the others.
  const gridHeight =
    rows +
    (dragKind === 'move' && draggedItem
      ? (draggedItem.h + 1) * (GRID_ROW_PX + GRID_GAP_PX)
      : 0);
  const menuWidget = menu
    ? widgets.find((widget) => goWidgetKey(widget) === menu.key)
    : undefined;

  return (
    <Box
      {...{ [SECTION_ATTR]: 'widgets' }}
      // React's own hiding (the section swipe shows it beside the others).
      style={active ? undefined : { display: 'none' }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      {/* Only the widgets: no title or buttons. Holding an empty spot
          arranges them (and offers Add); an empty screen offers Add. */}
      <Box
        ref={scrollerRef}
        {...{ [SECTION_SWIPE_SURFACE_ATTR]: '' }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onBackgroundPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        sx={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          overscrollBehaviorY: 'contain',
          // Room for the edit bar while arranging.
          pb: editing
            ? withTabBarSpace(104, '104px')
            : withTabBarSpace(28, '28px'),
          pt: '16px',
          px: '12px',
          scrollbarGutter: 'stable',
          touchAction: SECTION_SURFACE_TOUCH_ACTION,
          width: '100%',
        }}
      >
        <Box
          sx={{ maxWidth: GRID_MAX_WIDTH_PX, width: '100%' }}
          onPointerDown={onBackgroundPointerDown}
        >
          {widgets.length === 0 ? (
            <EmptyWidgets onAdd={() => setPickerOpen(true)} />
          ) : (
            <Box
              ref={gridRef}
              role="list"
              aria-label={tw('title', 'Widgets')}
              onPointerDown={onBackgroundPointerDown}
              sx={{
                height: gridHeight,
                position: 'relative',
                transition: dragKind ? 'none' : `height 220ms ${EASE}`,
                width: '100%',
              }}
            >
              {/* Where the held widget will land. */}
              {draggedItem && gridWidth > 0 ? (
                <Box
                  aria-hidden
                  sx={{
                    border: `2px dashed ${alpha(theme.palette.primary.main, 0.6)}`,
                    borderRadius: `${RADIUS_PX}px`,
                    backgroundColor: alpha(theme.palette.primary.main, 0.06),
                    left: 0,
                    pointerEvents: 'none',
                    position: 'absolute',
                    top: 0,
                    transition: `transform 160ms ${EASE}, width 160ms ${EASE}, height 160ms ${EASE}`,
                    ...(() => {
                      const px = gridRectPx(draggedItem, columnPx);
                      return {
                        height: px.height,
                        transform: `translate3d(${px.left}px, ${px.top}px, 0)`,
                        width: px.width,
                      };
                    })(),
                  }}
                />
              ) : null}
              {gridWidth > 0
                ? widgets.map((widget) => {
                    const key = goWidgetKey(widget);
                    const item = layoutByKey.get(key) ?? widget;
                    // A resize shows its finger-sized outline; the widget
                    // itself keeps its size until let go.
                    const sizeItem =
                      dragKind === 'resize' && dragKey === key
                        ? (savedLayout.find((entry) => entry.key === key) ??
                          item)
                        : item;
                    const px = gridRectPx(item, columnPx);
                    const sizePx = gridRectPx(sizeItem, columnPx);
                    const held = dragKey === key && dragKind === 'move';
                    return (
                      <Box
                        key={key}
                        role="listitem"
                        aria-label={widget.title ?? widget.name}
                        ref={(node: HTMLDivElement | null) => {
                          cardRefs.current.set(key, node);
                        }}
                        sx={{
                          ...dashboardPanelSx(theme, 'base'),
                          borderRadius: `${RADIUS_PX}px`,
                          height: sizePx.height,
                          left: 0,
                          position: 'absolute',
                          top: 0,
                          transform: held
                            ? undefined
                            : `translate3d(${px.left}px, ${px.top}px, 0)`,
                          transition: held
                            ? 'box-shadow 160ms ease'
                            : `transform 220ms ${EASE}, width 180ms ${EASE}, height 180ms ${EASE}, box-shadow 160ms ease`,
                          width: sizePx.width,
                          willChange: dragKind ? 'transform' : undefined,
                          zIndex: held ? 5 : dragKey === key ? 4 : 1,
                          ...(held
                            ? {
                                boxShadow: isDark
                                  ? '0 18px 36px rgba(0,0,0,0.55)'
                                  : '0 18px 36px rgba(15,20,30,0.25)',
                              }
                            : {}),
                        }}
                      >
                        {/* The panel style makes its direct children
                          position: relative; everything of the card
                          sits in this one full-size box instead. */}
                        <Box
                          sx={{
                            height: '100%',
                            position: 'relative',
                            width: '100%',
                          }}
                        >
                          <Box
                            sx={{
                              borderRadius: `${RADIUS_PX}px`,
                              inset: 0,
                              overflow: 'hidden',
                              position: 'absolute',
                            }}
                          >
                            {framesMounted ? (
                              <GoWidgetFrame
                                widget={widget}
                                visible={live && !pickerOpen}
                                isOnScreen={isOnScreen}
                                sizePx={sizePx}
                                onAskSize={onAskSize}
                                interactive={!editing}
                                reloadKey={reloadKeys[key] ?? 0}
                                onLoaded={onLoaded}
                              />
                            ) : null}
                            <WidgetPlaceholder
                              widget={widget}
                              shown={!framesMounted || !loaded[key]}
                            />
                          </Box>
                          {editing ? (
                            <>
                              {/* GO takes the touches while arranging: move. */}
                              <Box
                                data-widget-drag=""
                                onPointerDown={(event) =>
                                  beginDrag(event, key, 'move')
                                }
                                onPointerMove={moveDrag}
                                onPointerUp={(event) => endDrag(event)}
                                onPointerCancel={(event) =>
                                  endDrag(event, true)
                                }
                                sx={{
                                  backgroundColor: alpha(
                                    theme.palette.background.default,
                                    0.18
                                  ),
                                  border: `1.5px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                                  borderRadius: `${RADIUS_PX}px`,
                                  cursor: held ? 'grabbing' : 'grab',
                                  inset: 0,
                                  position: 'absolute',
                                  touchAction: 'none',
                                }}
                              />
                              <ButtonBase
                                aria-label={tw('remove', 'Remove')}
                                onClick={() => removeWidget(key)}
                                sx={{
                                  alignItems: 'center',
                                  backgroundColor:
                                    theme.palette.background.paper,
                                  border: `1px solid ${alpha(theme.palette.text.primary, 0.18)}`,
                                  borderRadius: '50%',
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                  color: 'text.primary',
                                  display: 'flex',
                                  height: 28,
                                  justifyContent: 'center',
                                  left: -8,
                                  position: 'absolute',
                                  top: -8,
                                  width: 28,
                                  zIndex: 2,
                                }}
                              >
                                <CloseRoundedIcon sx={{ fontSize: 17 }} />
                              </ButtonBase>
                              {/* Resize: the corner handle. */}
                              <Box
                                role="button"
                                aria-label={tw('resize', 'Resize')}
                                onPointerDown={(event) =>
                                  beginDrag(event, key, 'resize')
                                }
                                onPointerMove={moveDrag}
                                onPointerUp={(event) => endDrag(event)}
                                onPointerCancel={(event) =>
                                  endDrag(event, true)
                                }
                                sx={{
                                  bottom: -6,
                                  cursor: 'nwse-resize',
                                  height: 36,
                                  position: 'absolute',
                                  right: -6,
                                  touchAction: 'none',
                                  width: 36,
                                  zIndex: 2,
                                  '&::after': {
                                    backgroundColor:
                                      theme.palette.background.paper,
                                    border: `2px solid ${theme.palette.primary.main}`,
                                    borderRadius: '50%',
                                    bottom: 8,
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                    content: '""',
                                    height: 16,
                                    position: 'absolute',
                                    right: 8,
                                    width: 16,
                                  },
                                }}
                              />
                            </>
                          ) : null}
                        </Box>
                      </Box>
                    );
                  })
                : null}
              {/* A resize's outline, under the finger. */}
              {dragKind === 'resize' && dragKey ? (
                <Box
                  ref={ghostRef}
                  aria-hidden
                  sx={{
                    border: `2px solid ${theme.palette.primary.main}`,
                    borderRadius: `${RADIUS_PX}px`,
                    left: 0,
                    pointerEvents: 'none',
                    position: 'absolute',
                    top: 0,
                    zIndex: 6,
                    ...(() => {
                      const start = savedLayout.find(
                        (entry) => entry.key === dragKey
                      );
                      if (!start) return {};
                      const px = gridRectPx(start, columnPx);
                      return {
                        height: px.height,
                        transform: `translate3d(${px.left}px, ${px.top}px, 0)`,
                        width: px.width,
                      };
                    })(),
                  }}
                />
              ) : null}
            </Box>
          )}
        </Box>
      </Box>

      <AnimatePresence>
        {dragKind === 'move' ? (
          <motion.div
            key="remove-target"
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 18 }}
            transition={{
              duration: reduceMotion ? 0 : 0.18,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{
              bottom: `calc(18px + ${GO_TAB_BAR_SPACE})`,
              display: 'flex',
              justifyContent: 'center',
              left: 0,
              pointerEvents: 'none',
              position: 'absolute',
              right: 0,
              zIndex: 10,
            }}
          >
            <Box
              ref={removeTargetRef}
              role="status"
              aria-live="polite"
              sx={{
                alignItems: 'center',
                backdropFilter: 'blur(14px) saturate(140%)',
                backgroundColor: overRemove
                  ? theme.palette.error.main
                  : isDark
                    ? alpha(theme.palette.background.paper, 0.82)
                    : alpha(theme.palette.background.paper, 0.92),
                border: `1px solid ${
                  overRemove
                    ? theme.palette.error.main
                    : alpha(theme.palette.error.main, 0.55)
                }`,
                borderRadius: 999,
                boxShadow: isDark
                  ? '0 8px 24px rgba(0,0,0,0.5)'
                  : '0 8px 24px rgba(15,20,30,0.18)',
                color: overRemove
                  ? theme.palette.error.contrastText
                  : theme.palette.error.main,
                display: 'flex',
                fontSize: '0.9rem',
                fontWeight: 700,
                gap: 1,
                px: 3,
                py: 1.25,
                transform: overRemove ? 'scale(1.08)' : 'none',
                transition:
                  'transform 140ms ease, background-color 140ms ease, color 140ms ease',
              }}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
              {tw('remove', 'Remove')}
            </Box>
          </motion.div>
        ) : editing ? (
          <motion.div
            key="edit-bar"
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 18 }}
            transition={{
              duration: reduceMotion ? 0 : 0.2,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{
              bottom: `calc(18px + ${GO_TAB_BAR_SPACE})`,
              display: 'flex',
              justifyContent: 'center',
              left: 0,
              pointerEvents: 'none',
              position: 'absolute',
              right: 0,
              zIndex: 10,
            }}
          >
            <Box
              sx={{
                backdropFilter: 'blur(14px) saturate(140%)',
                backgroundColor: isDark
                  ? alpha(theme.palette.background.paper, 0.78)
                  : alpha(theme.palette.background.paper, 0.9),
                border: `1px solid ${alpha(theme.palette.text.primary, isDark ? 0.12 : 0.1)}`,
                borderRadius: 999,
                boxShadow: isDark
                  ? '0 8px 24px rgba(0,0,0,0.5)'
                  : '0 8px 24px rgba(15,20,30,0.18)',
                display: 'flex',
                gap: 0.75,
                p: 0.75,
                pointerEvents: 'auto',
              }}
            >
              <Button
                startIcon={<AddRoundedIcon />}
                disabled={widgets.length >= GO_WIDGET_LIMIT}
                onClick={() => {
                  setEditing(false);
                  setPickerOpen(true);
                }}
                sx={{ borderRadius: 999, fontWeight: 700, px: 2 }}
              >
                {tw('add', 'Add widget')}
              </Button>
              <Button
                variant="contained"
                startIcon={<CheckRoundedIcon />}
                onClick={() => setEditing(false)}
                sx={{ borderRadius: 999, fontWeight: 700, px: 2 }}
              >
                {tw('done', 'Done')}
              </Button>
            </Box>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Menu
        anchorEl={menu?.anchor ?? null}
        open={Boolean(menu && menuWidget)}
        onClose={() => setMenu(null)}
        anchorOrigin={{ horizontal: 'center', vertical: 'center' }}
        transformOrigin={{ horizontal: 'center', vertical: 'top' }}
      >
        {menuWidget
          ? [
              <MenuItem key="open" onClick={() => openWidgetApp(menuWidget)}>
                <ListItemIcon>
                  <OpenInNewRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>
                  {tw('open_app', 'Open {{name}}', { name: menuWidget.name })}
                </ListItemText>
              </MenuItem>,
              <MenuItem key="reload" onClick={() => reloadWidget(menu!.key)}>
                <ListItemIcon>
                  <RefreshRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{tw('reload', 'Reload')}</ListItemText>
              </MenuItem>,
              <MenuItem key="remove" onClick={() => removeWidget(menu!.key)}>
                <ListItemIcon>
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{tw('remove', 'Remove')}</ListItemText>
              </MenuItem>,
            ]
          : null}
      </Menu>

      <WidgetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        added={widgets}
        onAdd={addWidget}
      />
    </Box>
  );
});
WidgetsScreen.displayName = 'WidgetsScreen';

/** The widget's icon and name, until its Q-App has drawn itself. */
const WidgetPlaceholder = ({
  widget,
  shown,
}: {
  widget: SavedGoWidget;
  shown: boolean;
}) => (
  <Box
    aria-hidden
    sx={{
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: 0.75,
      inset: 0,
      justifyContent: 'center',
      opacity: shown ? 1 : 0,
      pointerEvents: 'none',
      position: 'absolute',
      transition: 'opacity 220ms ease',
    }}
  >
    <AppThumbnailAvatar
      appName={widget.name}
      fallbackSize={18}
      sx={{ height: 30, width: 30 }}
    />
    {widget.h > 2 ? (
      <Typography
        noWrap
        sx={{
          color: 'text.secondary',
          fontSize: '0.72rem',
          fontWeight: 600,
          maxWidth: '90%',
        }}
      >
        {widget.title ?? widget.name}
      </Typography>
    ) : null}
  </Box>
);

/** No widgets yet: only a round + to add one, and how arranging works. */
const EmptyWidgets = ({ onAdd }: { onAdd: () => void }) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        justifyContent: 'center',
        minHeight: '55vh',
        textAlign: 'center',
      }}
    >
      <ButtonBase
        onClick={onAdd}
        sx={{
          alignItems: 'center',
          borderRadius: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 1,
          '&:active .widgets-add-circle': { transform: 'scale(0.94)' },
        }}
      >
        <Box
          className="widgets-add-circle"
          sx={{
            alignItems: 'center',
            backdropFilter: 'blur(14px) saturate(140%)',
            backgroundColor: isDark
              ? alpha(theme.palette.background.paper, 0.72)
              : alpha(theme.palette.background.paper, 0.86),
            border: `1px solid ${alpha(theme.palette.primary.main, 0.45)}`,
            borderRadius: '50%',
            boxShadow: isDark
              ? '0 8px 22px rgba(0,0,0,0.45)'
              : '0 8px 22px rgba(15,20,30,0.16)',
            color: 'primary.main',
            display: 'flex',
            height: 72,
            justifyContent: 'center',
            transition: 'transform 120ms ease',
            width: 72,
          }}
        >
          <AddRoundedIcon sx={{ fontSize: 38 }} />
        </Box>
        <Typography
          component="span"
          sx={{ color: 'text.primary', fontSize: '0.9rem', fontWeight: 700 }}
        >
          {t('group:widgets.add', { defaultValue: 'Add widget' })}
        </Typography>
      </ButtonBase>
      <Typography
        sx={{
          color: 'text.secondary',
          fontSize: '0.74rem',
          lineHeight: 1.45,
          maxWidth: 260,
          opacity: 0.8,
        }}
      >
        {t('group:widgets.empty_hint', {
          defaultValue:
            'Later, hold a widget or an empty spot to add, move or resize widgets. Drag one down to Remove to take it away.',
        })}
      </Typography>
    </Box>
  );
};
