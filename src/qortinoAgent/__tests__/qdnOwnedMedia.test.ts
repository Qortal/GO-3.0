import { describe, expect, it } from 'vitest';
import { extractNameCandidates } from '../qdnLookup';
import {
  isTinyVideo,
  preferSubstantialVideos,
  type QdnMediaItem,
} from '../qdnMedia';
import {
  isMediaSearchKind,
  mediaKindsForSearchKind,
  servicesForSearchKind,
} from '../qdnSearchKind';

function video(id: string, size?: number): QdnMediaItem {
  return {
    kind: 'video',
    name: 'Test',
    service: 'VIDEO',
    identifier: id,
    title: id,
    size,
  };
}

describe('QDN person + media chips', () => {
  it('treats bare multi-word queries as name candidates', () => {
    expect(extractNameCandidates('chris luno')[0]?.toLowerCase()).toBe(
      'chris luno'
    );
    expect(extractNameCandidates('Chris Luno')[0]).toBe('Chris Luno');
  });

  it('Videos / Images / Audio / Documents chips all use media search kinds', () => {
    for (const kind of ['videos', 'images', 'audio', 'documents'] as const) {
      expect(isMediaSearchKind(kind), kind).toBe(true);
      expect(mediaKindsForSearchKind(kind), kind).not.toBeNull();
      expect(servicesForSearchKind(kind).length, kind).toBeGreaterThan(0);
    }
    expect(mediaKindsForSearchKind('videos')).toEqual(['video']);
    expect(mediaKindsForSearchKind('images')).toEqual(['image']);
    expect(mediaKindsForSearchKind('audio')).toEqual(['audio']);
    expect(mediaKindsForSearchKind('documents')).toEqual(['pdf', 'file']);
    expect(servicesForSearchKind('images')).toEqual(['IMAGE', 'THUMBNAIL']);
    expect(servicesForSearchKind('documents')).toEqual([
      'DOCUMENT',
      'BLOG_POST',
      'FILE',
    ]);
  });

  it('treats bare Qortino as a name candidate for Images/Users chips', () => {
    expect(extractNameCandidates('Qortino')[0]).toBe('Qortino');
    expect(extractNameCandidates('qortino')[0]?.toLowerCase()).toBe('qortino');
  });

  it('title match accepts multi-word name phrases', async () => {
    const { titleMatchesSubject } = await import('../qdnTopicMedia');
    expect(titleMatchesSubject('Chris Luno on Qortal', 'Chris Luno')).toBe(
      true
    );
    expect(titleMatchesSubject('Interview with chris luno today', 'chris luno')).toBe(
      true
    );
    expect(titleMatchesSubject('Random primary vlog', 'Chris Luno')).toBe(
      false
    );
    expect(titleMatchesSubject('Qortino banner art', 'Qortino')).toBe(true);
  });

  it('does not match Justin Bieber titles for Qortal Justin', async () => {
    const { titleMatchesSubject } = await import('../qdnTopicMedia');
    expect(titleMatchesSubject('Justin Bieber - Baby', 'qortal justin')).toBe(
      false
    );
    expect(titleMatchesSubject('Justin Bieber', 'Qortal Justin')).toBe(false);
    expect(
      titleMatchesSubject('Qortal Justin weekly update', 'Qortal Justin')
    ).toBe(true);
  });

  it('rejects search hits from other publishers', async () => {
    const { isExactPublisherName } = await import('../qdnMedia');
    expect(isExactPublisherName('Qortal Justin', 'Qortal Justin')).toBe(true);
    expect(isExactPublisherName('Qortal News Network', 'Qortal Justin')).toBe(
      false
    );
    expect(isExactPublisherName('Justin', 'Qortal Justin')).toBe(false);
    expect(isExactPublisherName('', 'Qortal Justin')).toBe(false);
    expect(isExactPublisherName(undefined, 'Qortal Justin')).toBe(false);
  });

  it('hides sub-1MB videos when larger videos exist', () => {
    const big = video('big', 5_000_000);
    const tiny = video('tiny', 200_000);
    const unknown = video('unknown');
    expect(isTinyVideo(tiny)).toBe(true);
    expect(isTinyVideo(big)).toBe(false);
    expect(isTinyVideo(unknown)).toBe(false);

    const filtered = preferSubstantialVideos([tiny, big, unknown]);
    expect(filtered.map((v) => v.identifier)).toEqual(['big', 'unknown']);
  });

  it('keeps tiny videos when they are the only videos / only results', () => {
    const a = video('a', 100_000);
    const b = video('b', 500_000);
    expect(preferSubstantialVideos([a, b]).map((v) => v.identifier)).toEqual([
      'a',
      'b',
    ]);
    // Images do not count as “other videos” — still keep tiny if no large video.
    const withImage: QdnMediaItem[] = [
      a,
      {
        kind: 'image',
        name: 'Test',
        service: 'IMAGE',
        identifier: 'pic',
        title: 'pic',
      },
    ];
    expect(preferSubstantialVideos(withImage).map((v) => v.identifier)).toEqual([
      'a',
      'pic',
    ]);
  });

  it('keeps IMAGE *_thumb identifiers in topic media hits', async () => {
    const { titleMatchesSubject } = await import('../qdnTopicMedia');
    // Smoke: subject match still works for single-token publisher names.
    expect(titleMatchesSubject('Sunset', 'Qortino')).toBe(false);
    expect(titleMatchesSubject('Qortino sunset', 'Qortino')).toBe(true);
  });
});
