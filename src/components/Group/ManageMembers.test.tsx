import { createContext } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
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
  default: ({ members }) => (
    <div data-testid="member-list">{members.length} members</div>
  ),
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
