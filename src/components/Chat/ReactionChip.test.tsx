import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactionChip } from './ReactionChip';
import { DESKTOP_MESSAGE_ACTION_SIZES } from './messageActionSizes';

const props = {
  reaction: '🔥',
  sizes: DESKTOP_MESSAGE_ACTION_SIZES,
  messageKey: 'sig-1',
  // Mounted long ago: changes from here on are live.
  mountedAt: 0,
  onToggle: () => {},
  onShowWho: () => {},
  onTouchStart: () => {},
  onTouchMove: () => {},
  onTouchEnd: () => {},
};

describe('ReactionChip', () => {
  let animate: ReturnType<typeof vi.fn>;
  const original = HTMLElement.prototype.animate;

  beforeEach(() => {
    animate = vi.fn(() => ({ finished: Promise.resolve() }));
    HTMLElement.prototype.animate =
      animate as unknown as typeof HTMLElement.prototype.animate;
  });

  afterEach(() => {
    HTMLElement.prototype.animate = original;
  });

  it('pops when someone else reacts, not for the viewer’s own changes', () => {
    const { rerender } = render(
      <ReactionChip {...props} count={1} isMine={false} othersCount={1} />
    );
    // A chip of a row that was already on screen pops in.
    expect(animate).toHaveBeenCalled();
    animate.mockClear();
    // Someone else joins.
    rerender(
      <ReactionChip {...props} count={2} isMine={false} othersCount={2} />
    );
    expect(animate).toHaveBeenCalled();
    animate.mockClear();
    // The confirmed copy of the viewer's own reaction replacing the shown
    // one changes nothing visible, so nothing moves.
    rerender(<ReactionChip {...props} count={3} isMine othersCount={2} />);
    animate.mockClear();
    rerender(<ReactionChip {...props} count={3} isMine othersCount={2} />);
    expect(animate).not.toHaveBeenCalled();
    rerender(
      <ReactionChip {...props} count={2} isMine={false} othersCount={2} />
    );
    expect(animate).not.toHaveBeenCalled();
  });

  it('keeps a chip that loaded with the chat still', () => {
    render(
      <ReactionChip
        {...props}
        count={1}
        isMine
        mountedAt={Date.now()}
        othersCount={0}
      />
    );
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByText('🔥')).toBeVisible();
  });
});
