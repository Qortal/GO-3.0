import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  paginateReticulumChatGroupSubIds,
  ReticulumChatManager,
} from './reticulum-chat';
import { wireFitsReticulumChat } from './reticulum-wire-size';

// Hub 3.0.3 relays a group_sub page with `o` (22-character compact origin),
// `h`, `q` and `fw` added, and silently drops it when that no longer fits
// one packet. Today's group ids have 4 digits.
const FOUR_DIGIT_GROUPS = Array.from({ length: 50 }, (_, i) => 1000 + i);
const ORIGIN_PEER = 'a'.repeat(32);
const NEIGHBOUR_PEER = 'b'.repeat(32);

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-group-sub-'));
  tempPaths.push(root);
  return path.join(root, 'reticulum-chat.db');
}

/** The page as a Hub 3.0.3 relay one hop further would send it. */
function relayedOnce(page: number[], q = '0'.repeat(16)) {
  return {
    t: 'RCHAT',
    k: 'group_sub',
    groups: page,
    mode: 'summary',
    o: 'x'.repeat(22),
    h: 8,
    q,
    fw: 4,
  };
}

function makeManager() {
  const fanout: Array<{
    messages: Record<string, unknown>[];
    options?: { maxPeerCount?: number; selectionKey?: string };
  }> = [];
  const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[],
        _exclude?: string[],
        options?: { maxPeerCount?: number; selectionKey?: string }
      ) => {
        fanout.push({ messages, options });
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    } as any,
  });
  managers.push(manager);
  return { manager, fanout, direct };
}

const groupSubsIn = (wires: Record<string, unknown>[]) =>
  wires.filter(
    (wire) => wire.k === 'group_sub' && (wire.groups as unknown[]).length > 1
  ) as Array<Record<string, unknown> & { groups: number[] }>;

describe('paginateReticulumChatGroupSubIds', () => {
  it('leaves room for the fields a relay adds', () => {
    const pages = paginateReticulumChatGroupSubIds(
      FOUR_DIGIT_GROUPS,
      'summary'
    );
    // 44 four-digit ids is the most that still fits once relayed (381 B).
    expect(pages.map((page) => page.length)).toEqual([44, 6]);
    expect(pages.flat()).toEqual(FOUR_DIGIT_GROUPS);
    for (const page of pages) {
      expect(wireFitsReticulumChat(relayedOnce(page))).toBe(true);
    }
    expect(wireFitsReticulumChat(relayedOnce(FOUR_DIGIT_GROUPS))).toBe(false);
  });

  it('keeps small accounts on one page and never exceeds 50 groups', () => {
    expect(paginateReticulumChatGroupSubIds([56, 57, 58], 'summary')).toEqual([
      [56, 57, 58],
    ]);
    const small = Array.from({ length: 120 }, (_, i) => i + 1);
    const pages = paginateReticulumChatGroupSubIds(small, 'summary');
    expect(pages.flat()).toEqual(small);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(50);
      expect(wireFitsReticulumChat(relayedOnce(page))).toBe(true);
    }
    expect(paginateReticulumChatGroupSubIds([], 'summary')).toEqual([]);
  });

  it('still fits with 5-digit ids and with a longer relayed q', () => {
    const fiveDigit = Array.from({ length: 50 }, (_, i) => 10_000 + i);
    const pages = paginateReticulumChatGroupSubIds(fiveDigit, 'summary');
    expect(pages[0]).toHaveLength(37);
    expect(pages.flat()).toEqual(fiveDigit);

    const longQ = 'q'.repeat(32);
    const relayPages = paginateReticulumChatGroupSubIds(
      FOUR_DIGIT_GROUPS,
      'summary',
      { o: 'o'.repeat(22), h: 1, q: longQ, fw: 4 }
    );
    expect(relayPages.flat()).toEqual(FOUR_DIGIT_GROUPS);
    for (const page of relayPages) {
      expect(wireFitsReticulumChat(relayedOnce(page, longQ))).toBe(true);
    }
  });
});

