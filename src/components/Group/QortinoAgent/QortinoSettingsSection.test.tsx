import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import { QORTINO_MODEL } from '../../../qortinoAgent/manifest';
import {
  getQortinoSettings,
  resetQortinoSettingsForTests,
} from '../../../qortinoAgent/settings';
import { QortinoSettingsSection } from './QortinoSettingsSection';

const INSTALL = {
  installed: true,
  modelId: QORTINO_MODEL.id,
  llmPath: `/agent/models/${QORTINO_MODEL.parts[0].filename}`,
};

function renderSection(
  overrides: Partial<Parameters<typeof QortinoSettingsSection>[0]> = {}
) {
  const props = {
    install: INSTALL,
    hasChats: true,
    onDeleteAllChats: vi.fn(),
    onRemoveQortino: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<QortinoSettingsSection {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  return props;
}

describe("Qortino's settings in the chat history panel", () => {
  afterEach(() => {
    resetQortinoSettingsForTests();
    localStorage.clear();
  });

  it('opens from its row at the top and is remembered open', () => {
    render(
      <QortinoSettingsSection
        install={INSTALL}
        hasChats
        onDeleteAllChats={vi.fn()}
        onRemoveQortino={vi.fn(async () => undefined)}
      />
    );
    const row = screen.getByRole('button', { name: 'Settings' });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Answers')).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Answers')).toBeInTheDocument();
    expect(localStorage.getItem('qortal-go:qortino-settings-open:v1')).toBe(
      '1'
    );
  });

  it('changes answer length, text size, keep-ready and the Enter key', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Short' }));
    fireEvent.click(screen.getByRole('button', { name: 'Large' }));
    fireEvent.click(screen.getByRole('button', { name: 'While GO is open' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Enter key sends/ }));
    expect(getQortinoSettings()).toEqual({
      answerLength: 'short',
      textSize: 'large',
      enterSends: false,
      keepReady: 'open',
    });
    expect(screen.getByRole('button', { name: 'Short' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('asks before deleting every chat', () => {
    const props = renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all chats' }));
    expect(props.onDeleteAllChats).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onDeleteAllChats).toHaveBeenCalledTimes(1);
  });

  it('has nothing to delete when no chat has messages', () => {
    renderSection({ hasChats: false });
    expect(
      screen.getByRole('button', { name: 'Delete all chats' })
    ).toBeDisabled();
  });

  it('shows the model on the phone and removes it after a confirm', async () => {
    const props = renderSection();
    expect(
      screen.getByText('Qwen3 4B Instruct 2507 · 2.3 GB on this phone')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Qortino from this phone' })
    );
    expect(props.onRemoveQortino).not.toHaveBeenCalled();
    expect(
      screen.getByText(/This deletes the Qortino model \(2\.3 GB\)/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(props.onRemoveQortino).toHaveBeenCalledTimes(1));
  });

  it('says why when removing failed, and lets the user cancel', async () => {
    renderSection({
      onRemoveQortino: vi.fn(async () => {
        throw new Error('cleanupStorage failed: busy');
      }),
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Qortino from this phone' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(
      await screen.findByText(
        'Could not remove Qortino: cleanupStorage failed: busy'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Remove Qortino from this phone' })
    ).toBeInTheDocument();
  });
});
