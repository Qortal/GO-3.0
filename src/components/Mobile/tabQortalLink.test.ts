import { describe, expect, it } from 'vitest';
import { buildTabQortalUrl, liveTabQortalUrl } from './tabQortalLink';
import type { OpenTab } from './useOpenTabs';

const tab = {
  tabId: 'tab-1',
  service: 'APP',
  name: 'Torq',
} as OpenTab;

describe('tabQortalLink', () => {
  it('builds the root app link from the tab identity', () => {
    expect(buildTabQortalUrl(tab)).toBe('qortal://APP/Torq');
  });

  it('prefers the live QDN_RESOURCE_DISPLAYED post path', () => {
    expect(
      liveTabQortalUrl(tab, 'qortal://APP/Torq/post/alice/POST_9')
    ).toBe('qortal://APP/Torq/post/alice/POST_9');
  });

  it('falls back to the tab root when Hub has not reported a path yet', () => {
    expect(liveTabQortalUrl(tab, '')).toBe('qortal://APP/Torq');
  });
});
