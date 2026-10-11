import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUnlockTimingSnapshot,
  recordUnlockTiming,
  resetUnlockTimingsForTests,
  setUnlockDeviceProbe,
} from './unlockTimings';

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const steps = () => getUnlockTimingSnapshot().events.map((e) => e.step);

describe('unlock timings', () => {
  beforeEach(() => {
    resetUnlockTimingsForTests();
  });
  afterEach(() => {
    resetUnlockTimingsForTests();
  });

  it('records steps with rounded durations and short details', () => {
    recordUnlockTiming('kdf', 412.6, 'native, 16 jobs');
    recordUnlockTiming('decrypt', Number.NaN);
    recordUnlockTiming('unlock', 900, 'x'.repeat(400));
    const events = getUnlockTimingSnapshot().events;
    expect(events.map((e) => [e.step, e.ms])).toEqual([
      ['kdf', 413],
      ['decrypt', -1],
      ['unlock', 900],
    ]);
    expect(events[0].detail).toBe('native, 16 jobs');
    expect(events[2].detail).toHaveLength(160);
  });

  it('records nothing extra without a device probe', async () => {
    recordUnlockTiming('unlock', 900, 'password');
    await flush();
    expect(steps()).toEqual(['unlock']);
  });

  it('adds a device row (ms n/a) after each unlock step only', async () => {
    const probe = vi.fn(async () => 'charging usb, 31.2 °C');
    setUnlockDeviceProbe(probe);
    recordUnlockTiming('kdf', 400);
    recordUnlockTiming('decrypt', 300, 'ok');
    await flush();
    expect(probe).not.toHaveBeenCalled();
    recordUnlockTiming('unlock', 900, 'password');
    await vi.waitFor(() => expect(steps()).toHaveLength(4));
    expect(probe).toHaveBeenCalledTimes(1);
    const device = getUnlockTimingSnapshot().events[3];
    expect(device).toMatchObject({
      step: 'device',
      ms: -1,
      detail: 'charging usb, 31.2 °C',
    });
    // The device row itself does not ask again.
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(steps()).toEqual(['kdf', 'decrypt', 'unlock', 'device']);
  });

  it('skips the row when the probe has nothing, fails or throws', async () => {
    setUnlockDeviceProbe(async () => null);
    recordUnlockTiming('unlock', 1);
    setUnlockDeviceProbe(async () => '');
    recordUnlockTiming('unlock', 2);
    setUnlockDeviceProbe(() => Promise.reject(new Error('native gone')));
    recordUnlockTiming('unlock', 3);
    setUnlockDeviceProbe(() => {
      throw new Error('sync throw');
    });
    expect(() => recordUnlockTiming('unlock', 4)).not.toThrow();
    await flush();
    expect(steps()).toEqual(['unlock', 'unlock', 'unlock', 'unlock']);
  });

  it('forgets the probe when cleared or reset', async () => {
    const probe = vi.fn(async () => 'on battery');
    setUnlockDeviceProbe(probe);
    setUnlockDeviceProbe(null);
    recordUnlockTiming('unlock', 1);
    setUnlockDeviceProbe(probe);
    resetUnlockTimingsForTests();
    recordUnlockTiming('unlock', 2);
    await flush();
    expect(probe).not.toHaveBeenCalled();
    expect(steps()).toEqual(['unlock']);
  });
});
