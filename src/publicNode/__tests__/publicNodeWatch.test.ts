import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterPublicNodeOpen,
  BACK_SHOWN_MS,
  beforePublicNodeOpen,
  checkPublicNodeNow,
  configurePublicNodeWatch,
  CONFIRM_RETRY_MS,
  getPublicNodeSnapshot,
  notePublicNodeAnswered,
  observePublicNodeFetch,
  OPEN_WAIT_MAX_MS,
  publicNodeUrlChanged,
  reportPublicNodeTrouble,
  resetPublicNodeWatchForTests,
  setPublicNodeQdnNoticeHidden,
  setPublicNodeWatchEnabled,
  WATCH_INTERVALS_MS,
  waitForPublicNode,
} from '../publicNodeWatch';

const PUBLIC = 'https://ext-node.qortal.link';
const PRIVATE = 'http://192.168.1.20:12391';

type Answer = number | 'fail';

let nodeUrl = PUBLIC;
let online = true;
let visible = true;
/** /admin/status answers, in order; `fallback` once they run out. */
let answers: Answer[] = [];
let fallback: Answer = 200;

const statusFetch = vi.fn(async (_input: unknown, _init?: unknown) => {
  const answer = answers.length ? answers.shift()! : fallback;
  if (answer === 'fail') throw new TypeError('Failed to fetch');
  return { ok: answer >= 200 && answer < 300, status: answer } as Response;
});

/** Long enough for a failed ask, the pause and the second ask. */
const settleProbe = () => vi.advanceTimersByTimeAsync(CONFIRM_RETRY_MS + 50);

/** Runs the next scheduled check (and its answer). */
const untilNextCheck = () =>
  vi.advanceTimersByTimeAsync(
    getPublicNodeSnapshot().nextCheckAt! - Date.now() + 10
  );

async function goDown() {
  fallback = 'fail';
  void checkPublicNodeNow();
  await settleProbe();
  expect(getPublicNodeSnapshot().health).toBe('down');
}

function holdTorq(retry = vi.fn()) {
  const opened = beforePublicNodeOpen({ service: 'APP', name: 'Torq', retry });
  return { opened, retry };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T22:00:00Z'));
  nodeUrl = PUBLIC;
  online = true;
  visible = true;
  answers = [];
  fallback = 200;
  statusFetch.mockClear();
  vi.stubGlobal('fetch', statusFetch);
  localStorage.clear();
  resetPublicNodeWatchForTests();
  configurePublicNodeWatch({
    nodeUrl: () => nodeUrl,
    deviceOnline: () => online,
    isVisible: () => visible,
  });
  setPublicNodeWatchEnabled(true);
});

