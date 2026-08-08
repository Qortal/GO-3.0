import { describe, expect, it } from 'vitest';
import {
  detectRosterIntent,
  extractGroupOwnerQuery,
  extractOwnedNamesQuery,
  isObviouslyQdnQuestion,
} from '../qdnRoster';

describe('qdnRoster intents', () => {
  it('detects admin roster questions', () => {
    expect(detectRosterIntent('Who are the minter admins?')).toBe('minter-admins');
    expect(detectRosterIntent('list the Dev Admins')).toBe('dev-admins');
  });

  it('extracts group owner queries', () => {
    expect(extractGroupOwnerQuery('Who is the owner of the Welcome to Qortal group?')).toBe(
      'Welcome to Qortal'
    );
  });

  it('extracts owned-names queries', () => {
    expect(extractOwnedNamesQuery('What are the primary names of Crowetic?')?.toLowerCase()).toContain(
      'crowetic'
    );
  });

  it('flags obvious QDN questions (not bare who-is — Offline can answer those)', () => {
    expect(isObviouslyQdnQuestion('who is Crowetic')).toBe(false);
    expect(isObviouslyQdnQuestion('who are the minter admins?')).toBe(true);
    expect(isObviouslyQdnQuestion('how do I purify water')).toBe(false);
  });
});

