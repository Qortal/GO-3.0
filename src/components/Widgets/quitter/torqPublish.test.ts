import { beforeEach, describe, expect, it, vi } from 'vitest';

const published: Record<string, unknown>[][] = [];

vi.mock('./quitterIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitterIdentity')>()),
  buildQuitterPostIdentifier: vi.fn(
    async () => 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-abcdefghijklmno-v1'
  ),
  quitterHashString: vi.fn(async (name: string) => `hash(${name})`),
}));

vi.mock('./quitterPublish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitterPublish')>()),
  publishMultipleResources: vi.fn(async (resources: Record<string, unknown>[]) => {
    published.push(resources);
    return {};
  }),
}));

import {
  buildQshareDescription,
  buildTorqAttachmentEmbed,
  needsTorqPostLink,
  normalizeTorqPoll,
  packTorqHashtagKeywords,
  publishTorqPost,
  torqFileRejection,
} from './torqPublish';

const decode = (base64: string) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));

beforeEach(() => {
  published.length = 0;
});

describe('Torq helpers', () => {
  it('normalizes polls like Torq: trim, drop empty and duplicate choices', () => {
    expect(normalizeTorqPoll([' Yes ', '', 'yes', 'No'])).toEqual({
      options: [
        { id: 'opt_1', text: 'Yes' },
        { id: 'opt_4', text: 'No' },
      ],
    });
    expect(normalizeTorqPoll(['Only one', ''])).toBeNull();
    const anon = normalizeTorqPoll(['A', 'B'], { anonymous: true });
    expect(anon?.anonymous).toBe(true);
    expect(atob(anon!.voteKey!).length).toBe(32);
  });

  it('packs every hashtag that fits the 240-byte description', () => {
    expect(packTorqHashtagKeywords(['#Qortal', '#qortal', '#Torq'], ['~@x~'])).toBe(
      '~#qortal~,~#torq~'
    );
    const many = Array.from({ length: 60 }, (_, i) => `#tag${i}`);
    const packed = packTorqHashtagKeywords(many);
    expect(new TextEncoder().encode(packed).length).toBeLessThanOrEqual(240);
  });

  it('keeps the post link inside the 240-char Q-Share description', () => {
    const link = 'qortal://APP/Torq/post/Alice/id';
    const { resource } = buildQshareDescription({
      title: 'song.mp3',
      postText: 'x'.repeat(400),
      postLink: link,
    });
    expect(resource.length).toBeLessThanOrEqual(240);
    expect(resource.endsWith(link)).toBe(true);
  });

  it('adds the Torq link when Quitter cannot show everything (Torq 1.2 rule)', () => {
    const base = { hasPoll: false, imageCount: 0, gifCount: 0, attachmentCount: 0 };
    expect(needsTorqPostLink(base)).toBe(false);
    expect(needsTorqPostLink({ ...base, imageCount: 4 })).toBe(false);
    expect(needsTorqPostLink({ ...base, imageCount: 5 })).toBe(true);
    expect(needsTorqPostLink({ ...base, hasPoll: true })).toBe(true);
    expect(needsTorqPostLink({ ...base, gifCount: 1 })).toBe(true);
    expect(needsTorqPostLink({ ...base, attachmentCount: 1 })).toBe(true);
  });

  it('rejects GIFs, videos and 2 GB files as attachments', () => {
    expect(torqFileRejection(new File(['x'], 'a.gif', { type: 'image/gif' }))).toBeTruthy();
    expect(torqFileRejection(new File(['x'], 'a.mp4', { type: 'video/mp4' }))).toBeTruthy();
    expect(torqFileRejection(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBeNull();
  });
});

describe('publishTorqPost', () => {
  it('publishes Quitter-compatible JSON with Torq extras and compat links', async () => {
    const file = new File(['hello'], 'notes.pdf', { type: 'application/pdf' });
    await publishTorqPost({
      text: 'Vote! #Qortal @Bob',
      richText: '<p>Vote! <b>#Qortal</b> @Bob</p>',
      userName: 'Alice',
      gifs: [{ identifier: 'gif-cat', name: 'Carol', service: 'IMAGE' }],
      poll: normalizeTorqPoll(['Yes', 'No']),
      files: [{ file }],
    });

    const resources = published[0];
    expect(resources.map((r) => r.service)).toEqual(['FILE', 'DOCUMENT', 'DOCUMENT']);
    const [fileResource, catalog, postResource] = resources;
    expect(String(fileResource.identifier)).toMatch(/^qshare_file_notespdf_[\w-]{6}$/);
    expect(fileResource.tag1).toBe('qshare_file_');
    expect(String(catalog.identifier)).toMatch(/^qshare_file_notespdf_[\w-]{6}_metadata$/);
    expect(postResource.identifier).toBe(
      'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-abcdefghijklmno-v1'
    );
    expect(postResource.description).toBe('~#qortal~,~@hash(Bob)~');

    const post = decode(String(postResource.base64));
    const postLink =
      'qortal://APP/Torq/post/Alice/MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-abcdefghijklmno-v1';
    const [lead, pollLink, gifLink, fileLink] = post.text.split('\n\n');
    expect(lead).toBe('Vote! #Qortal @Bob');
    expect(pollLink).toBe(postLink);
    expect(gifLink).toMatch(/^qortal:\/\/use-embed\/IMAGE\?name=Carol&identifier=gif-cat&service=IMAGE&mimeType=image%2Fgif&timestamp=\d+$/);
    expect(fileLink).toBe(buildTorqAttachmentEmbed(post.attachments[0]));
    expect(post.poll).toEqual({
      options: [
        { id: 'opt_1', text: 'Yes' },
        { id: 'opt_2', text: 'No' },
      ],
    });
    expect(post.gifs[0]).toMatchObject({
      identifier: 'gif-cat',
      libraryGif: true,
      mimeType: 'image/gif',
      name: 'Carol',
      service: 'IMAGE',
    });
    expect(post.attachments[0]).toMatchObject({
      name: 'Alice',
      service: 'FILE',
      identifier: fileResource.identifier,
      filename: 'notes.pdf',
      mimeType: 'application/pdf',
      size: 5,
      source: 'upload',
      shareIdentifier: catalog.identifier,
      shareName: 'Alice',
    });
    expect(post.richText).toBe('<p>Vote! <b>#Qortal</b> @Bob</p>');
    expect(post.name).toBe('Alice');
  });

  it('links GIF-only posts back to Torq, but not plain text posts', async () => {
    await publishTorqPost({
      text: 'Look',
      userName: 'Alice',
      gifs: [{ identifier: 'gif-cat', name: 'Carol', service: 'IMAGE' }],
    });
    await publishTorqPost({ text: 'Just words', userName: 'Alice' });
    const [gifPost, textPost] = published.map((resources) =>
      decode(String(resources[resources.length - 1].base64))
    );
    expect(gifPost.text.split('\n\n')[1]).toMatch(/^qortal:\/\/APP\/Torq\/post\/Alice\//);
    expect(textPost.text).toBe('Just words');
  });

  it('refuses an empty post', async () => {
    await expect(publishTorqPost({ text: '  ', userName: 'Alice' })).rejects.toThrow();
  });
});
