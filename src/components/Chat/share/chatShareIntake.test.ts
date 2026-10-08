import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (path: string) => `http://localhost${path}` },
}));

const native = vi.hoisted(() => ({
  share: null as unknown,
  listener: null as null | ((event?: { kind?: string }) => void),
  consumed: [] as string[],
}));

vi.mock('../../../plugins/ShareReceiver', () => ({
  isShareReceiverAvailable: () => true,
  ShareReceiver: {
    getPendingChatShare: vi.fn(async () => {
      const share = native.share;
      native.share = null;
      return share;
    }),
    consumeSharedFile: vi.fn(async (path: string) => {
      native.consumed.push(path);
    }),
    addShareListener: vi.fn(async (listener) => {
      native.listener = listener;
      return { remove: vi.fn() };
    }),
  },
}));

const clean = vi.hoisted(() => ({ result: 'clean' as 'clean' | 'refuse' }));
vi.mock('../../../utils/cleanPastedImage', () => ({
  cleanPastedImage: vi.fn(async (file: File) =>
    clean.result === 'clean' ? file : null
  ),
}));

const events = vi.hoisted(() => ({ fired: [] as string[] }));
vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn((name: string) => events.fired.push(name)),
}));

import {
  CHAT_SHARE_REQUEST_EVENT,
  initChatShareIntake,
  prepareChatShare,
  resetChatShareIntake,
  routeChatShare,
  sharedText,
  takeChatShareRequest,
} from './chatShareIntake';

const ME = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';
const BOB = 'QMjCNsctvWLoDdPSRpHn6TF2j96iDr9YWm';

const photo = {
  path: '/cache/shared_media/1_IMG_2001.jpg',
  name: 'IMG_2001.jpg',
  mimeType: 'image/jpeg',
  size: 3,
};

beforeEach(() => {
  native.share = null;
  native.listener = null;
  native.consumed = [];
  events.fired = [];
  clean.result = 'clean';
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
      )
  ) as typeof fetch;
});

afterEach(() => {
  resetChatShareIntake();
});

describe('chatShareIntake', () => {
  it.each([
    ['chats:groups', 'groups'],
    ['chats:directs', 'directs'],
    ['chats:self', 'self'],
  ] as const)('puts a %s share up for Q-Chat', (target, scope) => {
    routeChatShare({ target, items: [], text: 'https://qortal.dev' });
    expect(events.fired).toEqual([CHAT_SHARE_REQUEST_EVENT]);
    const request = takeChatShareRequest();
    expect(request?.kind).toBe('share');
    if (request?.kind !== 'share') return;
    expect(request.share.scope).toBe(scope);
    expect(request.share.text).toBe('https://qortal.dev');
    expect(takeChatShareRequest()).toBeNull();
  });

  it('gives every share its own id', () => {
    routeChatShare({ target: 'chats:groups', items: [photo] });
    const first = takeChatShareRequest();
    routeChatShare({ target: 'chats:groups', items: [photo] });
    const second = takeChatShareRequest();
    expect(first?.kind === 'share' && second?.kind === 'share').toBe(true);
    if (first?.kind !== 'share' || second?.kind !== 'share') return;
    expect(second.share.id).not.toBe(first.share.id);
  });

  it('says why when nothing usable came', () => {
    routeChatShare({
      target: 'chats:groups',
      items: [],
      tooLargeCount: 1,
      maxFileBytes: 100 * 1024 * 1024,
    });
    expect(takeChatShareRequest()).toEqual({
      kind: 'nothing',
      notices: [{ kind: 'too_large', maxMb: 100 }],
    });
  });

  it('ignores unknown and old targets', () => {
    for (const target of [
      'composer',
      'picker:groups',
      `chat:go1:${ME}:d:${BOB}`,
      `open:go1:${ME}:g:42`,
    ]) {
      routeChatShare({ target, items: [photo] });
    }
    expect(takeChatShareRequest()).toBeNull();
    expect(events.fired).toEqual([]);
  });

  it('reads the file, cleans pictures and frees the native copy', async () => {
    const prepared = prepareChatShare(
      { target: 'chats:groups', items: [photo], extraCount: 2 },
      'groups'
    );
    const files = await prepared.files;
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe('image/jpeg');
    expect(native.consumed).toEqual([photo.path]);
    expect(prepared.notices).toEqual([{ kind: 'extra_files', count: 2 }]);
  });

  it('leaves out a picture that cannot be cleaned', async () => {
    clean.result = 'refuse';
    const prepared = prepareChatShare(
      { target: 'chats:self', items: [photo] },
      'self'
    );
    expect(await prepared.files).toEqual([]);
    expect(prepared.notices).toEqual([{ kind: 'unsafe_image' }]);
  });

  it('prefers the shared text over the subject', () => {
    expect(sharedText({ text: ' https://a.b ', subject: 'Title' })).toBe(
      'https://a.b'
    );
    expect(sharedText({ subject: ' Title ' })).toBe('Title');
    expect(sharedText({})).toBe('');
  });

  it('drains at start and on chat events only', async () => {
    native.share = { target: 'chats:groups', items: [], text: 'hi' };
    initChatShareIntake();
    await vi.waitFor(() => expect(events.fired).toHaveLength(1));
    native.share = { target: 'chats:groups', items: [], text: 'again' };
    native.listener?.({ kind: 'composer' });
    await Promise.resolve();
    expect(events.fired).toHaveLength(1);
    native.listener?.({ kind: 'chat' });
    await vi.waitFor(() => expect(events.fired).toHaveLength(2));
  });
});
