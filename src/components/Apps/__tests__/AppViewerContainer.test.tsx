import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: true }));

vi.mock('../../../utils/platform', () => ({
  isCapacitor: () => platform.native,
}));
vi.mock('../../Desktop/CustomTitleBar', () => ({ appChromeOffsetPx: '0px' }));
vi.mock('react-frame-component', () => ({
  default: ({ children }: { children: unknown }) => (
    <div data-testid="frame">{children as never}</div>
  ),
}));
vi.mock('../AppViewer', () => ({
  AppViewer: () => <div data-testid="viewer" />,
}));

import AppViewerContainer from '../AppViewerContainer';

let hidden = false;
let fullscreenElement: Element | null = null;

const setHidden = (value: boolean) => {
  hidden = value;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

const containerDisplay = (root: HTMLElement) =>
  window.getComputedStyle(
    root.querySelector('[data-testid="frame"]')!.parentElement!
  ).display;

describe('AppViewerContainer background pause', () => {
  beforeEach(() => {
    platform.native = true;
    hidden = false;
    fullscreenElement = null;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
  });

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).hidden;
    delete (document as unknown as Record<string, unknown>).fullscreenElement;
  });

  const renderSelected = () =>
    render(
      <AppViewerContainer
        app={{ tabId: 't1' }}
        hide={false}
        isDevMode={false}
        isSelected
      />
    );

  it('hides the open Q-App while GO is off screen and restores it', () => {
    const { container } = renderSelected();
    expect(containerDisplay(container)).toBe('flex');
    setHidden(true);
    expect(containerDisplay(container)).toBe('none');
    // The frame stays mounted: state and media survive the pause.
    expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull();
    setHidden(false);
    expect(containerDisplay(container)).toBe('flex');
  });

  it('leaves a fullscreen Q-App frame alone', () => {
    fullscreenElement = document.createElement('iframe');
    const { container } = renderSelected();
    setHidden(true);
    expect(containerDisplay(container)).toBe('flex');
  });

  it('never pauses on desktop', () => {
    platform.native = false;
    const { container } = renderSelected();
    setHidden(true);
    expect(containerDisplay(container)).toBe('flex');
  });
});
