import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadShareChannelBundle,
  noWritableShareChannel,
  normalizeShareChannelId,
  shareChannelSections,
  shareChannelStep,
  SHARE_CHANNEL_RETRY_DELAYS_MS,
  type ShareChannelLike,
} from './chatShareChannels';

const channel = (
  channelId: string,
  extra: Partial<ShareChannelLike> = {}
): ShareChannelLike => ({
  channelId,
  name: channelId,
  position: 0,
  archived: false,
  ...extra,
});

const ids = (sections: ReturnType<typeof shareChannelSections>) =>
  sections.map((section) => ({
    categoryId: section.categoryId,
    name: section.name,
    rows: section.rows.map(
      (row) => `${row.channel.channelId}${row.canWrite ? '' : ' (admins)'}`
    ),
  }));

const asMember = { isAdmin: false, defaultCategoryName: 'Channels' };
const asAdmin = { isAdmin: true, defaultCategoryName: 'Channels' };

describe('shareChannelSections', () => {
  it('lists the channels as the group shows them, by category', () => {
    const sections = shareChannelSections(
      {
        channels: [
          channel('dev', { categoryId: 'cat-build', position: 1 }),
          channel('general', { position: 0 }),
          channel('builds', { categoryId: 'cat-build', position: 0 }),
          channel('random', { position: 2 }),
          channel('lost', { categoryId: 'cat-gone', position: 1 }),
        ],
        categories: [
          { categoryId: 'cat-build', name: 'Build' },
          { categoryId: 'cat-empty', name: 'Nothing here' },
        ],
      },
      asMember
    );
    expect(ids(sections)).toEqual([
      // A channel of an unknown category sits in the default one.
      { categoryId: '', name: 'Channels', rows: ['general', 'lost', 'random'] },
      { categoryId: 'cat-build', name: 'Build', rows: ['builds', 'dev'] },
    ]);
  });

  it('leaves out archived channels and, for members, admins-only ones', () => {
    const bundle = {
      channels: [
        channel('general'),
        channel('old', { archived: true, position: 1 }),
        channel('admins', { readMode: 'admins', position: 2 }),
      ],
    };
    expect(ids(shareChannelSections(bundle, asMember))[0].rows).toEqual([
      'general',
    ]);
    expect(ids(shareChannelSections(bundle, asAdmin))[0].rows).toEqual([
      'general',
      'admins',
    ]);
  });

  it('marks channels only admins post in', () => {
    const bundle = {
      channels: [
        channel('general'),
        channel('news', { writeMode: 'admins', position: 1 }),
      ],
    };
    expect(ids(shareChannelSections(bundle, asMember))[0].rows).toEqual([
      'general',
      'news (admins)',
    ]);
    expect(ids(shareChannelSections(bundle, asAdmin))[0].rows).toEqual([
      'general',
      'news',
    ]);
  });

  it("uses the default category's own name, or hides it as the group does", () => {
    const named = shareChannelSections(
      {
        channels: [channel('general')],
        categories: [{ categoryId: 'cat-qchat-default', name: 'Lobby' }],
      },
      asMember
    );
    expect(named[0].name).toBe('Lobby');

    const hidden = {
      channels: [channel('chat'), channel('more', { categoryId: 'cat-x' })],
      categories: [
        {
          categoryId: 'cat-qchat-default',
          name: 'QCHAT_DEFAULT_CATEGORY_HIDDEN',
        },
        { categoryId: 'cat-x', name: 'More' },
      ],
    };
    expect(shareChannelSections(hidden, asMember)[0].name).toBeNull();

    // General keeps the header, under the fallback name.
    const withGeneral = {
      ...hidden,
      channels: [channel('general'), ...hidden.channels],
    };
    expect(shareChannelSections(withGeneral, asMember)[0].name).toBe(
      'Channels'
    );
  });

  it('copes with nothing known', () => {
    expect(shareChannelSections(null, asMember)).toEqual([]);
    expect(shareChannelSections({ channels: [] }, asMember)).toEqual([]);
  });
});

