import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../../i18n/i18n';
import {
  resetQortinoSettingsForTests,
  updateQortinoSettings,
} from '../../../../qortinoAgent/settings';
import { QortinoHomeComposer } from '../QortinoHomeComposer';

describe('The ask box next to Qortino on Home', () => {
  afterEach(() => {
    resetQortinoSettingsForTests();
  });

  it('sends the question with Enter and clears itself', () => {
    const onSend = vi.fn();
    const onFocusChange = vi.fn();
    render(
      <QortinoHomeComposer onFocusChange={onFocusChange} onSend={onSend} />
    );
    const box = screen.getByRole('textbox', { name: 'Ask Qortino…' });
    fireEvent.focus(box);
    expect(onFocusChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(box, { target: { value: '  how do I purify water?  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('how do I purify water?');
    expect(box).toHaveValue('');
  });

  it('has nothing to send while empty', () => {
    const onSend = vi.fn();
    render(<QortinoHomeComposer onFocusChange={vi.fn()} onSend={onSend} />);
    const send = screen.getByRole('button', { name: 'Ask Qortino' });
    expect(send).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('starts a new line with Enter when Qortino is set to', () => {
    updateQortinoSettings({ enterSends: false });
    const onSend = vi.fn();
    render(<QortinoHomeComposer onFocusChange={vi.fn()} onSend={onSend} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'two' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Qortino' }));
    expect(onSend).toHaveBeenCalledWith('two');
  });
});
