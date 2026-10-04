/**
 * Node requests made by native (Java) HTTP rather than by the WebView.
 *
 * WebView fetches must carry the node API key in the query string
 * (`?apiKey=`): Qortal Core's CORS rules do not allow an X-API-KEY header, and
 * keyed nodes stop answering if one is sent. Native HTTP is not subject to
 * CORS, so for native downloads the key travels separately and the plugin
 * sends it as an X-API-KEY header. That keeps it out of URLs, which end up in
 * logcat, in error text on screen and in screenshots people share.
 */
import { getApiKeyFromStorage, getBaseApi } from '../background/background';
import { joinNodeEndpoint } from './nodeEndpointPath';

export type NativeNodeRequest = {
  /** Present only when a custom node with an API key is configured. */
  apiKey?: string;
  /** The node URL, without the API key. */
  url: string;
};

type StoredNode = { apikey?: unknown; url?: unknown } | null;

/**
 * The same node and path createEndpoint would use, with the key split out.
 * The key is only sent to a custom node the user configured with one, exactly
 * as createEndpoint only appends it there.
 */
export async function createNativeNodeRequest(
  endpoint: string
): Promise<NativeNodeRequest> {
  const stored = (await getApiKeyFromStorage()) as unknown as StoredNode;
  const customUrl =
    stored && typeof stored.url === 'string' && stored.url ? stored.url : '';
  const base = customUrl || (await getBaseApi());
  const url = joinNodeEndpoint(base, endpoint);
  const apiKey =
    customUrl && typeof stored?.apikey === 'string' ? stored.apikey.trim() : '';
  return apiKey ? { apiKey, url } : { url };
}

/**
 * The URL without its query string, fragment or user info, for anything a
 * person or a log can see.
 */
export function stripUrlQuery(url: string): string {
  const value = String(url ?? '').trim();
  const cut = value.search(/[?#]/);
  const withoutQuery = cut === -1 ? value : value.slice(0, cut);
  return withoutQuery.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

/**
 * Free text with the query string removed from every http(s) URL in it and
 * any `apiKey=` value masked.
 */
export function redactUrlQueries(text: string): string {
  return String(text ?? '')
    .replace(/\b(https?:\/\/[^\s"'<>()?#]*)[?#][^\s"'<>()]*/gi, '$1')
    .replace(
      /\b(api[_-]?key|apikey)(\s*[=:]\s*)[^\s&"'<>,;]+/gi,
      '$1$2<redacted>'
    );
}
