import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Backups re-derive the account from the decrypted seed. They must write the
// account the file is named after (with the version that derives it), and
// refuse when the saved entry's key is another account's.

const decrypted = vi.hoisted(() => ({ seed: new Uint8Array(0) as Uint8Array }));

vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));
vi.mock('../../utils/decryptWallet', () => ({
  decryptStoredWallet: vi.fn(async () => decrypted.seed.slice()),
}));
vi.mock('../../utils/generateWallet/generateWallet', () => ({
  saveFileToDisk: vi.fn(async () => true),
}));
// Re-encryption (KDF) is not under test: the "file" keeps what identifies it.
vi.mock('../../utils/generateWallet/storeWallet', () => ({
  generateSaveWalletData: vi.fn(
    async (
      wallet: { _addresses: { address: string }[]; _walletVersion: unknown },
      _password: string,
      kdfThreads: number
    ) => ({
      address0: wallet._addresses[0].address,
      version: wallet._walletVersion,
      encryptedSeed: 'reencrypted',
      kdfThreads,
    })
  ),
}));

import { saveFileToDisk } from '../../utils/generateWallet/generateWallet';
import PhraseWalletUntyped from '../../utils/generateWallet/phrase-wallet';
import { lightTheme } from '../../styles/theme-light';
import { BackupWalletModal } from './BackupWalletModal';
import { DownloadWallet } from './DownloadWallet';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PhraseWallet = PhraseWalletUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function seedBytes(length: number, fill: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (fill * 43 + i * 17) & 0xff;
  return bytes;
}

function addressFor(seed: Uint8Array, version: number): string {
  return new PhraseWallet(seed.slice(), version, { qortOnly: true })
    ._addresses[0].address;
}

const seed32 = seedBytes(32, 1);
const seed64 = seedBytes(64, 2);
const v1Account = addressFor(seed32, 1);
const v2Account = addressFor(seed64, 2);
const otherAccount = addressFor(seedBytes(64, 3), 2);
const short = (address: string) =>
  `${address.slice(0, 7)}…${address.slice(-5)}`;

const storedEntry = (address0: string, version?: number) => ({
  address0,
  ...(version ? { version } : {}),
  encryptedSeed: 'enc',
  iv: 'iv',
  salt: 'salt',
  mac: 'mac',
});

function typePassword(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  vi.mocked(saveFileToDisk).mockClear();
});

describe('BackupWalletModal key check', () => {
  const renderModal = (rawWallet: unknown) =>
    render(
      <ThemeProvider theme={lightTheme}>
        <BackupWalletModal onClose={vi.fn()} open rawWallet={rawWallet} />
      </ThemeProvider>
    );

  it('writes the corrected version for an entry that lost version 1', async () => {
    decrypted.seed = seed32;
    renderModal(storedEntry(v1Account));
    typePassword('backup-wallet-current-password', 'pw');
    fireEvent.click(
      screen.getByRole('button', { name: /download wallet file/i })
    );

    await waitFor(() => expect(saveFileToDisk).toHaveBeenCalledTimes(1));
    const [written, fileAddress] = vi.mocked(saveFileToDisk).mock.calls[0];
    expect(written).toMatchObject({ address0: v1Account, version: 1 });
    expect(fileAddress).toBe(v1Account);
  });

  it("refuses to write another account's key", async () => {
    decrypted.seed = seed64;
    renderModal(storedEntry(otherAccount, 2));
    typePassword('backup-wallet-current-password', 'pw');
    fireEvent.click(
      screen.getByRole('button', { name: /download wallet file/i })
    );

    expect(
      await screen.findByText(new RegExp(short(otherAccount)))
    ).toHaveTextContent(short(v2Account));
    expect(saveFileToDisk).not.toHaveBeenCalled();
  });
});

describe('DownloadWallet key check', () => {
  const renderDownload = (
    rawWallet: unknown,
    setWalletToBeDownloaded: (value: unknown) => void
  ) =>
    render(
      <ThemeProvider theme={lightTheme}>
        <DownloadWallet
          returnToMain={vi.fn()}
          setIsLoading={vi.fn()}
          rawWallet={rawWallet}
          setWalletToBeDownloaded={setWalletToBeDownloaded}
          walletToBeDownloaded={null}
        />
      </ThemeProvider>
    );

  it('names the prepared file after the address written inside it', async () => {
    decrypted.seed = seed32;
    const setWalletToBeDownloaded = vi.fn();
    renderDownload(storedEntry(v1Account), setWalletToBeDownloaded);
    typePassword('standard-adornment-password', 'pw');
    // CustomButton is a styled div.
    fireEvent.click(screen.getByText('Confirm password', { selector: 'div' }));

    await waitFor(() => expect(setWalletToBeDownloaded).toHaveBeenCalled());
    expect(setWalletToBeDownloaded).toHaveBeenCalledWith({
      wallet: expect.objectContaining({ address0: v1Account, version: 1 }),
      qortAddress: v1Account,
    });
  });

  it("refuses to prepare a file with another account's key", async () => {
    decrypted.seed = seed64;
    const setWalletToBeDownloaded = vi.fn();
    renderDownload(storedEntry(otherAccount, 2), setWalletToBeDownloaded);
    typePassword('standard-adornment-password', 'pw');
    // CustomButton is a styled div.
    fireEvent.click(screen.getByText('Confirm password', { selector: 'div' }));

    expect(
      await screen.findByText(new RegExp(short(otherAccount)))
    ).toHaveTextContent(short(v2Account));
    expect(setWalletToBeDownloaded).not.toHaveBeenCalled();
  });
});
