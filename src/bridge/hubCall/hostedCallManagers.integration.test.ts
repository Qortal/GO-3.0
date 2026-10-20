/**
 * Two GO devices, each running the UNMODIFIED Hub CallManager + GroupCallManager
 * behind GO's adapters (hostedCallManagers.ts), connected through an in-memory
 * stand-in for GO's Python bridge (testing/fakePythonNetwork.ts).
 *
 * Mobile shims are swapped in exactly as the GO build does (vite.config.ts
 * mobileChatWorkerPoolPlugin + aliases): zlib (sync raw deflate), crypto
 * (noble Ed25519), verify-worker-pool (inline), presence (slim). Every
 * signature is a real wallet-style Ed25519 signature over the real field sets
 * and passes GO's wallet signing policy (testing/testWallet.ts).
 * Scenarios: testing/callScenarios.ts (also run with the `buffer` package as
 * the global Buffer in hostedCallManagers.polyfillBuffer.test.ts).
 */
import { afterEach, describe, it, vi } from 'vitest';
import {
  disposeScenarioStacks,
  runDeclineScenario,
  runDmCallScenario,
  runGroupRoomScenario,
  runTargetOfflineScenario,
} from './testing/callScenarios';

vi.mock(
  'zlib',
  async () => await import('../../reticulumChat/mobile/shims/zlib')
);
vi.mock(
  'crypto',
  async () => await import('../../reticulumChat/mobile/shims/crypto')
);
vi.mock(
  '../../../electron/src/verify-worker-pool',
  async () =>
    await import('../../reticulumChat/mobile/shims/verify-worker-pool')
);
vi.mock(
  '../../../electron/src/presence',
  async () => await import('../../reticulumChat/mobile/shims/presence-slim')
);
vi.mock('../../../electron/src/logger', () => {
  const verbose = process.env.GO_CALL_TEST_LOGS === '1';
  const out = (...args: unknown[]) => {
    if (verbose) console.log(...args);
  };
  return { log: out, warn: out, error: out, debug: out, info: out };
});

afterEach(() => disposeScenarioStacks());

describe('hosted Hub call managers on GO (two devices, fake python)', () => {
  it(
    'DM call: CR → CA → media room → link-auth → GC_KEY adopted → audio → RTC offer → hangup over link',
    runDmCallScenario,
    60_000
  );

  it(
    'decline: reason-signed and legacy CX pinned to the caller, caller sees the reason',
    runDeclineScenario,
    30_000
  );

  it(
    'a target without any presence route is "Target offline" (desktop IPC result)',
    runTargetOfflineScenario,
    30_000
  );

  it(
    'group room: two members join, verify each other, link up and exchange topology',
    runGroupRoomScenario,
    60_000
  );
});
