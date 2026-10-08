import { atom } from 'jotai';
import { atomWithReset } from 'jotai/utils';

/**
 * A Q-App or website frame is on screen in the Apps section (not the
 * library, a category, app info or the dev home). Set by AppsDesktop, which
 * owns that state; the phone shell keeps room above the tab buttons for a
 * frame, since the app's own bottom menu would sit under them.
 */
export const mobileQappFrameShowingAtom = atom(false);

/**
 * The tab of a Q-App that asked for full screen (qortalRequest action
 * SET_FULL_SCREEN, enabled: true), or null. While that tab is on screen the
 * phone shell hides its bars and the status bar, whatever the immersive
 * setting. Cleared when the app says so, when the tab is left or closed, and
 * on Android back.
 */
// atomWithReset: with strictNullChecks off, atom(null) would type as read-only.
export const qappFullScreenTabAtom = atomWithReset<string | null>(null);
