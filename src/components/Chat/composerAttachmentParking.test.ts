import { describe, expect, it } from 'vitest';
import {
  hasComposerAttachments,
  swapParkedAttachments,
  type ComposerAttachments,
} from './composerAttachmentParking';

type Attachments = ComposerAttachments<string, string>;
const none: Attachments = { files: [], gif: null };

describe('swapParkedAttachments', () => {
  it('keeps a file in the channel it was picked in', () => {
    const parked = new Map<string, Attachments>();
    const inA: Attachments = { files: ['photo.jpg'], gif: null };

    const inB = swapParkedAttachments(parked, 'group:1/ch-a', 'group:1', inA);
    expect(inB).toEqual(none);
    expect(parked.get('group:1/ch-a')).toBe(inA);

    const backInA = swapParkedAttachments(
      parked,
      'group:1',
      'group:1/ch-a',
      inB
    );
    expect(backInA).toBe(inA);
    expect(parked.size).toBe(0);
  });

  it('parks a picked GIF the same way', () => {
    const parked = new Map<string, Attachments>();
    const withGif: Attachments = { files: [], gif: 'cat.gif' };
    swapParkedAttachments(parked, 'group:1', 'group:1/ch-a', withGif);
    expect(parked.get('group:1')).toBe(withGif);
  });

  it('parks nothing for an empty composer', () => {
    const parked = new Map<string, Attachments>();
    swapParkedAttachments(parked, 'group:1', 'group:1/ch-a', none);
    expect(parked.size).toBe(0);
  });

  it('changes nothing when the key stays', () => {
    const parked = new Map<string, Attachments>();
    const current: Attachments = { files: ['a.pdf'], gif: null };
    expect(swapParkedAttachments(parked, 'group:1', 'group:1', current)).toBe(
      current
    );
    expect(parked.size).toBe(0);
  });

  it('does not park attachments without a key they belong to', () => {
    const parked = new Map<string, Attachments>();
    const current: Attachments = { files: ['a.pdf'], gif: null };
    expect(swapParkedAttachments(parked, null, 'group:1', current)).toEqual(
      none
    );
    expect(parked.size).toBe(0);
  });

  it('keeps each channel apart', () => {
    const parked = new Map<string, Attachments>();
    const a: Attachments = { files: ['a.jpg'], gif: null };
    const b: Attachments = { files: ['b.jpg'], gif: null };
    let current = swapParkedAttachments(
      parked,
      'group:1/ch-a',
      'group:1/ch-b',
      a
    );
    current = swapParkedAttachments(parked, 'group:1/ch-b', 'group:2', b);
    expect(current).toEqual(none);
    expect(
      swapParkedAttachments(parked, 'group:2', 'group:1/ch-b', current)
    ).toBe(b);
    expect(parked.get('group:1/ch-a')).toBe(a);
  });
});

describe('hasComposerAttachments', () => {
  it('sees files or a GIF', () => {
    expect(hasComposerAttachments(none)).toBe(false);
    expect(hasComposerAttachments({ files: ['x'], gif: null })).toBe(true);
    expect(hasComposerAttachments({ files: [], gif: 'g' })).toBe(true);
  });
});
