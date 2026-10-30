import { executeEvent } from './events';

const CUSTOM_NODE_GUIDE_WEBSITE_NAME = 'Custom Node on Qortal GO | GUIDE';

const blurFocusedElement = () => {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }
};

const openGuideInApps = () => {
  executeEvent('addTab', {
    data: {
      service: 'WEBSITE',
      name: CUSTOM_NODE_GUIDE_WEBSITE_NAME,
      navigateIfAlreadyOpen: true,
    },
  });
  executeEvent('open-apps-mode', {});
};

/** Open the private-node setup guide website in the apps tab strip. */
export const openCustomNodeGuideWebsite = () => {
  blurFocusedElement();
  executeEvent('close-account-settings', {});
  // Wait for account settings dialog to fully unmount (avoids MUI aria-hidden freeze).
  window.setTimeout(openGuideInApps, 180);
};
