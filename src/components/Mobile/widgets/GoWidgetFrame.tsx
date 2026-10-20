import { Box } from '@mui/material';
import { memo, useEffect, useMemo, useRef } from 'react';
import Frame, { useFrame } from 'react-frame-component';
import { useTranslation } from 'react-i18next';
import { useQortalMessageListener } from '../../../hooks/useQortalMessageListener';
import { getBaseApiReact } from '../../../utils/globalApi';
import { buildQappRenderUrl } from '../../../utils/qappPath';
import { useThemeContext } from '../../Theme/ThemeContext';
import { goWidgetKey, type SavedGoWidget } from './goWidgets';
import {
  GRID_COLUMNS,
  GRID_MAX_H,
  GRID_MIN_H,
  gridColumnsForWidth,
  gridRowsForPx,
} from './widgetGrid';
import {
  GO_WIDGET_INFO,
  GO_WIDGET_SET_SIZE,
  type QappWidgetPolicy,
} from './widgetRequests';

/** Posted to a widget when its screen comes into view or leaves it. */
export const GO_WIDGET_VISIBILITY = 'GO_WIDGET_VISIBILITY';

/** The tab id a widget's requests carry (session permissions are per tab). */
export const goWidgetTabId = (widget: {
  name: string;
  identifier: string | null;
}) => `go-widget:${goWidgetKey(widget).replace('\u0000', ':')}`;

/**
 * The address a widget loads from: its app's /render address with the theme
 * and language every Q-App gets, its identifier, and goWidget=1 so it draws
 * itself as a widget from the first frame. Null for a name that would leave
 * /render/APP/<name> (GO-21).
 */
export const goWidgetUrl = (
  widget: { name: string; identifier: string | null },
  {
    theme,
    language,
    baseUrl,
  }: { theme: string; language: string; baseUrl: string }
): string | null =>
  buildQappRenderUrl({
    baseUrl,
    service: 'APP',
    name: widget.name,
    rest: '',
    query: `?theme=${encodeURIComponent(theme)}&lang=${encodeURIComponent(
      language
    )}&identifier=${
      widget.identifier ? encodeURIComponent(widget.identifier) : ''
    }&goWidget=1`,
  });

/** What a widget asked for with GO_WIDGET_SET_SIZE, in grid cells. */
export const askedWidgetSize = (
  data: Record<string, unknown>
): { w: number | null; h: number } | null => {
  const payload = (data?.payload ?? {}) as Record<string, unknown>;
  const height = Number(data?.height ?? payload.height);
  if (!Number.isFinite(height) || height <= 0) return null;
  return {
    w: gridColumnsForWidth(data?.width ?? payload.width),
    h: gridRowsForPx(height),
  };
};

type GoWidgetFrameProps = {
  widget: SavedGoWidget;
  /** Its screen is the one showing, with GO in the foreground. */
  visible: boolean;
  /** Read at the moment a request comes in (see widgetRequests). */
  isOnScreen: () => boolean;
  /** The frame's size now, in CSS px (for GO_WIDGET_INFO). */
  sizePx: { width: number; height: number };
  /** The widget asked for a size; taken unless the user has sized it. */
  onAskSize: (key: string, size: { w: number | null; h: number }) => void;
  /** Off while the screen is being arranged: GO takes the touches. */
  interactive: boolean;
  /** Bumped to load the widget again. */
  reloadKey: number;
  onLoaded: (key: string) => void;
};

