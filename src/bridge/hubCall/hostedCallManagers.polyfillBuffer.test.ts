/**
 * The DM and group scenarios again, but with the `buffer` npm package as the
 * global `Buffer` — what GO's WebView has (nodeGlobals.ts installs it; it
 * lacks 'base64url', which group-call.ts needs for GO1 reassembly and the
 * compact GJ destination). Node's own Buffer is put back afterwards.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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
  const out = () => {};
  return { log: out, warn: out, error: out, debug: out, info: out };
});

type Scenarios = typeof import('./testing/callScenarios');

const nodeBuffer = (globalThis as { Buffer?: unknown }).Buffer;
let scenarios: Scenarios;
let polyfill: typeof import('buffer').Buffer;

beforeAll(async () => {
  const bufferModule = await import('buffer');
  polyfill = bufferModule.Buffer;
  expect(polyfill).not.toBe(nodeBuffer);
  // As in the WebView: no global Buffer until nodeGlobals installs one.
  delete (globalThis as { Buffer?: unknown }).Buffer;
  scenarios = await import('./testing/callScenarios');
  expect((globalThis as { Buffer?: unknown }).Buffer).toBe(polyfill);
  expect(polyfill.from('-_8', 'base64url' as BufferEncoding).length).toBe(2);
});

afterEach(() => scenarios?.disposeScenarioStacks());

afterAll(() => {
  (globalThis as { Buffer?: unknown }).Buffer = nodeBuffer;
});

describe('hosted Hub call managers with the WebView Buffer polyfill', () => {
  it('DM call end to end', async () => {
    await scenarios.runDmCallScenario();
  }, 60_000);

  it('group room end to end', async () => {
    await scenarios.runGroupRoomScenario();
  }, 60_000);
});
