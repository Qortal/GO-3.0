import { act, cleanup, render } from '@testing-library/react';
import { createStore, Provider, useAtomValue } from 'jotai';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mobileTabBarCoveredAtom,
  useCoverMobileTabBar,
} from './mobileTabBarCover';

const Panel = ({ open }: { open: boolean }) => {
  useCoverMobileTabBar(open);
  return null;
};

const Covered = ({ onValue }: { onValue: (value: boolean) => void }) => {
  onValue(useAtomValue(mobileTabBarCoveredAtom));
  return null;
};

function setup() {
  const store = createStore();
  let covered = false;
  let setPanels: (panels: {
    a: boolean;
    b: boolean;
    mountB: boolean;
  }) => void = () => undefined;
  const Harness = () => {
    const [panels, set] = useState({ a: false, b: false, mountB: true });
    setPanels = set;
    return (
      <>
        <Panel open={panels.a} />
        {panels.mountB && <Panel open={panels.b} />}
        <Covered onValue={(value) => (covered = value)} />
      </>
    );
  };
  render(
    <Provider store={store}>
      <Harness />
    </Provider>
  );
  return {
    covered: () => covered,
    set: (panels: { a: boolean; b: boolean; mountB?: boolean }) =>
      act(() => setPanels({ mountB: true, ...panels })),
  };
}

describe('useCoverMobileTabBar', () => {
  afterEach(cleanup);

  it('covers the tab bar while a panel is open', () => {
    const view = setup();
    expect(view.covered()).toBe(false);
    view.set({ a: true, b: false });
    expect(view.covered()).toBe(true);
    view.set({ a: false, b: false });
    expect(view.covered()).toBe(false);
  });

  it('stays covered until the last open panel closes', () => {
    const view = setup();
    view.set({ a: true, b: true });
    view.set({ a: false, b: true });
    expect(view.covered()).toBe(true);
    view.set({ a: false, b: false });
    expect(view.covered()).toBe(false);
  });

  it('lets go when an open panel unmounts', () => {
    const view = setup();
    view.set({ a: false, b: true });
    expect(view.covered()).toBe(true);
    view.set({ a: false, b: true, mountB: false });
    expect(view.covered()).toBe(false);
  });
});
