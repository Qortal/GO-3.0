import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reticulumChannelToOpen } from './ChatGroup';
import {
  groupChannelDraftKey,
  groupDraftKey,
  setChatDraft,
} from '../../utils/chatPersistence';
import { queueChatShareFor, resetChatShareInbox } from './share/chatShareInbox';

const ME = 'QMjCNsctvWLoDdPSRpHn6TF2j96iDr9YWm';

describe('reticulumChannelToOpen', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    resetChatShareInbox();
  });

  it('opens General when the group has no draft', () => {
    expect(reticulumChannelToOpen(ME, 12)).toBe('general');
  });

  it('opens the channel the draft was started in', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-dev'), '<p>half done</p>');
    expect(reticulumChannelToOpen(ME, 12)).toBe('ch-dev');
    expect(reticulumChannelToOpen(ME, '12')).toBe('ch-dev');
    // Other groups are not affected.
    expect(reticulumChannelToOpen(ME, 13)).toBe('general');
  });

  it('opens the channel typed in last when several hold a draft', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-dev'), '<p>dev</p>');
    setChatDraft(ME, groupChannelDraftKey(12, 'general'), '<p>general</p>');
    expect(reticulumChannelToOpen(ME, 12)).toBe('general');
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-dev'), '<p>dev 2</p>');
    expect(reticulumChannelToOpen(ME, 12)).toBe('ch-dev');
  });

  it('leaves the channel to a tapped notification', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-dev'), '<p>half done</p>');
    expect(reticulumChannelToOpen(ME, 12, 'ch-news')).toBe('general');
  });

  it('leaves the channel to a share waiting for the group', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-dev'), '<p>half done</p>');
    queueChatShareFor(groupDraftKey(12), {
      text: 'shared',
      files: Promise.resolve([]),
      notices: [],
    });
    expect(reticulumChannelToOpen(ME, 12)).toBe('general');
  });

  it('opens General without an account or a group', () => {
    setChatDraft(ME, groupChannelDraftKey(12, 'ch-dev'), '<p>half done</p>');
    expect(reticulumChannelToOpen('', 12)).toBe('general');
    expect(reticulumChannelToOpen(ME, null)).toBe('general');
    expect(reticulumChannelToOpen(ME, '')).toBe('general');
  });
});