describe('shareChannelStep', () => {
  it('asks when more than one channel can take the share', () => {
    const sections = shareChannelSections(
      { channels: [channel('general'), channel('dev', { position: 1 })] },
      asMember
    );
    expect(shareChannelStep(sections)).toEqual({ kind: 'pick' });
  });

  it('goes straight in when one channel can take it', () => {
    const only = shareChannelSections(
      { channels: [channel('general')] },
      asMember
    );
    expect(shareChannelStep(only)).toEqual({
      kind: 'direct',
      channelId: 'general',
    });
    // An announcements channel only admins post in does not count.
    const withNews = shareChannelSections(
      {
        channels: [
          channel('general'),
          channel('news', { writeMode: 'admins', position: 1 }),
        ],
      },
      asMember
    );
    expect(shareChannelStep(withNews)).toEqual({
      kind: 'direct',
      channelId: 'general',
    });
    // ...but an admin can post there, so an admin is asked.
    expect(
      shareChannelStep(
        shareChannelSections(
          {
            channels: [
              channel('general'),
              channel('news', { writeMode: 'admins', position: 1 }),
            ],
          },
          asAdmin
        )
      )
    ).toEqual({ kind: 'pick' });
  });

  it('opens the group as before when its channels are not known', () => {
    expect(shareChannelStep([])).toEqual({ kind: 'direct', channelId: null });
  });

  it('shows the channels, all greyed out, when none can take it', () => {
    const sections = shareChannelSections(
      {
        channels: [
          channel('news', { writeMode: 'admins' }),
          channel('rules', { writeMode: 'admins', position: 1 }),
        ],
      },
      asMember
    );
    expect(shareChannelStep(sections)).toEqual({ kind: 'pick' });
    expect(noWritableShareChannel(sections)).toBe(true);
    expect(noWritableShareChannel([])).toBe(false);
  });
});

describe('loadShareChannelBundle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes once and returns the signed layout', async () => {
    const source = {
      subscribeGroup: vi.fn(),
      getChannelMetadataBundle: vi.fn(() => ({
        channels: [channel('general')],
        categories: [],
        ready: true,
      })),
    };
    const bundle = await loadShareChannelBundle(7, () => false, source);
    expect(bundle?.channels?.[0].channelId).toBe('general');
    expect(source.subscribeGroup).toHaveBeenCalledWith(7);
    expect(source.getChannelMetadataBundle).toHaveBeenCalledTimes(1);
  });

  it('waits for the layout, then keeps the last one seen', async () => {
    vi.useFakeTimers();
    const source = {
      getChannelMetadataBundle: vi
        .fn()
        .mockReturnValueOnce({ channels: [], ready: false })
        .mockReturnValue({ channels: [channel('general')], ready: false }),
    };
    const loading = loadShareChannelBundle(7, () => false, source);
    await vi.runAllTimersAsync();
    const bundle = await loading;
    expect(bundle?.channels).toHaveLength(1);
    expect(source.getChannelMetadataBundle).toHaveBeenCalledTimes(
      SHARE_CHANNEL_RETRY_DELAYS_MS.length
    );
  });

  it('stops when cancelled, and without a source or a group', async () => {
    let cancelled = false;
    const source = {
      getChannelMetadataBundle: vi.fn(() => {
        cancelled = true;
        return { channels: [channel('general')], ready: false };
      }),
    };
    expect(await loadShareChannelBundle(7, () => cancelled, source)).toBe(null);
    expect(await loadShareChannelBundle(7, () => false, {})).toBeNull();
    expect(await loadShareChannelBundle(0, () => false, source)).toBeNull();
  });

  it('tries again after a failed read', async () => {
    vi.useFakeTimers();
    const source = {
      getChannelMetadataBundle: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('not a member yet');
        })
        .mockReturnValue({ channels: [channel('general')], ready: true }),
    };
    const loading = loadShareChannelBundle(7, () => false, source);
    await vi.runAllTimersAsync();
    expect((await loading)?.ready).toBe(true);
  });
});

describe('normalizeShareChannelId', () => {
  it('matches the summaries to the channels like the group chat', () => {
    expect(normalizeShareChannelId(' Off Topic ')).toBe('off-topic');
    expect(normalizeShareChannelId('')).toBe('');
  });
});
