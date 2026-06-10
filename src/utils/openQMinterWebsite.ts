import { getBaseApiReact } from './globalApi';
import { executeEvent } from './events';

export const Q_MINTER_WEBSITE_LINK = 'qortal://WEBSITE/Q-Minter';

export const Q_MINTER_WEBSITE_NAME = 'Q-Minter';

/** Candidate image URLs for the Q-Minter website icon (avatar / favicon). */
export const getQMinterWebsiteAvatarCandidates = (): string[] => {
  const base = getBaseApiReact();
  const encoded = encodeURIComponent(Q_MINTER_WEBSITE_NAME);
  return [
    `${base}/arbitrary/THUMBNAIL/${encoded}/qortal_avatar?async=true`,
    `${base}/arbitrary/THUMBNAIL/q-minter/qortal_avatar?async=true`,
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
