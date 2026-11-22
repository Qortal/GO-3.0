import {
  forwardRef,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Box } from '@mui/material';
import { getBaseApiReact } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { useFrame } from 'react-frame-component';
import { useQortalMessageListener } from '../../hooks/useQortalMessageListener';
import { useThemeContext } from '../Theme/ThemeContext';
import { useTranslation } from 'react-i18next';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { appHeighOffsetPx } from '../Desktop/CustomTitleBar';
import { buildQappRenderUrl, isSafeQappPath } from '../../utils/qappPath';
import { buildPreviewUrl } from './appPreviewUrl';
import { useSetAtom } from 'jotai';
import { infoSnackGlobalAtom, openSnackGlobalAtom } from '../../atoms/global';
import { useQappPublishWindowBridge } from './useQappPublishWindowBridge';

const identifierParam = (identifier: unknown): string =>
  identifier != null && identifier != 'null'
    ? encodeURIComponent(String(identifier))
    : '';

type AppViewerProps = {
  app: any;
  hide: boolean;
  isDevMode: boolean;
};

export const AppViewer = forwardRef<HTMLIFrameElement, AppViewerProps>(
  ({ app, hide, isDevMode }, iframeRef) => {
    const { window: frameWindow } = useFrame();
    const { path, history, changeCurrentIndex, resetHistory } =
      useQortalMessageListener(
        frameWindow,
        iframeRef,
        app?.tabId,
        isDevMode,
        isDevMode ? 'devapp' : app?.name,
        app?.service,
        app?.identifier
      );

    const [url, setUrl] = useState('');
    const { themeMode } = useThemeContext();
    const { i18n, t } = useTranslation(['auth', 'core', 'group', 'question']);
    const currentLang = i18n.language;
    const setInfoSnackGlobal = useSetAtom(infoSnackGlobalAtom);
    const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);

    // GO-21: every node /render URL is built here, with the name and each path
    // segment encoded. A name or path that would leave /render/<SERVICE>/<name>
    // gives null, and the tab does not load another publisher's app.
    const renderUrl = (rest: string, query: string): string | null => {
      const built = buildQappRenderUrl({
        baseUrl: getBaseApiReact(),
        service: app?.service,
        name: app?.name,
        rest,
        query,
      });
      if (built === null) {
        console.warn('Refused a Q-App URL outside its own path', {
          name: app?.name,
          service: app?.service,
        });
        setInfoSnackGlobal({
          type: 'error',
          message: t('auth:message.error.invalid_qortal_link', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnackGlobal(true);
      }
      return built;
    };

    useEffect(() => {
      if (app?.isPreview) return;
      if (isDevMode) {
        setUrl(app?.url + `?theme=${themeMode}&lang=${currentLang}`);
        return;
      }
      let hasQueryParam = false;
      if (app?.path && app.path.includes('?')) {
        hasQueryParam = true;
      }

      setUrl(
        renderUrl(
          app?.path != null ? `/${app?.path}` : '',
          `${hasQueryParam ? '&' : '?'}theme=${themeMode}&lang=${currentLang}&identifier=${identifierParam(app?.identifier)}`
        ) ?? ''
      );
    }, [app?.service, app?.name, app?.identifier, app?.path, app?.isPreview]);

    useEffect(() => {
      if (app?.isPreview && app?.url) {
        resetHistory();
        // A private app built on the phone has no query of its own yet.
        setUrl(
          buildPreviewUrl(app.url, {
            language: currentLang,
            theme: themeMode,
          })
        );
      }
    }, [app?.url, app?.isPreview]);

    const defaultUrl = useMemo(() => {
      return url;
    }, [url, isDevMode]);

    const refreshAppFunc = (e) => {
      const { tabId } = e.detail;
      if (tabId === app?.tabId) {
        // A preview (a private app) reloads its own address; building a
        // /render/<service>/<name> address would show its encrypted file.
        if (app?.isPreview && app?.url) {
          resetHistory();
          setUrl(
            buildPreviewUrl(app.url, {
              cacheBuster: Date.now(),
              language: currentLang,
              theme: themeMode,
            })
          );
          return;
        }
        if (isDevMode) {
          resetHistory();
          setUrl(
            buildPreviewUrl(app?.url, {
              cacheBuster: Date.now(),
              language: currentLang,
              theme: themeMode,
            })
          );
          return;
        }
        const constructUrl = renderUrl(
          path != null ? path : '',
          `?theme=${themeMode}&lang=${currentLang}&identifier=${app?.identifier != null ? encodeURIComponent(app.identifier) : ''}&time=${new Date().getMilliseconds()}`
        );
        if (constructUrl) setUrl(constructUrl);
      }
    };

    useEffect(() => {
      subscribeToEvent('refreshApp', refreshAppFunc);

      return () => {
        unsubscribeFromEvent('refreshApp', refreshAppFunc);
      };
    }, [app, path, isDevMode, themeMode, currentLang]);

    useEffect(() => {
      const iframe = iframeRef?.current;
      if (!iframe || !iframe?.src) return;

      try {
        const targetOrigin = new URL(iframe.src).origin;
        iframe.contentWindow?.postMessage(
          { action: 'THEME_CHANGED', theme: themeMode, requestedHandler: 'UI' },
          targetOrigin
        );
      } catch (err) {
        console.error('Failed to send theme change to iframe:', err);
      }
    }, [themeMode]);

    useEffect(() => {
      const iframe = iframeRef?.current;
      if (!iframe || !iframe?.src) return;

      try {
        const targetOrigin = new URL(iframe.src).origin;
        iframe.contentWindow?.postMessage(
          {
            action: 'LANGUAGE_CHANGED',
            language: currentLang,
            requestedHandler: 'UI',
          },
          targetOrigin
        );
      } catch (err) {
        console.error('Failed to send language change to iframe:', err);
      }
    }, [currentLang]);

    const removeTrailingSlash = (str) => str.replace(/\/$/, '');

    const copyLinkFunc = (e) => {
      const { tabId } = e.detail;
      if (tabId === app?.tabId) {
        let link =
          QORTAL_PROTOCOL + app?.service + '/' + app?.name.replace(/ /g, '%20');
        if (path && path.startsWith('/')) {
          link = link + removeTrailingSlash(path);
        }
        if (path && !path.startsWith('/')) {
          link = link + '/' + removeTrailingSlash(path);
        }
        navigator.clipboard
          .writeText(link)
          .then(() => undefined)
          .catch((error) => {
            console.error('Failed to copy path:', error);
          });
      }
    };

    useEffect(() => {
      subscribeToEvent('copyLink', copyLinkFunc);

      return () => {
        unsubscribeFromEvent('copyLink', copyLinkFunc);
      };
    }, [app, path]);

    const receiveChunksFunc = useCallback(
      (e) => {
        const iframe = iframeRef?.current;
        if (!iframe || !iframe?.src) return;
        if (app?.tabId !== e.detail?.tabId) return;
        const publishLocation = e.detail?.publishLocation;
        const chunksSubmitted = e.detail?.chunksSubmitted;
        const totalChunks = e.detail?.totalChunks;
        const retry = e.detail?.retry;
        const filename = e.detail?.filename;
        try {
          if (publishLocation === undefined || publishLocation === null) return;
          const dataToBeSent = {};
          if (chunksSubmitted !== undefined && chunksSubmitted !== null) {
            dataToBeSent.chunks = chunksSubmitted;
          }
          if (totalChunks !== undefined && totalChunks !== null) {
            dataToBeSent.totalChunks = totalChunks;
          }
          if (retry !== undefined && retry !== null) {
            dataToBeSent.retry = retry;
          }
          if (filename !== undefined && filename !== null) {
            dataToBeSent.filename = filename;
          }
          const targetOrigin = new URL(iframe.src).origin;
          iframe.contentWindow?.postMessage(
            {
              action: 'PUBLISH_STATUS',
              publishLocation,
              ...dataToBeSent,
              requestedHandler: 'UI',
              processed: e.detail?.processed || false,
            },
            targetOrigin
          );
        } catch (err) {
          console.error('Failed to send status to iframe:', err);
        }
      },
      [iframeRef, app?.tabId]
    );

    useEffect(() => {
      subscribeToEvent('receiveChunks', receiveChunksFunc);

      return () => {
        unsubscribeFromEvent('receiveChunks', receiveChunksFunc);
      };
    }, [receiveChunksFunc]);

    // GO's publish window takes the app's own one off the screen meanwhile.
    useQappPublishWindowBridge(
      iframeRef as MutableRefObject<HTMLIFrameElement | null>,
      app?.tabId
    );

    // Function to navigate back in iframe
    const navigateBackInIframe = async () => {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow && history?.currentIndex > 0) {
        // Calculate the previous index and path
        const previousPageIndex = history.currentIndex - 1;
        const previousPath = history.customQDNHistoryPaths[previousPageIndex];
        let targetOrigin;
        try {
          targetOrigin = new URL(iframe.src).origin;
        } catch {
          return;
        }
        // Signal non-manual navigation
        iframe.contentWindow.postMessage(
          { action: 'PERFORMING_NON_MANUAL', currentIndex: previousPageIndex },
          targetOrigin
        );
        // Update the current index locally
        changeCurrentIndex(previousPageIndex);

        // Create a navigation promise with a 200ms timeout
        const navigationPromise = new Promise((resolve, reject) => {
          function handleNavigationSuccess(event) {
            if (
              event.source === iframe.contentWindow &&
              event.origin === targetOrigin &&
              event.data?.action === 'NAVIGATION_SUCCESS' &&
              event.data.path === previousPath
            ) {
              frameWindow.removeEventListener(
                'message',
                handleNavigationSuccess
              );
              resolve();
            }
          }

          frameWindow.addEventListener('message', handleNavigationSuccess);

          // Timeout after 200ms if no response
          setTimeout(() => {
            frameWindow.removeEventListener('message', handleNavigationSuccess);
            reject(
              new Error(
                t('core:message.error.navigation_timeout', {
                  postProcess: 'capitalizeFirstChar',
                })
              )
            );
          }, 200);
          // Send the navigation command after setting up the listener and timeout
          iframe.contentWindow.postMessage(
            {
              action: 'NAVIGATE_TO_PATH',
              path: previousPath,
              requestedHandler: 'UI',
            },
            targetOrigin
          );
        });

        // Execute navigation promise and handle timeout fallback
        try {
          await navigationPromise;
        } catch (error) {
          if (isDevMode) {
            setUrl(
              `${url}${previousPath != null ? previousPath : ''}?theme=${themeMode}&lang=${currentLang}&time=${new Date().getMilliseconds()}&isManualNavigation=false`
            );
            return;
          }
          const previousUrl = renderUrl(
            previousPath != null ? previousPath : '',
            `?theme=${themeMode}&lang=${currentLang}&identifier=${identifierParam(app?.identifier)}&time=${new Date().getMilliseconds()}&isManualNavigation=false`
          );
          if (previousUrl) setUrl(previousUrl);
          // iframeRef.current.contentWindow.location.href = previousPath; // Fallback URL update
        }
      }
    };

    const navigateBackAppFunc = (e) => {
      navigateBackInIframe();
    };

    useEffect(() => {
      if (!app?.tabId) return;
      subscribeToEvent(`navigateBackApp-${app?.tabId}`, navigateBackAppFunc);

      return () => {
        unsubscribeFromEvent(
          `navigateBackApp-${app?.tabId}`,
          navigateBackAppFunc
        );
      };
    }, [app, history, themeMode, currentLang]);

    const navigateToPathFunc = useCallback(
      async (e) => {
        const { path: targetPath = '' } = e.detail;
        // GO-21: the app itself may act on this path, so a traversal path is
        // never handed to it either.
        if (!isSafeQappPath(targetPath)) return;
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;

        let targetOrigin;
        try {
          targetOrigin = new URL(iframe.src).origin;
        } catch {
          return;
        }

        const navigationPromise = new Promise((resolve, reject) => {
          function handleNavigationSuccess(event) {
            if (
              event.source === iframe.contentWindow &&
              event.origin === targetOrigin &&
              event.data?.action === 'NAVIGATION_SUCCESS' &&
              event.data.path === targetPath
            ) {
              frameWindow.removeEventListener(
                'message',
                handleNavigationSuccess
              );
              resolve(undefined);
            }
          }

          frameWindow.addEventListener('message', handleNavigationSuccess);

          setTimeout(() => {
            frameWindow.removeEventListener('message', handleNavigationSuccess);
            reject(new Error('navigation_timeout'));
          }, 250);
          iframe.contentWindow.postMessage(
            {
              action: 'NAVIGATE_TO_PATH',
              path: targetPath,
              requestedHandler: 'UI',
            },
            targetOrigin
          );
        });

        try {
          await navigationPromise;
        } catch {
          if (isDevMode) {
            setUrl(
              `${url}${targetPath}?theme=${themeMode}&lang=${currentLang}&time=${new Date().getMilliseconds()}&isManualNavigation=false`
            );
            return;
          }
          const targetUrl = renderUrl(
            `/${targetPath}`,
            `?theme=${themeMode}&lang=${currentLang}&identifier=${identifierParam(app?.identifier)}&time=${new Date().getMilliseconds()}&isManualNavigation=false`
          );
          if (targetUrl) setUrl(targetUrl);
        }
      },
      [app, frameWindow, iframeRef, isDevMode, url, themeMode, currentLang]
    );

    // A message from GO itself (sendToApp in AppsDesktop), to the app's
    // own origin only. Q-Apps cannot raise GO's events.
    useEffect(() => {
      if (!app?.tabId) return;
      const eventName = `postToApp-${app.tabId}`;
      const postToApp = (e) => {
        const message = e.detail?.message;
        const iframe = (iframeRef as MutableRefObject<HTMLIFrameElement | null>)
          ?.current;
        if (!message || !iframe?.contentWindow) return;
        let targetOrigin;
        try {
          targetOrigin = new URL(iframe.src).origin;
        } catch {
          return;
        }
        iframe.contentWindow.postMessage(message, targetOrigin);
      };
      subscribeToEvent(eventName, postToApp);
      return () => unsubscribeFromEvent(eventName, postToApp);
    }, [app?.tabId, iframeRef]);

    useEffect(() => {
      if (!app?.tabId) return;
      subscribeToEvent(`navigateToPath-${app?.tabId}`, navigateToPathFunc);

      return () => {
        unsubscribeFromEvent(
          `navigateToPath-${app?.tabId}`,
          navigateToPathFunc
        );
      };
    }, [app?.tabId, navigateToPathFunc]);

    // Function to navigate back in iframe
    const navigateForwardInIframe = async () => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        const targetOrigin = iframeRef.current
          ? new URL(iframeRef.current.src).origin
          : '*';
        iframeRef.current.contentWindow.postMessage(
          { action: 'NAVIGATE_FORWARD' },
          targetOrigin
        );
      }
    };

    return (
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          overflowAnchor: 'none',
          overscrollBehavior: 'none',
          position: 'relative',
          width: '100%',
        }}
      >
        <iframe
          ref={iframeRef}
          style={{
            border: 'none',
            contain: 'layout paint style',
            display: 'block',
            height: '100%',
            inset: 0,
            isolation: 'isolate',
            minHeight: 0,
            overflow: 'hidden',
            overflowAnchor: 'none',
            overscrollBehavior: 'none',
            position: 'absolute',
            width: '100%',
          }}
          id="browser-iframe"
          // Lets a background player notification tap find this tab.
          data-tab-id={app?.tabId}
          tabIndex={-1}
          src={defaultUrl}
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
          allow="fullscreen; clipboard-read; clipboard-write; screen-wake-lock"
        />
      </Box>
    );
  }
);
