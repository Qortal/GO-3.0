import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count !== undefined ? `${key} ${options.count}` : key,
    i18n: { language: 'en' },
  }),
}));

import { useSecureScreen } from '../../hooks/useSecureScreen';
import { lightTheme } from '../../styles/theme-light';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import { PaymentPublishDialog } from './PaymentPublishDialog';

type Props = Parameters<typeof PaymentPublishDialog>[0];

const message = { message: 'Send 1 QORT to Alice', paymentFee: '0.01 QORT' };

function renderDialog(props: Partial<Props> = {}) {
  const onAccept = vi.fn();
  const onCancel = vi.fn();
  const view = (next: Partial<Props> = {}) => (
    <ThemeProvider theme={lightTheme}>
      <PaymentPublishDialog
        open
        requestId={1}
        message={message}
        onAccept={onAccept}
        onCancel={onCancel}
        {...props}
        {...next}
      />
    </ThemeProvider>
  );
  const result = render(view());
  return {
    onAccept,
    onCancel,
    rerenderWith: (next: Partial<Props>) => result.rerender(view(next)),
  };
}

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('PaymentPublishDialog (GO-28 / GO-29)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(useSecureScreen).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps Accept disabled for a second after a request appears', () => {
    const { onAccept, rerenderWith } = renderDialog();
    const accept = () => screen.getByTestId('payment-publish-accept');
    expect(accept()).toBeDisabled();
    fireEvent.click(accept());
    expect(onAccept).not.toHaveBeenCalled();

    wait(1000);
    expect(accept()).toBeEnabled();
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledTimes(1);

    // The next request waits its own second.
    rerenderWith({ requestId: 2 });
    expect(accept()).toBeDisabled();
    wait(1000);
    expect(accept()).toBeEnabled();
  });

  it('lets Decline work at once', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByText('core:action.decline'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('says how many confirmations wait behind this one', () => {
    const { rerenderWith } = renderDialog();
    expect(
      screen.queryByTestId('payment-publish-pending')
    ).not.toBeInTheDocument();
    rerenderWith({ pendingCount: 2 });
    expect(screen.getByTestId('payment-publish-pending')).toHaveTextContent(
      'core:approval_dialog.more_waiting 2'
    );
  });

  it('declines on the Android back button, not on a double press', () => {
    const { onCancel, rerenderWith } = renderDialog();
    const pressBack = () => {
      const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(pressBack()).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    wait(300);
    expect(pressBack()).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Closed: back goes to the screens below again.
    rerenderWith({ open: false });
    expect(pressBack()).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('protects the screen and touches only while open', () => {
    const { rerenderWith } = renderDialog();
    expect(useSecureScreen).toHaveBeenLastCalledWith({
      secure: true,
      touchProtection: true,
    });
    rerenderWith({ open: false });
    expect(useSecureScreen).toHaveBeenLastCalledWith({
      secure: false,
      touchProtection: false,
    });
  });
});
