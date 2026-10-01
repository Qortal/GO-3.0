import { describe, expect, it } from 'vitest';
import {
  addTabToNamedFolder,
  emptyOrganization,
  findFolderForTabKey,
  getOpenTabKey,
  libraryAppToOpenTab,
  pinnedAppToOpenTab,
  removeTabKeyFromFolders,
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
    expect(pinnedAppToOpenTab({ isPrivate: true, privateAppProperties: {} })).toBeNull();
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

describe('libraryAppToOpenTab', () => {
  it('keys a library app like the tab that opening it creates', () => {
    const tab = libraryAppToOpenTab({
      name: 'Q-Blog',
      service: 'APP',
      metadata: { title: 'Q-Blog Reader' },
    });
    expect(getOpenTabKey(tab!)).toBe('APP|Q-Blog');
    expect(tab?.label).toBe('Q-Blog Reader');
  });

  it('skips nameless apps', () => {
    expect(libraryAppToOpenTab({ service: 'APP' })).toBeNull();
    expect(libraryAppToOpenTab(null)).toBeNull();
  });
});

describe('addTabToNamedFolder', () => {
  const blog = libraryAppToOpenTab({ name: 'Q-Blog', service: 'APP' })!;
  const site = libraryAppToOpenTab({ name: 'MySite', service: 'WEBSITE' })!;

  it('creates the folder at the end of the first row', () => {
    const start = {
      ...emptyOrganization(),
      folders: [
        { id: 'f1', name: 'Social', order: 0, row: 0, tabKeys: [] },
        { id: 'f2', name: 'Sales', order: 0, row: 1, tabKeys: [] },
      ],
      folderRowCount: 2,
    };
    const { organization, folder } = addTabToNamedFolder(
      start,
      blog,
      'Library',
      'new-id'
    );
    expect(folder).toEqual({
      id: 'new-id',
      name: 'Library',
      order: 1,
      row: 0,
      tabKeys: ['APP|Q-Blog'],
    });
    expect(organization.tabFolderMap['APP|Q-Blog']).toBe('new-id');
    expect(organization.savedTabs['APP|Q-Blog']).toMatchObject({
      name: 'Q-Blog',
      service: 'APP',
    });
    expect(organization.folderRowCount).toBe(2);
  });

  it('reuses an existing folder regardless of case', () => {
    const first = addTabToNamedFolder(
      emptyOrganization(),
      blog,
      'Library',
      'lib'
    ).organization;
    const renamed = {
      ...first,
      folders: first.folders.map((f) => ({ ...f, name: ' library ' })),
    };
    const { organization, folder } = addTabToNamedFolder(
      renamed,
      site,
      'Library',
      'unused'
    );
    expect(organization.folders).toHaveLength(1);
    expect(folder.id).toBe('lib');
    expect(folder.tabKeys).toEqual(['APP|Q-Blog', 'WEBSITE|MySite']);
  });

  it('moves the tab out of the folder it was in', () => {
    const start = {
      ...emptyOrganization(),
      folders: [
        { id: 'f1', name: 'Social', order: 0, row: 0, tabKeys: ['APP|Q-Blog'] },
      ],
      tabFolderMap: { 'APP|Q-Blog': 'f1' },
    };
    const { organization } = addTabToNamedFolder(start, blog, 'Library', 'lib');
    expect(organization.folders.find((f) => f.id === 'f1')?.tabKeys).toEqual(
      []
    );
    expect(findFolderForTabKey(organization, 'APP|Q-Blog')?.id).toBe('lib');
  });
});

describe('removeTabKeyFromFolders', () => {
  it('removes the tab and its saved shell but keeps the folder', () => {
    const blog = libraryAppToOpenTab({ name: 'Q-Blog', service: 'APP' })!;
    const pinned = addTabToNamedFolder(
      emptyOrganization(),
      blog,
      'Library',
      'lib'
    ).organization;
    const organization = removeTabKeyFromFolders(pinned, 'APP|Q-Blog');
    expect(organization.folders).toEqual([
      { id: 'lib', name: 'Library', order: 0, row: 0, tabKeys: [] },
    ]);
    expect(organization.tabFolderMap).toEqual({});
    expect(organization.savedTabs).toEqual({});
  });

  it('returns the same object when the tab is in no folder', () => {
    const organization = emptyOrganization();
    expect(removeTabKeyFromFolders(organization, 'APP|Q-Blog')).toBe(
      organization
    );
  });
});
