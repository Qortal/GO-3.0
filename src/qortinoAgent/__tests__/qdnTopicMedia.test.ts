import { describe, expect, it } from 'vitest';
import {
  detectTopicMediaIntent,
  titleMatchesSubject,
} from '../qdnTopicMedia';

describe('qdnTopicMedia', () => {
  it('parses show me images of the dogs', () => {
    const intent = detectTopicMediaIntent('show me images of the dogs');
    expect(intent).not.toBeNull();
    expect(intent!.kinds).toEqual(['image']);
    expect(intent!.subject).toBe('dog');
  });

  it('parses videos about cats', () => {
    const intent = detectTopicMediaIntent('videos about cats');
    expect(intent).not.toBeNull();
    expect(intent!.kinds).toEqual(['video']);
    expect(intent!.subject).toBe('cat');
  });

  it('does not treat videos by Crowetic as topic media', () => {
    expect(detectTopicMediaIntent('videos by Crowetic')).toBeNull();
  });

  it('matches dog* titles', () => {
    expect(titleMatchesSubject('Dogs at the park', 'dog')).toBe(true);
    expect(titleMatchesSubject('My doggo', 'dog')).toBe(true);
    expect(titleMatchesSubject('Cat video', 'dog')).toBe(false);
  });
});
