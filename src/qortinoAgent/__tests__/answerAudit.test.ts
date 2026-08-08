/**
 * Offline + QDN answer/routing audit for representative user questions.
 * Asserts golden FAQ hits, app-catalog collisions, and QDN-only nudges.
 */
import { describe, expect, it } from 'vitest';
import { matchQAppCatalog } from '../qAppCatalog';
import { matchGoldenAnswer } from '../goldenMatch';
import { extractDayPublishQuery } from '../qdnDayPublishes';
import { extractNameCandidates } from '../qdnLookup';
import { isMintingHowToQuery } from '../qdnMintingGuide';
import {
  extractGroupOwnerQuery,
  isObviouslyQdnQuestion,
} from '../qdnRoster';
import { isQortalNetworkDefinitionQuery } from '../queryIntent';
import {
  isTopicFollowUpQuery,
  resolveTopicFollowUpQuery,
} from '../topicFollowUp';
import { resolveFollowUpQuery } from '../qdnFollowUpContext';

type Expectation = {
  q: string;
  /** offline | qdn | both */
  mode: 'offline' | 'qdn' | 'both';
  /** Expected golden id (offline / FAQ-in-QDN) */
  goldenId?: string;
  /** Substrings that MUST appear in golden answer */
  answerIncludes?: string[];
  /** Substrings that must NOT appear */
  answerExcludes?: RegExp[];
  /** Must be treated as network definition (not an app) */
  networkDef?: boolean;
  /** Must NOT match an app catalog entry */
  noApp?: boolean;
  /** Must match this app catalog id */
  appId?: string;
  /** Offline should nudge to QDN */
  qdnOnly?: boolean;
  /** Minting how-to path */
  minting?: boolean;
  /** Day-publish extraction */
  dayPublishName?: string;
  /** Name candidate primary */
  nameCandidate?: string;
};

const CASES: Expectation[] = [
  // —— Qortal network ——
  {
    q: 'What is Qortal?',
    mode: 'both',
    goldenId: 'qortal-001',
    networkDef: true,
    noApp: true,
    answerIncludes: ['decentralized'],
    answerExcludes: [/\bgame\b/i],
  },
  {
    q: 'how does qortal work',
    mode: 'both',
    goldenId: 'qortal-001',
    networkDef: true,
    noApp: true,
  },
  {
    q: 'what are q-apps',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-014',
    answerIncludes: ['app'],
  },
  {
    q: 'what is minting',
    mode: 'both',
    minting: true,
    noApp: true,
    goldenId: 'qortal-005',
  },
  {
    q: 'what is QORT',
    mode: 'both',
    noApp: true,
    answerIncludes: ['coin'],
    answerExcludes: [/\btoken\b/i],
  },
  {
    q: 'is qortal a video game',
    mode: 'both',
    noApp: true,
    answerExcludes: [/yes[,.]?\s*(it\s+is|qortal\s+is)\s+a\s+(video\s+)?game/i],
  },

  // —— Named apps (should open catalog) ——
  {
    q: 'what is Q-Assets',
    mode: 'both',
    appId: 'q-assets',
  },
  {
    q: 'what is Welcome to Qortal',
    mode: 'both',
    appId: 'welcome',
  },
  {
    q: 'explain Ear-Bump',
    mode: 'both',
    appId: 'ear-bump',
  },

  // —— People / QDN ——
  {
    q: 'who is Simon James',
    mode: 'both',
    noApp: true,
    answerIncludes: ['qortal'],
  },
  {
    q: 'who are the minter admins',
    mode: 'offline',
    qdnOnly: true,
    noApp: true,
  },
  {
    q: 'who owns the Welcome to Qortal group',
    mode: 'offline',
    qdnOnly: true,
    noApp: true,
  },
  {
    q: 'what did PixelMage publish on 24th of July',
    mode: 'both',
    qdnOnly: true,
    dayPublishName: 'pixelmage',
    noApp: true,
  },
  {
    q: 'what did qortal justin publish on may 17th',
    mode: 'both',
    qdnOnly: true,
    dayPublishName: 'qortal justin',
    noApp: true,
  },
  {
    q: 'what did he publish on june 12th',
    mode: 'qdn',
    qdnOnly: true,
    noApp: true,
  },

  // —— Survival / health ——
  {
    q: 'How do I purify water by boiling?',
    mode: 'both',
    noApp: true,
    answerIncludes: ['boil'],
  },
  {
    q: 'how do I stop severe bleeding',
    mode: 'both',
    noApp: true,
    answerIncludes: ['pressure'],
  },
  {
    q: 'what should be in a home first-aid kit',
    mode: 'both',
    noApp: true,
  },
  {
    q: 'how do I treat dehydration',
    mode: 'both',
    noApp: true,
    goldenId: 'survival-089',
    answerIncludes: ['water', 'salt'],
  },
  {
    q: 'what do I do if someone is choking',
    mode: 'both',
    noApp: true,
    goldenId: 'survival-201',
    answerIncludes: ['back blows'],
  },
  {
    q: 'how do I stay warm without power',
    mode: 'both',
    noApp: true,
    goldenId: 'survival-057',
    answerIncludes: ['warm'],
  },
  {
    q: 'first aid for burns',
    mode: 'both',
    noApp: true,
    goldenId: 'survival-068',
    answerIncludes: ['cool'],
  },
  {
    q: 'how do I join qortal',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-059',
  },
  {
    q: 'how do I get a minting nomination',
    mode: 'both',
    minting: true,
    noApp: true,
    goldenId: 'qortal-006',
  },
  {
    q: 'what can I do on qortal',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-205',
  },
  {
    q: 'who is Crowetic',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-032',
    answerIncludes: ['jason', 'founder'],
  },

  // —— High-impact paraphrase / collision fixes ——
  {
    q: 'how do I grow mint',
    mode: 'both',
    noApp: true,
    goldenId: 'gardening-201',
    answerIncludes: ['herb'],
    answerExcludes: [/minting rights|proof of contribution/i],
  },
  {
    q: 'what is a node',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-206',
    answerIncludes: ['blockchain'],
  },
  {
    q: 'who founded qortal',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-031',
  },
  {
    q: 'how do levels work',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-007',
  },
  {
    q: 'Hub vs Qortal GO',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-141',
  },
  {
    q: 'how do I start a fire without matches',
    mode: 'both',
    noApp: true,
    goldenId: 'survival-028',
  },
  {
    q: 'how do I do cpr',
    mode: 'both',
    noApp: true,
    goldenId: 'survival-202',
    answerIncludes: ['compress'],
  },
  {
    q: 'can I mint without a nomination',
    mode: 'both',
    minting: true,
    noApp: true,
    goldenId: 'qortal-207',
  },
  {
    q: 'what is a reward share',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-083',
  },
  {
    q: 'how do I send qort to someone',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-208',
  },
  {
    q: 'is my seed phrase public',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-009',
    answerIncludes: ['never share'],
  },
  {
    q: 'how do I purify air in a smoke emergency',
    mode: 'both',
    noApp: true,
    goldenId: 'survival-205',
  },
  {
    q: 'how do I lower blood pressure naturally',
    mode: 'both',
    noApp: true,
    goldenId: 'health-202',
  },
  {
    q: 'what is the price of QORT',
    mode: 'both',
    noApp: true,
    goldenId: 'qortal-210',
    answerIncludes: ['qdn', 'ltc'],
    answerExcludes: [/\$\d|usd\s*\d/i],
  },
];