const WidgetDocument = ({
  widget,
  visible,
  isOnScreen,
  sizePx,
  onAskSize,
  interactive,
  reloadKey,
  onLoaded,
}: GoWidgetFrameProps) => {
  const { window: frameWindow } = useFrame();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { themeMode } = useThemeContext();
  const { i18n } = useTranslation();
  const language = i18n.language;
  const key = goWidgetKey(widget);

  // The address is fixed for the frame's life (a reload builds it again):
  // theme and language changes are posted to it, as to any Q-App.
  const url = useMemo(
    () =>
      goWidgetUrl(widget, {
        theme: themeMode,
        language,
        baseUrl: getBaseApiReact(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widget.name, widget.identifier, reloadKey]
  );

  const live = useRef({ visible, sizePx, themeMode, language, widget });
  live.current = { visible, sizePx, themeMode, language, widget };
  const askRef = useRef(onAskSize);
  askRef.current = onAskSize;

  const policy = useMemo<QappWidgetPolicy>(
    () => ({
      isOnScreen,
      answer: (action, data) => {
        const current = live.current;
        if (action === GO_WIDGET_SET_SIZE) {
          const asked = askedWidgetSize(data);
          if (!asked) return { applied: false };
          const userSized = current.widget.sizedBy === 'user';
          if (!userSized) askRef.current(key, asked);
          return { applied: !userSized };
        }
        if (action === GO_WIDGET_INFO) {
          return {
            widget: true,
            platform: 'GO 3.0',
            theme: current.themeMode,
            language: current.language,
            visible: current.visible,
            width: Math.round(current.sizePx.width),
            height: Math.round(current.sizePx.height),
            columns: current.widget.w,
            rows: current.widget.h,
            gridColumns: GRID_COLUMNS,
            minRows: GRID_MIN_H,
            maxRows: GRID_MAX_H,
            sizedBy: current.widget.sizedBy,
          };
        }
        return null;
      },
    }),
    [isOnScreen, key]
  );

  useQortalMessageListener(
    frameWindow,
    iframeRef,
    goWidgetTabId(widget),
    false,
    widget.name,
    'APP',
    widget.identifier ?? undefined,
    policy
  );

  const post = (message: Record<string, unknown>) => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow || !frame.src) return;
    try {
      frame.contentWindow.postMessage(
        { requestedHandler: 'UI', ...message },
        new URL(frame.src).origin
      );
    } catch {
      /* not loaded yet */
    }
  };

  useEffect(() => {
    post({ action: 'THEME_CHANGED', theme: themeMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeMode]);
  useEffect(() => {
    post({ action: 'LANGUAGE_CHANGED', language });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);
  // Lets a widget pause its timers while nobody sees it.
  useEffect(() => {
    post({ action: GO_WIDGET_VISIBILITY, payload: { visible } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A native listener: React's onLoad does not reach a frame rendered into
  // the wrapper frame's document.
  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;
  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const onLoad = () => {
      loadedRef.current(key);
      // What changed while it loaded never reached it: say it again.
      const current = live.current;
      post({ action: 'THEME_CHANGED', theme: current.themeMode });
      post({ action: 'LANGUAGE_CHANGED', language: current.language });
      post({
        action: GO_WIDGET_VISIBILITY,
        payload: { visible: current.visible },
      });
    };
    frame.addEventListener('load', onLoad);
    return () => frame.removeEventListener('load', onLoad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);

  if (!url) return null;
  return (
    <iframe
      ref={iframeRef}
      title={widget.title ?? widget.name}
      src={url}
      // Less than an app tab gets: no pop-up dialogs, downloads, full
      // screen or clipboard (see widgetRequests for what it may ask GO).
      sandbox="allow-scripts allow-same-origin allow-forms"
      allow=""
      tabIndex={-1}
      style={{
        background: 'transparent',
        border: 'none',
        display: 'block',
        height: '100%',
        inset: 0,
        pointerEvents: interactive ? 'auto' : 'none',
        position: 'absolute',
        width: '100%',
      }}
    />
  );
};

/**
 * One widget's Q-App, in a frame of its own (as app tabs are: its messages
 * reach only this frame's listener, with the widget policy).
 */
export const GoWidgetFrame = memo((props: GoWidgetFrameProps) => (
  <Box sx={{ inset: 0, position: 'absolute' }}>
    <Frame
      head={
        <style>
          {`html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: transparent; }
            .frame-root, .frame-content { height: 100%; position: relative; }`}
        </style>
      }
      style={{
        background: 'transparent',
        border: 'none',
        display: 'block',
        height: '100%',
        pointerEvents: props.interactive ? 'auto' : 'none',
        width: '100%',
      }}
      tabIndex={-1}
    >
      <WidgetDocument {...props} />
    </Frame>
  </Box>
));
GoWidgetFrame.displayName = 'GoWidgetFrame';