afterEach(() => {
  resetPublicNodeWatchForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public node watch', () => {
  it('leaves apps alone on a private node', () => {
    nodeUrl = PRIVATE;
    const reload = vi.fn();

    expect(holdTorq().opened).toBe(true);
    afterPublicNodeOpen({ service: 'APP', name: 'Torq', reload });
    reportPublicNodeTrouble();

    expect(statusFetch).not.toHaveBeenCalled();
    expect(getPublicNodeSnapshot().window).toBeNull();
  });

  it('asks /admin/status and takes a lone 502 for a blip, not an outage', async () => {
    answers = [502, 200];

    void checkPublicNodeNow();
    await settleProbe();

    expect(statusFetch).toHaveBeenCalledTimes(2);
    expect(String(statusFetch.mock.calls[0][0])).toBe(`${PUBLIC}/admin/status`);
    expect(getPublicNodeSnapshot().health).toBe('up');
  });

  it('holds an app while the node is down and opens it when the node is back', async () => {
    await goDown();

    const { opened, retry } = holdTorq();
    expect(opened).toBe(false);
    expect(getPublicNodeSnapshot().window).toMatchObject({
      reason: 'app',
      phase: 'down',
      app: { service: 'APP', name: 'Torq', kind: 'open' },
    });

    // The check started by the tap: still down.
    await settleProbe();
    expect(retry).not.toHaveBeenCalled();
    expect(getPublicNodeSnapshot().nextCheckAt).not.toBeNull();

    fallback = 200;
    await untilNextCheck();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(getPublicNodeSnapshot().window?.phase).toBe('back');
    // Opening it again now goes straight through.
    expect(holdTorq().opened).toBe(true);

    await vi.advanceTimersByTimeAsync(BACK_SHOWN_MS);
    expect(getPublicNodeSnapshot().window).toBeNull();
  });

  it('opens at once after a recent answer from the node', () => {
    notePublicNodeAnswered(PUBLIC);

    expect(holdTorq().opened).toBe(true);
    afterPublicNodeOpen({ service: 'APP', name: 'Torq', reload: vi.fn() });

    expect(statusFetch).not.toHaveBeenCalled();
  });

  it('checks behind an app opened with no recent answer and reloads it when the node is back', async () => {
    fallback = 'fail';
    const reload = vi.fn();

    expect(holdTorq().opened).toBe(true);
    afterPublicNodeOpen({ service: 'APP', name: 'Torq', reload });
    await settleProbe();

    expect(getPublicNodeSnapshot().window).toMatchObject({
      reason: 'app',
      app: { name: 'Torq', kind: 'reload' },
    });

    fallback = 200;
    await untilNextCheck();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps checking after "Wait" and still opens the app when the node is back', async () => {
    await goDown();
    const { retry } = holdTorq();
    await settleProbe();

    waitForPublicNode();
    expect(getPublicNodeSnapshot().window).toBeNull();

    fallback = 200;
    await untilNextCheck();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(getPublicNodeSnapshot().window).toBeNull();
  });

  it('does not open an app that waited longer than two minutes', async () => {
    await goDown();
    const { retry } = holdTorq();
    waitForPublicNode();

    await vi.advanceTimersByTimeAsync(OPEN_WAIT_MAX_MS + 1_000);
    fallback = 200;
    await vi.advanceTimersByTimeAsync(
      WATCH_INTERVALS_MS[WATCH_INTERVALS_MS.length - 1] + 10
    );

    expect(getPublicNodeSnapshot().health).toBe('up');
    expect(retry).not.toHaveBeenCalled();
  });

  it('backs off between checks while the node stays down', async () => {
    await goDown();
    const asked = () => statusFetch.mock.calls.length;
    const before = asked();

    await vi.advanceTimersByTimeAsync(WATCH_INTERVALS_MS[0] + 10);
    await settleProbe();
    expect(asked()).toBe(before + 2);
    await vi.advanceTimersByTimeAsync(WATCH_INTERVALS_MS[0]);
    expect(asked()).toBe(before + 2); // the second wait is longer
  });

  it('stops checking while GO is off screen', async () => {
    await goDown();
    visible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    const asked = statusFetch.mock.calls.length;

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(statusFetch.mock.calls.length).toBe(asked);
    expect(getPublicNodeSnapshot().nextCheckAt).toBeNull();

    visible = true;
    fallback = 200;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(getPublicNodeSnapshot().health).toBe('up');
  });

  it('shows the window for failed QDN loads once per outage', async () => {
    fallback = 'fail';
    const load = observePublicNodeFetch(
      async (_input: string) => ({ ok: false, status: 502 }) as Response
    );

    await load(`${PUBLIC}/arbitrary/THUMBNAIL/Some%20Name/avatar`);
    await settleProbe();
    expect(getPublicNodeSnapshot().window).toMatchObject({
      reason: 'qdn',
      app: null,
    });

    waitForPublicNode();
    await load(`${PUBLIC}/arbitrary/THUMBNAIL/Other/avatar`);
    expect(getPublicNodeSnapshot().window).toBeNull();
  });

  it('honours "Don\'t show again" for QDN loads but not for apps', async () => {
    setPublicNodeQdnNoticeHidden(true);
    fallback = 'fail';

    reportPublicNodeTrouble();
    await settleProbe();
    expect(getPublicNodeSnapshot().health).toBe('down');
    expect(getPublicNodeSnapshot().window).toBeNull();

    expect(holdTorq().opened).toBe(false);
    expect(getPublicNodeSnapshot().window?.reason).toBe('app');
  });

  it('ignores loads from other nodes and loads the caller aborted', async () => {
    const privateLoad = observePublicNodeFetch(
      async (_input: string) => ({ ok: false, status: 502 }) as Response
    );
    await privateLoad(`${PRIVATE}/arbitrary/THUMBNAIL/name/avatar`);

    const aborted = observePublicNodeFetch(async (_input: string) => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });
    await expect(
      aborted(`${PUBLIC}/arbitrary/THUMBNAIL/name/avatar`)
    ).rejects.toThrow();
    await settleProbe();

    expect(statusFetch).not.toHaveBeenCalled();
  });

  it('does not blame the node when the phone is offline', async () => {
    online = false;
    fallback = 'fail';

    reportPublicNodeTrouble();
    await settleProbe();

    expect(statusFetch).not.toHaveBeenCalled();
    expect(getPublicNodeSnapshot().health).toBe('unknown');
    expect(holdTorq().opened).toBe(true);
  });

  it('opens a waiting app on the private node the user moves to', async () => {
    await goDown();
    const { retry } = holdTorq();

    nodeUrl = PRIVATE;
    publicNodeUrlChanged();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(getPublicNodeSnapshot()).toMatchObject({
      health: 'unknown',
      window: null,
    });
  });

  it('checks before trusting a single answer while down', async () => {
    await goDown();
    const { retry } = holdTorq();
    await settleProbe();

    fallback = 200;
    notePublicNodeAnswered(PUBLIC);
    expect(getPublicNodeSnapshot().health).toBe('down');
    await vi.advanceTimersByTimeAsync(10);

    expect(getPublicNodeSnapshot().health).toBe('up');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('turns off and forgets everything when signed out', async () => {
    await goDown();
    const { retry } = holdTorq();

    setPublicNodeWatchEnabled(false);
    fallback = 200;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(retry).not.toHaveBeenCalled();
    expect(getPublicNodeSnapshot()).toMatchObject({
      health: 'unknown',
      window: null,
    });
  });
});
