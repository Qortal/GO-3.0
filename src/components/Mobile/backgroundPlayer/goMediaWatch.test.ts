import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * android/app/src/main/res/raw/go_media_watch.js: the script GO injects into
 * every frame to report audio and video to the native background player.
 */
const SCRIPT = readFileSync(
  resolve(
    __dirname,
    '../../../../android/app/src/main/res/raw/go_media_watch.js'
  ),
  'utf8'
);

type Sent = Record<string, unknown>;

const posted: string[] = [];
let commandListener: ((event: { data: string }) => void) | null = null;
const playStub = vi.fn(() => Promise.resolve());

function sent(): Sent[] {
  return posted.map((raw) => JSON.parse(raw) as Sent);
}

function lastState(id?: string): Sent | undefined {
  return sent()
    .filter((m) => m.t === 'p' && (!id || m.id === id))
    .pop();
}

function fakeMedia(
  el: HTMLMediaElement,
  props: Partial<Record<string, unknown>>
): void {
  const values: Record<string, unknown> = {
    paused: true,
    ended: false,
    duration: 180,
    currentTime: 0,
    readyState: 4,
    muted: false,
    volume: 1,
    playbackRate: 1,
    seeking: false,
    currentSrc: '',
    videoWidth: 0,
    ...props,
  };
  for (const key of Object.keys(values)) {
    Object.defineProperty(el, key, {
      configurable: true,
      get: () => values[key],
      set: (v) => {
        values[key] = v;
      },
    });
  }
}

function setMedia(el: HTMLMediaElement, props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    (el as unknown as Record<string, unknown>)[key] = value;
  }
}

function command(c: string, id: unknown, extra: Record<string, unknown> = {}) {
  commandListener?.({ data: JSON.stringify({ c, id, ...extra }) });
}

