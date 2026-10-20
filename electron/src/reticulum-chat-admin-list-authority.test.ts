import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Under Vitest `better-sqlite3` resolves to a statement-shape mock. These
// tests run the real ReticulumChatDatabase SQL against Node's built-in SQLite
// (node:sqlite) through a minimal better-sqlite3 adapter.
vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('node:module');
  const load = createRequire(import.meta.url);
  const { DatabaseSync } = load('node:sqlite') as {
    DatabaseSync: new (file: string) => any;
  };
  class Statement {
    constructor(private readonly statement: any) {}
    run(...args: unknown[]) {
      const result = this.statement.run(...args);
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid,
      };
    }
    get(...args: unknown[]) {
      return this.statement.get(...args);
    }
    all(...args: unknown[]) {
      return this.statement.all(...args);
    }
  }
  class Database {
    private readonly db: any;
    private depth = 0;
    constructor(file: string) {
      this.db = new DatabaseSync(file);
    }
    prepare(sql: string) {
      return new Statement(this.db.prepare(sql));
    }
    exec(sql: string) {
      this.db.exec(sql);
      return this;
    }
    pragma(source: string, options?: { simple?: boolean }) {
      const rows = this.db.prepare(`PRAGMA ${source}`).all();
      if (options?.simple) {
        return rows[0] ? Object.values(rows[0])[0] : undefined;
      }
      return rows;
    }
    get inTransaction() {
      return this.db.isTransaction;
    }
    transaction(fn: (...args: any[]) => any) {
      const wrapped = (...args: any[]) => {
        const nested = this.db.isTransaction;
        const savepoint = `sp_${++this.depth}`;
        this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
        try {
          const result = fn(...args);
          this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
          return result;
        } catch (err) {
          this.db.exec(
            nested
              ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`
              : 'ROLLBACK'
          );
          throw err;
        } finally {
          this.depth -= 1;
        }
      };
      (wrapped as any).immediate = wrapped;
      (wrapped as any).deferred = wrapped;
      (wrapped as any).exclusive = wrapped;
      return wrapped;
    }
    close() {
      if (this.db.isOpen) this.db.close();
    }
    get open() {
      return this.db.isOpen;
    }
  }
  return { default: Database };
});

import {
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatEvent,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

/**
 * The chat page pushes { isAdmin, adminStatusAuthoritative } per group from
 * its admin-list fetch (Group.tsx, reticulumAdminList.ts). Before the first
 * good list it now pushes adminStatusAuthoritative: false, so the engine must
 * ask Core about the account's own address instead of reading "not admin"
 * from an empty list.
 */

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const GROUP_ID = 501;
const SECOND = 1_000;

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];
const clock = { now: Date.now() };

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  clock.now = Date.now();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-admin-list-'));
  tempRoots.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function identity(): Identity {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  return {
    address: deriveAddressFromPublicKey(publicKey),
    publicKey,
    secretKey: kp.secretKey,
  };
}

let seq = 0;
function channelCreate(
  author: Identity,
  channelId: string
): ReticulumChatEvent {
  seq += 1;
  const encryptedPayload = JSON.stringify({
    channelId,
    name: channelId,
    position: 1,
  });
  const event: ReticulumChatEvent = {
    eventId: `create-${seq.toString(16).padStart(8, '0')}`,
    groupId: GROUP_ID,
    channelId,
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: 'f'.repeat(32),
    authorSeq: seq,
    timestamp: clock.now - SECOND,
    eventType: 'channel_create',
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: [],
    signature: '',
  } as ReticulumChatEvent;
  event.signature = base58Encode(
    nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(buildReticulumChatSignedFields(event) as any)
      ),
      author.secretKey
    )
  );
  return event;
}

function makeManager(validateGroupAdmin: (address: string) => boolean | null) {
  const adminChecks: string[] = [];
  const bridge = Object.assign(new EventEmitter(), {
    getLocalDestinationHash: () => 'a1'.repeat(16),
    sendReticulumChatDetailed: async () => ({ ok: true as const }),
    fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
  });
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    now: () => clock.now,
    bridge: bridge as any,
    validateGroupMember: async () => true,
    validateGroupAdmin: async (_groupId: number, address: string) => {
      adminChecks.push(address);
      return validateGroupAdmin(address) as boolean;
    },
  });
  managers.push(manager);
  return { manager, adminChecks };
}

async function project(
  manager: ReticulumChatManager,
  event: ReticulumChatEvent
): Promise<string> {
  return (manager as any).applyChannelMetadataEventForProjection(
    event.eventId,
    JSON.parse(event.encryptedPayload)
  );
}

const channelIds = (manager: ReticulumChatManager) =>
  manager.getChannels(GROUP_ID, true).map((channel) => channel.channelId);

describe('admin list authority (own channel metadata)', () => {
  it('applies the own channel_create through Core when the list is not authoritative', async () => {
    const me = identity();
    const { manager, adminChecks } = makeManager(() => true);
    manager.setLocalGroupMemberships([
      {
        groupId: GROUP_ID,
        isAdmin: false,
        adminStatusAuthoritative: false,
        localAddress: me.address,
      },
    ]);
    const create = channelCreate(me, 'support');
    expect((manager as any).db.insertEvent(create, true)).toBe(true);

    await expect(project(manager, create)).resolves.toBe('applied');
    expect(adminChecks).toContain(me.address);
    expect(channelIds(manager)).toContain('support');
  });

  it('defers, not skips, the own channel_create while Core has no answer', async () => {
    const me = identity();
    let coreAnswer: boolean | null = null;
    const { manager, adminChecks } = makeManager(() => coreAnswer);
    manager.setLocalGroupMemberships([
      {
        groupId: GROUP_ID,
        isAdmin: false,
        adminStatusAuthoritative: false,
        localAddress: me.address,
      },
    ]);
    const create = channelCreate(me, 'support');
    (manager as any).db.insertEvent(create, true);

    await expect(project(manager, create)).resolves.toBe('deferred');
    expect(adminChecks).toEqual([me.address]);
    expect(channelIds(manager)).not.toContain('support');

    // Core answers later: the same event now applies.
    coreAnswer = true;
    clock.now += 60 * SECOND;
    await expect(project(manager, create)).resolves.toBe('applied');
    expect(channelIds(manager)).toContain('support');
  });

  it('reads an authoritative list without asking Core (why the page must not claim it early)', async () => {
    const me = identity();
    const { manager, adminChecks } = makeManager(() => true);
    manager.setLocalGroupMemberships([
      {
        groupId: GROUP_ID,
        isAdmin: false,
        adminStatusAuthoritative: true,
        localAddress: me.address,
      },
    ]);
    const create = channelCreate(me, 'support');
    (manager as any).db.insertEvent(create, true);

    await expect(project(manager, create)).resolves.toBe('skipped');
    expect(adminChecks).toEqual([]);
    expect(channelIds(manager)).not.toContain('support');
  });

  it('keeps applying from a kept authoritative list while Core is down', async () => {
    const me = identity();
    const { manager, adminChecks } = makeManager(() => null);
    manager.setLocalGroupMemberships([
      {
        groupId: GROUP_ID,
        isAdmin: true,
        adminStatusAuthoritative: true,
        localAddress: me.address,
      },
    ]);
    const create = channelCreate(me, 'support');
    (manager as any).db.insertEvent(create, true);

    await expect(project(manager, create)).resolves.toBe('applied');
    expect(adminChecks).toEqual([]);
    expect(channelIds(manager)).toContain('support');
  });
});
