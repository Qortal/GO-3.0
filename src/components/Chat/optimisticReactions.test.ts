import { describe, expect, it } from 'vitest';
import {
  applyOwnReactions,
  OPTIMISTIC_REACTION_GRACE_MS,
  OptimisticReactionTracker,
  readQueuedReactions,
} from './optimisticReactions';

const ME = 'QMe';

const queued = (
  signature: string,
  emoji: string,
  add = true,
  status = 'pending'
) => ({
  type: 'chat-reaction',
  status,
  chatReference: signature,
  message: { content: emoji, contentState: add, type: 'reaction' },
});

describe('optimistic reactions', () => {
  it('reads reaction sends from the queue, not edits or messages', () => {
    const { pending, failed } = readQueuedReactions([
      queued('sig-1', '🔥'),
      { type: 'chat-edit', chatReference: 'sig-1', message: { content: 'x' } },
      queued('sig-2', '👍', false),
      queued('sig-3', '😂', true, 'failed-permanent'),
    ]);
    expect(pending).toEqual([
      { signature: 'sig-1', emoji: '🔥', add: true },
      { signature: 'sig-2', emoji: '👍', add: false },
    ]);
    expect(failed).toEqual([{ signature: 'sig-3', emoji: '😂', add: true }]);
  });

  it('lays the viewer’s changes over the confirmed reactions', () => {
    const confirmed = {
      '👍': [{ sender: 'QBob' }, { sender: ME }],
      '😂': [{ sender: 'QBob' }],
    };
    const next = applyOwnReactions(
      confirmed,
      new Map([
        ['👍', false],
        ['😂', true],
        ['🔥', true],
      ]),
      ME,
      'me'
    );
    expect(next).toEqual({
      '👍': [{ sender: 'QBob' }],
      '😂': [{ sender: 'QBob' }, { sender: ME, senderName: 'me' }],
      '🔥': [{ sender: ME, senderName: 'me' }],
    });
    // The confirmed map itself is left alone.
    expect(confirmed['👍']).toHaveLength(2);
  });

  it('keeps a sent reaction until its confirmed copy is in', () => {
    const tracker = new OptimisticReactionTracker();
    let confirmed = false;
    const isMine = () => confirmed;
    expect(tracker.update([queued('sig', '🔥')], isMine, 0)).toEqual(
      new Map([['sig', new Map([['🔥', true]])]])
    );
    // Left the queue, not confirmed yet: still shown, no blink.
    expect(tracker.update([], isMine, 100).get('sig')?.get('🔥')).toBe(true);
    expect(tracker.msUntilNextExpiry(100)).toBe(OPTIMISTIC_REACTION_GRACE_MS);
    confirmed = true;
    expect(tracker.update([], isMine, 200).size).toBe(0);
    expect(tracker.msUntilNextExpiry(200)).toBeNull();
  });

  it('gives up after the grace, and at once when the send failed', () => {
    const tracker = new OptimisticReactionTracker();
    const never = () => false;
    tracker.update([queued('sig', '🔥')], never, 0);
    tracker.update([], never, 10);
    expect(
      tracker.update([], never, 10 + OPTIMISTIC_REACTION_GRACE_MS).size
    ).toBe(0);
    tracker.update([queued('sig', '😂')], never, 0);
    expect(
      tracker.update([queued('sig', '😂', true, 'failed-permanent')], never, 50)
        .size
    ).toBe(0);
  });

  it('follows the last of several taps on the same reaction', () => {
    const tracker = new OptimisticReactionTracker();
    const result = tracker.update(
      [queued('sig', '👍'), queued('sig', '👍', false)],
      () => false,
      0
    );
    expect(result.get('sig')?.get('👍')).toBe(false);
  });
});
