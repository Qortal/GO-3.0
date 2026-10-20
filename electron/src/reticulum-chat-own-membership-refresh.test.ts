import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReticulumChatManager } from './reticulum-chat';

// ownMembershipLocalFirst (GO): the background Core check behind each own
// address answer from the pushed group list backs off while Core cannot
// answer (report A: 277 own requests, 189 failed). Measured before: 62
// groups, Core failing for 5 min, each group used every 5 s = 1,860 requests.

const OWN = 'QOwnAddressxxxxxxxxxxxxxxxxxxxxxxx';
const GROUPS = Array.from({ length: 62 }, (_, i) => 1000 + i);

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function setup() {
  const clock = { now: 2_000_000 };
  let answer: boolean | null = null;
  const requests: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-own-refresh-'));
  tempPaths.push(root);
  const manager = new ReticulumChatManager({
    dbPath: path.join(root, 'reticulum-chat.db'),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
    } as any,
    now: () => clock.now,
    ownMembershipLocalFirst: true,
    validateGroupMember: async (groupId: number, address: string) => {
      requests.push(`${groupId}:${address}`);
      return answer;
    },
  });
  managers.push(manager);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  manager.setLocalGroupMemberships(
    GROUPS.map((groupId) => ({ groupId, localAddress: OWN }))
  );
  const m = manager as any;
  /** Every group uses the own address once, then the clock moves on. */
  const useAll = async (stepMs: number) => {
    let answeredTrue = 0;
    for (const groupId of GROUPS) {
      if ((await m.isValidatedGroupMember(groupId, OWN)) === true) {
        answeredTrue += 1;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.now += stepMs;
    return answeredTrue;
  };
  return {
    clock,
    requests,
    setAnswer: (value: boolean | null) => {
      answer = value;
    },
    useAll,
  };
}

describe('own-address background membership refresh', () => {
  it('backs off per group while Core fails, then refreshes once and rests on the cache', async () => {
    const { requests, setAnswer, useAll } = setup();
    let answeredTrue = 0;
    for (let s = 0; s < 5 * 60; s += 5) answeredTrue += await useAll(5_000);
    // The list still answered every use.
    expect(answeredTrue).toBe(62 * 60);
    // 10 s, 20 s, 40 s, 80 s ... per group: 5 tries each in 5 minutes.
    expect(requests.length).toBeLessThanOrEqual(62 * 6);
    expect(requests.length).toBeGreaterThanOrEqual(62 * 4);
    const perGroup = new Map<string, number>();
    for (const key of requests) perGroup.set(key, (perGroup.get(key) ?? 0) + 1);
    expect(Math.max(...perGroup.values())).toBeLessThanOrEqual(6);
    expect(
      (managers[0] as any).getDeliveryCounters().ownMembershipRefreshHeld
    ).toBe(62 * 60 - requests.length);

    // Core answers again: the next use of each group asks once (the first
    // answer clears every backoff), then the 5 min cache answers.
    setAnswer(true);
    const before = requests.length;
    for (let s = 0; s < 5 * 60 - 10; s += 5) await useAll(5_000);
    const after = requests.slice(before);
    expect(new Set(after).size).toBe(62);
    expect(after.length).toBeLessThanOrEqual(62 + 1);
  });

  it('any Core answer ends every own backoff', async () => {
    const { clock, requests, setAnswer, useAll } = setup();
    await useAll(10_000); // t = 0: asked, 10 s backoff
    await useAll(2_000); // t = 10 s: asked, 20 s backoff (until 30 s)
    expect(requests).toHaveLength(124);
    // t = 12 s: Core is back and answers an author check.
    setAnswer(true);
    const m = managers[0] as any;
    await expect(
      m.getCoreValidatedGroupMembership(GROUPS[0], 'QSomeAuthor')
    ).resolves.toBe(true);
    clock.now += 8_000;
    expect(clock.now - 2_000_000).toBe(20_000);
    // t = 20 s: past the engine's 10 s unavailable window, before the 30 s
    // the backoff would have held: every group refreshes now.
    await useAll(1_000);
    expect(requests).toHaveLength(124 + 1 + 62);
  });

  it('a group whose refresh failed is asked again 10 s later, not at its next use', async () => {
    const { clock, requests, useAll } = setup();
    await useAll(5_000);
    expect(requests).toHaveLength(62);
    await useAll(4_000); // t = 5 s: held
    expect(requests).toHaveLength(62);
    await useAll(1_000); // t = 9 s: held
    expect(requests).toHaveLength(62);
    expect(clock.now).toBe(2_000_000 + 10_000);
    await useAll(20_000); // t = 10 s: asked again
    expect(requests).toHaveLength(124);
    await useAll(1_000); // t = 30 s: second backoff (20 s) is over
    expect(requests).toHaveLength(186);
  });
});
