import { describe, expect, it } from 'vitest';
import { groupTabsIntoStacks, stackKeyFor, tabPageLabel } from './tabStacks';

const tab = (
  tabId: string,
  name: string,
  extra: Record<string, unknown> = {}
) => ({
  tabId,
  service: 'APP',
  name,
  ...extra,
});

describe('groupTabsIntoStacks', () => {
  it('stacks tabs of the same app whatever page they are on', () => {
    const stacks = groupTabsIntoStacks(
      [
        tab('1', 'Q-Tube'),
        tab('2', 'Q-Mail'),
        tab('3', 'q-tube', { path: '/video/abc' }),
        tab('4', 'Q-Tube', { identifier: 'channel' }),
      ],
      null
    );
    expect(stacks.map((stack) => stack.tabs.map((item) => item.tabId))).toEqual(
      [['1', '3', '4'], ['2']]
    );
  });

  it('keeps websites apart from apps of the same name', () => {
    const stacks = groupTabsIntoStacks(
      [tab('1', 'Torq'), tab('2', 'Torq', { service: 'WEBSITE' })],
      null
    );
    expect(stacks).toHaveLength(2);
  });

  it('leads with the active tab, else the newest', () => {
    const tabs = [tab('1', 'Q-Tube'), tab('2', 'Q-Tube'), tab('3', 'Q-Tube')];
    expect(groupTabsIntoStacks(tabs, '1')[0].lead.tabId).toBe('1');
    expect(groupTabsIntoStacks(tabs, null)[0].lead.tabId).toBe('3');
  });

  it('stacks private apps only with the same app', () => {
    const a = tab('1', 'Publisher', {
      isPrivate: true,
      privateAppProperties: {
        name: 'Publisher',
        identifier: 'app-a',
        service: 'APP',
      },
    });
    const b = tab('2', 'Publisher', {
      isPrivate: true,
      privateAppProperties: {
        name: 'Publisher',
        identifier: 'app-b',
        service: 'APP',
      },
    });
    expect(stackKeyFor(a)).not.toBe(stackKeyFor(b));
  });
});

describe('tabPageLabel', () => {
  it('names the page a tab is on', () => {
    expect(tabPageLabel(tab('1', 'Q-Tube', { path: 'video/abc' }))).toBe(
      '/video/abc'
    );
    expect(tabPageLabel(tab('1', 'Q-Tube'))).toBe('/');
  });
});
