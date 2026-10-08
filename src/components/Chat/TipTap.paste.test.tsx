import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';

const native = vi.hoisted(() => ({
  available: false,
  file: null as File | null,
}));
vi.mock('../../utils/nativeClipboardImage', () => ({
  noteClipboardIssue: vi.fn(),
  hasNativeClipboardImages: () => native.available,
  readClipboardImageFile: vi.fn(async () => native.file),
  claimKeyboardImageTarget: () => () => undefined,
  describeClipboardImage: async () => null,
}));

import Tiptap from './TipTap';

const photo = () =>
  new File(
    [
      readFileSync(
        resolve(
          __dirname,
          '../../utils/__fixtures__/media-metadata/phone-exif-gps.jpg'
        )
      ),
    ],
    'IMG_at_home.jpg',
    { type: 'image/jpeg' }
  );

const textOf = (file: Blob) =>
  new Promise<string>((done) => {
    const reader = new FileReader();
    reader.onload = () =>
      done(Buffer.from(reader.result as ArrayBuffer).toString('latin1'));
    reader.readAsArrayBuffer(file);
  });

const setPhone = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderComposer = (insertFiles: (files: File[]) => void) =>
  render(
    <Tiptap
      compactChat
      insertFiles={insertFiles}
      isChat
      onEnter={() => undefined}
      placeholder="Message"
      setEditorRef={() => undefined}
    />
  );

const paste = (target: Element, files: File[]) =>
  fireEvent.paste(target, {
    clipboardData: {
      files,
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
      types: files.length ? ['Files'] : [],
      getData: () => '',
    },
  });

describe('pasting a picture into the chat composer', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    setPhone();
    native.available = false;
    native.file = null;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  const expectCleaned = async (insertFiles: ReturnType<typeof vi.fn>) => {
    await waitFor(() => expect(insertFiles).toHaveBeenCalledTimes(1));
    const [[files]] = insertFiles.mock.calls as [[File[]]];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('pasted-image.jpg');
    const body = await textOf(files[0]);
    expect(body).not.toContain('GPSSECRET');
    expect(body).not.toContain('PrivateModel');
  };

  it('cleans a picture the paste carries before it is attached', async () => {
    const insertFiles = vi.fn();
    const view = renderComposer(insertFiles);
    const editor = await waitFor(() => {
      const node = view.container.querySelector('.tiptap-prosemirror');
      expect(node).not.toBeNull();
      return node as Element;
    });
    paste(editor, [photo()]);
    await expectCleaned(insertFiles);
  });

  it('on Android takes the clipboard’s picture over the WebView’s file', async () => {
    native.available = true;
    native.file = photo();
    const insertFiles = vi.fn();
    const view = renderComposer(insertFiles);
    const editor = await waitFor(() => {
      const node = view.container.querySelector('.tiptap-prosemirror');
      expect(node).not.toBeNull();
      return node as Element;
    });
    // What the WebView hands over can be a file that no longer reads.
    const unreadable = new File([new Uint8Array(16)], 'image.png', {
      type: 'image/png',
    });
    paste(editor, [unreadable]);
    await expectCleaned(insertFiles);
  });

  it('falls back to the WebView’s file when the clipboard has none', async () => {
    native.available = true;
    native.file = null;
    const insertFiles = vi.fn();
    const view = renderComposer(insertFiles);
    const editor = await waitFor(() => {
      const node = view.container.querySelector('.tiptap-prosemirror');
      expect(node).not.toBeNull();
      return node as Element;
    });
    paste(editor, [photo()]);
    await expectCleaned(insertFiles);
  });

  it('reads it from the Android clipboard when the paste comes empty', async () => {
    native.available = true;
    native.file = photo();
    const insertFiles = vi.fn();
    const view = renderComposer(insertFiles);
    const editor = await waitFor(() => {
      const node = view.container.querySelector('.tiptap-prosemirror');
      expect(node).not.toBeNull();
      return node as Element;
    });
    paste(editor, []);
    await expectCleaned(insertFiles);
  });
});
