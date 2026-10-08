import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import { capitalizeFirstChar } from '../../i18n/processors';

// The real settings screen pulls in the whole group list.
vi.mock('./GroupList', () => ({
  ReticulumChatSettingsDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="chat settings" /> : null,
}));

import {
  MobileChatListHeader,
  directIconShare,
  type MobileChatListHeaderHandle,
} from './MobileChatListHeader';
import type { ChatScope } from './ChatScopeSwitch';
import type { PreparedChatShare } from '../Chat/share/chatShareIntake';

const i18n = createInstance().use(capitalizeFirstChar as any);
void i18n.init({
  lng: 'en',
  resources: {
    en: {
      core: { action: { new: { chat: 'new chat' } }, settings: 'settings' },
      group: { action: { create_group: 'create group' } },
      reticulum: {
        chat_scope: {
          direct_messages: 'DMs',
          groups: 'Groups',
          label: 'Show groups or direct messages',
        },
        dm_search: { title: 'search messages' },
        rail: { find_groups: 'Find Groups' },
        share: {
          cancel: 'cancel sharing',
          chip_label: '{{what}} to share: tap a chat to add it',
          kind_file: 'file',
          kind_link: 'link',
          kind_photo: 'photo',
          kind_text: 'text',
          kind_video: 'video',
          pick_chat: 'pick a chat',
        },
      },
    },
  },
});

const renderHeader = (
  scope: ChatScope,
  share: PreparedChatShare | null = null
) => {
  const props = {
    onScopeChange: vi.fn(),
    onFindGroups: vi.fn(),
    onCreateGroup: vi.fn(),
    onSearchMessages: vi.fn(),
    onNewChat: vi.fn(),
    onCancelShare: vi.fn(),
  };
  const ref = createRef<MobileChatListHeaderHandle>();
  const view = (next: PreparedChatShare | null) => (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={darkTheme}>
        <MobileChatListHeader
          ref={ref}
          scope={scope}
          share={next}
          {...props}
        />
      </ThemeProvider>
    </I18nextProvider>
  );
  const { rerender } = render(view(share));
  return {
    props,
    ref,
    setShare: (next: PreparedChatShare | null) => rerender(view(next)),
  };
};

const sharing = (
  overrides: Partial<PreparedChatShare> = {}
): PreparedChatShare => ({
  id: 1,
  scope: 'groups',
  text: '',
  files: new Promise<File[]>(() => undefined),
  items: [
    {
      path: '/cache/shared_media/1_IMG_2001.jpg',
      name: 'IMG_2001.jpg',
      mimeType: 'image/jpeg',
      size: 2_400_000,
    },
  ],
  notices: [],
  ...overrides,
});

/** The two stacked icons of the middle button: new group, new chat. */
const middleIcons = (name: string) => {
  const layers = screen
    .getByRole('button', { name })
    .querySelectorAll<HTMLElement>(':scope > span > span');
  return { group: layers[0], direct: layers[1] };
};

describe('MobileChatListHeader', () => {
  it('finds and starts groups on Groups', () => {
    const { props } = renderHeader('groups');

    fireEvent.click(screen.getByRole('button', { name: 'Find Groups' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    expect(props.onFindGroups).toHaveBeenCalledTimes(1);
    expect(props.onCreateGroup).toHaveBeenCalledTimes(1);
    expect(props.onSearchMessages).not.toHaveBeenCalled();
    // The onboarding tour's find-groups step points at the search button.
    expect(screen.getByRole('button', { name: 'Find Groups' })).toHaveAttribute(
      'data-tour',
      'hub-group-discovery'
    );
  });

  it('searches messages and starts chats on DMs', () => {
    const { props } = renderHeader('directs');

    fireEvent.click(screen.getByRole('button', { name: 'Search messages' }));
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));

    expect(props.onSearchMessages).toHaveBeenCalledTimes(1);
    expect(props.onNewChat).toHaveBeenCalledTimes(1);
    expect(props.onFindGroups).not.toHaveBeenCalled();
    expect(props.onCreateGroup).not.toHaveBeenCalled();
  });

  it.each(['groups', 'directs'] as const)(
    'opens the Q-Chat settings on %s',
    (scope) => {
      renderHeader(scope);
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

      expect(
        screen.getByRole('dialog', { name: 'chat settings' })
      ).toBeInTheDocument();
    }
  );

  it('cross-fades the middle icon with the pages', () => {
    const { ref } = renderHeader('groups');
    const icons = middleIcons('Create group');
    expect(icons.group.style.opacity).toBe('1');
    expect(icons.direct.style.opacity).toBe('0');

    act(() => ref.current?.setPosition(0.5));
    expect(icons.group.style.opacity).toBe('0.5');
    expect(icons.direct.style.opacity).toBe('0.5');
    expect(icons.direct.style.transition).toBe('none');

    act(() => ref.current?.setPosition(1, 240, 'ease-out'));
    expect(icons.group.style.opacity).toBe('0');
    expect(icons.direct.style.opacity).toBe('1');
    expect(icons.direct.style.transition).toContain('opacity 240ms ease-out');
  });

  it('shows a waiting share in place of the buttons', () => {
    const { props, setShare } = renderHeader('groups', sharing());

    expect(
      screen.getByRole('group', {
        name: 'Photo to share: tap a chat to add it',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('Photo')).toBeInTheDocument();
    expect(screen.getByText('Pick a chat')).toBeInTheDocument();
    // Search, new and settings are out of the way while it waits.
    expect(screen.queryByRole('button', { name: 'Find Groups' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create group' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel sharing' }));
    expect(props.onCancelShare).toHaveBeenCalledTimes(1);

    // Once it is taken (or dropped) the buttons are back, icons in place.
    setShare(null);
    expect(screen.queryByRole('group', { name: /to share/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Find Groups' })
    ).toBeInTheDocument();
    const icons = middleIcons('Create group');
    expect(icons.group.style.opacity).toBe('1');
    expect(icons.direct.style.opacity).toBe('0');
  });

  it('names a shared file, and shows a shared link itself', () => {
    const { setShare } = renderHeader(
      'directs',
      sharing({
        items: [
          {
            path: '/cache/shared_media/2_notes.pdf',
            name: 'notes.pdf',
            mimeType: 'application/pdf',
            size: 1000,
          },
        ],
      })
    );
    expect(screen.getByText('notes.pdf')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'File to share: tap a chat to add it' })
    ).toBeInTheDocument();

    setShare(sharing({ id: 2, items: [], text: 'https://qortal.dev/go' }));
    expect(screen.getByText('https://qortal.dev/go')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Link to share: tap a chat to add it' })
    ).toBeInTheDocument();
  });

  it('keeps one icon whole near either page', () => {
    expect(directIconShare(0)).toBe(0);
    expect(directIconShare(0.15)).toBe(0);
    expect(directIconShare(0.5)).toBeCloseTo(0.5);
    expect(directIconShare(0.85)).toBe(1);
    expect(directIconShare(1.2)).toBe(1);
  });
});
