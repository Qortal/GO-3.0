import { getBaseApiReact } from '../../App';
import { getPrimaryNameForAvatar } from '../Group/groupApi';
import type { OpenTab } from './useOpenTabs';

export type TabAppDetails = {
  title: string;
  qortalName: string;
  service: string;
  description: string;
  primaryName: string;
  isInternal: boolean;
};

export async function fetchTabAppDetails(
  tab: OpenTab,
  displayTitle: string
): Promise<TabAppDetails> {
  if (tab.internal) {
    return {
      title: displayTitle,
      qortalName: '',
      service: 'INTERNAL',
      description: '',
      primaryName: '',
      isInternal: true,
    };
  }

  const service = String(tab.service || 'APP');
  const name = String(tab.name || '');
  let description = '';
  let title = displayTitle;

  if (name) {
    try {
      const params = new URLSearchParams({
        service,
        mode: 'ALL',
        name,
        includemetadata: 'true',
        includestatus: 'true',
      });
      const response = await fetch(
        `${getBaseApiReact()}/arbitrary/resources/search?${params.toString()}`
      );
      if (response.ok) {
        const data = await response.json();
        const matches = Array.isArray(data) ? data : [];
        const tabIdentifier = tab.identifier ? String(tab.identifier) : '';
        const app =
          matches.find(
            (item) =>
              !tabIdentifier ||
              String(item?.identifier || '') === tabIdentifier
          ) || matches[0];
        if (app?.metadata?.description) {
          description = String(app.metadata.description);
        }
        if (app?.metadata?.title) {
          title = String(app.metadata.title);
        }
      }
    } catch {
      // Fall back to tab metadata only.
    }
  }

  let primaryName = '';
  if (name) {
    try {
      const nameResponse = await fetch(
        `${getBaseApiReact()}/names/${encodeURIComponent(name)}`
      );
      if (nameResponse.ok) {
        const nameData = await nameResponse.json();
        if (nameData?.owner) {
          primaryName = await getPrimaryNameForAvatar(String(nameData.owner));
        }
      }
    } catch {
      // Publisher primary name is optional.
    }
  }

  return {
    title,
    qortalName: name,
    service,
    description,
    primaryName,
    isInternal: false,
  };
}
