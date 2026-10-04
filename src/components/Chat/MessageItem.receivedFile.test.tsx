import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';

const native = vi.hoisted(() => ({
  isNative: true,
  qchatFileStat: vi.fn(),
  qchatFileOpen: vi.fn(),
  qchatReceivedFileRead: vi.fn(),
  qchatReceivedFileSave: vi.fn(),
  ensureStoragePermission: vi.fn(),
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => native.isNative },
  };
});
vi.mock('../../plugins/Reticulum', () => ({
  Reticulum: {
    qchatFileStat: native.qchatFileStat,
    qchatFileOpen: native.qchatFileOpen,
    qchatReceivedFileRead: native.qchatReceivedFileRead,
    qchatReceivedFileSave: native.qchatReceivedFileSave,
  },
}));
vi.mock('../../plugins/FileWriter', () => ({
  ensureNativeStoragePermission: native.ensureStoragePermission,
}));
vi.mock('../../utils/qchatFileApi', () => ({
  getQchatFileApi: () => ({ qchatFileOpen: native.qchatFileOpen }),
}));
vi.mock('../../App', async () => {
  const { createContext: create } = await import('react');
  return {
    QORTAL_APP_CONTEXT: create({
      getIndividualUserInfo: async () => null,
    }),
    getBaseApiReact: () => '',
  };
});
vi.mock('../../hooks/usePresence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/usePresence')>()),
  useStatus: () => 'offline',
}));
vi.mock('./MessageDisplay', () => ({
  MessageDisplay: ({ trailingContent }: { trailingContent?: ReactNode }) => (
    <div data-testid="message-display">{trailingContent}</div>
  ),
}));
vi.mock('../Embeds/Embed', () => ({ Embed: () => null }));
vi.mock('../ReactionPicker', () => ({ ReactionPicker: () => null }));
vi.mock('./ReticulumImageViewer', () => ({ ReticulumImageViewer: () => null }));
vi.mock('./AvatarPreviewModal', () => ({ AvatarPreviewModal: () => null }));

import { MessageItem } from './MessageItem';

// New strings reach the locale files in a separate step; until then i18next
// shows the key, so each check accepts either.
const SAVE = /Save to device|file_transfer\.save_to_device/;
const KEPT = /Kept privately in GO until you log out|received_private_hint/;
const GONE = /No longer on this device|received_file_removed/;

const ME = 'QMeAddress';
const PEER = 'QPeerAddress';
const PATH =
  '/data/user/0/com.github.Qortal.qortalMobile/files/qchat-received/u/holidaygpj.jpg';

const offer = (fileName: string) => ({
  id: 'event-1',
  signature: 'event-1',
  timestamp: Date.now(),
  sender: PEER,
  senderAddress: PEER,
  recipientAddress: ME,
  decryptedData: {
    type: 'qchat-dm-file-transfer',
    data: {
      status: 'offer',
      transferId: 'qft-1',
      fileName,
      size: 2048,
      expiresAt: Date.now() + 60_000,
    },
  },
});

const renderReceived = (
  fileName: string,
  record: Record<string, unknown> = {}
) =>
  render(
    <MessageItem
      {...({
        handleReaction: vi.fn(),
        isLast: false,
        isPrivate: true,
        message: offer(fileName),
        myAddress: ME,
        onReply: vi.fn(),
        onSeen: vi.fn(),
        reactions: {},
        onAcceptQchatFileTransfer: vi.fn(),
        qchatFileTransferStates: {},
        qchatCompletedTransfers: {
          'qft-1': {
            transferId: 'qft-1',
            fileName,
            path: PATH,
            downloadsUri: '',
            ...record,
          },
        },
      } as any)}
    />
  );

describe('MessageItem received chat file (N-22, N-27)', () => {
  beforeEach(() => {
    native.isNative = true;
    native.qchatFileStat.mockReset().mockResolvedValue({
      exists: true,
      size: 2048,
    });
    native.qchatFileOpen.mockReset().mockResolvedValue({ ok: true });
    native.qchatReceivedFileRead.mockReset();
    native.qchatReceivedFileSave.mockReset().mockResolvedValue({
      ok: true,
      uri: 'content://media/external/file/9',
      name: 'holidaygpj.jpg',
      folder: 'Qortal Go/Images',
    });
    native.ensureStoragePermission.mockReset().mockResolvedValue(true);
  });

  it('offers Open and Save to device, and saves only on tap', async () => {
    renderReceived('holiday\u2066gpj.jpg');
    await screen.findByText(KEPT);
    expect(screen.getByText('holidaygpj')).toBeInTheDocument();
    expect(screen.getByText('.jpg')).toBeInTheDocument();
    expect(native.qchatReceivedFileSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() =>
      expect(native.qchatReceivedFileSave).toHaveBeenCalledWith({
        path: PATH,
        fileName: 'holidaygpj.jpg',
      })
    );
    expect(screen.getByRole('button', { name: /Open/ })).toBeInTheDocument();
  });

  it('shows the real extension of a disguised package and offers no Open', async () => {
    renderReceived('holiday\u202Egpj.apk');
    await screen.findByText(KEPT);
    expect(screen.getByText('.apk')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(screen.getByRole('button', { name: SAVE })).toBeInTheDocument();
  });

  it('does not call a file from an older build private', async () => {
    // v0.0.14 and earlier: app-specific external storage plus a copy in
    // public Downloads.
    const legacyPath =
      '/storage/emulated/0/Android/data/com.github.Qortal.qortalMobile/files/Download/QortalFiles/report.pdf';
    renderReceived('report.pdf', {
      path: legacyPath,
      downloadsUri: 'content://media/external/downloads/42',
    });
    await waitFor(() =>
      expect(native.qchatFileStat).toHaveBeenCalledWith({ path: legacyPath })
    );
    // Let the stat result reach the card.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('button', { name: SAVE })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open/ })).toBeInTheDocument();
    expect(screen.queryByText(KEPT)).toBeNull();
  });

  it('says when the file is no longer on the device', async () => {
    native.qchatFileStat.mockResolvedValue({ exists: false, size: 0 });
    renderReceived('notes.txt');
    await screen.findByText(GONE);
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });

  it('shows the English text once the new keys are in the locale', async () => {
    const { default: i18n } = await import('i18next');
    // The strings this lane adds (i18n-batch2-F-received-files.json).
    i18n.addResource(
      'en',
      'core',
      'file_transfer.save_to_device',
      'Save to device'
    );
    i18n.addResource(
      'en',
      'core',
      'file_transfer.received_private_hint',
      'Kept privately in GO until you log out'
    );
    renderReceived('photo.jpg');
    await screen.findByText('Kept privately in GO until you log out');
    expect(
      screen.getByRole('button', { name: 'Save to device' })
    ).toBeInTheDocument();
  });

  it('keeps the desktop card as it was', () => {
    native.isNative = false;
    renderReceived('notes.txt');
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(screen.getByRole('button', { name: 'Downloaded' })).toBeDisabled();
    expect(native.qchatFileStat).not.toHaveBeenCalled();
  });
});
