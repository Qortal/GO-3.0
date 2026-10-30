/**
 * Curated who-is blurbs for well-known Qortal accounts when on-chain / Hub
 * profile text is missing or outdated.
 */
import type { OfficialResourceLink } from './officialResources';

type ProfileOverride = {
  /** Displayed in the profile chip + preferred offline who-is blurb. */
  description: string;
  /** Extra tappable APP/WEBSITE / https chips for this person. */
  links?: OfficialResourceLink[];
};

const PLAYING_QORTAL_SITE = '... Playing Qortal ...';

const SIMON_JAMES_DESCRIPTION =
  'Simon James is a long established Qortal account. Self described as life-long learning, child-like curious scientist, traveller and guide. The user has been a supporter and promoter of Qortal. Author of Playing Qortal Material (qortal://WEBSITE/...%20Playing%20Qortal%20...) and various Q-Apps and websites.';

const OVERRIDES: Record<string, ProfileOverride> = {
  'simon james': {
    description: SIMON_JAMES_DESCRIPTION,
    links: [
      {
        id: 'playing-qortal-site',
        label: 'Playing Qortal',
        blurb: 'Playing Qortal material on QDN',
        service: 'WEBSITE',
        name: PLAYING_QORTAL_SITE,
      },
    ],
  },
};

export function getProfileOverride(name: string): ProfileOverride | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return OVERRIDES[key] || null;
}
