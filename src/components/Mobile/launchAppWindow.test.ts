import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { launchAppWindow } from './useOpenTabs';

const listen = (name: string) => {
  const calls: unknown[] = [];
  const handler = (event: CustomEvent) => calls.push(event.detail?.data);
  subscribeToEvent(name, handler);
  return { calls, stop: () => unsubscribeFromEvent(name, handler) };
};

describe('launchAppWindow', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    vi.restoreAllMocks();
  });

  it('opens an open app again in a new window', () => {
    const addTab = listen('addTab');
    const select = listen('setSelectedTab');
    stops.push(addTab.stop, select.stop);
    launchAppWindow({
      tabId: 'abc',
      service: 'APP',
      name: 'Q-Tube',
      label: 'Q-Tube',
    });
    expect(select.calls).toHaveLength(0);
    expect(addTab.calls).toEqual([
      {
        service: 'APP',
        name: 'Q-Tube',
        identifier: undefined,
        label: 'Q-Tube',
      },
    ]);
  });

  it('opens a pinned app that is not open yet', () => {
    const addTab = listen('addTab');
    stops.push(addTab.stop);
    launchAppWindow({
      tabId: 'saved:APP|Q-Mail',
      service: 'APP',
      name: 'Q-Mail',
    });
    expect(addTab.calls).toHaveLength(1);
    expect(addTab.calls[0]).toMatchObject({
      name: 'Q-Mail',
      navigateIfAlreadyOpen: true,
    });
  });
});
