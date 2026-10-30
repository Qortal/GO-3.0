import i18n from 'i18next';
import {
  hasControlCharacter,
  nodePathSegment,
} from '../utils/nodeEndpointPath';

/**
 * Checks for the values a Q-App puts into node request paths. Each value is
 * matched against what Qortal Core actually serves, so a Q-App can only reach
 * the endpoint the request type is meant for.
 */

type ForeignCoinTicker = 'BTC' | 'LTC' | 'DOGE' | 'DGB' | 'RVN' | 'ARRR';

const FOREIGN_COIN_TICKERS = new Map<string, ForeignCoinTicker>([
  ['BTC', 'BTC'],
  ['BITCOIN', 'BTC'],
  ['LTC', 'LTC'],
  ['LITECOIN', 'LTC'],
  ['DOGE', 'DOGE'],
  ['DOGECOIN', 'DOGE'],
  ['DGB', 'DGB'],
  ['DIGIBYTE', 'DGB'],
  ['RVN', 'RVN'],
  ['RAVENCOIN', 'RVN'],
  ['ARRR', 'ARRR'],
  ['PIRATECHAIN', 'ARRR'],
]);

/** Core's SupportedBlockchain names, used by /crosschain/txactivity. */
const TRADE_BLOCKCHAIN_NAMES: Record<ForeignCoinTicker, string> = {
  BTC: 'BITCOIN',
  LTC: 'LITECOIN',
  DOGE: 'DOGECOIN',
  DGB: 'DIGIBYTE',
  RVN: 'RAVENCOIN',
  ARRR: 'PIRATECHAIN',
};

const FOREIGN_FEE_TYPES = new Set(['feekb', 'feerequired']);

const MAX_LIST_NAME_LENGTH = 128;
// Core stores a list as <lists dir>/<name>.json, so a path separator in the
// name would reach outside that folder.
const LIST_NAME_SEPARATORS = /[/\\]/;

function coinNotSupported(coin: unknown): Error {
  return new Error(
    i18n.t('question:message.error.token_not_supported', {
      token: typeof coin === 'string' ? coin : String(coin ?? ''),
      postProcess: 'capitalizeFirstChar',
    })
  );
}

/** The ticker for a coin given as a ticker or chain name in any case, or null. */
export function foreignCoinTicker(coin: unknown): ForeignCoinTicker | null {
  if (typeof coin !== 'string') return null;
  return FOREIGN_COIN_TICKERS.get(coin.trim().toUpperCase()) ?? null;
}

/** True for ARRR under any accepted spelling (ARRR, arrr, PIRATECHAIN). */
export function isArrrCoin(coin: unknown): boolean {
  return foreignCoinTicker(coin) === 'ARRR';
}

/** Like foreignCoinTicker, but throws "not supported" for anything else. */
export function requireForeignCoinTicker(coin: unknown): ForeignCoinTicker {
  const ticker = foreignCoinTicker(coin);
  if (!ticker) throw coinNotSupported(coin);
  return ticker;
}

/** The /crosschain/<segment>/... path segment for a coin (btc, ltc, ...). */
export function foreignCoinPathSegment(coin: unknown): string {
  return requireForeignCoinTicker(coin).toLowerCase();
}

/** Core's chain name (LITECOIN, ...) for a coin given as ticker or chain name. */
export function tradeBlockchainName(coin: unknown): string {
  return TRADE_BLOCKCHAIN_NAMES[requireForeignCoinTicker(coin)];
}

/** 'feekb' or 'feerequired'; anything else throws "invalid type". */
export function foreignFeeType(type: unknown): 'feekb' | 'feerequired' {
  const normalized = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (!FOREIGN_FEE_TYPES.has(normalized)) {
    throw new Error(
      i18n.t('question:message.error.invalid_type', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return normalized as 'feekb' | 'feerequired';
}

/**
 * The encoded /lists/<name> segment. Q-Apps choose their own list names
 * ("blockedNames", "followedNames_q-tube", ...), so the name is checked for
 * characters that could leave the path or Core's lists folder rather than
 * against a fixed set.
 */
export function listNamePathSegment(name: unknown): string {
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > MAX_LIST_NAME_LENGTH ||
    name.startsWith('.') ||
    LIST_NAME_SEPARATORS.test(name) ||
    hasControlCharacter(name)
  ) {
    throw new Error(
      i18n.t('question:message.error.invalid_list_name', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return nodePathSegment(name);
}

/** The node origin to show a Q-App, with no path, query or API key. */
export function nodeOriginForQApp(url: unknown): string {
  if (typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? '' : parsed.origin;
  } catch {
    return '';
  }
}
