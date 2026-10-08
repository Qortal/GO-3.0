import { createContext } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import { getGroupMembers } from './groupApi';
import { ManageMembers } from './ManageMembers';

vi.mock('../../App', () => ({
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
  getBaseApiReact: () => 'http://localhost:12391',
}));
vi.mock('./groupApi', () => ({
  getGroupMembers: vi.fn(async () => ({
    members: [{ member: 'Qa' }, { member: 'Qb' }, { member: 'Qc' }],
  })),
  getNames: vi.fn(),
}));
vi.mock('./ListOfMembers', () => ({
  default: ({ members, focusMemberRequest }) => (
    <div
      data-testid="member-list"
      data-focus-address={focusMemberRequest?.address ?? ''}
      data-focus-nonce={focusMemberRequest?.nonce ?? ''}
    >
      {members.length} members
    </div>
  ),
}));
vi.mock('./CachedAvatars', () => ({
  CachedUserAvatar: () => <span aria-hidden />,
}));

const renderInline = (props = {}) =>
  render(
    <ManageMembers
      inline
      reticulumSidebar
      open
      setOpen={vi.fn()}
      selectedGroup={{ groupId: 7, groupName: 'GO 3.0' }}
      isAdmin={false}
      isOwner={false}
      {...props}
    />
  );

describe('ManageMembers phone screen header', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the title, the member count and a close X', async () => {
    global.fetch = vi.fn(async () => ({ json: async () => ({}) })) as never;
    const onClose = vi.fn();
    renderInline({ onClose });
    expect(screen.getByRole('heading', { name: 'Members' })).toBeVisible();
    await waitFor(() => expect(screen.getByText('3')).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('titles the header after the open tab for admins', async () => {
    global.fetch = vi.fn(async () => ({ json: async () => ({}) })) as never;
    renderInline({ onClose: vi.fn(), isAdmin: true });
    fireEvent.click(screen.getByRole('tab', { name: 'Bans' }));
    expect(screen.getByRole('heading', { name: 'Bans' })).toBeVisible();
  });

  it('keeps the desktop rail without a header', () => {
    global.fetch = vi.fn(async () => ({ json: async () => ({}) })) as never;
    renderInline();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Members' })).toBeNull();
  });
});

describe('ManageMembers phone member search', () => {
  const named = [
    'Alice',
    'Alan',
    'Big Al',
    'Salma',
    'Kalle',
    'Hal',
    'Val',
    'Sal',
    'Opal',
    'Coral',
    'Bob',
  ].map((primaryName, index) => ({
    member: `Q${primaryName.replace(' ', '')}${index}`,
    primaryName,
    isAdmin: primaryName === 'Alan',
  }));

  const openSearch = async () => {
    vi.mocked(getGroupMembers).mockResolvedValueOnce({ members: named });
    global.fetch = vi.fn(async () => ({ json: async () => ({}) })) as never;
    renderInline({ onClose: vi.fn() });
    await waitFor(() => expect(screen.getByText('11')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Search members' }));
    return screen.getByRole('combobox', { name: 'Search members' });
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens a focused field from the header and suggests ranked matches', async () => {
    const field = await openSearch();
    expect(field).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(field, { target: { value: 'al' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(8);
    // Name starts first, then a word start, then names containing it.
    expect(options[0]).toHaveTextContent('Alan');
    expect(options[0]).toHaveTextContent('Admin');
    expect(options[1]).toHaveTextContent('Alice');
    expect(options[2]).toHaveTextContent('Big Al');
    expect(options[3]).toHaveTextContent('Coral');
    expect(screen.getByText('2 more')).toBeVisible();
    expect(screen.queryByText('Bob')).toBeNull();
  });

  it('closes the search on a pick and asks the list to focus that member', async () => {
    const field = await openSearch();
    fireEvent.change(field, { target: { value: 'big' } });
    fireEvent.click(screen.getByRole('option', { name: /Big Al/ }));

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('member-list')).toHaveAttribute(
      'data-focus-address',
      'QBigAl2'
    );
  });

  it('picks the first suggestion on Enter', async () => {
    const field = await openSearch();
    fireEvent.change(field, { target: { value: 'sal' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('member-list')).toHaveAttribute(
      'data-focus-address',
      'QSal7'
    );
  });

  it('says when nothing matches and closes on back', async () => {
    const field = await openSearch();
    fireEvent.change(field, { target: { value: 'zzz' } });
    expect(screen.getByText('No members match')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(field).toHaveValue('');

    act(() => {
      window.dispatchEvent(
        new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true })
      );
    });
    expect(screen.queryByRole('combobox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Search members' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    // Back now reaches the Members screen again, not the search.
    expect(screen.getByRole('heading', { name: 'Members' })).toBeVisible();
  });

  it('offers no search on the desktop rail', () => {
    global.fetch = vi.fn(async () => ({ json: async () => ({}) })) as never;
    renderInline();
    expect(screen.queryByRole('button', { name: 'Search members' })).toBeNull();
  });
});
