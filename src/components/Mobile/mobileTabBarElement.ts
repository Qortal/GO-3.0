import { atomWithReset } from 'jotai/utils';

/**
 * The phone's bottom tab bar element (the round Home, Apps and Chat
 * buttons), for the sideways swipe between sections, which also listens
 * there. atomWithReset: with strictNullChecks off, atom(null) would type as
 * read-only.
 */
export const mobileTabBarElementAtom = atomWithReset<HTMLElement | null>(null);
