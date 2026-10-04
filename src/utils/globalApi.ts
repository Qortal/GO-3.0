import {
  cleanUrl,
  getProtocol,
  groupApi,
  groupApiSocket,
} from '../background/background.ts';
import { ApiKey } from '../types/auth.ts';
import { preferHttpForLocalPrivateUrl } from './helpers.ts';
import { setCurrentNodeBaseResolver } from './remoteContentPolicy.ts';
import { setQdnAvatarApiBaseResolver } from '../lib/qdnAvatars/defaultCache';

export let globalApiKey: ApiKey | null = null;

export const handleSetGlobalApikey = (data: ApiKey | null) => {
  if (!data?.url) {
    globalApiKey = data;
    return;
  }
  const preferredUrl = preferHttpForLocalPrivateUrl(data.url) || data.url;
  globalApiKey =
    preferredUrl === data.url ? data : { ...data, url: preferredUrl };
};

export const getBaseApiReact = (customApi?: string): string => {
  if (customApi) {
    return preferHttpForLocalPrivateUrl(customApi) || customApi;
  }
  if (globalApiKey?.url) {
    return preferHttpForLocalPrivateUrl(globalApiKey.url) || globalApiKey.url;
  }
  return preferHttpForLocalPrivateUrl(groupApi) || groupApi;
};

// Messages may show images served by the node GO is using.
setCurrentNodeBaseResolver(() => getBaseApiReact());
// The avatar cache asks the same node (read at each fetch).
setQdnAvatarApiBaseResolver(() => getBaseApiReact());

/** Base API URL for avatar/image requests. Uses HTTP when on local/private HTTPS (same logic as useAuth). */
export const getBaseApiReactForAvatar = (customApi?: string): string => {
  return getBaseApiReact(customApi);
};

/** Base API URL for primary name fetch when used for avatar (wallets/auth). Uses HTTP when on local/private HTTPS. */
export const getBaseApiReactForPrimaryName = (customApi?: string): string => {
  return getBaseApiReact(customApi);
};

export const getArbitraryEndpointReact = (): string => {
  return `/arbitrary/resources/search`;
};

export const getArbitrarySearchSimpleEndpointReact = (): string => {
  return `/arbitrary/resources/searchsimple`;
};

export const getBaseApiReactSocket = (customApi?: string): string => {
  if (customApi) {
    const preferred = preferHttpForLocalPrivateUrl(customApi) || customApi;
    const protocol = getProtocol(preferred) === 'http' ? 'ws://' : 'wss://';
    return `${protocol}${cleanUrl(preferred)}`;
  }
  if (globalApiKey?.url) {
    const preferred =
      preferHttpForLocalPrivateUrl(globalApiKey.url) || globalApiKey.url;
    const protocol = getProtocol(preferred) === 'http' ? 'ws://' : 'wss://';
    return `${protocol}${cleanUrl(preferred)}`;
  }
  return groupApiSocket;
};
