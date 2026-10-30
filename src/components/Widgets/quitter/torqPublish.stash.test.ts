import { beforeEach, describe, expect, it, vi } from 'vitest';

const stashedIds = vi.hoisted(() => [] as string[]);
const discardPublishFile = vi.hoisted(() => vi.fn());
const publishMultipleResources = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../../../utils/publishFileStash', () => ({
  stashPublishFile: vi.fn(() => {
    const id = `stash-${stashedIds.length + 1}`;
    stashedIds.push(id);
    return id;
  }),
  discardPublishFile,
}));
vi.mock('../../../qdn/encryption/group-encryption', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../qdn/encryption/group-encryption')
  >()),
  objectToBase64: vi.fn(async () => {
    throw new Error('encode failed');
  }),
}));
vi.mock('./quitterIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitterIdentity')>()),
  buildQuitterPostIdentifier: vi.fn(
    async () => 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-abcdefghijklmno-v1'
  ),
}));
vi.mock('./quitterPublish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitterPublish')>()),
  publishMultipleResources,
}));

import { publishTorqPost } from './torqPublish';

// A post that fails before the publish call never hands its stashed files
// to the publisher, so they must be released here.
describe('publishTorqPost stashed files', () => {
  beforeEach(() => {
    stashedIds.length = 0;
    discardPublishFile.mockClear();
    publishMultipleResources.mockClear();
  });

  it('discards every stashed file when the post fails before publishing', async () => {
    const pdf = new File(['%PDF-1.4 hello'], 'notes.pdf', {
      type: 'application/pdf',
    });
    const cover = new File(['cover'], 'cover.jpg', { type: 'image/jpeg' });

    await expect(
      publishTorqPost({
        text: 'notes',
        userName: 'Alice',
        files: [{ file: pdf, thumbnail: cover }],
      })
    ).rejects.toThrow('encode failed');

    expect(stashedIds).toEqual(['stash-1', 'stash-2']);
    expect(discardPublishFile.mock.calls.map((call) => call[0])).toEqual(
      stashedIds
    );
    expect(publishMultipleResources).not.toHaveBeenCalled();
  });
});
