import { describe, expect, it } from 'vitest';
import {
  formatChatDatabaseLine,
  formatSyncHealthLines,
} from './reticulumDiagnostics';

describe('formatChatDatabaseLine', () => {
  it('prints journal modes, pool use and statement cache without file names', () => {
    const line = formatChatDatabaseLine({
      pool: { capacity: 24, files: 9 },
      databases: [
        {
          name: 'reticulum-chat-QSecretAddress.sqlite',
          journalMode: 'wal',
          statementsCached: 40,
          statementHits: 1200,
          statementMisses: 34,
        },
        {
          name: 'resources.sqlite',
          journalMode: 'delete',
          statementsCached: 3,
          statementHits: 30,
          statementMisses: 6,
        },
      ],
    });
    expect(line).toBe(
      'Chat database: journal wal, delete, pool 9/24 slots, statement cache 1,230 hits / 40 misses'
    );
    expect(line).not.toContain('QSecretAddress');
    expect(line).not.toContain('sqlite');
  });

  it('handles a missing pool and no open databases', () => {
    expect(formatChatDatabaseLine({ pool: null, databases: [] })).toBe(
      'Chat database: journal none open, pool n/a, statement cache 0 hits / 0 misses'
    );
  });

  it('returns null when an older worker sends nothing', () => {
    expect(formatChatDatabaseLine(null)).toBeNull();
    expect(formatChatDatabaseLine(undefined)).toBeNull();
  });

  it('shows up in the sync health section', () => {
    const lines = formatSyncHealthLines({
      sqlite: {
        pool: { capacity: 24, files: 5 },
        databases: [
          {
            name: 'chat.sqlite',
            journalMode: 'wal',
            statementsCached: 1,
            statementHits: 2,
            statementMisses: 1,
          },
        ],
      },
    } as never);
    expect(lines.some((l) => l.startsWith('Chat database: journal wal'))).toBe(
      true
    );
  });
});
