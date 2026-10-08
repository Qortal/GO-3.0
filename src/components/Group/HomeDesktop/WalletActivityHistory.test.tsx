import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material';
import '../../../i18n/i18n';
import { WalletActivityHistory } from './WalletActivityHistory';
import {
  WALLET_HISTORY_PAGE_SIZE,
  formatWalletHistoryDate,
  shortWalletAddress,
  walletEntryFromTransaction,
  walletHistoryUrl,
} from './walletHistory';

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

const ME = 'QmeAddress000000000000000000000000';
const ALICE = 'QaliceAddress00000000000000000000';
const BOB = 'QbobAddress0000000000000000000000';

const payment = (
  n: number,
  from: string,
  to: string,
  amount = '1.50000000'
) => ({
  type: 'PAYMENT',
  timestamp: 1_700_000_000_000 - n * 60_000,
  signature: `sig${n}`,
  creatorAddress: from,
  recipient: to,
  amount,
});

describe('wallet history helpers', () => {
  it('reads a payment from the account side', () => {
    expect(walletEntryFromTransaction(payment(1, ALICE, ME), ME)).toEqual({
      amount: 1.5,
      counterpartyAddress: ALICE,
      direction: 'incoming',
      signature: 'sig1',
      timestamp: 1_700_000_000_000 - 60_000,
    });
    expect(
      walletEntryFromTransaction(payment(2, ME, BOB, '3'), ME)?.direction
    ).toBe('outgoing');
    expect(walletEntryFromTransaction(payment(3, ALICE, BOB), ME)).toBeNull();
    expect(
      walletEntryFromTransaction({ ...payment(4, ALICE, ME), amount: 'x' }, ME)
    ).toBeNull();
  });

  it('asks the node for one page, newest first', () => {
    const url = walletHistoryUrl('http://node', ME, 40);
    expect(url).toContain('txType=PAYMENT');
    expect(url).toContain(`address=${ME}`);
    expect(url).toContain(`limit=${WALLET_HISTORY_PAGE_SIZE}`);
    expect(url).toContain('offset=40');
    expect(url).toContain('reverse=true');
  });

  it('shows the year only for other years, and short addresses', () => {
    const now = new Date(2026, 9, 7).getTime();
    expect(
      formatWalletHistoryDate(new Date(2026, 9, 6, 14, 32).getTime(), 'en', now)
    ).not.toContain('2026');
    expect(
      formatWalletHistoryDate(new Date(2025, 0, 2, 9, 5).getTime(), 'en', now)
    ).toContain('2025');
    expect(shortWalletAddress(ALICE)).toBe('Qalice…0000');
    expect(shortWalletAddress('Qshort')).toBe('Qshort');
  });
});

describe('WalletActivityHistory', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respond = (page: unknown[]) =>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => page });

  const Harness = ({
    open,
    onToggle = () => undefined,
    excludeSignature,
  }: {
    open: boolean;
    onToggle?: () => void;
    excludeSignature?: string;
  }) => (
    <ThemeProvider theme={createTheme()}>
      <WalletActivityHistory
        excludeSignature={excludeSignature}
        onOpenCounterparty={() => undefined}
        onToggle={onToggle}
        open={open}
        refreshKey="1"
        resolveLabel={async (address) =>
          address === ALICE ? 'alice' : address
        }
        userAddress={ME}
      />
    </ThemeProvider>
  );

  it('loads nothing until it is opened', async () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} open={false} />);
    fireEvent.click(screen.getByText('Transaction history'));
    expect(onToggle).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists payments without the one shown above, and pages on', async () => {
    const first = Array.from({ length: WALLET_HISTORY_PAGE_SIZE }, (_, n) =>
      n % 2 ? payment(n, ME, BOB) : payment(n, ALICE, ME)
    );
    respond(first);
    render(<Harness excludeSignature="sig0" open />);
    expect(await screen.findAllByText('alice')).toHaveLength(
      WALLET_HISTORY_PAGE_SIZE / 2 - 1
    );
    expect(screen.getAllByText('QbobAd…0000')).toHaveLength(
      WALLET_HISTORY_PAGE_SIZE / 2
    );
    expect(screen.getAllByText('+1.50 QORT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-1.50 QORT').length).toBeGreaterThan(0);

    respond([payment(50, ALICE, ME)]);
    await act(async () => {
      fireEvent.click(screen.getByText('Show more'));
    });
    expect(fetchMock.mock.calls[1][0]).toContain(
      `offset=${WALLET_HISTORY_PAGE_SIZE}`
    );
    expect(await screen.findAllByText('alice')).toHaveLength(
      WALLET_HISTORY_PAGE_SIZE / 2
    );
    // A short page is the last one.
    expect(screen.queryByText('Show more')).toBeNull();
  });

  it('offers a retry when the node fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Harness open />);
    expect(
      await screen.findByText("Couldn't load the history.")
    ).toBeInTheDocument();
    respond([]);
    await act(async () => {
      fireEvent.click(screen.getByText('Try again'));
    });
    expect(await screen.findByText('No payments yet.')).toBeInTheDocument();
  });
});
