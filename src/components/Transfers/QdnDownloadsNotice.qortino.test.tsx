import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ openQortinoAgentSheet: vi.fn() }));

vi.mock('../../plugins/QortalBackground', () => ({
  QortalBackground: {
    showTransferNotification: vi.fn(async () => ({ success: true })),
    dismissTransferNotification: vi.fn(async () => ({ success: true })),
  },
}));
vi.mock('../../utils/platform', () => ({ isCapacitor: () => true }));
vi.mock('../../qortinoAgent/qortinoSheetNav', () => nav);

import '../../i18n/i18n';
import {
  getQortinoInstallJob,
  resetQortinoInstallJobStoreForTests,
  updateQortinoInstallJob,
} from '../../qortinoAgent/installJobStore';
import { QdnDownloadsNotice, useQdnDownloadsBadge } from './QdnDownloadsNotice';

const fetching = {
  phase: 'fetch' as const,
  partIndex: 1,
  partCount: 2,
  bytesDone: 47,
  bytesTotal: 100,
};

describe("Qortino's download in GO's notifications", () => {
  afterEach(() => {
    resetQortinoInstallJobStoreForTests();
    vi.clearAllMocks();
  });

  it('lists nothing when there is no download', () => {
    const { container } = render(<QdnDownloadsNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the running download with its step, and opens Qortino on tap', () => {
    updateQortinoInstallJob({
      status: 'running',
      listed: true,
      progress: fetching,
    });
    const onClose = vi.fn();
    render(<QdnDownloadsNotice onClose={onClose} />);

    expect(screen.getByText('Qortino')).toBeInTheDocument();
    expect(
      screen.getByText('Part 1 of 2 · your node is fetching it from QDN… 47%')
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '47'
    );
    // A running download has nothing to dismiss.
    expect(
      screen.queryByRole('button', { name: 'Dismiss' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Qortino'));
    expect(nav.openQortinoAgentSheet).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says it is waiting for peers between tries', () => {
    updateQortinoInstallJob({
      status: 'retrying',
      listed: true,
      progress: fetching,
    });
    render(<QdnDownloadsNotice />);
    expect(screen.getByText('Waiting for peers…')).toBeInTheDocument();
  });

  it('says the connection broke off when saving stopped part way', () => {
    updateQortinoInstallJob({
      status: 'retrying',
      listed: true,
      progress: fetching,
      error: { code: 'download', detail: 'Download ended early' },
    });
    render(<QdnDownloadsNotice />);
    expect(
      screen.getByText('Connection broke off, carrying on soon…')
    ).toBeInTheDocument();
    expect(screen.queryByText('Waiting for peers…')).not.toBeInTheDocument();
  });

  it('keeps a finished download until it is dismissed', () => {
    updateQortinoInstallJob({ status: 'done', listed: true });
    render(<QdnDownloadsNotice />);
    expect(screen.getByText('Qortino is ready.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(getQortinoInstallJob().listed).toBe(false);
    expect(nav.openQortinoAgentSheet).not.toHaveBeenCalled();
  });

  it('counts on the bell while its window is closed', () => {
    const { result } = renderHook(() => useQdnDownloadsBadge());
    expect(result.current.unseen).toBe(0);
    expect(result.current.hasAny).toBe(false);

    act(() => {
      updateQortinoInstallJob({ status: 'running', listed: true });
    });
    expect(result.current.unseen).toBe(1);
    expect(result.current.hasAny).toBe(true);

    act(() => {
      updateQortinoInstallJob({ viewOpen: true });
    });
    expect(result.current.unseen).toBe(0);
    expect(result.current.hasAny).toBe(true);
  });
});
