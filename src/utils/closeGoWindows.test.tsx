import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../i18n/i18n';
import {
  openSavedFileActions,
  SavedFileActionsSheet,
} from '../components/Mobile/SavedFileActionsSheet';
import { closeGoWindows, useCloseWithGoWindows } from './closeGoWindows';

describe('useCloseWithGoWindows', () => {
  it('closes an open window', () => {
    const close = vi.fn();
    renderHook(() => useCloseWithGoWindows(true, close));
    act(() => closeGoWindows());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves a closed window alone', () => {
    const close = vi.fn();
    renderHook(() => useCloseWithGoWindows(false, close));
    act(() => closeGoWindows());
    expect(close).not.toHaveBeenCalled();
  });

  it('runs the latest close and stops listening on unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ close }) => useCloseWithGoWindows(true, close),
      { initialProps: { close: first } }
    );
    rerender({ close: second });
    act(() => closeGoWindows());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    act(() => closeGoWindows());
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('closes a real GO window (the saved-file sheet)', async () => {
    render(<SavedFileActionsSheet />);
    act(() =>
      openSavedFileActions({
        fileName: 'receipt.pdf',
        folder: 'Documents/Qortal Go/Documents',
        uri: 'content://media/external/file/42',
        mimeType: 'application/pdf',
        blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      })
    );
    expect(screen.getByText('receipt.pdf')).toBeTruthy();
    act(() => closeGoWindows());
    await waitFor(() => expect(screen.queryByText('receipt.pdf')).toBeNull());
  });
});
