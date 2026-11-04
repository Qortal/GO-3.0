import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { ListOfBans } from './ListOfBans';
import { NULL_OWNER_ADDRESS } from './memberAdminActions';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));
vi.mock('../../background/background.ts', () => ({
  getFee: vi.fn(async () => ({ fee: '0.01' })),
}));
vi.mock('./groupApi', () => ({
  getNameInfo: vi.fn(async () => 'Banned Name'),
}));
vi.mock('./CachedAvatars', () => ({
  CachedUserAvatar: () => null,
}));
// jsdom has no layout, so give the virtualized list a real viewport.
vi.mock('react-virtualized', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-virtualized')>();
  return {
    ...actual,
    AutoSizer: ({ children }) => children({ height: 600, width: 400 }),
  };
});

const OWNER = 'Qowner';

const renderBans = (props = {}) =>
  render(
    <ListOfBans
      compact
      groupId={42}
      setInfoSnack={vi.fn()}
      setOpenSnack={vi.fn()}
      show={vi.fn(async () => true)}
      {...props}
    />
  );

describe('ListOfBans', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => [{ offender: 'Qbanned', groupId: 42 }],
      }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('lets the owner lift a ban', async () => {
    renderBans({ isOwner: true, isAdmin: true, ownerAddress: OWNER });
    expect(await screen.findByText('Banned Name')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Cancel ban' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/group owner|no owner/)).not.toBeInTheDocument();
  });

  it('shows an admin the bans but no unban, and says only the owner can', async () => {
    renderBans({ isOwner: false, isAdmin: true, ownerAddress: OWNER });
    expect(await screen.findByText('Banned Name')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel ban' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Only the group owner can lift bans.')
    ).toBeInTheDocument();
  });

  it('says lifting a ban needs approval in an ownerless group', async () => {
    renderBans({
      isOwner: false,
      isAdmin: true,
      ownerAddress: NULL_OWNER_ADDRESS,
    });
    expect(await screen.findByText('Banned Name')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel ban' })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/This group has no owner/)).toBeInTheDocument();
  });
});
