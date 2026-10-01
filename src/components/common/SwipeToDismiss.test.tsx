import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SwipeToDismiss } from './SwipeToDismiss';

describe('SwipeToDismiss', () => {
  it('lets a plain tap through to the row', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(
      <SwipeToDismiss onDismiss={onDismiss}>
        <button onClick={onClick}>Row</button>
      </SwipeToDismiss>
    );

    const row = screen.getByRole('button', { name: 'Row' });
    fireEvent.pointerDown(row);
    fireEvent.click(row);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses the focused row with Delete and swallows the click after it', async () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(
      <SwipeToDismiss onDismiss={onDismiss}>
        <button onClick={onClick}>Row</button>
      </SwipeToDismiss>
    );

    const row = screen.getByRole('button', { name: 'Row' });
    fireEvent.keyDown(row, { key: 'Delete' });
    fireEvent.click(row);

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const onDismiss = vi.fn();
    render(
      <SwipeToDismiss onDismiss={onDismiss}>
        <button>Row</button>
      </SwipeToDismiss>
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Row' }), {
      key: 'Enter',
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
