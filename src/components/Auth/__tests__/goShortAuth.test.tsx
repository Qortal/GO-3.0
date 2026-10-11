import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ALICE = 'QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG';

vi.mock('../../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));
// The account picker's storage, node and biometric neighbours: one saved
// account, nothing on the network.
vi.mock('../../../background/background.ts', () => ({
  getWallets: vi.fn(async () => [{ address0: ALICE }]),
  storeWallets: vi.fn(async () => undefined),
  walletVersion: 2,
}));
vi.mock('../../../utils/chromeStorage', () => ({
  getData: vi.fn(async () => null),
  storeData: vi.fn(async () => 'Data saved successfully'),
}));
vi.mock('../../../utils/globalApi', () => ({
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  getBaseApiReactForAvatar: () => '',
  getBaseApiReactForPrimaryName: () => '',
}));
vi.mock('../../../App', () => ({
  getArbitrarySearchSimpleEndpointReact: () =>
    '/arbitrary/resources/searchsimple',
  getBaseApiReact: () => '',
  getBaseApiReactForPrimaryName: () => '',
}));
vi.mock('../../../utils/generateWallet/phrase-wallet.ts', () => ({
  default: class {},
}));
vi.mock('../../../encryption/kdf', () => ({ prewarmKdfWorkers: vi.fn() }));
vi.mock('../../../utils/lastAuthenticatedWallet', () => ({
  getLastAuthenticatedWalletAddress: () => '',
  hasAttemptedLastWalletAutoSelectThisSession: () => true,
  markLastWalletAutoSelectAttemptedThisSession: vi.fn(),
}));
vi.mock('../../../utils/walletBiometricAuth', () => ({
  getBiometricEnabledAddresses: vi.fn(async () => []),
  getBiometricEnabledAddressesSync: vi.fn(() => []),
  prefetchWalletSessionProbe: vi.fn(),
  prewarmBiometricUnlockKdf: vi.fn(async () => undefined),
  syncBiometricAutoPromptFlag: vi.fn(),
  syncBiometricPasswordCache: vi.fn(async () => undefined),
  updateEarlyBiometricPromptForTopWallet: vi.fn(),
  warmUpBiometricHardware: vi.fn(async () => undefined),
}));
vi.mock('../../../plugins/QortalBiometric', () => ({
  isQortalBiometricHardwareAvailable: vi.fn(async () => false),
}));

import { __setGoLayoutForTests } from '../../../layout/goLayout';
import { lightTheme } from '../../../styles/theme-light';
import { AuthFrame } from '../AuthShell';
import { BackupWalletModal } from '../BackupWalletModal';
import { Wallets } from '../../Wallets';

const PHONE_LANDSCAPE = { go: true, width: 873, stableHeight: 393 };
const PHONE = { go: true, width: 393, stableHeight: 873 };

const themed = (ui: ReactElement) =>
  render(<ThemeProvider theme={lightTheme}>{ui}</ThemeProvider>);

/** The CSS emotion wrote for one of an element's classes. */
const rulesFor = (el: Element) => {
  const css = Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  return Array.from(el.classList)
    .filter((name) => name.startsWith('css-'))
    .flatMap((name) => css.split('}').filter((rule) => rule.includes(name)));
};

afterEach(() => {
  // Unmount first: the reset below notifies the layout store's readers.
  cleanup();
  __setGoLayoutForTests(null);
});

describe('AuthFrame padding', () => {
  const framePadding = () => {
    themed(
      <AuthFrame>
        <span>unlock form</span>
      </AuthFrame>
    );
    // span → animated column → padded row
    const row = screen.getByText('unlock form').parentElement?.parentElement;
    return getComputedStyle(row as HTMLElement);
  };

  it('drops the bottom to 16px in a short GO window', () => {
    __setGoLayoutForTests(PHONE_LANDSCAPE);
    const style = framePadding();
    expect(style.paddingBottom).toBe('16px');
  });

  // The account picker's logo overhangs its card by ~56px; trimming the top
  // would push it above the frame, where it is clipped and cannot be
  // scrolled to.
  it('keeps the top padding in a short GO window', () => {
    __setGoLayoutForTests(PHONE_LANDSCAPE);
    const style = framePadding();
    expect(style.paddingTop).not.toBe('16px');
    const row = screen.getByText('unlock form').parentElement?.parentElement;
    const shortRule = rulesFor(row as HTMLElement).find((rule) =>
      rule.includes('html[data-go-short]')
    );
    expect(shortRule).toContain('padding-bottom:16px');
    expect(shortRule).not.toContain('padding-top');
  });

  // The 56px itself sits in MUI's `@media (min-width:0px)` rule, which jsdom
  // does not apply; what matters is that the short rule stays out.
  it('keeps the usual padding on a GO phone in portrait', () => {
    __setGoLayoutForTests(PHONE);
    expect(framePadding().paddingTop).not.toBe('16px');
  });

  it('keeps the usual padding on the Hub', () => {
    __setGoLayoutForTests({ go: false });
    expect(framePadding().paddingTop).not.toBe('16px');
  });
});

describe('Wallets account list in a short window', () => {
  const renderPicker = async () => {
    const view = render(
      <Provider store={createStore()}>
        <ThemeProvider theme={lightTheme}>
          <Wallets mode="entry" setExtState={vi.fn()} setRawWallet={vi.fn()} />
        </ThemeProvider>
      </Provider>
    );
    // The list scrolls inside a fixed viewport: the one box with overflow.
    let list: HTMLElement | undefined;
    await waitFor(() => {
      list = Array.from(view.container.querySelectorAll('div')).find(
        (el) => getComputedStyle(el).overflowY === 'auto'
      );
      expect(list).toBeDefined();
    });
    return list as HTMLElement;
  };

  it('is capped at 45% of the height with no forced minimum (GO, short)', async () => {
    __setGoLayoutForTests(PHONE_LANDSCAPE);
    const list = await renderPicker();
    const shortRule = rulesFor(list).find((rule) =>
      rule.includes('html[data-go-short]')
    );
    expect(shortRule).toContain('max-height:min(292px, 45dvh)');
    expect(shortRule).toContain('min-height:0');
    // The attribute is on <html>, so the short rule applies.
    expect(document.documentElement.hasAttribute('data-go-short')).toBe(true);
    expect(getComputedStyle(list).minHeight).toMatch(/^0(px)?$/);
  });

  it('keeps the fixed 292px list elsewhere', async () => {
    __setGoLayoutForTests(PHONE);
    const list = await renderPicker();
    expect(document.documentElement.hasAttribute('data-go-short')).toBe(false);
    expect(getComputedStyle(list).minHeight).toBe('292px');
    expect(getComputedStyle(list).maxHeight).toBe('292px');
  });
});

describe('BackupWalletModal body', () => {
  const rawWallet = { address0: ALICE, name: 'alice' };

  const body = () => {
    themed(<BackupWalletModal onClose={vi.fn()} open rawWallet={rawWallet} />);
    const paper = document.querySelector('.MuiDialog-paper');
    return getComputedStyle(paper?.firstElementChild as HTMLElement);
  };

  it('scrolls on GO so the Backup button stays reachable', () => {
    __setGoLayoutForTests(PHONE_LANDSCAPE);
    const style = body();
    expect(style.overflowY).toBe('auto');
    expect(style.minHeight).toMatch(/^0(px)?$/);
  });

  it('is unchanged on the Hub', () => {
    __setGoLayoutForTests({ go: false });
    const style = body();
    expect(style.overflowY).not.toBe('auto');
    expect(style.minHeight).not.toMatch(/^0(px)?$/);
  });
});