describe('go_media_watch.js', () => {
  beforeAll(() => {
    HTMLMediaElement.prototype.play = playStub as never;
    HTMLMediaElement.prototype.pause = vi.fn();
    (window as unknown as Record<string, unknown>).goMediaWatch = {
      postMessage: (data: string) => posted.push(data),
      addEventListener: (
        type: string,
        fn: (event: { data: string }) => void
      ) => {
        if (type === 'message') commandListener = fn;
      },
    };
    // Same as a document-start script: runs in the page's own world.
    new Function(SCRIPT)();
  });

  beforeEach(() => {
    posted.length = 0;
    document.body.innerHTML = '';
  });

  it('takes the channel away from the page', () => {
    expect('goMediaWatch' in window).toBe(false);
    expect(commandListener).toBeTypeOf('function');
  });

  it('reports audible media that plays, with a title from its file name', () => {
    const el = document.createElement('audio');
    document.body.appendChild(el);
    fakeMedia(el, {
      currentSrc: 'http://localhost:3000/music/Night_Drive.mp3',
      currentTime: 12,
      paused: false,
    });
    el.dispatchEvent(new Event('playing'));
    const state = lastState();
    expect(state).toMatchObject({
      v: 1,
      t: 'p',
      st: 'playing',
      k: 'audio',
      ok: true,
      ti: 'Night Drive',
      d: 180,
      p: 12,
      sk: true,
    });
    expect(typeof state?.f).toBe('string');
  });

  it('leaves muted, silent and short sounds out of the notification', () => {
    const muted = document.createElement('video');
    document.body.appendChild(muted);
    fakeMedia(muted, { muted: true, paused: false, videoWidth: 640 });
    muted.dispatchEvent(new Event('playing'));
    expect(lastState()).toMatchObject({ ok: false, k: 'video' });

    const blip = document.createElement('audio');
    document.body.appendChild(blip);
    fakeMedia(blip, { duration: 1.2, paused: false });
    blip.dispatchEvent(new Event('playing'));
    expect(lastState()).toMatchObject({ ok: false });

    const quiet = document.createElement('audio');
    document.body.appendChild(quiet);
    fakeMedia(quiet, { volume: 0, paused: false });
    quiet.dispatchEvent(new Event('playing'));
    expect(lastState()).toMatchObject({ ok: false });
  });

  it('counts a live stream as media', () => {
    const el = document.createElement('audio');
    document.body.appendChild(el);
    fakeMedia(el, { duration: Infinity, paused: false });
    el.dispatchEvent(new Event('playing'));
    expect(lastState()).toMatchObject({ ok: true, d: -2, sk: false });
  });

  it('a <video> with no picture counts as audio', () => {
    const el = document.createElement('video');
    document.body.appendChild(el);
    fakeMedia(el, { paused: false, videoWidth: 0, readyState: 4 });
    el.dispatchEvent(new Event('playing'));
    expect(lastState()).toMatchObject({ k: 'audio', ok: true });
  });

  it('runs Play, Pause and seeks GO sends', () => {
    const el = document.createElement('audio');
    document.body.appendChild(el);
    fakeMedia(el, { paused: false, currentTime: 40 });
    el.pause = vi.fn();
    el.dispatchEvent(new Event('playing'));
    const id = lastState()?.id;

    command('pause', id);
    expect(el.pause).toHaveBeenCalledTimes(1);

    playStub.mockClear();
    command('play', id);
    expect(playStub).toHaveBeenCalledTimes(1);

    command('seek', id, { to: 500 });
    // Never past the end.
    expect(el.currentTime).toBe(179.75);
    setMedia(el, { currentTime: 40 });
    command('skip', id, { by: -10 });
    expect(el.currentTime).toBe(30);
    command('skip', id, { by: -100 });
    expect(el.currentTime).toBe(0);
  });

  it('ignores commands for players it does not know and bad JSON', () => {
    expect(() => command('pause', 'nope')).not.toThrow();
    expect(() => commandListener?.({ data: '{not json' })).not.toThrow();
  });

  it('sends only real changes, not every clock tick', () => {
    const el = document.createElement('audio');
    document.body.appendChild(el);
    fakeMedia(el, { paused: false, currentTime: 1 });
    el.dispatchEvent(new Event('playing'));
    const before = sent().length;
    setMedia(el, { currentTime: 2 });
    el.dispatchEvent(new Event('timeupdate'));
    el.dispatchEvent(new Event('durationchange'));
    expect(sent().length).toBe(before);
    setMedia(el, { paused: true });
    el.dispatchEvent(new Event('pause'));
    return new Promise<void>((done) => {
      setTimeout(() => {
        expect(lastState()).toMatchObject({ st: 'paused' });
        done();
      }, 5);
    });
  });

  it('a playing element taken out of the page is gone, not paused', async () => {
    const el = document.createElement('audio');
    document.body.appendChild(el);
    fakeMedia(el, { paused: false });
    el.dispatchEvent(new Event('playing'));
    const id = lastState()?.id;
    el.remove();
    setMedia(el, { paused: true });
    el.dispatchEvent(new Event('pause'));
    await new Promise((r) => setTimeout(r, 5));
    expect(sent().pop()).toMatchObject({ t: 'g', id });
  });

  it('finds players that never join the page (new Audio())', () => {
    const audio = new Audio();
    fakeMedia(audio, { paused: false });
    void audio.play();
    audio.dispatchEvent(new Event('playing'));
    expect(lastState()).toMatchObject({ st: 'playing', ok: true });
  });

  it('takes the title, artist and Next from navigator.mediaSession', () => {
    const el = document.createElement('audio');
    document.body.appendChild(el);
    fakeMedia(el, { paused: false });
    el.dispatchEvent(new Event('playing'));
    const id = lastState()?.id;
    const Meta = (
      window as unknown as { MediaMetadata: new (init: object) => object }
    ).MediaMetadata;
    const next = vi.fn();
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.metadata = new Meta({
      title: 'Song A',
      artist: 'Band B',
      album: 'Album C',
    }) as MediaMetadata;
    expect(lastState(id as string)).toMatchObject({
      ti: 'Song A',
      ar: 'Band B',
      al: 'Album C',
      nx: true,
      pv: false,
    });
    command('next', id);
    expect(next).toHaveBeenCalledWith({ action: 'nexttrack' });
    navigator.mediaSession.setActionHandler('nexttrack', null);
    expect(lastState(id as string)).toMatchObject({ nx: false });
  });

  it('uses the page’s own play / pause handlers like a browser does', () => {
    const el = document.createElement('audio');
    document.body.appendChild(el);
    fakeMedia(el, { paused: false });
    el.pause = vi.fn();
    el.dispatchEvent(new Event('playing'));
    const id = lastState()?.id;
    const onPause = vi.fn();
    navigator.mediaSession.setActionHandler('pause', onPause);
    command('pause', id);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(el.pause).not.toHaveBeenCalled();
    navigator.mediaSession.setActionHandler('pause', null);
    command('pause', id);
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it('says goodbye when the frame unloads', () => {
    const el = document.createElement('audio');
    document.body.appendChild(el);
    fakeMedia(el, { paused: false });
    el.dispatchEvent(new Event('playing'));
    window.dispatchEvent(new Event('pagehide'));
    expect(sent().pop()).toMatchObject({ t: 'u' });
  });
});
