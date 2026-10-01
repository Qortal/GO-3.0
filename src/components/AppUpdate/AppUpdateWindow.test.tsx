import { fireEvent, render, screen, within } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const controller = vi.hoisted(() => ({
  canInstallBuilds: vi.fn(() => true),
  checkForUpdatesNow: vi.fn(async () => undefined),
  closeAppUpdateWindow: vi.fn(),
  continueInstall: vi.fn(),
  dismissAppUpdate: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  loadPublishedReleases: vi.fn(async () => undefined),
  markAppUpdateSeen: vi.fn(),
  readInstalledVersion: vi.fn(async () => '0.0.12'),
  resetAppUpdateProgress: vi.fn(),
  startAppUpdateDownload: vi.fn(async () => undefined),
}));
const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));

vi.mock('../../appUpdate/appUpdateController', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../appUpdate/appUpdateController')
  >()),
  ...controller,
}));
vi.mock('../../utils/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/events')>()),
  executeEvent: events.executeEvent,
}));
import '../../i18n/i18n';

import {
  appUpdateCheckAtom,
  appUpdateInstalledVersionAtom,
  appUpdateReleaseAtom,
  appUpdateReleaseListAtom,
  appUpdateWindowOpenAtom,
} from '../../appUpdate/appUpdateAtoms';
import type { AppRelease } from '../../appUpdate/qdnAppUpdate';
import { AppUpdateWindow } from './AppUpdateWindow';

const store = getDefaultStore();

const build = (version: string): AppRelease => ({
  filename: `GO 3.0 v${version}.apk`,
  identifier: `file-${version}`,
  notes: '',
  notesHtml: `<p>Changes in ${version}</p><script>alert(1)</script>`,
  publishedAt: Date.now(),
  service: 'FILE',
  shareIdentifier: `qshare_file_go-30-${version}_metadata`,
  size: 128 * 1024 * 1024,
  title: `GO 3.0 v${version}`,
  version,
});

const v13 = build('0.0.13');
const v12 = build('0.0.12');
const v9 = build('0.0.9');

describe('GO 3.0 Updates screen', () => {
  beforeEach(() => {
    Object.values(controller).forEach((fn) => fn.mockClear());
    events.executeEvent.mockClear();
    store.set(appUpdateInstalledVersionAtom, '0.0.12');
    store.set(appUpdateReleaseAtom, v13);
    store.set(appUpdateCheckAtom, {
      checkedAt: Date.now(),
      status: 'available',
    });
    store.set(appUpdateReleaseListAtom, {
      loadedAt: Date.now(),
      missing: 0,
      releases: [v13, v12, v9],
      status: 'ready',
    });
    store.set(appUpdateWindowOpenAtom, true);
  });

  it('shows the update with its bell, the check and every version', () => {
    render(<AppUpdateWindow />);

    expect(screen.getByText('GO 3.0 Updates')).toBeInTheDocument();
    expect(screen.getByText('New GO 3.0 update available')).toBeInTheDocument();
    expect(screen.getByText('GO 3.0 v0.0.12')).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(
      items.map((item) => within(item).getByText(/^v0\.0\./).textContent)
    ).toEqual(['v0.0.13', 'v0.0.12', 'v0.0.9']);
    expect(within(items[0]).getByText('New')).toBeInTheDocument();
    expect(within(items[1]).getByText('Installed')).toBeInTheDocument();
    expect(within(items[2]).getByText('Older')).toBeInTheDocument();
    // The notes are Q-Share's HTML, sanitised.
    expect(within(items[0]).getByText('Changes in 0.0.13')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }));
    expect(controller.checkForUpdatesNow).toHaveBeenCalled();
  });

  it('installs the update straight away', () => {
    render(<AppUpdateWindow />);
    fireEvent.click(screen.getByRole('button', { name: 'Install update' }));
    expect(controller.startAppUpdateDownload).toHaveBeenCalledWith(v13);
  });

  it('offers install only for newer versions', () => {
    render(<AppUpdateWindow />);
    const [newer, current, older] = screen.getAllByRole('listitem');
    expect(
      within(newer).getByRole('button', { name: 'Install' })
    ).toBeInTheDocument();
    for (const item of [current, older]) {
      expect(
        within(item).queryByRole('button', { name: /Install/ })
      ).toBeNull();
      expect(
        within(item).getByRole('button', { name: /Open in Q-Share\+/ })
      ).toBeInTheDocument();
    }
  });

  it('opens a version in Q-Share+', () => {
    render(<AppUpdateWindow />);
    const older = screen.getAllByRole('listitem')[2];
    fireEvent.click(
      within(older).getByRole('button', { name: /Open in Q-Share\+/ })
    );
    expect(controller.closeAppUpdateWindow).toHaveBeenCalled();
    expect(events.executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        name: 'Q-Share+',
        navigateIfAlreadyOpen: true,
        path: 'share/GO%203.0/qshare_file_go-30-0.0.9_metadata',
        service: 'APP',
      },
    });
  });
});
