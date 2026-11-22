import { BackgroundPlayerWindow } from './BackgroundPlayerWindow';
import { useBackgroundPlayerBridge } from './useBackgroundPlayerBridge';

/**
 * GO's background player on the page: the settings window and the bridge
 * to Android's player (gear and notification taps, "Now playing", the
 * notification texts). Mounted once in App, GO only. The window waits for
 * a signed-in, unlocked GO: the gear tapped while GO is locked opens it
 * right after the unlock.
 */
export function BackgroundPlayerHost({ ready }: { ready: boolean }) {
  useBackgroundPlayerBridge();
  return <BackgroundPlayerWindow ready={ready} />;
}
