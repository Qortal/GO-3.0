import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSendFailuresForTests,
  describeSendError,
  getRecentSendFailures,
  recordSendFailure,
} from './sendFailureLog';

describe('sendFailureLog', () => {
  beforeEach(() => clearSendFailuresForTests());

  it('turns the shapes a send rejects with into one line', () => {
    expect(
      describeSendError(new Error('reticulumChat:publishEvent timed out'))
    ).toBe('reticulumChat:publishEvent timed out');
    expect(describeSendError('Local user is not a member of this group')).toBe(
      'Local user is not a member of this group'
    );
    expect(
      describeSendError({ error: 'author is not a current group member' })
    ).toBe('author is not a current group member');
    expect(describeSendError(undefined)).toBe('unknown error');
    expect(describeSendError(`x${'y'.repeat(400)}`).length).toBe(300);
  });

  it('keeps the most recent failures only', () => {
    for (let i = 0; i < 25; i++) recordSendFailure(`g${i}`, 3, `e${i}`);
    const recent = getRecentSendFailures();
    expect(recent).toHaveLength(20);
    expect(recent[0].target).toBe('g5');
    expect(recent[recent.length - 1]).toMatchObject({
      target: 'g24',
      attempts: 3,
      error: 'e24',
    });
  });
});
