import { describe, expect, it } from 'vitest';
import {
  emptyOrganization,
  getOpenTabKey,
  pinnedAppToOpenTab,
  renameTabKeyInOrganization,
} from './mobileTabOrganization';

describe('pinnedAppToOpenTab', () => {
  it('maps a public app pin', () => {
    const tab = pinnedAppToOpenTab({ name: 'Q-Blog', service: 'APP' });
    expect(tab).toMatchObject({
      name: 'Q-Blog',
      service: 'APP',
      label: 'Q-Blog',
    });
    expect(getOpenTabKey(tab!)).toBe('APP|Q-Blog');
  });

  it('maps a website pin', () => {
    const tab = pinnedAppToOpenTab({ name: 'MySite', service: 'WEBSITE' });
    expect(getOpenTabKey(tab!)).toBe('WEBSITE|MySite');
  });

  it('maps a private pin', () => {
    const tab = pinnedAppToOpenTab({
      isPrivate: true,
      privateAppProperties: {
        service: 'APP',
        name: 'MyGroupApp',
        identifier: 'zip',
        groupId: 42,
        appName: 'My Group App',
      },
    });
    expect(tab).toMatchObject({
      isPrivate: true,
      name: 'MyGroupApp',
      service: 'APP',
      identifier: 'zip',
      label: 'My Group App',
    });
    expect(getOpenTabKey(tab!)).toBe('APP|MyGroupApp|zip');
  });

  it('skips nameless pins', () => {
    expect(pinnedAppToOpenTab({ service: 'APP' })).toBeNull();
    expect(
      pinnedAppToOpenTab({ isPrivate: true, privateAppProperties: {} })
    ).toBeNull();
    expect(pinnedAppToOpenTab(null)).toBeNull();
  });
});

describe('renameTabKeyInOrganization', () => {
  it('keeps the folder row count when a tab address changes', () => {
    const organization = {
      folders: [
        { id: 'f1', name: 'Social', order: 0, row: 0, tabKeys: ['APP|Q-Blog'] },
        { id: 'f2', name: 'Sales', order: 0, row: 1, tabKeys: [] },
      ],
      folderRowCount: 3,
      savedTabs: {},
      tabFolderMap: { 'APP|Q-Blog': 'f1' },
      tabOverrides: {},
    };

    const renamed = renameTabKeyInOrganization(
      organization,
      'APP|Q-Blog',
      'APP|Q-Blog|post'
    );

    expect(renamed.folderRowCount).toBe(3);
    expect(renamed.folders[0].tabKeys).toEqual(['APP|Q-Blog|post']);
    expect(renamed.tabFolderMap).toEqual({ 'APP|Q-Blog|post': 'f1' });
  });
});

describe('getOpenTabKey', () => {
  it('keys an open tab by its app', () => {
    expect(getOpenTabKey({ tabId: 't1', service: 'app', name: 'Q-Tube' })).toBe(
      'APP|Q-Tube'
    );
    expect(
      getOpenTabKey({
        tabId: 't2',
        service: 'WEBSITE',
        name: 'blog',
        identifier: 'x',
      })
    ).toBe('WEBSITE|blog|x');
  });

  it('keeps the key a saved entry is saved under', () => {
    // A bookmark of a page inside an app has a key of its own.
    expect(
      getOpenTabKey({
        tabId: 'saved:bookmark:b1',
        service: 'APP',
        name: 'Q-Tube',
        path: 'playlists',
      })
    ).toBe('bookmark:b1');
    expect(
      getOpenTabKey({
        tabId: 'saved:APP|Q-Mail',
        service: 'APP',
        name: 'Q-Mail',
      })
    ).toBe('APP|Q-Mail');
  });

  it('keys a saved entry that has no key yet by its app', () => {
    expect(
      getOpenTabKey({ tabId: 'saved:pending', service: 'APP', name: 'Q-Mail' })
    ).toBe('APP|Q-Mail');
  });
});
