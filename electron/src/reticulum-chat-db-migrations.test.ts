import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReticulumChatDatabase } from './reticulum-chat-db';

// Under Vitest `better-sqlite3` resolves to the in-memory mock in
// src/test/mocks/betterSqlite3.ts (see vite.config.ts), which keeps one store
// per path and records schema migrations but does not evaluate arbitrary
// UPDATEs. The test therefore observes the statement stream: the backfill must
// be issued on the first open, skipped on a reopen, and issued again when the
// stamp is missing.
const BACKFILL_MIGRATION = 'message-projection-attachments-backfill-v1';

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-migrations-test-'));
  return path.join(root, 'reticulum-chat.db');
}

function rawDb(db: ReticulumChatDatabase) {
  return (db as any).db;
}

function hasStamp(db: ReticulumChatDatabase): boolean {
  return Boolean(
    rawDb(db)
      .prepare('SELECT 1 FROM rchat_schema_migrations WHERE name = ? LIMIT 1')
      .get(BACKFILL_MIGRATION)
  );
}

describe('reticulum chat DB schema migrations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the message projection attachment backfill once per database', () => {
    const execSpy = vi.spyOn(Database.prototype as any, 'exec');
    const backfillRuns = () =>
      execSpy.mock.calls.filter(([sql]) =>
        /UPDATE rchat_message_projection\s+SET has_attachment/.test(String(sql))
      ).length;

    const dbPath = tempDbPath();
    const first = new ReticulumChatDatabase(dbPath);
    expect(backfillRuns()).toBe(1);
    expect(hasStamp(first)).toBe(true);
    first.close();

    const second = new ReticulumChatDatabase(dbPath);
    expect(backfillRuns()).toBe(1);
    // A database from before the stamp existed: the backfill runs on the next
    // open and stamps itself.
    rawDb(second)
      .prepare('DELETE FROM rchat_schema_migrations WHERE name = ?')
      .run(BACKFILL_MIGRATION);
    expect(hasStamp(second)).toBe(false);
    second.close();

    const third = new ReticulumChatDatabase(dbPath);
    expect(backfillRuns()).toBe(2);
    expect(hasStamp(third)).toBe(true);
    third.close();
  });

  it('adds the nullable DM delivery retry columns once, additively', () => {
    const execSpy = vi.spyOn(Database.prototype as any, 'exec');
    const retryColumnAdds = () =>
      execSpy.mock.calls.filter(([sql]) =>
        /ALTER TABLE rchat_dm_events ADD COLUMN (delivery_attempts|next_delivery_attempt_at) INTEGER$/.test(
          String(sql)
        )
      ).length;
    const dmColumns = (db: ReticulumChatDatabase) =>
      (
        rawDb(db).prepare('PRAGMA table_info(rchat_dm_events)').all() as Array<{
          name: string;
        }>
      ).map((column) => column.name);

    const dbPath = tempDbPath();
    const first = new ReticulumChatDatabase(dbPath);
    expect(retryColumnAdds()).toBe(2);
    expect(dmColumns(first)).toEqual(
      expect.arrayContaining([
        'own_device_copied_at',
        'delivery_attempts',
        'next_delivery_attempt_at',
      ])
    );
    first.close();

    const second = new ReticulumChatDatabase(dbPath);
    expect(retryColumnAdds()).toBe(2);
    second.close();
  });

  it('creates the own post delivery table once per database', () => {
    const execSpy = vi.spyOn(Database.prototype as any, 'exec');
    const tableCreates = () =>
      execSpy.mock.calls.filter(([sql]) =>
        /CREATE TABLE IF NOT EXISTS rchat_own_post_delivery\b/.test(String(sql))
      ).length;
    const columns = (db: ReticulumChatDatabase) =>
      (
        rawDb(db)
          .prepare('PRAGMA table_info(rchat_own_post_delivery)')
          .all() as Array<{ name: string }>
      ).map((column) => column.name);

    const dbPath = tempDbPath();
    const first = new ReticulumChatDatabase(dbPath);
    expect(tableCreates()).toBe(1);
    expect(columns(first)).toEqual(
      expect.arrayContaining([
        'event_id',
        'scope',
        'conversation_id',
        'own_device_at',
        'member_at',
        'proof_kind',
      ])
    );
    first.close();

    const second = new ReticulumChatDatabase(dbPath);
    expect(tableCreates()).toBe(1);
    // A database from before the table existed gets it on its next open.
    rawDb(second).exec('DROP TABLE IF EXISTS rchat_own_post_delivery');
    second.close();

    const third = new ReticulumChatDatabase(dbPath);
    expect(tableCreates()).toBe(2);
    expect(columns(third)).toContain('member_peer_hash');
    third.close();
  });
});
