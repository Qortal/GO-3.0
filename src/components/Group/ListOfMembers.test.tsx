import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
} from '../../lib/qdnAvatars/testHarness';
import ListOfMembers from './ListOfMembers';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));
vi.mock('../../background/background.ts', () => ({
  getFee: vi.fn(async () => ({ fee: '0.01' })),
}));
vi.mock('../../utils/androidBack', () => ({
  BACK_PRIORITY: { dialog: 80 },
  useAndroidBack: vi.fn(),
}));
vi.mock('../../hooks/usePresence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/usePresence')>()),
  useOnlineAddresses: () => new Set(['Qowner', 'Qadmin', 'Qmember']),
}));
vi.mock('../WrapperUserAction', () => ({
  WrapperUserAction: ({ children }) => <div>{children}</div>,
}));
vi.mock('../QortalLand/QortalLandAvailabilityTags', () => ({
  QortalLandAvailabilityTags: () => null,
}));
// jsdom has no layout, so give the virtualized list a real viewport.
vi.mock('react-virtualized', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-virtualized')>();
  return {
    ...actual,
    AutoSizer: ({ children }) => children({ height: 900, width: 400 }),
  };
});

const OWNER = 'Qowner';
const ADMIN = 'Qadmin';
const MEMBER = 'Qmember';

const members = [
  { member: OWNER, isAdmin: true, primaryName: 'Owner Name' },
  { member: ADMIN, isAdmin: true, primaryName: 'Admin Name' },
  { member: MEMBER, isAdmin: false, primaryName: 'Member Name' },
];

const renderList = ({
  viewer = OWNER,
  isOwner = true,
  isAdmin = true,
  show = vi.fn(async () => true),
  onRefreshMembers = vi.fn(),
  list = members,
  groupId = 42,
} = {}) => {
  const store = createStore();
  store.set(userInfoAtom, { address: viewer });
  const setInfoSnack = vi.fn();
  const setOpenSnack = vi.fn();
  const utils = render(
    <Provider store={store}>
      <ListOfMembers
        compact
        reticulumUserCards
        groupId={groupId}
        isAdmin={isAdmin}
        isOwner={isOwner}
        members={list}
        onRefreshMembers={onRefreshMembers}
        ownerAddress={OWNER}
        setInfoSnack={setInfoSnack}
        setOpenSnack={setOpenSnack}
        show={show}
      />
    </Provider>
  );
  return { ...utils, show, onRefreshMembers, setInfoSnack, store };
};

describe('ListOfMembers admin actions', () => {
  beforeEach(() => {
    window.sendMessage = vi.fn(async () => ({ signature: 'sig' }));
    // Avatars come from a fake node, never the network.
    setQdnAvatarCacheForTests(
      createAvatarTestHarness({
        handler: (_url, { name }) => notPublishedResponse(name),
      }).cache
    );
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    setQdnAvatarCacheForTests(null);
  });

  it('gives the owner a make-admin and a menu button on regular members only', () => {
    renderList();
    expect(
      screen.getByRole('button', { name: 'Make Member Name an admin' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Admin Name as admin' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions for Member Name' })
    ).toBeInTheDocument();
    // Nothing on the owner's own row.
    expect(
      screen.queryByRole('button', {
        name: /Owner Name (an|as) admin|More actions for Owner Name/,
      })
    ).not.toBeInTheDocument();
  });

  it('shows no actions to a regular member', () => {
    renderList({ viewer: MEMBER, isOwner: false, isAdmin: false });
    expect(
      screen.queryByRole('button', { name: /an admin|as admin|More actions/ })
    ).not.toBeInTheDocument();
  });

  it('lets a non-owner admin open kick and ban for a regular member', async () => {
    renderList({ viewer: ADMIN, isOwner: false });
    expect(
      screen.queryByRole('button', { name: /an admin|as admin/ })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for Member Name' })
    );
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent('Kick member from group');
    expect(menu).toHaveTextContent('Ban member from group');
    expect(menu).not.toHaveTextContent('Make an admin');
  });

  it('confirms the fee, sends makeAdmin and marks the row pending until the list shows the admin', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { show, onRefreshMembers, rerender, store } = renderList();
    fireEvent.click(
      screen.getByRole('button', { name: 'Make Member Name an admin' })
    );
    await waitFor(() =>
      expect(window.sendMessage).toHaveBeenCalledWith('makeAdmin', {
        groupId: 42,
        qortalAddress: MEMBER,
      })
    );
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ publishFee: '0.01 QORT' })
    );
    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Make Member Name an admin' })
    ).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(onRefreshMembers).toHaveBeenCalled();

    // Core now reports the promotion: the row flips to "remove admin".
    rerender(
      <Provider store={store}>
        <ListOfMembers
          compact
          reticulumUserCards
          groupId={42}
          isAdmin
          isOwner
          members={members.map((member) =>
            member.member === MEMBER ? { ...member, isAdmin: true } : member
          )}
          onRefreshMembers={onRefreshMembers}
          ownerAddress={OWNER}
          setInfoSnack={vi.fn()}
          setOpenSnack={vi.fn()}
          show={show}
        />
      </Provider>
    );
    await waitFor(() =>
      expect(screen.queryByText('Pending')).not.toBeInTheDocument()
    );
    expect(
      screen.getByRole('button', { name: 'Remove Member Name as admin' })
    ).toBeInTheDocument();
  });

  it('keeps showing pending after the list is closed and reopened', async () => {
    const first = renderList({ groupId: 43 });
    fireEvent.click(
      screen.getByRole('button', { name: 'Make Member Name an admin' })
    );
    expect(await screen.findByText('Pending')).toBeInTheDocument();
    first.unmount();

    renderList({ groupId: 43 });
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Make Member Name an admin' })
    ).not.toBeInTheDocument();
  });

  it('sends nothing when the fee confirmation is declined', async () => {
    const show = vi.fn(async () => {
      throw { isCanceled: true };
    });
    const { setInfoSnack } = renderList({ show });
    fireEvent.click(
      screen.getByRole('button', { name: 'Make Member Name an admin' })
    );
    await waitFor(() => expect(show).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Make Member Name an admin' })
      ).toBeEnabled()
    );
    expect(window.sendMessage).not.toHaveBeenCalled();
    expect(setInfoSnack).not.toHaveBeenCalled();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('reports a Core rejection and does not mark the row pending', async () => {
    window.sendMessage = vi.fn(async () => ({ error: 'INVALID_GROUP_OWNER' }));
    const { setInfoSnack } = renderList();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Admin Name as admin' })
    );
    await waitFor(() =>
      expect(setInfoSnack).toHaveBeenCalledWith({
        type: 'error',
        message: 'INVALID_GROUP_OWNER',
      })
    );
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });
});

