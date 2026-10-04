import { getBaseApiReact } from './globalApi';
import { executeEvent } from './events';
import {
  getQdnAvatarSnapshot,
  noteQdnAvatarUse,
  peekQdnAvatarSrc,
} from '../lib/qdnAvatars';

export const Q_MINTER_WEBSITE_LINK = 'qortal://WEBSITE/Q-Minter';

export const Q_MINTER_WEBSITE_NAME = 'Q-Minter';

let avatarRequestQueued = false;

/**
 * Asks GO's avatar cache for the Q-Minter icon (fetch or refresh when needed)
 * and counts the use, after the current render: callers build the candidates
 * while rendering, and the cache tells its subscribers at once.
 */
const requestQMinterWebsiteAvatar = () => {
  if (avatarRequestQueued) return;
  avatarRequestQueued = true;
  setTimeout(() => {
    avatarRequestQueued = false;
    try {
      peekQdnAvatarSrc(Q_MINTER_WEBSITE_NAME);
      noteQdnAvatarUse(Q_MINTER_WEBSITE_NAME);
    } catch {
      // The node URLs below still work.
    }
  }, 0);
};

const cachedQMinterWebsiteAvatar = (): string | undefined => {
  try {
    return getQdnAvatarSnapshot(Q_MINTER_WEBSITE_NAME).src;
  } catch {
    return undefined;
  }
};

/**
 * Candidate image URLs for the Q-Minter website icon, best first: the icon
 * from GO's avatar cache (or the one GO ships), then the node's QDN avatar
 * and the website favicon. Names are case-insensitive on the node, so one
 * avatar URL is enough. Safe to call while rendering.
 */
export const getQMinterWebsiteAvatarCandidates = (): string[] => {
  const base = getBaseApiReact();
  const encoded = encodeURIComponent(Q_MINTER_WEBSITE_NAME);
  const cached = cachedQMinterWebsiteAvatar();
  requestQMinterWebsiteAvatar();
  return [
    ...(cached ? [cached] : []),
    `${base}/arbitrary/THUMBNAIL/${encoded}/qortal_avatar?async=true`,
    `${base}/site/${encoded}/favicon.ico`,
    `${base}/render/WEBSITE/${encoded}/favicon.ico`,
  ];
};

export const getQMinterWebsiteAvatarUrl = () =>
  getQMinterWebsiteAvatarCandidates()[0];

/** Open the Q-Minter website (qortal://WEBSITE/Q-Minter) in the apps tab strip. */
export const openQMinterWebsite = () => {
  executeEvent('addTab', {
    data: {
      service: 'WEBSITE',
      name: Q_MINTER_WEBSITE_NAME,
      navigateIfAlreadyOpen: true,
    },
  });
  executeEvent('open-apps-mode', {});
};
