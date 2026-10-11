import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/i18n';
import { reticulumChatSummariesAtom } from '../../../atoms/global';
import { darkTheme } from '../../../styles/theme-dark';

vi.mock('../../Group/useGroupRowAvatar', () => ({
  useGroupRowAvatar: () => ({ src: undefined, imgProps: {} }),
}));

import { ChatShareChannelStep } from './ChatShareChannelStep';

const channel = (
  channelId: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  archived: false,
  channelId,
  createdAt: 1,
  createdBy: 'tester',
  groupId: 7,
  name: channelId,
  position: 0,
  updatedAt: 1,
  ...extra,
});

const GROUP = { groupId: 7, groupName: 'Qortal GO testers' };

function withChannels(channels: Record<string, unknown>[], categories = []) {
  window.reticulumChat = {
    subscribeGroup: vi.fn(),
    getChannelMetadataBundle: vi.fn(() => ({
      channels,
      categories,
      ready: true,
      snapshotVersion: 1,
    })),
  } as unknown as typeof window.reticulumChat;
}

async function renderStep({
  isAdmin = false,
  store = createStore(),
}: { isAdmin?: boolean; store?: ReturnType<typeof createStore> } = {}) {
  const onBack = vi.fn();
  const onPick = vi.fn();
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <ChatShareChannelStep
          group={GROUP}
          isAdmin={isAdmin}
          onBack={onBack}
          onPick={onPick}
        />
      </ThemeProvider>
    </Provider>
  );
  // The channels are read asynchronously.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { onBack, onPick };
}

const stepRegion = () =>
  screen.queryByRole('region', {
    name: 'Pick a channel in Qortal GO testers',
  });

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  delete (window as { reticulumChat?: unknown }).reticulumChat;
});

describe('ChatShareChannelStep', () => {
  it("shows the group's channels and hands the share to the one tapped", async () => {
    withChannels(
      [
        channel('general'),
        channel('dev', { categoryId: 'cat-build', position: 1 }),
        channel('random', { position: 1 }),
      ],
      [{ categoryId: 'cat-build', name: 'Build', groupId: 7, position: 0 }]
    );
    const { onPick } = await renderStep();

    expect(stepRegion()).toBeInTheDocument();
    expect(screen.getByText('Qortal GO testers')).toBeInTheDocument();
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^dev/ }));
    expect(onPick).toHaveBeenCalledWith('dev');
    // One pick only.
    fireEvent.click(screen.getByRole('button', { name: /^random/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('greys out a channel only admins post in', async () => {
    withChannels([
      channel('general'),
      channel('dev', { position: 1 }),
      channel('news', { position: 2, writeMode: 'admins' }),
    ]);
    const { onPick } = await renderStep();

    const news = screen.getByRole('button', { name: /^news/ });
    expect(news).toBeDisabled();
    expect(news).toHaveTextContent('Admins only');
    fireEvent.click(news);
    expect(onPick).not.toHaveBeenCalled();
    // A row members can tap is not announced as disabled.
    expect(screen.getByRole('button', { name: /^dev/ })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('lets an admin post in admins-only channels', async () => {
    withChannels([
      channel('general'),
      channel('news', { position: 1, writeMode: 'admins' }),
    ]);
    const { onPick } = await renderStep({ isAdmin: true });

    fireEvent.click(screen.getByRole('button', { name: /^news/ }));
    expect(onPick).toHaveBeenCalledWith('news');
  });

  it('goes straight in when only one channel can take the share', async () => {
    withChannels([
      channel('general'),
      channel('news', { position: 1, writeMode: 'admins' }),
    ]);
    const { onPick } = await renderStep();

    expect(onPick).toHaveBeenCalledWith('general');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(stepRegion()).toBeNull();
  });

  it('opens the group as before when its channels cannot be read', async () => {
    const { onPick } = await renderStep();
    expect(onPick).toHaveBeenCalledWith(null);
    expect(stepRegion()).toBeNull();
  });

  it('says so when no channel takes posts from the user', async () => {
    withChannels([
      channel('news', { writeMode: 'admins' }),
      channel('rules', { position: 1, writeMode: 'admins' }),
    ]);
    const { onPick } = await renderStep();

    expect(
      screen.getByText('Only admins can post in the channels of this group.')
    ).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shows unread badges like the channel list', async () => {
    withChannels([channel('general'), channel('dev', { position: 1 })]);
    const store = createStore();
    store.set(reticulumChatSummariesAtom, {
      '7': {
        groupId: 7,
        channels: [{ groupId: 7, channelId: 'dev', replyCount: 3 }],
      },
    });
    await renderStep({ store });

    expect(screen.getByRole('button', { name: /^dev/ })).toHaveTextContent('3');
  });

  it('goes back to the Groups list', async () => {
    withChannels([channel('general'), channel('dev', { position: 1 })]);
    const { onBack, onPick } = await renderStep();

    fireEvent.click(screen.getByRole('button', { name: 'Back to groups' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});
