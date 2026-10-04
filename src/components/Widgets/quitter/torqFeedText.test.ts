import { describe, expect, it } from 'vitest';
import { visibleTorqPostText } from './torqFeedText';

describe('visibleTorqPostText', () => {
  const post = { author: 'Simon James', identifier: 'MhNi-abc-v1' };

  it('hides the links Torq only adds for Quitter readers', () => {
    const text = [
      'Vote on this!',
      'qortal://APP/Torq/post/Simon%20James/MhNi-abc-v1',
      'qortal://use-embed/IMAGE?name=Carol&identifier=gif-cat&service=IMAGE',
      'qortal://use-embed/ATTACHMENT?name=Simon%20James&service=FILE&identifier=qshare_file_x',
    ].join('\n\n');
    expect(visibleTorqPostText(text, post)).toBe('Vote on this!');
  });

  it('keeps links the author wrote, including other Torq posts', () => {
    const text =
      'See qortal://APP/Torq/post/Bob/other-id and qortal://APP/Q-Tube/video/x.';
    expect(visibleTorqPostText(text, post)).toBe(text);
  });

  it('drops the Q-Share link only when the files show as cards', () => {
    const text =
      'Files: qortal://APP/Q-Share/share/Simon/qshare_file_x_metadata';
    expect(visibleTorqPostText(text, post)).toBe(text);
    expect(visibleTorqPostText(text, { ...post, hasAttachments: true })).toBe(
      'Files:'
    );
  });
});
