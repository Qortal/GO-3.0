import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import { darkTheme } from '../../../styles/theme-dark';
import { AppBookmarksButton } from './AppBookmarksButton';
import {
  APP_BOOKMARKS_STORAGE_KEY,
  saveBookmarksForAddress,
} from './bookmarkStorage';
import type { AppBookmark } from './bookmarkTypes';

const ADDRESS = 'Qdesktop';

const bookmark = (id: string, appName: string): AppBookmark => ({
  id,
  name: appName,
  service: 'APP',
  appName,
  path: '',
  link: `qortal://APP/${appName}`,
  folderId: null,
  createdAt: 1,
  updatedAt: 1,
});

/** The desktop app's storage. */
const kept = new Map<string, unknown>();

beforeEach(() => {
  kept.clear();
  kept.set(APP_BOOKMARKS_STORAGE_KEY, {
    [ADDRESS]: { folders: [], bookmarks: [bookmark('b1', 'Q-Mail')] },
  });
  vi.stubGlobal('appStorage', {
    get: async (key: string) => structuredClone(kept.get(key)),
    set: async (key: string, value: unknown) => {
      kept.set(key, structuredClone(value));
    },
    delete: async () => undefined,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bookmarks menu', () => {
  it('reads the bookmarks again when they change elsewhere, so it never writes an old list back', async () => {
    const user = userEvent.setup();
    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={darkTheme}>
          <AppBookmarksButton address={ADDRESS} selectedTab={null} />
        </ThemeProvider>
      </Provider>
    );
    await user.click(screen.getByRole('button'));
    expect(await screen.findByText('Q-Mail')).toBeVisible();

    // The account's saved apps taken in from QDN add a bookmark.
    await act(async () => {
      await saveBookmarksForAddress(ADDRESS, {
        folders: [],
        bookmarks: [bookmark('b1', 'Q-Mail'), bookmark('b2', 'Q-Tube')],
        updatedAt: 2,
      });
    });

    expect(await screen.findByText('Q-Tube')).toBeVisible();
  });
});
