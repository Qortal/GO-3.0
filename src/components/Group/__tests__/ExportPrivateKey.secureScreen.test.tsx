import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider as JotaiProvider } from 'jotai';

vi.mock('../../../background/background.ts', () => ({ walletVersion: 2 }));
vi.mock('../../Mobile/MobileNodeConnectionSettings', () => ({
  MobileNodeConnectionSettings: () => null,
}));
vi.mock('../../Theme/ThemeManager', () => ({ default: () => null }));
vi.mock('../../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));

import i18n from '../../../i18n/i18n';
import { useSecureScreen } from '../../../hooks/useSecureScreen';
import { lightTheme } from '../../../styles/theme-light';
import { ExportPrivateKey } from '../Settings';

const lastSecureFlag = () => {
  const calls = vi.mocked(useSecureScreen).mock.calls;
  return calls[calls.length - 1]?.[0]?.secure;
};

describe('Settings > Export private key screen protection (GO-37)', () => {
  beforeEach(() => {
    vi.mocked(useSecureScreen).mockClear();
  });

  it('protects the export dialog only while it is open', async () => {
    render(
      <JotaiProvider store={createStore()}>
        <ThemeProvider theme={lightTheme}>
          <ExportPrivateKey rawWallet={{ address0: 'QAddress' }} />
        </ThemeProvider>
      </JotaiProvider>
    );
    expect(lastSecureFlag()).toBe(false);

    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('group:action.export_private_key', {
          postProcess: 'capitalizeFirstChar',
        }),
      })
    );
    expect(lastSecureFlag()).toBe(true);

    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('core:action.cancel', {
          postProcess: 'capitalizeFirstChar',
        }),
        hidden: true,
      })
    );
    await waitFor(() => expect(lastSecureFlag()).toBe(false));
  });
});
