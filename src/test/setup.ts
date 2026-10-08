import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from '../lib/qdnAvatars/defaultCache';
import { qdnAvatarKey } from '../lib/qdnAvatars/keys';
import {
  getQdnAvatarSeedNames,
  getQdnAvatarSeedUrl,
} from '../lib/qdnAvatars/seeds';
import { createAvatarTestHarness } from '../lib/qdnAvatars/testHarness';
import { resetChatWarmCacheForTests } from '../reticulumChat/chatWarmCache';

Object.defineProperties(HTMLMediaElement.prototype, {
  load: {
    configurable: true,
    value: vi.fn(),
  },
  pause: {
    configurable: true,
    value: vi.fn(),
  },
  play: {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  },
});

vi.mock('@evva/capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => ({ value: true })),
    remove: vi.fn(async () => ({ value: true })),
    clear: vi.fn(async () => ({ value: true })),
    keys: vi.fn(async () => ({ value: [] })),
    getPlatform: vi.fn(async () => ({ value: 'web' })),
  },
}));

vi.mock('asmcrypto.js/asmcrypto.all.js', () => ({}));

vi.mock('../background/background', () => {
  return {
    // whatever your module exports; make them fast + deterministic
    performPowTask: vi.fn(async (_bytes: Uint8Array, _difficulty: number) => {
      // return a minimal fake result your component expects
      return { success: true, nonce: 0, hash: '00...00' };
    }),
    // if it exports a default or other helpers, add them too
  };
});

// Components that show avatars must not ask a real node from tests (that
// would also use up fetch mocks): every test starts with an avatar cache
// whose node never answers, with the icons GO ships, as in the app. Tests
// that need answers install their own.
const bundledAvatarSeeds = Object.fromEntries(
  getQdnAvatarSeedNames().map((name) => [
    qdnAvatarKey(name),
    getQdnAvatarSeedUrl(name),
  ])
);

beforeEach(() => {
  // Recent chats kept in memory: none carried from one test to the next.
  resetChatWarmCacheForTests();
  setQdnAvatarCacheForTests(
    createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
      seeds: bundledAvatarSeeds,
    }).cache
  );
});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});
