import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatDraftKeys } from './useChatDraftKeys';
import {
  clearChatDraft,
  groupChannelDraftKey,
  setChatDraft,
} from '../utils/chatPersistence';

const ME = 'QMjCNsctvWLoDdPSRpHn6TF2j96iDr9YWm';

function renderDraftKeys(account: string) {
  const seen: Set<string>[] = [];
  const Probe = () => {
    seen.push(useChatDraftKeys(account));
    return null;
  };
  render(<Probe />);
  return seen;
}

describe('useChatDraftKeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lists the keys holding a draft, channels included', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-dev'), '<p>dev</p>');
    setChatDraft(ME, groupChannelDraftKey(12, 'general'), '<p>general</p>');
    const seen = renderDraftKeys(ME);
    expect([...seen[seen.length - 1]].sort()).toEqual([
      'group:12',
      'group:12/ch-dev',
    ]);
  });

  it('updates when a draft appears or goes, not while typing on', () => {
    const seen = renderDraftKeys(ME);
    const key = groupChannelDraftKey(12, 'ch-dev');
    expect(seen[seen.length - 1].size).toBe(0);

    act(() => setChatDraft(ME, key, '<p>h</p>'));
    const renders = seen.length;
    expect(seen[renders - 1].has(key)).toBe(true);

    // Typing on in the same draft: same keys, no new render.
    act(() => setChatDraft(ME, key, '<p>he</p>'));
    act(() => setChatDraft(ME, key, '<p>hello</p>'));
    expect(seen.length).toBe(renders);

    act(() => clearChatDraft(ME, key));
    expect(seen.length).toBe(renders + 1);
    expect(seen[seen.length - 1].size).toBe(0);
  });
});
