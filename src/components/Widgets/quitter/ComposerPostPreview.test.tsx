import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

const prepared = new File(['jpg'], 'cover.jpg', { type: 'image/jpeg' });
vi.mock('./torqPublish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./torqPublish')>()),
  prepareTorqThumbnail: vi.fn(async () => prepared),
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      group: {
        home_composer: {
          add_thumbnail: 'add thumbnail',
          audio_play: 'play',
          edit_attachment: 'edit {{name}}',
          move_file_down: 'move {{name}} down',
          remove_file: 'remove {{name}}',
          remove_image: 'remove image',
          move_image_earlier: 'move image earlier',
          move_image_later: 'move image later',
        },
      },
    },
  },
  interpolation: { escapeValue: false },
});

import {
  composerMediaGridSx,
  ComposerAttachmentCards,
  ComposerImageGrid,
} from './ComposerPostPreview';
import type { SessionFileDraft } from './quitterComposerSession';

const wrap = (ui: React.ReactElement) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </ThemeProvider>
  );

const createdBlobs: Blob[] = [];
beforeEach(() => {
  createdBlobs.length = 0;
  (URL as any).createObjectURL = vi.fn((blob: Blob) => {
    createdBlobs.push(blob);
    return `blob:test/${createdBlobs.length}`;
  });
  (URL as any).revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.clearAllMocks();
});

const audio: SessionFileDraft = {
  id: 'a1',
  file: new File(['abc'], 'Voice 001.m4a', { type: '' }),
};
const pdf: SessionFileDraft = {
  id: 'p1',
  file: new File(['%PDF-1'], 'notes.pdf', { type: 'application/pdf' }),
};

describe('ComposerAttachmentCards', () => {
  it('shows audio as the post player and other files as post cards', () => {
    const onEdit = vi.fn();
    wrap(
      <ComposerAttachmentCards
        files={[audio, pdf]}
        userName="Alice"
        onRemove={vi.fn()}
        onMove={vi.fn()}
        onEdit={onEdit}
        onThumbnail={vi.fn()}
        onError={vi.fn()}
      />
    );
    // The audio plays from the device, typed so .m4a works before publish.
    expect(screen.getByTestId('composer-audio-card')).toBeInTheDocument();
    expect(screen.getByText('Voice 001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(createdBlobs[0].type).toBe('audio/mp4');
    // The file card: title, then file name · size · author.
    expect(screen.getByText('notes')).toBeInTheDocument();
    expect(screen.getByText('notes.pdf · 1 KB · Alice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes.pdf' }));
    expect(onEdit).toHaveBeenCalledWith('p1');
  });

  it('adds a thumbnail when the cover is tapped', async () => {
    const onThumbnail = vi.fn();
    wrap(
      <ComposerAttachmentCards
        files={[pdf]}
        userName="Alice"
        onRemove={vi.fn()}
        onMove={vi.fn()}
        onEdit={vi.fn()}
        onThumbnail={onThumbnail}
        onError={vi.fn()}
      />
    );
    const input = screen.getByTestId('composer-thumbnail-input');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Add thumbnail' }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, {
      target: { files: [new File(['png'], 'pic.png', { type: 'image/png' })] },
    });
    await waitFor(() =>
      expect(onThumbnail).toHaveBeenCalledWith('p1', prepared)
    );
  });
});

describe('ComposerImageGrid', () => {
  it('lays pictures out like the post grid, with remove and reorder', () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    wrap(
      <ComposerImageGrid
        images={[
          { id: 'i1', previewUrl: 'blob:1' },
          { id: 'i2', previewUrl: 'blob:2' },
        ]}
        onRemove={onRemove}
        onMove={onMove}
      />
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Move image later' })[0]
    );
    expect(onMove).toHaveBeenCalledWith(0, 1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove image' })[1]);
    expect(onRemove).toHaveBeenCalledWith('i2');
  });

  it('uses Torq column counts', () => {
    expect(composerMediaGridSx(1).gridTemplateColumns).toBe('repeat(1, 1fr)');
    expect(composerMediaGridSx(3).gridTemplateColumns).toBe('repeat(2, 1fr)');
    expect(composerMediaGridSx(6).gridTemplateColumns).toBe('repeat(3, 1fr)');
  });
});
