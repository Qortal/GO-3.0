import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWindowCallApi, type CallIpcContext } from './callIpc';

/**
 * `window.call.onEvent`'s subscribe replay (setup.ts `call:subscribe`): the
 * first subscriber gets the calls already ringing (and accepted outbound
 * ones) a tick later, as after the desktop IPC round trip, but never one it
 * has already heard live in that tick.
 */
describe('createWindowCallApi onEvent replay', () => {
  let events: EventEmitter;
  let ringing: Array<{ callId: string; fromAddress: string; chatId: string }>;
  let accepted: Array<{ callId: string }>;
  let api: ReturnType<typeof createWindowCallApi>;

  const ring = (callId: string) => ({
    callId,
    fromAddress: 'Qcaller',
    chatId: `direct:${callId}`,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    events = new EventEmitter();
    ringing = [];
    accepted = [];
    const ctx = {
      events,
      callManager: {
        getPendingInboundRingingPayloads: () => [...ringing],
        getActiveOutboundAcceptedPayloads: () => [...accepted],
      },
      noteLocalCallEnd: () => {},
    } as unknown as CallIpcContext;
    api = createWindowCallApi(() => ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const subscribe = () => {
    const got: Array<[string, unknown]> = [];
    const unsubscribe = api.onEvent((event, payload) =>
      got.push([event, payload])
    );
    return { got, unsubscribe };
  };

  it('replays calls that were ringing before, a tick after subscribing', () => {
    ringing.push(ring('a'));
    accepted.push({ callId: 'b' });
    const { got } = subscribe();
    // Not during subscribe: after the (desktop) IPC round trip.
    expect(got).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(got).toEqual([
      ['call:incoming', ring('a')],
      ['call:accepted', { callId: 'b' }],
    ]);
  });

  it('a call that rings live before the replay runs is announced once', () => {
    const { got } = subscribe();
    // The call manager announces it, and it is ringing when the replay runs.
    ringing.push(ring('c'));
    events.emit('call:incoming', ring('c'));
    vi.advanceTimersByTime(0);
    expect(got).toEqual([['call:incoming', ring('c')]]);
  });

  it('an outbound call accepted live before the replay runs is announced once', () => {
    const { got } = subscribe();
    accepted.push({ callId: 'd' });
    events.emit('call:accepted', { callId: 'd' });
    vi.advanceTimersByTime(0);
    expect(got).toEqual([['call:accepted', { callId: 'd' }]]);
  });

  it('still replays the others ringing at that point', () => {
    ringing.push(ring('older'));
    const { got } = subscribe();
    ringing.push(ring('live'));
    events.emit('call:incoming', ring('live'));
    vi.advanceTimersByTime(0);
    expect(got).toEqual([
      ['call:incoming', ring('live')],
      ['call:incoming', ring('older')],
    ]);
  });

  it('after the replay, every live event goes through as before', () => {
    const { got } = subscribe();
    vi.advanceTimersByTime(0);
    events.emit('call:incoming', ring('e'));
    events.emit('call:hangup', { callId: 'e' });
    events.emit('call:incoming', ring('e'));
    expect(got).toEqual([
      ['call:incoming', ring('e')],
      ['call:hangup', { callId: 'e' }],
      ['call:incoming', ring('e')],
    ]);
  });

  it('only the first subscriber gets the replay; the next ones live events only', () => {
    ringing.push(ring('f'));
    const first = subscribe();
    const second = subscribe();
    vi.advanceTimersByTime(0);
    expect(first.got).toEqual([['call:incoming', ring('f')]]);
    expect(second.got).toEqual([]);
    events.emit('call:hangup', { callId: 'f' });
    expect(second.got).toEqual([['call:hangup', { callId: 'f' }]]);
  });

  it('no replay to a subscriber that left before it ran', () => {
    ringing.push(ring('g'));
    const { got, unsubscribe } = subscribe();
    unsubscribe();
    vi.advanceTimersByTime(0);
    expect(got).toEqual([]);
  });
});
