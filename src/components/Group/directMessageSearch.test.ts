import { describe, expect, it } from 'vitest';
import {
  decodeHtmlEntities,
  directMessageVisibleText,
  directSearchHits,
  directSearchSnippet,
  type DirectSearchEvent,
} from './directMessageSearch';

const ME = 'Qme';
const PEER = 'Qpeer';

const dm = (
  eventId: string,
  html: string,
  overrides: Partial<DirectSearchEvent> = {}
): DirectSearchEvent => ({
  eventId,
  eventType: 'message',
  senderAddress: PEER,
  recipientAddress: ME,
  timestamp: 1_000,
  payload: JSON.stringify({ messageText: html, expiryDurationMs: 0 }),
  ...overrides,
});

describe('directMessageVisibleText', () => {
  it('reads the message as shown, without markup', () => {
    expect(
      directMessageVisibleText(
        JSON.stringify({ messageText: '<p>Tom &amp; Jerry</p><p>at 5</p>' })
      )
    ).toBe('Tom & Jerry at 5');
    expect(directMessageVisibleText('<p>plain &lt;b&gt;</p>')).toBe(
      'plain <b>'
    );
  });

  it('decodes numeric entities and leaves unknown ones', () => {
    expect(decodeHtmlEntities('caf&#233; &#x1F600; &bogus;')).toBe(
      'café 😀 &bogus;'
    );
  });
});

describe('directSearchHits', () => {
  it('keeps only matches in the shown text, newest first as given', () => {
    const hits = directSearchHits(
      [
        dm('m3', '<p>see <a href="https://lunch.example">this</a></p>'),
        dm('m2', '<p>Lunch at noon?</p>', {
          senderAddress: ME,
          recipientAddress: PEER,
          timestamp: 2_000,
        }),
        dm('m1', '<p>lunch was great</p>'),
      ],
      'LUNCH',
      ME
    );

    expect(hits.map((hit) => hit.messageId)).toEqual(['m2', 'm1']);
    expect(hits[0]).toMatchObject({
      fromMe: true,
      peerAddress: PEER,
      text: 'Lunch at noon?',
      timestamp: 2_000,
    });
    expect(hits[1]).toMatchObject({ fromMe: false, peerAddress: PEER });
  });

  it('opens an edit at the message it edits, once', () => {
    const hits = directSearchHits(
      [
        dm('edit-2', '<p>new cafe</p>', {
          eventType: 'edit',
          targetEventId: 'm1',
        }),
        dm('m1', '<p>cafe</p>'),
      ],
      'cafe',
      ME
    );
    expect(hits.map((hit) => hit.messageId)).toEqual(['m1']);
    expect(hits[0].text).toBe('new cafe');
  });

  it('finds Saved Messages under your own address', () => {
    const [hit] = directSearchHits(
      [
        dm('s1', '<p>note to self</p>', {
          senderAddress: ME,
          recipientAddress: ME,
        }),
      ],
      'note',
      ME
    );
    expect(hit).toMatchObject({ fromMe: true, peerAddress: ME });
  });

  it('needs two letters and stops at the limit', () => {
    const events = [dm('a', '<p>aa</p>'), dm('b', '<p>aa</p>')];
    expect(directSearchHits(events, 'a', ME)).toEqual([]);
    expect(directSearchHits(events, 'aa', ME, 1)).toHaveLength(1);
  });
});

describe('directSearchSnippet', () => {
  it('splits around the first match', () => {
    expect(directSearchSnippet('Lunch at noon?', 'NOON')).toEqual({
      before: 'Lunch at ',
      match: 'noon',
      after: '?',
    });
  });

  it('starts a long message near the match, on a word', () => {
    const text = `${'word '.repeat(30)}the needle here`;
    const snippet = directSearchSnippet(text, 'needle', 20);
    expect(snippet.before.startsWith('… ')).toBe(true);
    expect(snippet.before.endsWith('the ')).toBe(true);
    expect(snippet.before.length).toBeLessThanOrEqual(24);
    expect(snippet.match).toBe('needle');
  });

  it('shows the whole text when nothing matches', () => {
    expect(directSearchSnippet('hello', 'zz')).toEqual({
      before: '',
      match: '',
      after: 'hello',
    });
  });
});
