import { describe, expect, it } from 'vitest';
import { chatShareKey, parseShareTarget } from './chatShareTarget';

const BOB = 'QMjCNsctvWLoDdPSRpHn6TF2j96iDr9YWm';

describe('chatShareTarget', () => {
  it('reads the three share-sheet entries', () => {
    expect(parseShareTarget('chats:groups')).toBe('groups');
    expect(parseShareTarget('chats:directs')).toBe('directs');
    expect(parseShareTarget('chats:self')).toBe('self');
  });

  it('refuses anything else', () => {
    for (const target of [
      undefined,
      null,
      42,
      '',
      'composer',
      'rev',
      'picker:groups',
      `chat:go1:${BOB}:g:1`,
      'chats:',
      'chats:constructor',
      'constructor',
      'toString',
    ]) {
      expect(parseShareTarget(target)).toBeNull();
    }
  });

  it('uses the chat draft keys', () => {
    expect(chatShareKey({ kind: 'group', groupId: '694' })).toBe('group:694');
    expect(chatShareKey({ kind: 'dm', address: BOB })).toBe(`direct:${BOB}`);
  });
});
