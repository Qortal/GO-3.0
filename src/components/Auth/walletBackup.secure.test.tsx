import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));

import { useSecureScreen } from '../../hooks/useSecureScreen';
import { lightTheme } from '../../styles/theme-light';
import { BackupWalletModal } from './BackupWalletModal';
import { DownloadWallet } from './DownloadWallet';

const lastSecureFlag = () => {
  const calls = vi.mocked(useSecureScreen).mock.calls;
  return calls[calls.length - 1]?.[0]?.secure;
};

const rawWallet = { address0: 'QAddress', name: 'alice' };

const backupModal = (open: boolean) => (
  <ThemeProvider theme={lightTheme}>
    <BackupWalletModal onClose={vi.fn()} open={open} rawWallet={rawWallet} />
  </ThemeProvider>
);

describe('wallet backup screen protection (GO-37)', () => {
  beforeEach(() => {
    vi.mocked(useSecureScreen).mockClear();
  });

  it('protects the backup dialog only while it is open', () => {
    const { rerender } = render(backupModal(false));
    expect(lastSecureFlag()).toBe(false);

    rerender(backupModal(true));
    expect(lastSecureFlag()).toBe(true);

    rerender(backupModal(false));
    expect(lastSecureFlag()).toBe(false);
  });

  it('protects the download backup screen', () => {
    render(
      <ThemeProvider theme={lightTheme}>
        <DownloadWallet
          returnToMain={vi.fn()}
          setIsLoading={vi.fn()}
          rawWallet={rawWallet}
          setWalletToBeDownloaded={vi.fn()}
          walletToBeDownloaded={null}
        />
      </ThemeProvider>
    );
    expect(lastSecureFlag()).toBe(true);
  });
});
