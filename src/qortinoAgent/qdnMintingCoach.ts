/**
 * Self minting-status coach for the logged-in viewer (QDN mode).
 */
import { apiGetJson } from './qdnApi';
import { qAppAvatarUrl } from './qAppCatalog';
import type { QdnProfileCard } from './qdnLookup';

/** Same thresholds as MintingStats — kept local to avoid heavy UI imports. */
function accountTargetBlocks(level: number): number | undefined {
  const map: Record<number, number> = {
    0: 7200,
    1: 72000,
    2: 201600,
    3: 374400,
    4: 618400,
    5: 964000,
    6: 1482400,
    7: 2173600,
    8: 3037600,
    9: 4074400,
  };
  return map[level];
}

function nextLevel(level: number): number | undefined {
  return level >= 0 && level < 10 ? level + 1 : undefined;
}

export function detectMintingCoachIntent(query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return false;
  // Must be about the viewer / minting status — not "what is minting"
  const self =
    /\b(my|me|i|i'm|im|am i)\b/.test(t) ||
    /\b(how\s+am\s+i|am\s+i\s+minting|my\s+level|my\s+blocks|level\s+up)\b/.test(
      t
    );
  if (!self) return false;
  return (
    /\b(mint|minting|minter|level|blocks?\s+minted|level\s*up|progress|how\s+far)\b/.test(
      t
    ) || /\bam\s+i\s+minting\b/.test(t)
  );
}

export async function fetchMintingCoach(
  viewer: { address?: string | null; name?: string | null },
  signal?: AbortSignal
): Promise<{
  answer: string;
  profile?: QdnProfileCard;
} | null> {
  const address = (viewer.address || '').trim();
  if (!address) {
    return {
      answer:
        'I need you to be logged in so I can read your on-chain minting level and blocks from this node.',
    };
  }

  const [addr, primary] = await Promise.all([
    apiGetJson<{
      level?: number;
      blocksMinted?: number;
      blocksMintedAdjustment?: number;
      flags?: number;
    }>(`/addresses/${encodeURIComponent(address)}`, signal),
    apiGetJson<{ name?: string }>(
      `/names/primary/${encodeURIComponent(address)}`,
      signal
    ),
  ]);

  if (!addr) {
    return {
      answer:
        'I could not load your address info from this node yet. Check the node connection and try again.',
    };
  }

  const level = typeof addr.level === 'number' ? addr.level : 0;
  const minted =
    (addr.blocksMinted ?? 0) + (addr.blocksMintedAdjustment ?? 0);
  const target = accountTargetBlocks(level);
  const nxt = nextLevel(level);
  const displayName =
    (primary?.name || viewer.name || '').trim() || address.slice(0, 10) + '…';

  let progress = '';
  if (target != null && nxt != null) {
    const remaining = Math.max(0, target - minted);
    const pct = Math.min(100, Math.round((minted / target) * 100));
    progress =
      ` Toward Level ${nxt}: ~${remaining.toLocaleString()} blocks remaining ` +
      `(${pct}% of the Level ${level}→${nxt} target of ${target.toLocaleString()}). ` +
      `Exact level-up timing also depends on the 1000-block batch schedule on-chain.`;
  } else if (level >= 10) {
    progress = ' You are at the top minting level band tracked here.';
  }

  const tips =
    level < 5
      ? ' Tip: stay online minting, use the network (Q-Apps, chat, publishes), and aim for Level 5+ before a Q-Mintership nomination.'
      : ' Tip: keep contributing and check Q-Mintership for nomination / minter-admin flows when you want to help grow the minting set.';

  const answer =
    `${displayName}, you are Level ${level} with ${minted.toLocaleString()} blocks minted on this node.` +
    progress +
    tips;

  const profile: QdnProfileCard = {
    name: displayName,
    address,
    level,
    tags: ['You', level >= 1 ? 'Minter track' : 'Getting started'],
    avatarUrl: qAppAvatarUrl(displayName),
  };

  return { answer, profile };
}
