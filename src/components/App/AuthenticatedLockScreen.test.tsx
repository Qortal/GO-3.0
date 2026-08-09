import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedLockScreen } from './AuthenticatedLockScreen';
import { isCapacitor } from '../../utils/platform';
import {
  isBiometricHardwareAvailable,
  isBiometricUnlockConfigured,
  readBiometricUnlockPassword,
  verifyBiometricUnlock,
} from '../../utils/walletBiometricAuth';

vi.mock('../../utils/platform', () => ({ isCapacitor: vi.fn(() => false) }));
vi.mock('../../utils/walletBiometricAuth', () => ({
  isBiometricHardwareAvailable: vi.fn(async () => false),
  isBiometricUnlockConfigured: vi.fn(async () => false),
  readBiometricUnlockPassword: vi.fn(async () => ''),
  verifyBiometricUnlock: vi.fn(async () => {}),
}));

/** Put the component in the state where fingerprint unlock is on offer. */
function enrolFingerprint(password = 'stored password') {
  vi.mocked(isCapacitor).mockReturnValue(true);
  vi.mocked(isBiometricHardwareAvailable).mockResolvedValue(true);
  vi.mocked(isBiometricUnlockConfigured).mockResolvedValue(true);
  vi.mocked(readBiometricUnlockPassword).mockResolvedValue(password);
}

const fingerprintButton = () =>
  screen.findByRole('button', { name: 'Unlock with fingerprint' });

describe('AuthenticatedLockScreen', () => {
  beforeEach(() => {
    vi.mocked(isCapacitor).mockReturnValue(false);
    vi.mocked(isBiometricHardwareAvailable).mockResolvedValue(false);
    vi.mocked(isBiometricUnlockConfigured).mockResolvedValue(false);
    vi.mocked(verifyBiometricUnlock).mockResolvedValue(undefined);
  });

  it('keeps keyboard focus inside the lock screen', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Underlying action</button>
        <AuthenticatedLockScreen onUnlock={vi.fn()} />
      </>
    );

    const passwordInput = screen.getByLabelText('Qortal account password');
    const unlockButton = screen.getByRole('button', { name: 'Unlock' });
    await waitFor(() => expect(passwordInput).toHaveFocus());

    await user.type(passwordInput, 'password');
    await user.tab();
    expect(unlockButton).toHaveFocus();
    await user.tab();
    expect(passwordInput).toHaveFocus();
    expect(screen.getByText('Underlying action')).not.toHaveFocus();
  });

  it('clears a rejected password and reports the failure', async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error('incorrect'));
    render(<AuthenticatedLockScreen onUnlock={onUnlock} />);

    const passwordInput = screen.getByLabelText('Qortal account password');
    await userEvent.type(passwordInput, 'wrong password');
    fireEvent.submit(passwordInput.closest('form')!);

    await waitFor(() =>
      expect(onUnlock).toHaveBeenCalledWith('wrong password')
    );
    await waitFor(() => expect(passwordInput).toHaveValue(''));
    expect(
      screen.getByText('That password is not correct. Please try again.')
    ).toBeVisible();
  });

  it('does not start duplicate password checks', async () => {
    let finishUnlock: (() => void) | undefined;
    const onUnlock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUnlock = resolve;
        })
    );
    render(<AuthenticatedLockScreen onUnlock={onUnlock} />);

    const passwordInput = screen.getByLabelText('Qortal account password');
    fireEvent.change(passwordInput, { target: { value: 'password' } });
    const form = passwordInput.closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(onUnlock).toHaveBeenCalledTimes(1);
    await act(async () => finishUnlock?.());
  });

  it('does not offer fingerprint unlock outside the mobile app', async () => {
    render(<AuthenticatedLockScreen onUnlock={vi.fn()} walletAddress="Q123" />);

    await waitFor(() =>
      expect(isBiometricUnlockConfigured).not.toHaveBeenCalled()
    );
    expect(
      screen.queryByRole('button', { name: 'Unlock with fingerprint' })
    ).toBeNull();
  });

  it('does not offer fingerprint unlock when the account has none enrolled', async () => {
    vi.mocked(isCapacitor).mockReturnValue(true);
    vi.mocked(isBiometricHardwareAvailable).mockResolvedValue(true);
    vi.mocked(isBiometricUnlockConfigured).mockResolvedValue(false);
    render(<AuthenticatedLockScreen onUnlock={vi.fn()} walletAddress="Q123" />);

    await waitFor(() =>
      expect(isBiometricUnlockConfigured).toHaveBeenCalledWith('Q123')
    );
    expect(
      screen.queryByRole('button', { name: 'Unlock with fingerprint' })
    ).toBeNull();
  });

  it('unlocks with the stored password after a successful scan', async () => {
    enrolFingerprint('stored password');
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    render(<AuthenticatedLockScreen onUnlock={onUnlock} walletAddress="Q123" />);

    await userEvent.click(await fingerprintButton());

    await waitFor(() => expect(verifyBiometricUnlock).toHaveBeenCalled());
    // The scan must be verified before the credential is read.
    expect(readBiometricUnlockPassword).toHaveBeenCalledWith('Q123');
    await waitFor(() =>
      expect(onUnlock).toHaveBeenCalledWith('stored password')
    );
  });

  it('falls back to the password when the scan is cancelled', async () => {
    enrolFingerprint();
    vi.mocked(verifyBiometricUnlock).mockRejectedValue(
      new Error('Biometric scan cancelled')
    );
    const onUnlock = vi.fn();
    render(<AuthenticatedLockScreen onUnlock={onUnlock} walletAddress="Q123" />);

    await userEvent.click(await fingerprintButton());

    await waitFor(() =>
      expect(screen.getByText('Fingerprint unlock was cancelled.')).toBeVisible()
    );
    expect(onUnlock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Qortal account password')).toBeEnabled();
  });
});
