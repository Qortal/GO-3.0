import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANDROID_BACK_EVENT } from '../bridge/capacitorBridge';
import { BACK_PRIORITY, useAndroidBack } from '../utils/androidBack';
import { ReactionPicker } from './ReactionPicker';

vi.mock('./Chat/gifs/ChatGifPicker', () => ({ ChatGifPicker: () => null }));
// The real picker needs IntersectionObserver; the stub shows the inline style
// it was given, which the library puts on its root <aside>.
vi.mock('emoji-picker-react', () => ({
  default: ({ style }: { style?: React.CSSProperties }) => (
    <aside data-testid="emoji-picker" style={style} />
  ),
  EmojiStyle: { NATIVE: 'native' },
  Theme: { DARK: 'dark' },
}));

const setPhone = (phone: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const trigger = () => screen.getByRole('button');

describe('ReactionPicker trigger size', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('keeps the 32px composer button by default', () => {
    render(<ReactionPicker compactComposer neutralIcon onReaction={vi.fn()} />);
    const style = getComputedStyle(trigger());
    expect(style.width).toBe('32px');
    expect(style.height).toBe('32px');
    expect(getComputedStyle(trigger().querySelector('svg')).fontSize).toBe(
      '23px'
    );
  });

  it('keeps the padded 18px icon in the desktop message toolbar', () => {
    render(<ReactionPicker neutralIcon onReaction={vi.fn()} />);
    expect(getComputedStyle(trigger()).padding).toBe('4px');
    expect(getComputedStyle(trigger().querySelector('svg')).fontSize).toBe(
      '18px'
    );
  });

  it('takes an explicit square size and icon size', () => {
    render(
      <ReactionPicker
        buttonSize={44}
        compactComposer
        iconSize={22}
        neutralIcon
        onReaction={vi.fn()}
      />
    );
    const style = getComputedStyle(trigger());
    expect(style.width).toBe('44px');
    expect(style.height).toBe('44px');
    expect(style.padding).toBe('0px');
    expect(getComputedStyle(trigger().querySelector('svg')).fontSize).toBe(
      '22px'
    );
  });
});

describe('ReactionPicker panel', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  const openPanel = () => {
    render(<ReactionPicker neutralIcon onReaction={vi.fn()} />);
    fireEvent.click(trigger());
    return screen.getByTestId('emoji-picker');
  };

  it('uses bigger emoji on phones', () => {
    setPhone(true);
    const panel = openPanel();
    expect(panel).not.toBeNull();
    expect(panel.style.getPropertyValue('--epr-emoji-size')).toBe('26px');
  });

  it('leaves the desktop emoji size to the stylesheet', () => {
    setPhone(false);
    const panel = openPanel();
    expect(panel).not.toBeNull();
    expect(panel.style.getPropertyValue('--epr-emoji-size')).toBe('');
  });
});

describe('ReactionPicker Android back', () => {
  const pressBack = () => {
    const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  };

  // A dialog the picker was opened over, registered first, as a thread's is.
  const Surface = ({ onBack }: { onBack: () => void }) => {
    useAndroidBack(
      () => {
        onBack();
        return true;
      },
      { priority: BACK_PRIORITY.dialog }
    );
    return <ReactionPicker neutralIcon onReaction={vi.fn()} />;
  };

  it('closes the open picker, not the surface under it', () => {
    const onSurfaceBack = vi.fn();
    const { unmount } = render(<Surface onBack={onSurfaceBack} />);
    fireEvent.click(trigger());
    expect(screen.getByTestId('emoji-picker')).not.toBeNull();

    expect(pressBack().defaultPrevented).toBe(true);
    expect(screen.queryByTestId('emoji-picker')).toBeNull();
    expect(onSurfaceBack).not.toHaveBeenCalled();

    // Closed, it leaves the next press to the surface.
    pressBack();
    expect(onSurfaceBack).toHaveBeenCalledTimes(1);
    unmount();
  });
});
