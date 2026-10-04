import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSavedMobileFile: vi.fn(async (..._args: unknown[]) => true),
  showTransferNotification: vi.fn(async () => ({ success: true })),
  dismissTransferNotification: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../plugins/QortalBackground', () => ({
  QortalBackground: {
    showTransferNotification: mocks.showTransferNotification,
    dismissTransferNotification: mocks.dismissTransferNotification,
  },
}));
vi.mock('../../utils/platform', () => ({ isCapacitor: () => true }));
vi.mock('../../utils/mobileFileSave', () => ({
  openSavedMobileFile: mocks.openSavedMobileFile,
}));
vi.mock('../../utils/qappFetchReporter', () => ({
  installQappFetchReporter: vi.fn(async () => undefined),
}));
vi.mock('../../utils/qappFetchProgress', () => ({
  startQappFetchProgressListener: vi.fn(() => () => undefined),
}));
// Only its height is used; the bar itself pulls in the whole app.
vi.mock('../Mobile/MobileTopBar', () => ({ MOBILE_TOP_BAR_HEIGHT_PX: 56 }));

import '../../i18n/i18n';
import {
  beginQdnSaveNotification,
  finishQdnSaveNotification,
  getQdnTransfers,
  resetQdnTransfersForTests,
} from '../../utils/qdnDownloadNotifications';
import { QdnTransfersOverlay } from './QdnTransfersOverlay';

const saved = (id: string, filename: string, mimeType?: string) =>
  act(() => {
    beginQdnSaveNotification(id, filename, { stage: 'saving' });
    finishQdnSaveNotification(id, 'Documents/Qortal Go/Apps', {
      uri: `content://media/external_primary/file/${id}`,
      mimeType,
    });
  });

describe('QdnTransfersOverlay', () => {
  beforeEach(() => {
    localStorage.clear();
    resetQdnTransfersForTests();
    mocks.openSavedMobileFile.mockClear();
  });

  afterEach(() => {
    act(() => resetQdnTransfersForTests());
  });

  // N-20 / N-31: an .apk a Q-App saved is shown as saved, with where it went,
  // but GO offers neither Install nor Open for it.
  it.each([
    ['GO 3.0 v0.0.15.apk', 'application/vnd.android.package-archive'],
    ['GO 3.0 v0.0.15.apk', undefined],
    ['update.bin', 'application/vnd.android.package-archive'],
  ])('offers nothing to tap for a saved %s (%s)', (filename, mimeType) => {
    render(<QdnTransfersOverlay />);
    saved('1', filename, mimeType);

    expect(screen.getByText(filename)).toBeTruthy();
    expect(
      screen.getByText('Saved to Documents/Qortal Go/Apps', { exact: false })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /install/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByText(/install/i)).toBeNull();
    expect(mocks.openSavedMobileFile).not.toHaveBeenCalled();
  });

  it('opens other files with their own type', async () => {
    render(<QdnTransfersOverlay />);
    saved('2', 'report.pdf', 'application/pdf');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    });
    expect(mocks.openSavedMobileFile).toHaveBeenCalledWith(
      'content://media/external_primary/file/2',
      'report.pdf',
      'application/pdf'
    );
  });

  it('moves a card into the bell after 5 s', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(<QdnTransfersOverlay />);
      saved('5', 'song.m4a', 'audio/mp4');
      act(() => vi.advanceTimersByTime(4_900));
      expect(getQdnTransfers()[0].minimized).toBe(false);
      act(() => vi.advanceTimersByTime(200));
      expect(getQdnTransfers()[0].minimized).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // One stack, newest in front: the cards behind it are only its edge.
  it('stacks the cards with only the newest one tappable', () => {
    render(<QdnTransfersOverlay />);
    saved('6', 'older.pdf', 'application/pdf');
    saved('7', 'newer.pdf', 'application/pdf');

    const open = screen.getByRole('button', { name: 'Open' });
    expect(open.closest('[role="status"]')?.textContent).toContain('newer.pdf');
    const behind = screen
      .getByText('older.pdf')
      .closest('div[aria-hidden]') as HTMLElement;
    expect(behind).toBeTruthy();
    expect(getComputedStyle(behind).pointerEvents).toBe('none');
  });

  // The card can be swiped sideways now; a plain tap on Open is still a tap.
  it('still opens on a tap that did not move', async () => {
    render(<QdnTransfersOverlay />);
    saved('4', 'clip.mp4', 'video/mp4');
    const open = screen.getByRole('button', { name: 'Open' });

    await act(async () => {
      fireEvent.pointerDown(open);
      fireEvent.click(open);
    });
    expect(mocks.openSavedMobileFile).toHaveBeenCalledTimes(1);
  });

  // A card that is leaving (here: opened, so dismissed) stays in the DOM until
  // AnimatePresence lets it go. On the phone that exit stalled, leaving an
  // invisible card with a live Open over the account menu's Notifications row.
  it('lets taps through a card that is leaving', async () => {
    render(<QdnTransfersOverlay />);
    saved('3', 'song.m4a', 'audio/mp4');
    const open = screen.getByRole('button', { name: 'Open' });

    await act(async () => {
      fireEvent.click(open);
    });

    expect(mocks.openSavedMobileFile).toHaveBeenCalledTimes(1);
    if (open.isConnected) {
      const card = open.closest('[data-motion-pop-id], div[aria-hidden]');
      expect(card).toBeTruthy();
      expect(getComputedStyle(card as Element).pointerEvents).toBe('none');
      expect(
        getComputedStyle(open.closest('.MuiPaper-root') as Element)
          .pointerEvents
      ).toBe('none');
    }
  });
});