describe('ListOfMembers avatars', () => {
  afterEach(() => {
    setQdnAvatarCacheForTests(null);
  });

  it('shows cached avatars and keeps the letter for members without one', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { name }) =>
        name === 'Owner Name' ? imageResponse() : notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = renderList();
    await act(async () => {
      await flushAsync();
    });

    const ownerImg = container.querySelector('img[alt="Owner Name"]');
    expect(ownerImg?.getAttribute('src')).toBe('blob:test/1');
    expect(container.querySelector('img[alt="Member Name"]')).toBeNull();
    expect(
      container.querySelector('[data-qdn-avatar="missing"]')?.textContent
    ).toBe('A');
    expect(new Set(h.calls.map((call) => call.name))).toEqual(
      new Set(['Owner Name', 'Admin Name', 'Member Name'])
    );
  });
});

describe('ListOfMembers search focus', () => {
  const originalScrollTo = HTMLElement.prototype.scrollTo;

  beforeEach(() => {
    setQdnAvatarCacheForTests(
      createAvatarTestHarness({
        handler: (_url, { name }) => notPublishedResponse(name),
      }).cache
    );
  });
  afterEach(() => {
    HTMLElement.prototype.scrollTo = originalScrollTo;
    vi.useRealTimers();
    setQdnAvatarCacheForTests(null);
  });

  const renderFocusable = () => {
    const store = createStore();
    store.set(userInfoAtom, { address: MEMBER });
    const ui = (focusMemberRequest = null) => (
      <Provider store={store}>
        <ListOfMembers
          compact
          reticulumUserCards
          focusMemberRequest={focusMemberRequest}
          groupId={42}
          members={members}
          ownerAddress={OWNER}
          setInfoSnack={vi.fn()}
          setOpenSnack={vi.fn()}
          show={vi.fn()}
        />
      </Provider>
    );
    const utils = render(ui());
    return {
      ...utils,
      focus: (address: string, nonce: number) =>
        utils.rerender(ui({ address, nonce })),
    };
  };

  it('unfolds the member’s section, scrolls to them and marks the row briefly', () => {
    vi.useFakeTimers();
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    const { container, focus } = renderFocusable();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse members' }));
    expect(screen.queryByText('Member Name')).toBeNull();

    focus(MEMBER, 1);

    expect(screen.getByText('Member Name')).toBeInTheDocument();
    const marked = container.querySelector('[data-member-focus="true"]');
    expect(marked).toHaveTextContent('Member Name');
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' })
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(container.querySelector('[data-member-focus="true"]')).toBeNull();
  });

  it('asks again for the same member with a new nonce', () => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    const { focus } = renderFocusable();

    focus(ADMIN, 1);
    focus(ADMIN, 1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    focus(ADMIN, 2);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
