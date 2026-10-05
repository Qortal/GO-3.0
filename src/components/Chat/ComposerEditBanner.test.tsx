import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/i18n';
import { ComposerEditBanner } from './ComposerEditBanner';

const originalMatchMedia = window.matchMedia;

const setTouch = (touch: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: touch && (query.includes('max-width') || query.includes('hover')),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderBanner = () => {
  const onCancel = vi.fn();
  render(
    <ComposerEditBanner
      desktopIcon={<span data-testid="desktop-icon" />}
      desktopPreview={<span>desktop preview</span>}
      onCancel={onCancel}
    />
  );
  return { onCancel };
};

describe('ComposerEditBanner', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('shows phones a clear card with a filled X that cancels the edit', () => {
    setTouch(true);
    const { onCancel } = renderBanner();
    expect(screen.getByText('Editing message')).toBeInTheDocument();
    expect(screen.queryByText('desktop preview')).not.toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel edit' });
    expect(getComputedStyle(cancel).width).toBe('40px');
    expect(cancel.querySelector('.composer-edit-cancel-disc')).not.toBeNull();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the desktop banner as it was', () => {
    setTouch(false);
    const { onCancel } = renderBanner();
    expect(screen.getByText('desktop preview')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-icon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
