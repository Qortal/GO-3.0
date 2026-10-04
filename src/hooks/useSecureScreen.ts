import { useEffect } from 'react';
import { holdScreenProtection } from '../plugins/ScreenSecurity';

export type UseSecureScreenOptions = {
  /**
   * Block screenshots, screen recording, the recents thumbnail and assistant
   * screen reading while true (FLAG_SECURE). For seed phrases, private keys,
   * wallet backups, approval dialogs and the lock screen only: chats and
   * Q-Apps stay capturable.
   */
  secure?: boolean;
  /**
   * Drop taps while another app's window covers GO and hide other apps'
   * overlays (Android 12+) while true. For approval dialogs.
   */
  touchProtection?: boolean;
};

/**
 * Protects the screen while the calling component is mounted and the given
 * flags are true. Pass the screen's own "shown" state, for example
 * `useSecureScreen({ secure: open })` in a dialog that stays mounted while
 * closed. Holds are counted, so overlapping screens work. No-op outside the
 * Android app.
 */
export function useSecureScreen({
  secure = false,
  touchProtection = false,
}: UseSecureScreenOptions = {}): void {
  // Callers may pass any truthy value; only on/off changes should re-hold.
  const wantSecure = Boolean(secure);
  const wantTouchProtection = Boolean(touchProtection);

  useEffect(() => {
    if (!wantSecure) return undefined;
    return holdScreenProtection('secure');
  }, [wantSecure]);

  useEffect(() => {
    if (!wantTouchProtection) return undefined;
    return holdScreenProtection('touch');
  }, [wantTouchProtection]);
}
