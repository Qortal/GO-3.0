import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The real strings: the button's name is what a screen reader says.
import '../../i18n/i18n';
import { MobileTopBarSearch } from './MobileTopBarSearch';

// The catalog fetch only runs while the search is open.
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

const URL = 'qortal://APP/Q-Blog/post/1';

const renderBar = (
  props: Partial<Parameters<typeof MobileTopBarSearch>[0]>
) => {
  const onExpandedChange = vi.fn();
  const toggle = vi.fn();
  render(
    <Provider store={createStore()}>
      <MobileTopBarSearch
        activeTabUrl={URL}
        activeTabId="t1"
        expanded={false}
        onExpandedChange={onExpandedChange}
        showActiveTabUrl
        pin={{ pinned: false, toggle }}
        {...props}
      />
    </Provider>
  );
  return { onExpandedChange, toggle };
};

afterEach(() => {
  cleanup();
});

describe('MobileTopBarSearch pin', () => {
  it('sits in the address and pins without opening the address', () => {
    const { onExpandedChange, toggle } = renderBar({});
    const button = screen.getByRole('button', { name: 'Pin' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('shows a pinned app as pinned, with Unpin', () => {
    renderBar({ pin: { pinned: true, toggle: vi.fn() } });
    const button = screen.getByRole('button', { name: 'Unpin' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('the rest of the address still opens it for editing', () => {
    const { onExpandedChange } = renderBar({});
    fireEvent.click(screen.getByRole('textbox'));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('is not there with nothing to pin, or without an address', () => {
    renderBar({ pin: null });
    expect(screen.queryByRole('button', { name: 'Pin' })).toBe(null);
    cleanup();
    renderBar({ showActiveTabUrl: false, activeTabUrl: '' });
    expect(screen.queryByRole('button', { name: 'Pin' })).toBe(null);
  });

  it('is not there while the address is open for editing', () => {
    renderBar({ expanded: true, showActiveTabUrl: false });
    expect(screen.queryByRole('button', { name: 'Pin' })).toBe(null);
  });
});
