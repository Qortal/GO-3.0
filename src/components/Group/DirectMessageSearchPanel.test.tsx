import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import { capitalizeFirstChar } from '../../i18n/processors';

vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));

import { DirectMessageSearchPanel } from './DirectMessageSearchPanel';

const ME = 'Qme';
const ALICE = 'QaliceAddress000000000000000000000';

const i18n = createInstance().use(capitalizeFirstChar as any);
void i18n.init({
  lng: 'en',
  resources: {
    en: {
      core: { action: { close: 'close' } },
      group: { last_message_you: 'You' },
      reticulum: {
        dm_search: {
          clear: 'clear search',
          empty: 'no messages found',
          hint: 'type at least 2 characters',
          placeholder: 'search your messages',
          title: 'search messages',
          unavailable: 'search is not available',
        },
      },
    },
  },
});

const event = (eventId: string, html: string, fromMe = false) => ({
  eventId,
  eventType: 'message',
  senderAddress: fromMe ? ME : ALICE,
  recipientAddress: fromMe ? ALICE : ME,
  timestamp: Date.now() - 60_000,
  payload: JSON.stringify({ messageText: html }),
});

const renderPanel = () => {
  const props = { onClose: vi.fn(), onOpenResult: vi.fn() };
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={darkTheme}>
        <DirectMessageSearchPanel
          open
          myAddress={ME}
          directs={[{ address: ALICE, name: 'Alice' }]}
          {...props}
        />
      </ThemeProvider>
    </I18nextProvider>
  );
  return props;
};

const type = async (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search messages' }), {
    target: { value: text },
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
};

describe('DirectMessageSearchPanel', () => {
  const original = window.reticulumChat;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.reticulumChat = original;
    vi.useRealTimers();
  });

  it('searches the DMs and opens a result at its message', async () => {
    const search = vi.fn(async () => [
      event('m2', '<p>Lunch at noon?</p>', true),
      event('m1', '<p>see you at lunch</p>'),
    ]);
    window.reticulumChat = { searchDirectMessages: search } as any;
    const props = renderPanel();
    expect(screen.getByText('Type at least 2 characters')).toBeInTheDocument();

    await type('lunch');

    expect(search).toHaveBeenCalledWith(ME, 'lunch', 120);
    const results = screen.getAllByRole('listitem');
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveTextContent('Alice');
    expect(results[0]).toHaveTextContent('You: Lunch at noon?');
    expect(results[0].querySelector('mark')).toHaveTextContent('Lunch');
    expect(results[1].querySelector('mark')).toHaveTextContent('lunch');

    fireEvent.click(results[1]);
    expect(props.onOpenResult).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', peerAddress: ALICE }),
      { address: ALICE, name: 'Alice' }
    );
  });

  it('says when nothing is found', async () => {
    window.reticulumChat = {
      searchDirectMessages: vi.fn(async () => []),
    } as any;
    renderPanel();

    await type('zebra');

    expect(screen.getByText('No messages found')).toBeInTheDocument();
  });

  it('says when this device cannot search', async () => {
    window.reticulumChat = {} as any;
    renderPanel();

    await type('zebra');

    expect(screen.getByText('Search is not available')).toBeInTheDocument();
  });

  it('waits for a pause in typing and drops stale answers', async () => {
    let answer: (value: unknown[]) => void = () => {};
    const search = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<unknown[]>((resolve) => (answer = resolve))
      )
      .mockImplementation(async () => [event('m9', '<p>lunchbox</p>')]);
    window.reticulumChat = { searchDirectMessages: search } as any;
    renderPanel();

    await type('lun');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search messages' }), {
      target: { value: 'lunchb' },
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    // Still typing: only the first query went out.
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(search).toHaveBeenLastCalledWith(ME, 'lunchb', 120);
    await act(async () => {
      answer([event('old', '<p>lunar</p>')]);
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveTextContent('lunchbox');
  });
});
