import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageQueueProvider, useMessageQueue } from './MessageQueueContext';
import {
  clearSendFailuresForTests,
  getRecentSendFailures,
  getRecentSendTimings,
} from './sendFailureLog';

const wrapper = ({ children }: { children: ReactNode }) => (
  <MessageQueueProvider>{children}</MessageQueueProvider>
);

describe('MessageQueueProvider send log', () => {
  beforeEach(() => {
    clearSendFailuresForTests();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearSendFailuresForTests();
  });

  it('records a send that went through on a retry as recovered', async () => {
    const { result } = renderHook(() => useMessageQueue(), { wrapper });
    const func = vi
      .fn()
      .mockRejectedValueOnce(new Error('reticulumChat:publishEvent timed out'))
      .mockResolvedValueOnce({
        success: true,
        duplicate: true,
        clearQueueOnSuccess: true,
      });

    act(() =>
      result.current.addToQueue(
        func,
        { message: { specialId: 's1' } },
        'chat',
        'g1'
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(func).toHaveBeenCalledTimes(2);
    expect(getRecentSendFailures()).toEqual([
      expect.objectContaining({
        target: 'g1',
        attempts: 2,
        outcome: 'recovered',
        error: 'reticulumChat:publishEvent timed out',
        attemptLog: [
          expect.objectContaining({
            error: 'reticulumChat:publishEvent timed out',
          }),
          expect.objectContaining({ error: null, duplicate: true }),
        ],
      }),
    ]);
    expect(getRecentSendTimings()).toHaveLength(1);
    // The success path still clears the row exactly as before.
    expect(result.current.queueChats.g1).toBeUndefined();
  });

  it('records only a send time when the first attempt goes through', async () => {
    const { result } = renderHook(() => useMessageQueue(), { wrapper });
    const func = vi.fn().mockResolvedValue({ clearQueueOnSuccess: true });

    act(() =>
      result.current.addToQueue(
        func,
        { message: { specialId: 's2' } },
        'chat',
        'g1'
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(func).toHaveBeenCalledTimes(1);
    expect(getRecentSendFailures()).toEqual([]);
    expect(getRecentSendTimings()).toEqual([0]);
  });

  it('keeps every attempt of a send that never went through', async () => {
    const { result } = renderHook(() => useMessageQueue(), { wrapper });
    const func = vi.fn().mockRejectedValue('Invalid event');

    act(() =>
      result.current.addToQueue(
        func,
        { message: { specialId: 's3' } },
        'chat',
        'g1'
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(func).toHaveBeenCalledTimes(3);
    const failures = getRecentSendFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      target: 'g1',
      attempts: 3,
      error: 'Invalid event',
    });
    expect(failures[0]).not.toHaveProperty('outcome');
    expect(failures[0].attemptLog).toHaveLength(3);
    expect(
      failures[0].attemptLog?.every((a) => a.error === 'Invalid event')
    ).toBe(true);
    expect(getRecentSendTimings()).toEqual([]);
    expect(result.current.queueChats.g1[0].status).toBe('failed-permanent');
    expect(result.current.queueChats.g1[0].sendError).toBe('Invalid event');
  });
});
