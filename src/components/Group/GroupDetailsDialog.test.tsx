import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { darkTheme } from '../../styles/theme-dark';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
} from '../../lib/qdnAvatars/testHarness';
import { ensureAvatarPresence } from '../../utils/groupMemberAvatars';
import {
  EAGER_MEMBER_AVATARS,
  GroupDetailsDialog,
  isEagerPersonRow,
  personAvatarPriority,
  shouldLookUpPersonAvatar,
} from './GroupDetailsDialog';
import { getGroupAdmins, getGroupMembers } from './groupApi';

const presence = new Map<string, boolean>();

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node:12391',
}));
vi.mock('../../utils/groupMemberAvatars', () => ({
  ensureAvatarPresence: vi.fn(),
  getAvatarPresence: (name?: string | null) =>
    presence.get((name ?? '').trim().toLowerCase()),
}));

const memberName = (i: number) => `Member${String(i).padStart(2, '0')}`;
const MEMBER_COUNT = 25;
// Owner and admin rows come first and count toward the eager rows.
const EAGER_MEMBERS = EAGER_MEMBER_AVATARS - 2;

vi.mock('./groupApi', () => ({
  getGroupMembers: vi.fn(async () => ({
    members: [
      { member: 'Qowner', primaryName: 'Owner', joined: 1 },
      { member: 'Qadmin', primaryName: 'Admin1', joined: 2 },
      ...Array.from({ length: MEMBER_COUNT }, (_, i) => ({
        member: `Q${i + 1}`,
        primaryName: memberName(i + 1),
        // Newest first: Member01 joined last.
        joined: 1000 - i,
      })),
    ],
  })),
  getGroupAdmins: vi.fn(async () => ({
    both: [{ name: 'Admin1', address: 'Qadmin', joined: 2 }],
  })),
}));

const settle = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await flushAsync();
    });
  }
};

beforeEach(() => {
  presence.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ owner: 'Qowner', memberCount: MEMBER_COUNT + 2 }),
    }))
  );
});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
  vi.unstubAllGlobals();
});

const dialog = (open = true) => (
  <ThemeProvider theme={darkTheme}>
    <GroupDetailsDialog
      open={open}
      onClose={() => {}}
      groupId={5}
      groupName="Test Group"
      ownerName="Owner"
      isPrivate={false}
    />
  </ThemeProvider>
);

const renderDialog = () => render(dialog());

const askedNames = (calls: { url: string; name: string }[]) =>
  new Set(
    calls
      .filter((call) => call.url.includes('/qortal_avatar'))
      .map((call) => call.name)
  );

