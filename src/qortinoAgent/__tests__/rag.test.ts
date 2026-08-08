import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  hashEmbed,
  retrieveKnowledge,
  type KnowledgePack,
} from '../rag';

describe('qortino rag', () => {
  it('produces unit-ish hash embeddings', () => {
    const a = hashEmbed('Qortal names on QDN');
    const b = hashEmbed('Qortal names on QDN');
    const c = hashEmbed('unrelated cooking recipe');
    expect(a).toHaveLength(384);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.99);
    expect(cosineSimilarity(a, c)).toBeLessThan(cosineSimilarity(a, b));
  });

  it('retrieves relevant knowledge chunks', async () => {
    const pack: KnowledgePack = {
      version: 'test',
      embeddingMethod: 'hash',
      chunks: [
        {
          id: '1',
          source: 'qortal/names.md',
          title: 'Names',
          text: 'Qortal names are human-readable identifiers registered on-chain for QDN.',
          embedding: hashEmbed(
            'Qortal names are human-readable identifiers registered on-chain for QDN.'
          ),
        },
        {
          id: '2',
          source: 'survival/water.md',
          title: 'Water',
          text: 'Boil uncertain water when you have fuel and store drinking water early.',
          embedding: hashEmbed(
            'Boil uncertain water when you have fuel and store drinking water early.'
          ),
        },
      ],
    };

    const hits = await retrieveKnowledge(pack, 'How do Qortal names work?', 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe('1');
  });

  it('excludes Playing Qortal chunks unless the user asked', async () => {
    const pack: KnowledgePack = {
      version: 'test',
      embeddingMethod: 'hash',
      chunks: [
        {
          id: 'net',
          source: 'faq/qortal-faq.md',
          title: 'What can I do on Qortal?',
          text: 'Run a node, mint, publish Q-Apps, chat, trade.',
          embedding: hashEmbed('Run a node, mint, publish Q-Apps, chat, trade.'),
        },
        {
          id: 'book',
          source: 'faq/philosophy-faq.md',
          title: 'What does Playing Qortal mean?',
          text: 'Playing Qortal by Simon James is philosophy about values.',
          embedding: hashEmbed(
            'Playing Qortal by Simon James is philosophy about values.'
          ),
        },
      ],
    };

    const blocked = await retrieveKnowledge(pack, 'what can I do on qortal', 4);
    expect(blocked.every((c) => c.id !== 'book')).toBe(true);

    const allowed = await retrieveKnowledge(
      pack,
      'what does Playing Qortal mean?',
      4
    );
    expect(allowed.some((c) => c.id === 'book')).toBe(true);
  });
});
