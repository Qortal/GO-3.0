import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Send screen resolves the recipient before the confirmation, shows name
// and full address there, and sends to that address with the fee it showed
// (GO-19, GO-20).

const ALICE = 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP';
const FEE = '0.01000000';

function withParams(key: string, options?: Record<string, unknown>) {
  const params = { ...(options || {}) };
  delete params.postProcess;
  delete params.defaultValue;
  return Object.keys(params).length ? `${key} ${JSON.stringify(params)}` : key;
}

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: withParams, i18n: { language: 'en' } }),
}));
vi.mock('../background/background.ts', () => ({
  getFee: vi.fn(),
  resolveRecipient: vi.fn(),
}));
vi.mock('./Group/groupApi', () => ({
  getPrimaryNameForAvatar: vi.fn(async () => 'alice-primary'),
}));
vi.mock('../utils/qrScanner', () => ({ isQrScannerAvailable: () => false }));
vi.mock('./QrScannerOverlay', () => ({ QrScannerOverlay: () => null }));
vi.mock('../utils/events', () => ({ executeEvent: vi.fn() }));

import { QortPayment } from './QortPayment';
import { lightTheme } from '../styles/theme-light';
import { getFee, resolveRecipient } from '../background/background.ts';
import { getPrimaryNameForAvatar } from './Group/groupApi';

const sendMessage = vi.fn();

function renderPayment(props: Record<string, unknown> = {}) {
  const show = vi.fn(async (_message: unknown) => true);
  const onSuccess = vi.fn();
  render(
    <ThemeProvider theme={lightTheme}>
      <QortPayment
        balance={100}
        show={show}
        onSuccess={onSuccess}
        defaultPaymentTo="alice"
        defaultPaymentAmount={1.5}
        {...props}
      />
    </ThemeProvider>
  );
  const password = document.getElementById(
    'payment-password'
  ) as HTMLInputElement;
  fireEvent.focus(password);
  fireEvent.change(password, { target: { value: 'pw' } });
  return { show, onSuccess };
}

beforeEach(() => {
  vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: FEE });
  vi.mocked(resolveRecipient).mockResolvedValue({
    address: ALICE,
    name: 'Alice',
  });
  sendMessage.mockResolvedValue(true);
  (window as unknown as { sendMessage: unknown }).sendMessage = sendMessage;
});

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { sendMessage?: unknown }).sendMessage;
});

describe('QortPayment', () => {
  it('confirms with name and full address, then pays that address with the shown fee', async () => {
    const { show, onSuccess } = renderPayment();
    fireEvent.click(screen.getByRole('button', { name: 'core:action.send' }));

    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(resolveRecipient).toHaveBeenCalledWith('alice');
    const { message, paymentFee } = show.mock.calls[0][0] as {
      message: string;
      paymentFee: string;
    };
    expect(message).toContain('core:message.question.transfer_qort_to');
    expect(message).toContain('"amount":"1.5"');
    expect(message).toContain(`Alice (${ALICE})`);
    expect(paymentFee).toBe(`${FEE} QORT`);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(sendMessage).toHaveBeenCalledWith('sendCoin', {
      amount: 1.5,
      receiver: ALICE,
      password: 'pw',
      approvedFee: FEE,
    });
  });

  it('shows the lookup error and asks nothing when the name is unknown', async () => {
    vi.mocked(resolveRecipient).mockRejectedValueOnce(
      new Error('name does not exist')
    );
    const { show } = renderPayment({ defaultPaymentTo: 'nobody' });
    fireEvent.click(screen.getByRole('button', { name: 'core:action.send' }));

    expect(await screen.findByText('name does not exist')).toBeTruthy();
    expect(show).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows the registered name for a typed or prefilled address', async () => {
    renderPayment({ defaultPaymentTo: ALICE });
    expect(await screen.findByText('alice-primary')).toBeTruthy();
    expect(getPrimaryNameForAvatar).toHaveBeenCalledWith(ALICE);
  });

  it('starts one send for a double tap on Send', async () => {
    const { show, onSuccess } = renderPayment();
    const send = screen.getByRole('button', { name: 'core:action.send' });
    fireEvent.click(send);
    fireEvent.click(send);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(resolveRecipient).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    // Free again once that send is done.
    fireEvent.click(send);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
  });

  it('can send again after the confirmation is declined', async () => {
    const { show } = renderPayment();
    show.mockRejectedValueOnce(new Error('declined'));
    const send = screen.getByRole('button', { name: 'core:action.send' });
    fireEvent.click(send);
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.click(send);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  });

  it('keeps the wallet password away from autofill and password managers (N-33)', () => {
    renderPayment();
    const password = document.getElementById(
      'payment-password'
    ) as HTMLInputElement;
    expect(password).toHaveAttribute('autocomplete', 'off');
    expect(password).toHaveAttribute('data-1p-ignore', 'true');
    expect(password).toHaveAttribute('data-bwignore', 'true');
    expect(password).toHaveAttribute('data-lpignore', 'true');
  });
});
