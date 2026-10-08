import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { QortinoNotificationHost } from '../Snackbar/QortinoNotificationHost';
import {
  openSavedFileActions,
  SavedFileActionsSheet,
} from './SavedFileActionsSheet';

const share = vi.hoisted(() => ({
  stageMobileFileForSharing: vi.fn(async () => 'file:///cache/receipt.pdf'),
  shareStagedMobileFile: vi.fn(async () => {}),
  openStagedMobileFileWith: vi.fn(async () => {}),
  openSavedMobileFile: vi.fn(async () => true),
}));

vi.mock('../../utils/mobileFileShare', () => ({
  stageMobileFileForSharing: share.stageMobileFileForSharing,
  shareStagedMobileFile: share.shareStagedMobileFile,
  openStagedMobileFileWith: share.openStagedMobileFileWith,
}));
vi.mock('../../utils/mobileFileSave', () => ({
  openSavedMobileFile: share.openSavedMobileFile,
}));

const pdf = () => new Blob(['%PDF-1.4'], { type: 'application/pdf' });

afterEach(() => {
  vi.clearAllMocks();
});

describe('SavedFileActionsSheet', () => {
  it('opens the saved copy with another app', async () => {
    render(<SavedFileActionsSheet />);
    act(() =>
      openSavedFileActions({
        fileName: 'receipt.pdf',
        folder: 'Documents/Qortal Go/Documents',
        uri: 'content://media/external/file/42',
        mimeType: 'application/pdf',
        blob: pdf(),
      })
    );
    expect(screen.getByText('receipt.pdf')).toBeTruthy();
    expect(screen.getByText('Documents/Qortal Go/Documents')).toBeTruthy();
    fireEvent.click(screen.getByText('Open with another app'));
    await waitFor(() =>
      expect(share.openSavedMobileFile).toHaveBeenCalledWith(
        'content://media/external/file/42',
        'receipt.pdf',
        'application/pdf'
      )
    );
    await waitFor(() => expect(screen.queryByText('receipt.pdf')).toBeNull());
  });

  it('shares a cached copy, since the share sheet takes file:// only', async () => {
    render(<SavedFileActionsSheet />);
    const blob = pdf();
    act(() =>
      openSavedFileActions({
        fileName: 'receipt.pdf',
        uri: 'content://media/external/file/42',
        mimeType: 'application/pdf',
        blob,
      })
    );
    fireEvent.click(screen.getByText('Share'));
    await waitFor(() =>
      expect(share.shareStagedMobileFile).toHaveBeenCalledWith(
        'file:///cache/receipt.pdf',
        'receipt.pdf'
      )
    );
    expect(share.stageMobileFileForSharing).toHaveBeenCalledWith(
      expect.stringMatching(/^saved-file:/),
      'receipt.pdf',
      blob
    );
  });

  it('offers no Open for an app package', () => {
    render(<SavedFileActionsSheet />);
    act(() =>
      openSavedFileActions({
        fileName: 'app.apk',
        uri: 'content://media/external/file/7',
        blob: new Blob(['PK']),
      })
    );
    expect(screen.queryByText('Open with another app')).toBeNull();
    expect(screen.getByText('Share')).toBeTruthy();
  });
});

describe('QortinoNotificationHost tap', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver; the banner only uses it to lay out the X.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    // Nor PointerEvent, without which a pointerdown carries no position.
    globalThis.PointerEvent ??= class extends MouseEvent {} as any;
  });

  const renderHost = (onTap: () => void) => {
    const setOpen = vi.fn();
    const setInfo = vi.fn();
    render(
      <QortinoNotificationHost
        open
        setOpen={setOpen}
        setInfo={setInfo}
        info={{
          type: 'success',
          message: 'Saved to Documents/Qortal Go/Documents',
          tapHint: 'Tap to open or share',
          onTap,
        }}
      />
    );
    return { setOpen };
  };

  it('runs onTap and closes when the popup is tapped', () => {
    const onTap = vi.fn();
    const { setOpen } = renderHost(onTap);
    const message = screen.getByText('Saved to Documents/Qortal Go/Documents');
    fireEvent.pointerDown(message, { clientX: 100, clientY: 50 });
    fireEvent.click(message, { clientX: 102, clientY: 51 });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('does not run onTap after a drag', () => {
    const onTap = vi.fn();
    renderHost(onTap);
    const message = screen.getByText('Saved to Documents/Qortal Go/Documents');
    fireEvent.pointerDown(message, { clientX: 100, clientY: 50 });
    fireEvent.click(message, { clientX: 100, clientY: 140 });
    expect(onTap).not.toHaveBeenCalled();
  });

  it('does not run onTap from the close button', () => {
    const onTap = vi.fn();
    renderHost(onTap);
    const close = screen
      .getAllByRole('button')
      .find((button) => button.querySelector('svg'));
    expect(close).toBeTruthy();
    fireEvent.pointerDown(close!, { clientX: 300, clientY: 50 });
    fireEvent.click(close!, { clientX: 300, clientY: 50 });
    expect(onTap).not.toHaveBeenCalled();
  });
});
