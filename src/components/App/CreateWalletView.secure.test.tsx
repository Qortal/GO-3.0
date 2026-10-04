import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));

import { useSecureScreen } from '../../hooks/useSecureScreen';
import { lightTheme } from '../../styles/theme-light';
import { CreateWalletView } from './CreateWalletView';

const lastSecureFlag = () => {
  const calls = vi.mocked(useSecureScreen).mock.calls;
  return calls[calls.length - 1]?.[0]?.secure;
};

const view = (creationStep: number, walletToBeDownloaded: unknown = null) => (
  <ThemeProvider theme={lightTheme}>
    <CreateWalletView
      creationStep={creationStep}
      walletToBeDownloaded={walletToBeDownloaded}
      walletToBeDownloadedPassword=""
      walletToBeDownloadedPasswordConfirm=""
      walletToBeDownloadedError=""
      showSeed={false}
      storeAccount={false}
      generatorRef={{ current: { parsedString: 'alpha bravo charlie' } }}
      confirmRef={createRef<HTMLInputElement>()}
      onReturnBack={vi.fn()}
      onShowSeed={vi.fn()}
      onHideSeed={vi.fn()}
      onCreationStepNext={vi.fn()}
      setWalletToBeDownloadedPassword={vi.fn()}
      setWalletToBeDownloadedPasswordConfirm={vi.fn()}
      setStoredAccount={vi.fn()}
      onCreateAccount={vi.fn()}
      onBackupAccountConfirm={vi.fn(async () => false)}
      onEnterHub={vi.fn()}
      exportSeedphrase={vi.fn()}
    />
  </ThemeProvider>
);

describe('CreateWalletView screen protection (GO-37)', () => {
  beforeEach(() => {
    vi.mocked(useSecureScreen).mockClear();
  });

  it('leaves the password step capturable', () => {
    render(view(1));
    expect(lastSecureFlag()).toBe(false);
  });

  it('protects the seed phrase step', () => {
    render(view(2));
    expect(lastSecureFlag()).toBe(true);
  });

  it('protects the backup download step', () => {
    render(view(3, { qortAddress: 'QAddress', wallet: {} }));
    expect(lastSecureFlag()).toBe(true);
  });

  it('turns protection off again when going back to the password step', () => {
    const { rerender } = render(view(2));
    expect(lastSecureFlag()).toBe(true);
    rerender(view(1));
    expect(lastSecureFlag()).toBe(false);
  });
});
