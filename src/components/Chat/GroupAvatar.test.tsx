import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { darkTheme } from '../../styles/theme-dark';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  qdnAvatarKey,
  qdnGroupAvatarIdentifier,
} from '../../lib/qdnAvatars/keys';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
  PNG_BYTES,
} from '../../lib/qdnAvatars/testHarness';
import {
  fullSizeAvatarRequestUrl,
  resetAvatarPublishesForTests,
} from '../Group/avatarPreviewUrls';
import { GroupAvatar } from './GroupAvatar';

const show = vi.fn(async (..._args: unknown[]) => true);

vi.mock('../../App', async () => {
  const { createContext: makeContext } = await import('react');
  return {
    QORTAL_APP_CONTEXT: makeContext({
      show: (...args: unknown[]) => show(...args),
    }),
    getArbitraryEndpointReact: () => '/arbitrary/resources/search',
    getBaseApiReact: () => 'http://node:12391',
  };
});
vi.mock('../../background/background.ts', () => ({
  getFee: vi.fn(async () => ({ fee: '0.01' })),
}));
vi.mock('../../utils/fileReading', () => ({
  fileToBase64: vi.fn(async () => btoa(String.fromCharCode(...PNG_BYTES))),
}));
vi.mock('../../common/ImageUploader', () => ({
  default: ({ children, onPick }) => (
    <div onClick={() => onPick(new File(['x'], 'avatar.png'))}>{children}</div>
  ),
}));

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await flushAsync();
    });
  }
};

const GROUP_ID = 7;
const identifier = qdnGroupAvatarIdentifier(GROUP_ID);

beforeEach(() => {
  // The "does this group have an avatar" search.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => [] }))
  );
  window.sendMessage = vi.fn(async () => ({}));
});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
  resetAvatarPublishesForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const renderAvatar = (props = {}) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <GroupAvatar
        myName="Me"
        balance={10}
        setOpenSnack={vi.fn()}
        setInfoSnack={vi.fn()}
        groupId={GROUP_ID}
        onDialogClose={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  );

describe('GroupAvatar', () => {
  it('shows the cached group avatar even when the node search finds nothing', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    renderAvatar();
    await settle();

    expect(screen.getByAltText('Me').getAttribute('src')).toBe('blob:test/1');
    expect(screen.getByText('Change avatar')).toBeTruthy();
    expect(h.calls[0].url).toContain(
      `/arbitrary/THUMBNAIL/Me/${identifier}?async=true`
    );
  });

  it('loads the full size from the node only when the preview opens', async () => {
    const loads: string[] = [];
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        decoding = 'auto';
        set src(value: string) {
          loads.push(value);
        }
      }
    );
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    renderAvatar();
    await settle();

    const full = `http://node:12391/arbitrary/THUMBNAIL/Me/${identifier}`;
    const avatar = screen.getByAltText('Me');
    // The big avatar is the cached copy; no full-size request on mount.
    expect(avatar.getAttribute('src')).toBe('blob:test/1');
    expect(loads).not.toContain(full);
    fireEvent.click(avatar);
    expect(loads).toContain(full);
  });

  it('previews the cached copy at once while the full size loads', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    renderAvatar();
    await settle();

    // jsdom never loads the full-size image, like a very slow node.
    const avatar = screen.getByAltText('Me');
    fireEvent.click(avatar);
    const preview = screen.getAllByAltText('Me').find((img) => img !== avatar);
    expect(preview?.getAttribute('src')).toBe('blob:test/1');
  });

  it('offers to set an avatar when there is none', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { name }) => notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);
    renderAvatar();
    await settle();
    expect(screen.queryByAltText('Me')).toBeNull();
    expect(screen.getByText('Set avatar')).toBeTruthy();
  });

  it('puts a just-published avatar into the cache, without fetching before', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    renderAvatar({ externalOnly: true, dialogOpen: true });
    await settle();
    expect(h.calls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Choose image'));
    fireEvent.click(screen.getByText('Publish avatar'));
    await settle();

    expect(window.sendMessage).toHaveBeenCalledWith(
      'publishOnQDN',
      expect.objectContaining({ identifier, service: 'THUMBNAIL' })
    );
    expect(h.cache.getSnapshot(qdnAvatarKey('Me', identifier))).toEqual({
      src: 'blob:test/1',
      status: 'ready',
      source: 'cache',
    });
    expect(h.calls).toHaveLength(0);
    // Previews keep the new cached copy instead of the old node file.
    expect(
      fullSizeAvatarRequestUrl(
        `http://node:12391/arbitrary/THUMBNAIL/Me/${identifier}`
      )
    ).toBeNull();
  });
});
