/**
 * The script GO runs at document start in every Q-App frame (installed
 * natively, since those frames are cross-origin). The native side keeps one
 * script, so everything GO runs there goes in together:
 * - qappFetchReporter.ts: the app's own big QDN downloads, for GO's cards;
 * - qappPublishUi.ts: hides the app's publish window while GO's shows it;
 * - qappLoadingPageWatch.ts: opens the app from the node's loading page once
 *   the node serves it, when the page itself would keep waiting.
 */
import { installNativeFrameScript } from '../plugins/FileWriter';
import { buildQappFetchReporterScript } from './qappFetchReporter';
import { buildQappLoadingPageWatchScript } from './qappLoadingPageWatch';
import { buildQappPublishUiScript } from './qappPublishUi';

function buildQappFrameScript(topOrigin: string): string {
  return [
    buildQappFetchReporterScript(topOrigin),
    buildQappPublishUiScript(topOrigin),
    buildQappLoadingPageWatchScript(topOrigin),
  ].join('\n');
}

let installed: Promise<boolean> | null = null;

/** Installs the frame script for Q-App frames loaded from now on. Native only. */
export function installQappFrameScripts(): Promise<boolean> {
  if (!installed) {
    const script = buildQappFrameScript(window.location.origin);
    installed = installNativeFrameScript(script).catch((error) => {
      console.warn('[QappFrameScripts] not installed', error);
      installed = null;
      return false;
    });
  }
  return installed;
}