describe('GroupDetailsDialog avatars', () => {
  it('looks up the first rows at once and further rows only when the node lists an avatar', async () => {
    presence.set(memberName(25).toLowerCase(), true);
    presence.set(memberName(24).toLowerCase(), false);
    // An eager row the presence search already found without an avatar.
    presence.set(memberName(3).toLowerCase(), false);
    const h = createAvatarTestHarness({
      handler: (_url, { name }) => notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);

    renderDialog();
    await settle();

    const expected = new Set([
      'Owner',
      'Admin1',
      ...Array.from({ length: EAGER_MEMBERS }, (_, i) => memberName(i + 1)),
      memberName(25),
    ]);
    expected.delete(memberName(3));
    expect(askedNames(h.calls)).toEqual(expected);
    expect(screen.getByText(memberName(23))).toBeTruthy();
    expect(screen.getByText(memberName(3))).toBeTruthy();
  });

  it('counts many admins toward the eager rows', async () => {
    const adminCount = EAGER_MEMBER_AVATARS + 5;
    const adminName = (i: number) => `Admin${String(i).padStart(2, '0')}`;
    const manyAdmins = Array.from({ length: adminCount }, (_, i) => ({
      name: adminName(i + 1),
      address: `Qa${i + 1}`,
      // Newest first: Admin01 joined last.
      joined: 500 - i,
    }));
    vi.mocked(getGroupAdmins).mockResolvedValueOnce({
      both: manyAdmins,
    } as never);
    vi.mocked(getGroupMembers).mockResolvedValueOnce({
      members: [
        { member: 'Qowner', primaryName: 'Owner', joined: 1 },
        ...manyAdmins.map((a) => ({
          member: a.address,
          primaryName: a.name,
          joined: a.joined,
        })),
        { member: 'Qm1', primaryName: memberName(1), joined: 1000 },
      ],
    } as never);
    const h = createAvatarTestHarness({
      handler: (_url, { name }) => notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);

    renderDialog();
    await settle();

    expect(askedNames(h.calls)).toEqual(
      new Set([
        'Owner',
        ...Array.from({ length: EAGER_MEMBER_AVATARS - 1 }, (_, i) =>
          adminName(i + 1)
        ),
      ])
    );
    expect(screen.getByText(adminName(adminCount))).toBeTruthy();
    expect(screen.getByText(memberName(1))).toBeTruthy();
  });

  it('loads the owner and the first members before rows found later by the presence search', async () => {
    // One request answered at a time, in the order the cache asks.
    const pending: { name: string; resolve: (r: Response) => void }[] = [];
    const h = createAvatarTestHarness({
      handler: (url, { name }) =>
        url.includes('/qortal_avatar')
          ? new Promise<Response>((resolve) => pending.push({ name, resolve }))
          : notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);

    renderDialog();
    await settle();

    // The presence search then lists every lower member as having an avatar.
    for (let i = EAGER_MEMBERS + 1; i <= MEMBER_COUNT; i += 1) {
      presence.set(memberName(i).toLowerCase(), true);
    }
    const presenceCalls = vi.mocked(ensureAvatarPresence).mock.calls;
    const refresh = presenceCalls[presenceCalls.length - 1]?.[1];
    expect(refresh).toBeTypeOf('function');
    await act(async () => {
      refresh?.();
    });
    await settle(2);

    const order: string[] = [];
    for (let guard = 0; guard < 100 && pending.length > 0; guard += 1) {
      const next = pending.shift();
      if (!next) break;
      order.push(next.name);
      next.resolve(imageResponse());
      await settle(2);
    }

    const eagerNames = [
      'Owner',
      'Admin1',
      ...Array.from({ length: EAGER_MEMBERS }, (_, i) => memberName(i + 1)),
    ];
    const lowerNames = Array.from(
      { length: MEMBER_COUNT - EAGER_MEMBERS },
      (_, i) => memberName(EAGER_MEMBERS + i + 1)
    );
    expect(new Set(order)).toEqual(new Set([...eagerNames, ...lowerNames]));
    const lastEager = Math.max(...eagerNames.map((n) => order.indexOf(n)));
    const firstLower = Math.min(...lowerNames.map((n) => order.indexOf(n)));
    expect(lastEager).toBeLessThan(firstLower);
    // The owner goes before the other rows.
    const others = [...eagerNames.slice(1), ...lowerNames];
    expect(order.indexOf('Owner')).toBeLessThan(
      Math.min(...others.map((n) => order.indexOf(n)))
    );
  });

  it('shows the cached group avatar at once and previews it while the full size loads', async () => {
    const h = createAvatarTestHarness({
      handler: (url, { name }) =>
        url.includes('qortal_group_avatar_5')
          ? imageResponse()
          : notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);

    renderDialog();
    await settle();

    // jsdom never loads the full-size image: the cached copy stays.
    const groupAvatar = screen.getByAltText('Test Group');
    expect(groupAvatar.getAttribute('src')).toBe('blob:test/1');
    fireEvent.click(groupAvatar);
    const preview = screen
      .getAllByAltText('Test Group')
      .find((img) => img !== groupAvatar);
    expect(preview?.getAttribute('src')).toBe('blob:test/1');
  });

  it('keeps the cached copy in the header and loads the full size only for the preview', async () => {
    const loaded: string[] = [];
    class LoadingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = 'auto';
      set src(value: string) {
        loaded.push(value);
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', LoadingImage);
    const h = createAvatarTestHarness({
      handler: (url, { name }) =>
        url.includes('qortal_group_avatar_5')
          ? imageResponse()
          : notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);

    renderDialog();
    await settle();

    const full =
      'http://node:12391/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_5';
    // (MUI's Avatar also checks each src it gets with an Image.)
    expect(loaded).not.toContain(full);
    const groupAvatar = screen.getByAltText('Test Group');
    expect(groupAvatar.getAttribute('src')).toBe('blob:test/1');
    fireEvent.click(groupAvatar);
    expect(loaded).toContain(full);
    await settle(2);
    const preview = screen
      .getAllByAltText('Test Group')
      .find((img) => img !== groupAvatar);
    expect(preview?.getAttribute('src')).toBe(full);
    // The header stays the cached copy.
    expect(groupAvatar.getAttribute('src')).toBe('blob:test/1');
  });

  it('does not reopen a preview left open when the dialog closed', async () => {
    const h = createAvatarTestHarness({
      handler: (url, { name }) =>
        url.includes('qortal_group_avatar_5')
          ? imageResponse()
          : notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);

    const view = renderDialog();
    await settle();
    fireEvent.click(screen.getByAltText('Test Group'));
    expect(screen.getAllByAltText('Test Group')).toHaveLength(2);

    // Closed with the preview still open (e.g. Android back), then reopened.
    view.rerender(dialog(false));
    await settle(2);
    view.rerender(dialog(true));
    await settle();
    expect(screen.getAllByAltText('Test Group')).toHaveLength(1);
  });

  it('keeps the letter and no preview while there is no group avatar', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { name }) => notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);

    renderDialog();
    await settle();

    expect(screen.queryByAltText('Test Group')).toBeNull();
    const letter = screen.getAllByText('T')[0];
    fireEvent.click(letter);
    expect(screen.queryByAltText('Test Group')).toBeNull();
  });
});

describe('isEagerPersonRow', () => {
  it('covers the first rows only', () => {
    expect(isEagerPersonRow(0)).toBe(true);
    expect(isEagerPersonRow(EAGER_MEMBER_AVATARS - 1)).toBe(true);
    expect(isEagerPersonRow(EAGER_MEMBER_AVATARS)).toBe(false);
    expect(isEagerPersonRow(-1)).toBe(false);
  });
});

describe('personAvatarPriority', () => {
  it('puts the owner first and presence-only rows last', () => {
    expect(personAvatarPriority({ role: 'owner', eager: true })).toBe('high');
    expect(personAvatarPriority({ role: 'admin', eager: true })).toBe('normal');
    expect(personAvatarPriority({ role: 'admin', eager: false })).toBe('low');
    expect(personAvatarPriority({ role: 'member', eager: true })).toBe(
      'normal'
    );
    expect(personAvatarPriority({ role: 'member', eager: false })).toBe('low');
  });
});

describe('shouldLookUpPersonAvatar', () => {
  beforeEach(() => presence.clear());

  it('needs a name', () => {
    expect(shouldLookUpPersonAvatar(undefined, true)).toBe(false);
    expect(shouldLookUpPersonAvatar('  ', true)).toBe(false);
  });

  it('looks up eager rows, and later rows only with a known avatar', () => {
    presence.set('alice', true);
    presence.set('bob', false);
    expect(shouldLookUpPersonAvatar('Carol', true)).toBe(true);
    expect(shouldLookUpPersonAvatar('Carol', false)).toBe(false);
    expect(shouldLookUpPersonAvatar('Alice', true)).toBe(true);
    expect(shouldLookUpPersonAvatar('Alice', false)).toBe(true);
    // The node already said Bob has no avatar: not even an eager row asks.
    expect(shouldLookUpPersonAvatar('Bob', true)).toBe(false);
    expect(shouldLookUpPersonAvatar('Bob', false)).toBe(false);
  });
});
