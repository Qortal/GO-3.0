import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { TextFieldProps } from '@mui/material';
import { PasswordField } from './PasswordField';

const expectHiddenFromPasswordManagers = (input: HTMLInputElement) => {
  expect(input).toHaveAttribute('autocomplete', 'off');
  expect(input).toHaveAttribute('data-1p-ignore', 'true');
  expect(input).toHaveAttribute('data-lpignore', 'true');
  expect(input).toHaveAttribute('data-bwignore', 'true');
  expect(input).toHaveAttribute('data-form-type', 'other');
};

/** A controlled field, the way the wallet screens use it. */
function ControlledPasswordField(props: {
  slotProps?: TextFieldProps['slotProps'];
  suppressAutofill?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <PasswordField
      id="wallet-password"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      {...props}
    />
  );
}

describe('PasswordField', () => {
  test('it renders', () => {
    render(<PasswordField data-testid="test-id" value="test-value" />);
    expect(screen.queryByTestId('test-id')).toBeTruthy();
  });

  test('User can toggle between plain text view and password view', async () => {
    render(<PasswordField data-testid="test-id" value="test-value" />);
    const user = userEvent.setup();

    // If your input has no testid, this reliably finds it via its value:
    const input = screen.getByDisplayValue('test-value') as HTMLInputElement;

    // initial: password mode
    expect(input.type).toBe('password');
    expect(screen.getByTestId('password-text-indicator')).toBeInTheDocument();

    // toggle -> plain text
    await user.click(screen.getByTestId('toggle-view-password-btn'));
    expect(input.type).toBe('text');
    expect(screen.getByTestId('plain-text-indicator')).toBeInTheDocument();

    // toggle back -> password
    await user.click(screen.getByTestId('toggle-view-password-btn'));
    expect(input.type).toBe('password');
    expect(screen.getByTestId('password-text-indicator')).toBeInTheDocument();
  });

  test('is never offered to Autofill or password managers (N-33)', () => {
    render(<PasswordField value="secret" />);
    expectHiddenFromPasswordManagers(
      screen.getByDisplayValue('secret') as HTMLInputElement
    );
  });

  test('a caller cannot turn autofill back on', () => {
    render(
      <PasswordField
        autoComplete="current-password"
        inputProps={{ autoComplete: 'new-password', 'aria-label': 'Password' }}
        value="secret"
      />
    );
    const input = screen.getByDisplayValue('secret') as HTMLInputElement;
    expectHiddenFromPasswordManagers(input);
    // The caller's other input props still apply.
    expect(input).toHaveAttribute('aria-label', 'Password');
  });

  test('slotProps.htmlInput cannot turn autofill back on either', () => {
    const { unmount } = render(
      <PasswordField
        slotProps={{
          htmlInput: {
            autoComplete: 'current-password',
            'aria-label': 'Wallet password',
            'data-1p-ignore': 'false',
          },
        }}
        value="secret"
      />
    );
    let input = screen.getByDisplayValue('secret') as HTMLInputElement;
    expectHiddenFromPasswordManagers(input);
    expect(input).toHaveAttribute('aria-label', 'Wallet password');
    unmount();

    // The function form of a slot prop.
    render(
      <PasswordField
        slotProps={{
          htmlInput: () => ({
            autoComplete: 'new-password',
            'aria-label': 'New wallet password',
          }),
        }}
        value="secret"
      />
    );
    input = screen.getByDisplayValue('secret') as HTMLInputElement;
    expectHiddenFromPasswordManagers(input);
    expect(input).toHaveAttribute('aria-label', 'New wallet password');
  });

  test('slotProps.input keeps the eye toggle, the guard and the opt-out', async () => {
    const user = userEvent.setup();
    render(
      <ControlledPasswordField
        suppressAutofill
        slotProps={{
          input: {
            endAdornment: <span data-testid="caller-adornment" />,
            // Nested html input props would otherwise replace the opt-out.
            inputProps: { autoComplete: 'current-password', name: 'pw' },
          },
        }}
      />
    );
    const input = document.getElementById(
      'wallet-password'
    ) as HTMLInputElement;
    expectHiddenFromPasswordManagers(input);
    expect(input).toHaveAttribute('name', 'pw');
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByTestId('caller-adornment')).toBeInTheDocument();

    await user.click(screen.getByTestId('toggle-view-password-btn'));
    expect(input.type).toBe('text');
    await user.click(input);
    expect(input).not.toHaveAttribute('readonly');
  });

  test('still accepts typing and paste', async () => {
    const user = userEvent.setup();
    render(<ControlledPasswordField />);
    const input = document.getElementById(
      'wallet-password'
    ) as HTMLInputElement;

    await user.type(input, 'typed');
    expect(input).toHaveValue('typed');

    await user.clear(input);
    await user.click(input);
    await user.paste('pasted password');
    expect(input).toHaveValue('pasted password');
    expect(input).not.toHaveAttribute('readonly');
  });

  test('suppressAutofill fields become editable on tap and accept paste', async () => {
    const user = userEvent.setup();
    render(<ControlledPasswordField suppressAutofill />);
    const input = document.getElementById(
      'wallet-password'
    ) as HTMLInputElement;
    expect(input).toHaveAttribute('readonly');
    expectHiddenFromPasswordManagers(input);

    await user.click(input);
    expect(input).not.toHaveAttribute('readonly');
    await user.paste('pasted password');
    expect(input).toHaveValue('pasted password');
  });
});
