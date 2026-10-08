import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it } from 'vitest';
import '../../../i18n/i18n';
import { ImmersiveModeSetting } from './ImmersiveModeSetting';
import { IMMERSIVE_MODE_STORAGE_KEY } from './immersiveMode';

const renderSetting = () =>
  render(
    <Provider store={createStore()}>
      <ImmersiveModeSetting />
    </Provider>
  );

describe('ImmersiveModeSetting', () => {
  beforeEach(() => {
    window.localStorage.removeItem(IMMERSIVE_MODE_STORAGE_KEY);
  });

  it('starts on Auto and offers Off, Auto and Manual', () => {
    renderSetting();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent)).toEqual([
      'Off',
      'Auto',
      'Manual',
    ]);
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(
      screen.getByText(/slide away when scrolling down/)
    ).toBeInTheDocument();
  });

  it('keeps a saved Off', async () => {
    window.localStorage.setItem(IMMERSIVE_MODE_STORAGE_KEY, '"off"');
    renderSetting();
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(
      await screen.findByText('The top and bottom bars are always shown.')
    ).toBeInTheDocument();
  });

  it('saves the choice and explains it', async () => {
    renderSetting();
    fireEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    expect(screen.getByRole('radio', { name: 'Manual' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(window.localStorage.getItem(IMMERSIVE_MODE_STORAGE_KEY)).toBe(
      '"manual"'
    );
    expect(
      await screen.findByText(/Tap the floating button to show them/)
    ).toBeInTheDocument();
  });

  it('reads a saved choice back', () => {
    window.localStorage.setItem(IMMERSIVE_MODE_STORAGE_KEY, '"auto"');
    renderSetting();
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });
});
