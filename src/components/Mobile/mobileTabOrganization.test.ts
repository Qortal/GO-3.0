import { describe, expect, it } from 'vitest';
import { getOpenTabKey, pinnedAppToOpenTab } from './mobileTabOrganization';

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
