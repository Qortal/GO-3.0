import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

const mockExecuteEvent = vi.fn();
vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => mockExecuteEvent(...args),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));

vi.mock('../../../plugins/ShareReceiver', () => ({
  ShareReceiver: {
    setShareTarget: vi.fn(async () => undefined),
    getPendingShare: vi.fn(async () => []),
    consumeSharedFile: vi.fn(async () => undefined),
    addShareListener: vi.fn(async () => null),
  },
  isShareReceiverAvailable: () => false,
}));

// A plain field for the rich editor: typing in it gives the composer the
// document Torq's editor would.
vi.mock('./TorqTextEditor', async () => {
  const { plainTextToTorqDoc } = await import('./torqRichText');
  return {
    TorqTextEditor: ({
      autoFocus,
      onChange,
    }: {
      autoFocus?: boolean;
      onChange: (doc: unknown) => void;
    }) => (
      <textarea
        aria-label="post text"
        data-autofocus={autoFocus ? 'yes' : 'no'}
        onChange={(event) => onChange(plainTextToTorqDoc(event.target.value))}
      />
    ),
  };
});

const publishTorqPost = vi.hoisted(() => vi.fn());
vi.mock('./torqPublish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./torqPublish')>()),
  publishTorqPost,
}));

// What the "Torq" share-sheet entry left for the composer (quitterShareIntake).
const shared = vi.hoisted(() => ({ media: null as unknown }));
vi.mock('./quitterShareIntake', () => ({
  QUITTER_SHARED_MEDIA_EVENT: 'quitterSharedMedia',
  takePendingQuitterShare: () => {
    const media = shared.media;
    shared.media = null;
    return media;
  },
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      group: {
        home_composer: {
          action_rev: 'Rev',
          rev_aria: 'make a Rev in Torq',
          open_app: 'open {{app}}',
          open_latest_post: 'open latest post',
          post_to: 'post to {{app}}',
          published_to: 'published to {{app}}',
          status: { preparing: 'preparing…', published: 'published' },
        },
      },
      core: { action: { cancel: 'cancel', hide: 'hide', publish: 'publish' } },
    },
  },
  interpolation: { escapeValue: false },
});

import { getDefaultStore } from 'jotai';
import { userInfoAtom } from '../../../atoms/global';
import { HomeQuitterComposer } from './HomeQuitterComposer';
import {
  clearQuitterComposerSession,
  homeComposerOpenAtom,
} from './quitterComposerSession';

const renderComposer = (onPublished = vi.fn()) => {
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <HomeQuitterComposer onPublished={onPublished} />
      </I18nextProvider>
    </ThemeProvider>
  );
  return onPublished;
};

const entry = () => screen.getByRole('button', { name: 'Post to Torq' });
const typePost = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'post text' }), {
    target: { value: text },
  });

beforeEach(() => {
  mockExecuteEvent.mockClear();
  publishTorqPost.mockReset();
  localStorage.clear();
  clearQuitterComposerSession();
  getDefaultStore().set(userInfoAtom, { name: 'Alice' } as any);
});

describe('HomeQuitterComposer in the Torq feed window', () => {
  it('folds to a Post to Torq entry that opens the composer in place', () => {
    renderComposer();
    expect(screen.queryByRole('textbox', { name: 'post text' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();

    fireEvent.click(entry());

    const editor = screen.getByRole('textbox', { name: 'post text' });
    // The cursor goes in, so the keyboard comes up with the composer.
    expect(editor).toHaveAttribute('data-autofocus', 'yes');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(getDefaultStore().get(homeComposerOpenAtom)).toBe(true);
    // Torq only: no Torq | Quitter switch any more.
    expect(screen.queryByRole('group', { name: 'Publish to' })).toBeNull();
    expect(screen.queryByText('Quitter')).toBeNull();
  });

  it('folds away on Cancel and keeps the draft for next time', () => {
    renderComposer();
    fireEvent.click(entry());
    typePost('Half a thought');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('textbox', { name: 'post text' })).toBeNull();
    expect(getDefaultStore().get(homeComposerOpenAtom)).toBe(false);
    // The entry shows the draft's first line.
    expect(entry()).toHaveTextContent('Half a thought');

    fireEvent.click(entry());
    expect(screen.getByRole('textbox', { name: 'post text' })).toBeVisible();
  });

  it('folds with the arrow beside the title, too', () => {
    renderComposer();
    fireEvent.click(entry());
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('textbox', { name: 'post text' })).toBeNull();
  });

  it('publishes to Torq, folds away and hands the post to the feed', async () => {
    const post = { name: 'Alice', text: 'Hello Torq', timestamp: 1700 };
    publishTorqPost.mockResolvedValue({ postIdentifier: 'qpost-1', post });
    const onPublished = renderComposer();

    fireEvent.click(entry());
    typePost('Hello Torq');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(onPublished).toHaveBeenCalledWith({
        author: 'Alice',
        post,
        postIdentifier: 'qpost-1',
      })
    );
    expect(publishTorqPost).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello Torq', userName: 'Alice' })
    );
    // Folded again, the draft gone, and a way to the post in Torq.
    expect(screen.queryByRole('textbox', { name: 'post text' })).toBeNull();
    expect(entry()).toHaveTextContent('Post to Torq');
    expect(screen.getByText('Published to Torq')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open latest post' }));
    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: {
        identifier: '',
        name: 'Torq',
        path: 'post/Alice/qpost-1',
        service: 'APP',
      },
    });
  });

  it('stays open with the draft when publishing fails', async () => {
    publishTorqPost.mockRejectedValue(new Error('node said no'));
    const onPublished = renderComposer();
    fireEvent.click(entry());
    typePost('Try this');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByText('node said no')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'post text' })).toBeVisible();
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('opens with a photo shared to Torq and scrolls Home to it', async () => {
    const { createObjectURL } = URL;
    const { scrollIntoView } = Element.prototype;
    const scrolled = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:shared-photo');
    // jsdom has none: the composer brings itself into view with it.
    Element.prototype.scrollIntoView = scrolled;
    try {
      const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'IMG.jpg', {
        type: 'image/jpeg',
      });
      shared.media = {
        images: [{ file: photo, mimeType: 'image/jpeg' }],
        video: null,
      };
      // As on a cold start from the share sheet: the composer mounts after
      // the share arrived and takes it.
      renderComposer();

      expect(getDefaultStore().get(homeComposerOpenAtom)).toBe(true);
      expect(screen.getByRole('textbox', { name: 'post text' })).toBeVisible();
      expect(document.querySelector('img[src="blob:shared-photo"]')).not.toBe(
        null
      );
      // A photo alone is a post.
      expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
      await waitFor(
        () =>
          expect(scrolled).toHaveBeenCalledWith({
            behavior: 'smooth',
            block: 'start',
          }),
        { timeout: 2000 }
      );
    } finally {
      URL.createObjectURL = createObjectURL;
      Element.prototype.scrollIntoView = scrollIntoView;
    }
  });

  it('opens Torq from its logo and Torq Rev from the Rev button', () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Open Torq' }));
    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: { identifier: '', name: 'Torq', service: 'APP' },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});

    mockExecuteEvent.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Make a Rev in Torq' }));
    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: {
        identifier: '',
        name: 'Torq',
        navigateIfAlreadyOpen: true,
        path: 'rev/new',
        service: 'APP',
      },
    });
  });
});
