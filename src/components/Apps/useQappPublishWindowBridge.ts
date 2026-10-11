import { type RefObject, useEffect } from 'react';
import {
  noteAppWindow,
  QDN_PUBLISH_APP_WINDOW_EVENT,
  type AppWindowCommandDetail,
} from '../../qdn/publish/publishJobs';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import {
  parseQappPublishUiReport,
  qappPublishUiCommand,
} from '../../utils/qappPublishUi';

/**
 * One Q-App tab's end of GO's publish window: GO's "hide" and "release" go
 * to this tab's frame (utils/qappPublishUi.ts runs there), and the frame's
 * answer comes back to the publish store. Answers are taken only from this
 * tab's own frame window.
 */
export function useQappPublishWindowBridge(
  iframeRef: RefObject<HTMLIFrameElement | null> | null | undefined,
  tabId: string | undefined
): void {
  useEffect(() => {
    if (!tabId || !iframeRef) return undefined;

    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<AppWindowCommandDetail>).detail;
      if (!detail || detail.tabId !== tabId) return;
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || !iframe.src) return;
      let targetOrigin: string;
      try {
        const url = new URL(iframe.src);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
        targetOrigin = url.origin;
      } catch {
        return;
      }
      try {
        iframe.contentWindow.postMessage(
          qappPublishUiCommand(detail.command, detail.jobId),
          targetOrigin
        );
      } catch {
        /* the frame is going away */
      }
    };

    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const report = parseQappPublishUiReport(event.data);
      if (!report) return;
      if (report.event === 'hidden' || report.event === 'none') {
        noteAppWindow(report.jobId, report.event, tabId);
      }
    };

    subscribeToEvent(QDN_PUBLISH_APP_WINDOW_EVENT, onCommand);
    window.addEventListener('message', onMessage);
    return () => {
      unsubscribeFromEvent(QDN_PUBLISH_APP_WINDOW_EVENT, onCommand);
      window.removeEventListener('message', onMessage);
    };
  }, [iframeRef, tabId]);
}
