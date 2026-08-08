import { describe, expect, it } from 'vitest';
import { formatAssistantBubbleForClipboard } from '../formatAssistantBubbleClipboard';

describe('formatAssistantBubbleForClipboard', () => {
  it('includes profile names from admin / who-is cards, not only content', () => {
    const text = formatAssistantBubbleForClipboard({
      content: 'Minter Admins: 2 on-chain admin(s). Avatars below.',
      profiles: [
        {
          name: 'Crowetic',
          address: 'Qaddr1',
          level: 8,
          tags: ['Minter Admin'],
          avatarUrl: '',
          primaryName: 'Crowetic',
          nameRole: 'primary',
        },
        {
          name: 'the cat',
          address: 'Qaddr2',
          level: 5,
          tags: ['Minter Admin'],
          avatarUrl: '',
          primaryName: 'the cat',
          nameRole: 'primary',
        },
      ],
    });
    expect(text).toContain('1. Crowetic');
    expect(text).toContain('2. the cat');
    expect(text).toContain('Minter Admin');
    expect(text).toContain('Minter Admins: 2 on-chain admin(s)');
  });

  it('includes owned names and media shelves', () => {
    const text = formatAssistantBubbleForClipboard({
      content: 'Names below.',
      ownedNames: [
        {
          name: 'Kitty',
          address: 'Q1',
          isPrimary: true,
          registered: Date.UTC(2024, 0, 15),
          avatarUrl: '',
        },
      ],
      media: [
        {
          kind: 'video',
          name: 'Kitty',
          service: 'VIDEO',
          identifier: 'vid1',
          title: 'Hello',
        },
      ],
    });
    expect(text).toContain('• Kitty (primary)');
    expect(text).toContain('[video] Hello — Kitty');
  });
});
