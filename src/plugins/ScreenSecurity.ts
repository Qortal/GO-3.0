import { registerPlugin } from '@capacitor/core';
import { isAndroidApp } from '../utils/androidApp';

/**
 * GO-37 / GO-29: screen protection for sensitive screens (Android only).
 *
 * - `secure`: FLAG_SECURE on GO's window. Screenshots, screen recording, the
 *   recents thumbnail and assistant screen reading get a blank window.
 * - `touch`: taps are dropped while another app's window covers GO, and other
 *   apps' overlays are hidden (Android 12+). Meant for approval dialogs.
 *
 * Owner decision (2026-10-02): only seed phrase, private key, wallet backup,
 * payment / Q-App approval screens and the lock screen are protected. Chats
 * and Q-Apps stay capturable, so never hold this for them.
 */
export interface QortalScreenSecurityPlugin {
  /** One hold per `on: true`; each must be given back with `on: false`. */
  setSecure(options: { on: boolean }): Promise<{ on: boolean }>;
  /** Same counting as `setSecure`, for overlay / tapjacking protection. */
  setTouchProtection(options: { on: boolean }): Promise<{ on: boolean }>;
  /** Drops every hold, such as those a previous page left behind. */
  resetHolds(): Promise<void>;
}

export const QortalScreenSecurity = registerPlugin<QortalScreenSecurityPlugin>(
  'QortalScreenSecurity'
);

export type ScreenProtection = 'secure' | 'touch';

const holds: Record<ScreenProtection, number> = { secure: 0, touch: 0 };

function send(kind: ScreenProtection, on: boolean): void {
  try {
    const request =
      kind === 'secure'
        ? QortalScreenSecurity.setSecure({ on })
        : QortalScreenSecurity.setTouchProtection({ on });
    Promise.resolve(request).catch(() => {
      // An older native shell without the plugin: nothing to protect with.
    });
  } catch {
    // Same: never let a missing plugin break the screen that asked.
  }
}

/**
 * Turns a protection on until the returned function is called. Holds are
 * counted, so overlapping screens (a backup dialog under the lock screen,
 * an approval over a key screen) keep the protection until the last one
 * closes. The native side only hears about the first hold and the last
 * release. Does nothing outside the Android app.
 *
 * The returned release function is safe to call more than once.
 */
export function holdScreenProtection(kind: ScreenProtection): () => void {
  if (!isAndroidApp()) return () => {};
  holds[kind] += 1;
  if (holds[kind] === 1) send(kind, true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds[kind] = Math.max(0, holds[kind] - 1);
    if (holds[kind] === 0) send(kind, false);
  };
}

/** How many screens currently hold a protection (for tests and diagnostics). */
export function screenProtectionHolds(kind: ScreenProtection): number {
  return holds[kind];
}

/**
 * The page's script starts with no holds, so the native side must not keep
 * any from an earlier page in this activity (a reload, a crash recovery, an
 * in-place navigation). Otherwise a screen that was protected when the page
 * went away would leave FLAG_SECURE on for good, over chats and Q-Apps too.
 * Native also drops the holds when a page starts loading; this is the second
 * safeguard. Capacitor runs plugin calls in order on one thread, so this
 * lands before this page's first hold.
 *
 * Sent once per page: a second copy of this module (a dev hot reload) must
 * not drop the first copy's holds.
 */
const PAGE_RESET_MARK = '__qortalScreenSecurityPageReset';

function resetNativeHoldsOncePerPage(): void {
  if (!isAndroidApp()) return;
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[PAGE_RESET_MARK]) return;
  scope[PAGE_RESET_MARK] = true;
  try {
    Promise.resolve(QortalScreenSecurity.resetHolds()).catch(() => {
      // A native shell without this method or plugin: nothing to reset.
    });
  } catch {
    // Same: never let a missing plugin break the page.
  }
}

resetNativeHoldsOncePerPage();

/** Test helper: forget every hold without telling the native side. */
export function resetScreenProtectionForTests(): void {
  holds.secure = 0;
  holds.touch = 0;
}
