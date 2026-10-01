import { forwardRef } from 'react';
import { Box } from '@mui/material';
import { AppViewer } from './AppViewer';
import Frame from 'react-frame-component';
import { appChromeOffsetPx } from '../Desktop/CustomTitleBar';
import { usePageVisible } from '../../hooks/usePageVisible';

type AppViewerContainerProps = {
  app: any;
  isSelected: boolean;
  hide: boolean;
  isDevMode: boolean;
  customHeight?: string;
  fillParent?: boolean;
};

const AppViewerContainer = forwardRef<
  HTMLIFrameElement,
  AppViewerContainerProps
>(({ app, isSelected, hide, isDevMode, customHeight, fillParent = false }, ref) => {
  // Q-App frames are cross-origin, so the phone's page-visibility override
  // does not reach them: while native keep-alive holds the WebView visible in
  // the background, the open Q-App would keep rendering. While GO is off
  // screen (phone only; usePageVisible is always true elsewhere) the frame
  // gets the same display:none an inactive tab gets. That stops its
  // rendering and animation frames and keeps the document loaded, so state
  // and media survive (audio keeps playing); its timers and network keep
  // running. Restored on the next foreground. While a frame is fullscreen
  // (a Q-App video) nothing is hidden.
  const pageVisible = usePageVisible();
  const pausedInBackground =
    !pageVisible &&
    !(
      typeof document !== 'undefined' &&
      document.fullscreenElement?.tagName === 'IFRAME'
    );
  const isHidden = !isSelected || hide || pausedInBackground;
  const frameHeight =
    customHeight || `calc(100dvh - ${appChromeOffsetPx})`;
  const fillShell = fillParent;

  return (
    <Box
      sx={{
        display: isHidden ? 'none' : 'flex',
        flex: fillShell ? 1 : undefined,
        flexDirection: 'column',
        height: fillShell ? '100%' : frameHeight,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        ...(!fillShell && isHidden
          ? {
              left: '-200vw',
              position: 'absolute',
              top: 0,
            }
          : {}),
      }}
    >
      <Frame
        id={`browser-iframe-${app?.tabId}`}
        head={
          <>
            <style>
              {`
              html,
              body {
                height: 100%;
                margin: 0;
                padding: 0;
                overflow: hidden;
                overscroll-behavior: none;
                overflow-anchor: none;
                position: fixed;
                inset: 0;
                width: 100%;
              }
              .frame-root,
              .frame-content {
                display: flex;
                flex-direction: column;
                height: 100%;
                min-height: 0;
                overflow: hidden;
                overscroll-behavior: none;
                overflow-anchor: none;
                width: 100%;
              }
              * {
                box-sizing: border-box;
                -ms-overflow-style: none;
                scrollbar-width: none;
              }
              *::-webkit-scrollbar {
                display: none;
              }
            `}
            </style>
          </>
        }
        style={{
          border: 'none',
          contain: 'layout paint style',
          display: 'block',
          flex: fillShell ? '1 1 auto' : undefined,
          height: fillShell ? '100%' : frameHeight,
          isolation: 'isolate',
          minHeight: fillShell ? 0 : undefined,
          overflow: 'hidden',
          overflowAnchor: 'none',
          overscrollBehavior: 'none',
          width: '100%',
        }}
        tabIndex={-1}
      >
        <AppViewer
          app={app}
          hide={!isSelected || hide}
          isDevMode={isDevMode}
          ref={ref}
        />
      </Frame>
    </Box>
  );
});

export default AppViewerContainer;
