/**
 * Live QORT peer price from the node's Trade Portal / cross-chain APIs.
 * LTC is the primary QORT market — prefer LTC/QORT quotes.
 */
import { getBaseApiReact } from '../utils/globalApi';

export type QortLtcPriceQuote = {
  /** LTC per 1 QORT (peer market estimate) */
  ltcPerQort: number;
  /** How the estimate was derived */
  source: 'price-api' | 'recent-trades';
  tradeCount?: number;
  answer: string;
  detail: string;
};

type TradeRow = {
  qortAmount?: string | number;
  foreignAmount?: string | number;
};

function twoWeeksAgoMs(): number {
  return Date.now() - 14 * 24 * 60 * 60 * 1000;
}

function formatLtc(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(6);
  return n.toFixed(8);
}

/** Weighted average LTC per QORT from recent completed trades. */
export function averageLtcPerQortFromTrades(trades: TradeRow[]): {
  ltcPerQort: number;
  tradeCount: number;
} {
  let totalQort = 0;
  let totalLtc = 0;
  let tradeCount = 0;
  for (const trade of trades) {
    const qort = parseFloat(String(trade.qortAmount ?? ''));
    const ltc = parseFloat(String(trade.foreignAmount ?? ''));
    if (!Number.isFinite(qort) || !Number.isFinite(ltc) || qort <= 0 || ltc <= 0) {
      continue;
    }
    totalQort += qort;
    totalLtc += ltc;
    tradeCount += 1;
  }
  if (totalQort <= 0 || tradeCount === 0) {
    return { ltcPerQort: 0, tradeCount: 0 };
  }
  return {
    ltcPerQort: totalLtc / totalQort,
    tradeCount,
  };
}

async function fetchPriceApiLtcPerQort(
  signal?: AbortSignal
): Promise<number | null> {
  const base = getBaseApiReact().replace(/\/$/, '');
  // inverse=true → foreign currency (LTC) per 1 QORT; value is ×1e8.
  const urls = [
    `${base}/crosschain/price/LITECOIN?inverse=true&maxtrades=20`,
    `${base}/crosschain/price/LITECOIN?inverse=true`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) continue;
      const raw = await res.json();
      const scaled =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string'
            ? parseFloat(raw)
            : typeof raw?.price === 'number'
              ? raw.price
              : NaN;
      if (!Number.isFinite(scaled) || scaled <= 0) continue;
      const ltcPerQort = scaled / 1e8;
      if (ltcPerQort > 0 && ltcPerQort < 1000) return ltcPerQort;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function fetchTradesAverageLtcPerQort(
  signal?: AbortSignal
): Promise<{ ltcPerQort: number; tradeCount: number } | null> {
  const base = getBaseApiReact().replace(/\/$/, '');
  const qs = new URLSearchParams({
    foreignBlockchain: 'LITECOIN',
    minimumTimestamp: String(twoWeeksAgoMs()),
    limit: '20',
    reverse: 'true',
  });
  try {
    const res = await fetch(`${base}/crosschain/trades?${qs}`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    const avg = averageLtcPerQortFromTrades(data);
    if (avg.ltcPerQort <= 0) return null;
    return avg;
  } catch {
    return null;
  }
}

function buildAnswer(
  ltcPerQort: number,
  source: QortLtcPriceQuote['source'],
  tradeCount?: number
): string {
  const price = formatLtc(ltcPerQort);
  const how =
    source === 'price-api'
      ? 'from this node’s Trade Portal price estimate (recent LTC peer market)'
      : `from the last ${tradeCount || 'several'} completed QORT/LTC peer trades on this node (about 2 weeks)`;
  return (
    `**≈ ${price} LTC per 1 QORT** ${how}.\n\n` +
    `LTC is the main QORT trading pair. There is no single official price — peer offers set the rate, and it moves. ` +
    `Open the Trade Portal for live offers. For chat about rates, ask in QDN Chat. ` +
    `I will not invent USD/BTC figures.`
  );
}

/**
 * Fetch a live QORT/LTC peer price from the connected Qortal node.
 * Prefers `/crosschain/price/LITECOIN`, falls back to recent trades average.
 */
export async function fetchQortLtcPrice(options?: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<QortLtcPriceQuote | null> {
  const controller = new AbortController();
  const outer = options?.signal;
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);
  const timer = window.setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? 20_000
  );

  try {
    const fromApi = await fetchPriceApiLtcPerQort(controller.signal);
    if (fromApi != null) {
      return {
        ltcPerQort: fromApi,
        source: 'price-api',
        answer: buildAnswer(fromApi, 'price-api'),
        detail: `QORT/LTC · ${formatLtc(fromApi)} LTC/QORT`,
      };
    }

    const fromTrades = await fetchTradesAverageLtcPerQort(controller.signal);
    if (fromTrades) {
      return {
        ltcPerQort: fromTrades.ltcPerQort,
        source: 'recent-trades',
        tradeCount: fromTrades.tradeCount,
        answer: buildAnswer(
          fromTrades.ltcPerQort,
          'recent-trades',
          fromTrades.tradeCount
        ),
        detail: `QORT/LTC · ${formatLtc(fromTrades.ltcPerQort)} LTC/QORT · ${fromTrades.tradeCount} trades`,
      };
    }

    return null;
  } finally {
    window.clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export const QORT_PRICE_OFFLINE_NUDGE =
  'Live QORT prices need your connected Qortal node (Trade Portal LTC peer market). Switch to the **QDN** chat window and ask again — Offline cannot quote a real LTC rate and will not invent one.';

export const QORT_PRICE_QDN_UNAVAILABLE =
  'I could not read a live QORT/LTC peer price from this node yet (no price API result and no recent LTC trades). Open the Trade Portal for open offers, or ask in QDN Chat. I will not invent a USD/BTC figure.';
