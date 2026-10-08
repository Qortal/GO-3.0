import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/i18n';

const clipboard = vi.hoisted(() => ({
  info: { hasImage: true, stamp: 1 } as { hasImage: boolean; stamp: number },
  file: new File(['png'], 'pasted-image.png', { type: 'image/png' }),
}));

vi.mock('../../utils/nativeClipboardImage', () => ({
  describeClipboardImage: vi.fn(async () => clipboard.info),
  readClipboardImageFile: vi.fn(async () => clipboard.file),
}));

import { ClipboardImagePasteChip } from './ClipboardImagePasteChip';

const anchor = () => {
  const node = document.createElement('div');
  document.body.appendChild(node);
  return node;
};

const settle = () => act(() => new Promise((done) => setTimeout(done, 0)));

describe('ClipboardImagePasteChip', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('offers a copied picture while the composer has focus', async () => {
    clipboard.info = { hasImage: true, stamp: 101 };
    const onPaste = vi.fn();
    render(
      <ClipboardImagePasteChip active anchorEl={anchor()} onPaste={onPaste} />
    );
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Paste image' }));
    await settle();
    expect(onPaste).toHaveBeenCalledWith(clipboard.file);
    // Pasted once: not offered again for the same copy.
    expect(
      screen.queryByRole('button', { name: 'Paste image' })
    ).not.toBeInTheDocument();
  });

  it('stays away once waved off, until something new is copied', async () => {
    clipboard.info = { hasImage: true, stamp: 202 };
    const node = anchor();
    const { rerender } = render(
      <ClipboardImagePasteChip active anchorEl={node} onPaste={vi.fn()} />
    );
    await settle();
    fireEvent.click(
      screen.getByRole('button', { name: "Don't paste the image" })
    );
    rerender(
      <ClipboardImagePasteChip
        active={false}
        anchorEl={node}
        onPaste={vi.fn()}
      />
    );
    rerender(
      <ClipboardImagePasteChip active anchorEl={node} onPaste={vi.fn()} />
    );
    await settle();
    expect(
      screen.queryByRole('button', { name: 'Paste image' })
    ).not.toBeInTheDocument();
    clipboard.info = { hasImage: true, stamp: 203 };
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(
      screen.getByRole('button', { name: 'Paste image' })
    ).toBeInTheDocument();
  });

  it('shows nothing without a picture or without focus', async () => {
    clipboard.info = { hasImage: false, stamp: 0 };
    const { rerender } = render(
      <ClipboardImagePasteChip active anchorEl={anchor()} onPaste={vi.fn()} />
    );
    await settle();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    clipboard.info = { hasImage: true, stamp: 303 };
    rerender(
      <ClipboardImagePasteChip
        active={false}
        anchorEl={anchor()}
        onPaste={vi.fn()}
      />
    );
    await settle();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
