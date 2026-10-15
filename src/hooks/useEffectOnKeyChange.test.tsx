import { act, cleanup, render } from '@testing-library/react';
import { Activity, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEffectOnKeyChange } from './useEffectOnKeyChange';

const runs: string[] = [];
const plainRuns: string[] = [];

const Probe = ({ group }: { group: string }) => {
  useEffectOnKeyChange(group, () => {
    runs.push(group);
  });
  // What a plain [group] effect does, for comparison.
  useEffect(() => {
    plainRuns.push(group);
  }, [group]);
  return null;
};

const renderInActivity = (group: string, visible: boolean) => (
  <Activity mode={visible ? 'visible' : 'hidden'}>
    <Probe group={group} />
  </Activity>
);

describe('useEffectOnKeyChange', () => {
  afterEach(() => {
    cleanup();
    runs.length = 0;
    plainRuns.length = 0;
  });

  it('runs on mount and when the key changes', () => {
    const view = render(renderInActivity('a', true));
    expect(runs).toEqual(['a']);
    act(() => view.rerender(renderInActivity('b', true)));
    expect(runs).toEqual(['a', 'b']);
  });

  it('does not run again when a hidden Activity is shown again', () => {
    const view = render(renderInActivity('a', true));
    act(() => view.rerender(renderInActivity('a', false)));
    act(() => view.rerender(renderInActivity('a', true)));
    // A plain [group] effect runs again on show; the key-change one does not.
    expect(plainRuns).toEqual(['a', 'a']);
    expect(runs).toEqual(['a']);
  });

  it('runs for a key that changed while hidden', () => {
    const view = render(renderInActivity('a', true));
    act(() => view.rerender(renderInActivity('a', false)));
    act(() => view.rerender(renderInActivity('b', false)));
    act(() => view.rerender(renderInActivity('b', true)));
    expect(runs).toEqual(['a', 'b']);
  });
});
