import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearChatDraft,
  directDraftKey,
  getChatDraft,
  groupChannelDraftKey,
  groupDraftChannelIds,
  groupDraftKey,
  groupIdsWithDrafts,
  latestGroupDraftChannel,
  parseGroupDraftKey,
  setChatDraft,
} from './chatPersistence';

const ME = 'QMjCNsctvWLoDdPSRpHn6TF2j96iDr9YWm';
const OTHER = 'QZ2pgyLBdY6t4GgbK3Kpn5Ugc6jzqW9mVQ';

describe('group channel drafts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps General on the group key and gives other channels their own', () => {
    expect(groupChannelDraftKey(12)).toBe('group:12');
    expect(groupChannelDraftKey('12', 'general')).toBe('group:12');
    expect(groupChannelDraftKey(12, null)).toBe('group:12');
    expect(groupChannelDraftKey(12, 'ch-a1')).toBe('group:12/ch-a1');
    expect(groupChannelDraftKey(12, 'ch-a1')).not.toBe(groupDraftKey(12));
  });

  it('reads the group and channel back from a key', () => {
    expect(parseGroupDraftKey('group:12')).toEqual({
      groupId: '12',
      channelId: 'general',
    });
    expect(parseGroupDraftKey('group:12/ch-a1')).toEqual({
      groupId: '12',
      channelId: 'ch-a1',
    });
    expect(parseGroupDraftKey(directDraftKey(OTHER))).toBeNull();
    expect(parseGroupDraftKey('group:')).toBeNull();
  });

  it('keeps a draft in the channel it was typed in', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-a1'), '<p>for a1</p>');
    expect(getChatDraft(ME, groupChannelDraftKey(12, 'ch-a1'))).toBe(
      '<p>for a1</p>'
    );
    expect(getChatDraft(ME, groupChannelDraftKey(12, 'general'))).toBe('');
    expect(getChatDraft(ME, groupChannelDraftKey(12, 'ch-b2'))).toBe('');
  });

  it('opens the channel typed in last', () => {
    expect(latestGroupDraftChannel(ME, 12)).toBeNull();
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-a1'), '<p>one</p>');
    setChatDraft(ME, groupChannelDraftKey(12, 'general'), '<p>two</p>');
    expect(latestGroupDraftChannel(ME, 12)).toBe('general');
    // Typing on in an older draft makes it the newest again.
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-a1'), '<p>one more</p>');
    expect(latestGroupDraftChannel(ME, '12')).toBe('ch-a1');
    // An unchanged save does not count as typing.
    setChatDraft(ME, groupChannelDraftKey(12, 'general'), '<p>two</p>');
    expect(latestGroupDraftChannel(ME, 12)).toBe('ch-a1');
  });

  it('falls back to the next newest draft once one is sent or cleared', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'general'), '<p>older</p>');
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-a1'), '<p>newer</p>');
    clearChatDraft(ME, groupChannelDraftKey(12, 'ch-a1'));
    expect(latestGroupDraftChannel(ME, 12)).toBe('general');
    setChatDraft(ME, groupChannelDraftKey(12, 'general'), '<p></p>');
    expect(latestGroupDraftChannel(ME, 12)).toBeNull();
  });

  it('looks only at that group and that account', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-a1'), '<p>12</p>');
    setChatDraft(ME, groupChannelDraftKey(120, 'ch-b2'), '<p>120</p>');
    setChatDraft(ME, directDraftKey(OTHER), '<p>dm</p>');
    setChatDraft(OTHER, groupChannelDraftKey(12, 'ch-c3'), '<p>other</p>');
    expect(latestGroupDraftChannel(ME, 12)).toBe('ch-a1');
    expect(latestGroupDraftChannel(ME, 1)).toBeNull();
    expect(latestGroupDraftChannel(OTHER, 12)).toBe('ch-c3');
  });

  it('marks a group with a draft in any channel, and which channels', () => {
    const keys = [
      groupChannelDraftKey(12, 'ch-a1'),
      groupChannelDraftKey(12, 'general'),
      groupChannelDraftKey(7, 'ch-b2'),
      directDraftKey(OTHER),
    ];
    expect([...groupIdsWithDrafts(keys)].sort()).toEqual(['12', '7']);
    expect([...groupDraftChannelIds(keys, 12)].sort()).toEqual([
      'ch-a1',
      'general',
    ]);
    expect([...groupDraftChannelIds(keys, '7')]).toEqual(['ch-b2']);
    expect(groupDraftChannelIds(keys, 1).size).toBe(0);
  });
});