describe('subscription bursts', () => {
  const summaryPages = (
    fanout: Array<{ messages: Record<string, unknown>[] }>
  ) =>
    fanout
      .flatMap((f) => f.messages)
      .filter(
        (wire) => wire.k === 'group_sub' && wire.mode === 'summary'
      ) as Array<Record<string, unknown> & { groups: number[] }>;

  it('collapses a sign-in burst into a few pages instead of one per group', async () => {
    const { manager, fanout } = makeManager();
    const groups = Array.from({ length: 30 }, (_, i) => 1000 + i);
    manager.setLocalGroupMemberships(groups);
    for (const groupId of groups) manager.subscribeGroup(groupId);

    await vi.waitFor(
      () => {
        expect(
          new Set(summaryPages(fanout).flatMap((wire) => wire.groups)).size
        ).toBe(30);
      },
      { timeout: 3_000 }
    );
    const pages = summaryPages(fanout);
    // The queue sends 8 frames at once (a hello and the first groups); the
    // rest wait and join one page. One page per group was 30 frames.
    expect(pages.length).toBeLessThanOrEqual(9);
    expect(pages.flatMap((wire) => wire.groups).sort()).toEqual(groups);
    for (const wire of pages) {
      expect(wireFitsReticulumChat(relayedOnce(wire.groups))).toBe(true);
    }
  });

  it('keeps the other groups of a waiting page when one is unsubscribed', async () => {
    const { manager, fanout } = makeManager();
    const groups = Array.from({ length: 20 }, (_, i) => 1000 + i);
    manager.setLocalGroupMemberships(groups);
    for (const groupId of groups) manager.subscribeGroup(groupId);
    manager.unsubscribeGroup(1015);

    await vi.waitFor(
      () => {
        expect(
          new Set(summaryPages(fanout).flatMap((wire) => wire.groups)).size
        ).toBe(19);
      },
      { timeout: 3_000 }
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    const announced = summaryPages(fanout).flatMap((wire) => wire.groups);
    expect(announced).not.toContain(1015);
    expect(new Set(announced)).toEqual(
      new Set(groups.filter((id) => id !== 1015))
    );
  });

  it('does not read 500 events on every subscribe or chat open', () => {
    const { manager } = makeManager();
    manager.setLocalGroupMemberships([1000]);
    const recent = vi.spyOn((manager as any).db, 'getRecentEvents');
    manager.subscribeGroup(1000);
    manager.subscribeGroup(1000);
    expect(recent.mock.calls.filter((call) => call[1] === 500)).toHaveLength(0);
  });
});

describe('group_sub pages on the wire', () => {
  it('forwards a full 50-group page from a neighbour as pages that fit', async () => {
    const { manager, fanout } = makeManager();

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: FOUR_DIGIT_GROUPS,
        mode: 'summary',
        q: 'c'.repeat(16),
        fw: 4,
      } as any,
      ORIGIN_PEER
    );

    await vi.waitFor(() => {
      expect(groupSubsIn(fanout.flatMap((f) => f.messages))).toHaveLength(2);
    });
    const forwarded = groupSubsIn(fanout.flatMap((f) => f.messages));
    expect(forwarded.flatMap((wire) => wire.groups)).toEqual(FOUR_DIGIT_GROUPS);
    for (const wire of forwarded) {
      expect(wire).toMatchObject({ h: 1, q: 'c'.repeat(16), fw: 4 });
      expect(typeof wire.o).toBe('string');
      expect(wireFitsReticulumChat(wire)).toBe(true);
    }
    // Still bounded gossip, as before the split.
    for (const call of fanout) {
      if (groupSubsIn(call.messages).length) {
        expect(call.options).toMatchObject({ maxPeerCount: 4 });
      }
    }
  });

  it('cuts our own subscription pages so they survive a relay', async () => {
    const { manager, fanout, direct } = makeManager();
    manager.setLocalGroupMemberships(FOUR_DIGIT_GROUPS);
    for (const groupId of FOUR_DIGIT_GROUPS) manager.subscribeGroup(groupId);
    expect(manager.getSubscriptions()).toEqual(FOUR_DIGIT_GROUPS);

    manager.announceSubscriptionsToPeer(NEIGHBOUR_PEER);
    await vi.waitFor(() => {
      expect(groupSubsIn(direct.map(({ wire }) => wire))).toHaveLength(2);
    });
    const introduced = groupSubsIn(direct.map(({ wire }) => wire));
    expect(introduced.map((wire) => wire.groups.length)).toEqual([44, 6]);
    expect(introduced.flatMap((wire) => wire.groups)).toEqual(
      FOUR_DIGIT_GROUPS
    );

    // Let the sign-in burst (a few singles, then one merged page) go out.
    await vi.waitFor(
      () => {
        expect(
          new Set(
            fanout
              .flatMap((f) => f.messages)
              .filter((wire) => wire.k === 'group_sub')
              .flatMap((wire) => wire.groups as number[])
          ).size
        ).toBe(50);
      },
      { timeout: 5_000 }
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const sentBefore = fanout.length;

    manager.reannounceSubscriptions();
    const replayPages = () =>
      groupSubsIn(fanout.slice(sentBefore).flatMap((f) => f.messages));
    await vi.waitFor(
      () => {
        expect(replayPages().length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 5_000 }
    );
    const refreshed = replayPages();
    expect(refreshed.map((wire) => wire.groups.length)).toEqual([44, 6]);
    for (const wire of groupSubsIn(fanout.flatMap((f) => f.messages))) {
      expect(wireFitsReticulumChat(relayedOnce(wire.groups))).toBe(true);
    }
    for (const wire of [...introduced, ...refreshed]) {
      expect(wireFitsReticulumChat(relayedOnce(wire.groups))).toBe(true);
    }
  });
});