function offlineNudgesToQdn(q: string): boolean {
  return (
    isObviouslyQdnQuestion(q) ||
    !!extractGroupOwnerQuery(q) ||
    !!extractDayPublishQuery(q)
  );
}

describe('answer audit — offline + QDN routing', () => {
  for (const c of CASES) {
    it(`${c.mode}: ${c.q}`, () => {
      if (c.networkDef) {
        expect(isQortalNetworkDefinitionQuery(c.q), 'networkDef').toBe(true);
      }
      if (c.noApp) {
        expect(matchQAppCatalog(c.q), 'noApp').toBeNull();
      }
      if (c.appId) {
        expect(matchQAppCatalog(c.q)?.entry.id, 'appId').toBe(c.appId);
      }
      if (c.minting) {
        expect(isMintingHowToQuery(c.q), 'minting').toBe(true);
      }
      if (c.qdnOnly) {
        expect(offlineNudgesToQdn(c.q), 'qdnOnly nudge').toBe(true);
      }
      if (c.dayPublishName) {
        const day = extractDayPublishQuery(c.q);
        expect(day, 'dayPublish').not.toBeNull();
        expect(day!.name.toLowerCase()).toBe(c.dayPublishName);
      }
      if (c.nameCandidate) {
        expect(extractNameCandidates(c.q)[0]?.toLowerCase()).toBe(
          c.nameCandidate
        );
      }

      // Golden FAQ checks (Fast threshold ~0.58)
      if (c.goldenId || c.answerIncludes || c.answerExcludes) {
        const m = matchGoldenAnswer(c.q, { minScore: 0.55 });
        if (c.goldenId) {
          expect(m, `golden for: ${c.q}`).not.toBeNull();
          expect(m!.entry.id).toBe(c.goldenId);
        }
        if (c.answerIncludes?.length) {
          expect(m, `answerIncludes needs golden: ${c.q}`).not.toBeNull();
          const a = m!.entry.a.toLowerCase();
          for (const needle of c.answerIncludes) {
            expect(a, `missing “${needle}”`).toContain(needle.toLowerCase());
          }
        }
        if (c.answerExcludes?.length && m) {
          for (const re of c.answerExcludes) {
            expect(m.entry.a, `excluded ${re}`).not.toMatch(re);
          }
        }
      }
    });
  }

  it('follow-up he → prior Qortal Justin', () => {
    const r = resolveFollowUpQuery('What did he publish on june 12th', [
      {
        role: 'assistant',
        content: '…',
        profiles: [{ name: 'Qortal Justin' }],
      },
    ]);
    expect(r.text.toLowerCase()).toContain('qortal justin');
    expect(extractDayPublishQuery(r.text)?.name.toLowerCase()).toContain(
      'justin'
    );
  });

  it('topic follow-up keeps Qortal after what is qortal', () => {
    expect(isTopicFollowUpQuery('what is it in depth')).toBe(true);
    const r = resolveTopicFollowUpQuery('what is it in depth', [
      { role: 'user', content: 'what is qortal' },
      { role: 'assistant', content: 'Qortal is a decentralized…' },
    ]);
    expect(r.expanded).toBe(true);
    expect(r.text.toLowerCase()).toContain('qortal');
  });
});
