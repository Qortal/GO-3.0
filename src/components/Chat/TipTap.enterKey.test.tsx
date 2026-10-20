import { fireEvent, render, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { isDisabledEditorEnterAtom } from '../../atoms/global';
import Tiptap from './TipTap';

const renderComposer = (onEnter: () => void) => {
  const view = render(
    <Tiptap
      compactChat
      isChat
      onEnter={onEnter}
      placeholder="Message"
      setEditorRef={() => undefined}
    />
  );
  return waitFor(() => {
    const node = view.container.querySelector('.tiptap-prosemirror');
    expect(node).not.toBeNull();
    return node as HTMLElement;
  });
};

describe('Enter in the chat composer (desktop)', () => {
  afterEach(() => {
    getDefaultStore().set(isDisabledEditorEnterAtom, false);
  });

  it('sends by default, and the keyboard shows a send key', async () => {
    const onEnter = vi.fn();
    const editor = await renderComposer(onEnter);
    expect(editor.getAttribute('enterkeyhint')).toBe('send');
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 13 });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('types a new line when switched to new line', async () => {
    getDefaultStore().set(isDisabledEditorEnterAtom, true);
    const onEnter = vi.fn();
    const editor = await renderComposer(onEnter);
    expect(editor.getAttribute('enterkeyhint')).toBe('enter');
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 13 });
    expect(onEnter).not.toHaveBeenCalled();
  });
});
