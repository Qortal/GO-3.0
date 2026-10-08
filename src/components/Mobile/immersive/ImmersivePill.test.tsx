import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import { ImmersivePill } from './ImmersivePill';
import { IMMERSIVE_HINT_SEEN_STORAGE_KEY } from './immersiveMode';

const renderPill = (visible: boolean, onReveal = vi.fn()) =>
  render(
    <Provider store={createStore()}>
      <ImmersivePill visible={visible} onReveal={onReveal} />
    </Provider>
  );

describe('ImmersivePill', () => {
  beforeEach(() => {
    window.localStorage.removeItem(IMMERSIVE_HINT_SEEN_STORAGE_KEY);
  });

  it('is out only while the bars are away', () => {
    renderPill(false);
    expect(
      screen.queryByRole('button', { name: 'Show bars' })
    ).not.toBeInTheDocument();
  });

  it('brings the bars back on tap and retires the first-time hint', () => {
    const onReveal = vi.fn();
    renderPill(true, onReveal);
    fireEvent.click(screen.getByRole('button', { name: 'Show bars' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(IMMERSIVE_HINT_SEEN_STORAGE_KEY)).toBe(
      'true'
    );
  });

  it('shows the hint once, until Got it', async () => {
    renderPill(true);
    expect(
      await screen.findByText('Tap to bring the bars back', undefined, {
        timeout: 2000,
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(window.localStorage.getItem(IMMERSIVE_HINT_SEEN_STORAGE_KEY)).toBe(
      'true'
    );
  });
});
