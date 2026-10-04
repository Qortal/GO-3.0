/**
 * Dev-only preview of a group's chat header and channel list on phones, next
 * to the desktop sidebar, with the real components from ChatGroup.tsx and
 * mock data. Run `npm run dev` and open /tools/preview/group-channels.html.
 * Not a build input, so it never ships.
 *
 * Phone chat header: the real group/channel opener between stand-ins for the
 * back arrow and the call/search/more buttons, all sized from
 * RETICULUM_PHONE_CHAT_HEADER as in ChatGroup. Each frame prints the channel
 * name's measured width against reticulumPhoneChatHeaderWidths.
 *
 * Channel list: the real rows, the default category's header and the
 * sortable categories. "admin" turns on reordering with the app's own
 * sensors and tap/drag rules: drag with the mouse, or (touch emulation in
 * devtools) hold a row still for 300ms first. A held tap still selects the
 * channel. "tour anchor" outlines the box the onboarding tour points at; it
 * should sit on the first channel row. The group-name bar above the list is
 * a stand-in (it lives inline in ChatGroup).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Avatar,
  Box,
  Chip,
  CssBaseline,
  IconButton,
  useTheme,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CallIcon from '@mui/icons-material/Call';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import i18n from '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import {
  ReticulumCategoryHeader,
  ReticulumPhoneChannelOpener,
  ReticulumSortableCategory,
  ReticulumSortableChannelButton,
} from '../../src/components/Chat/ChatGroup';
import {
  createReticulumChannelDragTracker,
  RETICULUM_CHANNEL_POINTER_DRAG_DISTANCE_PX,
  RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS,
  RETICULUM_CHANNEL_TOUCH_DRAG_TOLERANCE_PX,
  ReticulumMousePointerSensor,
} from '../../src/components/Chat/reticulumChannelDragSensors';
import {
  RETICULUM_CATEGORY_CONTENT_GAP_PX,
  RETICULUM_CHANNEL_DRAWER_PHONE_MAX_WIDTH,
  RETICULUM_CHANNEL_DRAWER_PHONE_WIDTH_PX,
  RETICULUM_CHANNEL_LIST_HEADER_PX,
  reticulumChannelListPadding,
  reticulumOnboardingChannelAnchor,
  type ReticulumTextScale,
} from '../../src/components/Chat/reticulumChannelListLayout';
import {
  RETICULUM_PHONE_CHAT_HEADER,
  reticulumPhoneChatHeaderWidths,
} from '../../src/components/Chat/reticulumGroupChatHeaderLayout';
import { reticulumSearchChipSx } from '../../src/components/Chat/reticulumSearchChipSx';

// English for the keys this change adds, until they are in the locale files
// (an existing value always wins).
i18n.addResourceBundle(
  'en',
  'group',
  {
    chat_group: {
      back_to_groups: 'Back to groups',
      category_label: '{{name}} category',
      channel_auto_delete: 'Messages auto-delete in {{duration}}',
      show_channels: 'Show channels',
      unread_mentions_count_one: '{{count}} unread mention',
      unread_mentions_count_other: '{{count}} unread mentions',
      unread_replies_count_one: '{{count}} unread reply',
      unread_replies_count_other: '{{count}} unread replies',
      calendar_short: 'Calendar',
      land_short: 'Land',
      more_group_actions: 'More group actions',
    },
  },
  true,
  false
);

// ChatGroup's drag ids (reticulumChannelDragId / reticulumCategoryDragId).
const CHANNEL_DRAG_PREFIX = 'reticulum-channel:';
const channelIdOf = (id: unknown) =>
  typeof id === 'string' && id.startsWith(CHANNEL_DRAG_PREFIX)
    ? id.slice(CHANNEL_DRAG_PREFIX.length)
    : '';

const NOW = Date.now();
const DAY = 86_400_000;

type Channel = Parameters<typeof ReticulumSortableChannelButton>[0]['channel'];
type Category = Parameters<typeof ReticulumSortableCategory>[0]['category'];

const channel = (
  channelId: string,
  name: string,
  categoryId = '',
  extra: Partial<Channel> = {}
): Channel => ({
  archived: false,
  categoryId,
  channelId,
  createdAt: NOW,
  createdBy: 'preview',
  groupId: 9001,
  name,
  position: 0,
  updatedAt: NOW,
  ...extra,
});

const category = (categoryId: string, name: string): Category => ({
  categoryId,
  createdAt: NOW,
  createdBy: 'preview',
  groupId: 9001,
  name,
  position: 0,
  updatedAt: NOW,
});

const DEFAULT_CATEGORY_NAMES = {
  long: 'Text channels for the whole community',
  short: 'Text channels',
};
const CATEGORIES = [
  category('community', 'Community'),
  category('projects', 'Projects with a long category name'),
];

const INITIAL_CHANNELS: Record<string, Channel[]> = {
  '': [
    channel('general', 'general'),
    channel('announcements', 'announcements', '', { writeMode: 'admins' }),
    channel('random', 'random', '', { expiryDurationMs: DAY }),
  ],
  community: [
    channel('help', 'help-and-questions', 'community'),
    channel('show', 'show-and-tell-with-a-much-longer-name', 'community'),
    channel('mods', 'moderators', 'community', { readMode: 'admins' }),
  ],
  projects: [
    channel('torq', 'torq', 'projects'),
    channel('go', 'qortal-go', 'projects', { expiryDurationMs: 7 * DAY }),
  ],
};

const BADGES: Record<
  string,
  { mentions?: number; replies?: number; unread?: number }
> = {
  announcements: { unread: 4 },
  help: { mentions: 2, unread: 3 },
  show: { replies: 3, unread: 1 },
  torq: { mentions: 1, unread: 1 },
  go: { unread: 2 },
};

type ListState = {
  admin: boolean;
  channels: Record<string, Channel[]>;
  collapsed: Set<string>;
  longDefaultName: boolean;
  scale: ReticulumTextScale;
  selected: string;
  showAnchor: boolean;
};

function ChannelList({
  onLog,
  phone,
  setChannels,
  setSelected,
  state,
  toggleCollapsed,
}: {
  onLog: (text: string) => void;
  phone: boolean;
  setChannels: (next: Record<string, Channel[]>) => void;
  setSelected: (channelId: string) => void;
  state: ListState;
  toggleCollapsed: (categoryId: string) => void;
}) {
  // The same tap/drag rules as ChatGroup.
  const [drag] = useState(createReticulumChannelDragTracker);
  const sensors = useSensors(
    useSensor(ReticulumMousePointerSensor, {
      activationConstraint: {
        distance: RETICULUM_CHANNEL_POINTER_DRAG_DISTANCE_PX,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS,
        tolerance: RETICULUM_CHANNEL_TOUCH_DRAG_TOLERANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const padding = reticulumChannelListPadding(phone);
  const anchor = reticulumOnboardingChannelAnchor({
    defaultCategoryHidden: false,
    phone,
    scale: state.scale,
  });

  const onDragEnd = (event: DragEndEvent) => {
    const from = channelIdOf(event.active.id);
    if (drag.finish(event) === 'tap') {
      if (from) setSelected(from);
      onLog(`held tap: selected #${from || '(category)'}`);
      return;
    }
    const to = channelIdOf(event.over?.id);
    if (!from || !to || from === to) return;
    const key = Object.keys(state.channels).find((categoryId) =>
      state.channels[categoryId].some((item) => item.channelId === from)
    );
    const list = key === undefined ? [] : state.channels[key];
    const toIndex = list.findIndex((item) => item.channelId === to);
    if (key === undefined || toIndex < 0) {
      onLog('the preview only reorders within a category');
      return;
    }
    const fromIndex = list.findIndex((item) => item.channelId === from);
    setChannels({
      ...state.channels,
      [key]: arrayMove(list, fromIndex, toIndex),
    });
    onLog(`moved #${from}`);
  };

  const renderChannel = (item: Channel) => {
    const badge = BADGES[item.channelId] ?? {};
    return (
      <ReticulumSortableChannelButton
        key={item.channelId}
        channel={item}
        hasUnreadMention={(badge.mentions ?? 0) > 0}
        isAdmin={state.admin}
        mentionCount={badge.mentions ?? 0}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!drag.claimContextMenu()) return;
          onLog(`admin menu for #${item.channelId}`);
        }}
        onSelect={(channelId) => {
          setSelected(channelId);
          onLog(`tap: selected #${channelId}`);
        }}
        phone={phone}
        replyCount={badge.replies ?? 0}
        selected={state.selected === item.channelId}
        textScale={state.scale}
        unreadCount={badge.unread ?? 0}
      />
    );
  };

  const defaultCategoryName = state.longDefaultName
    ? DEFAULT_CATEGORY_NAMES.long
    : DEFAULT_CATEGORY_NAMES.short;

  const renderCategory = (item: Category) => (
    <ReticulumSortableCategory
      key={item.categoryId}
      category={item}
      isAdmin={state.admin}
      isCollapsed={state.collapsed.has(item.categoryId)}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!drag.claimContextMenu()) return;
        onLog(`admin menu for ${item.name}`);
      }}
      onCreateChannel={() => onLog(`create channel in ${item.name}`)}
      onToggleCollapsed={toggleCollapsed}
      phone={phone}
    >
      {(state.channels[item.categoryId] ?? []).map(renderChannel)}
    </ReticulumSortableCategory>
  );

  return (
    <Box
      sx={{
        backgroundColor: 'background.surface',
        borderRight: 1,
        borderColor: 'divider',
        height: '100%',
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      {state.showAnchor && (
        <Box
          aria-hidden
          sx={{
            border: '2px dashed',
            borderColor: 'warning.main',
            borderRadius: '6px',
            height: anchor.height,
            left: anchor.inset,
            pointerEvents: 'none',
            position: 'absolute',
            right: anchor.inset,
            top: anchor.top,
            zIndex: 5,
          }}
        />
      )}
      {/* Stand-in for the group-name bar (inline in ChatGroup). */}
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          gap: 1,
          height: RETICULUM_CHANNEL_LIST_HEADER_PX,
          px: '10px',
        }}
      >
        <Avatar sx={{ height: phone ? 30 : 26, width: phone ? 30 : 26 }}>
          H
        </Avatar>
        <Box sx={{ fontSize: 15, fontWeight: 650 }}>Hiking Club</Box>
      </Box>
      <DndContext
        collisionDetection={closestCenter}
        onDragCancel={() => drag.finish()}
        onDragEnd={onDragEnd}
        onDragMove={(event) => {
          if (drag.move(event.delta)) onLog('drag moved: admin menu closed');
        }}
        onDragStart={drag.begin}
        sensors={sensors}
      >
        <SortableContext
          items={Object.values(state.channels)
            .flat()
            .map((item) => `${CHANNEL_DRAG_PREFIX}${item.channelId}`)}
          strategy={verticalListSortingStrategy}
        >
          <Box sx={{ pb: 2, px: `${padding.outer}px` }}>
            {/* The default category: the same header as ChatGroup's. */}
            <ReticulumCategoryHeader
              draggable={false}
              isAdmin={state.admin}
              isCollapsed={state.collapsed.has('')}
              name={defaultCategoryName}
              onContextMenu={(event) => {
                event.preventDefault();
                onLog(`admin menu for ${defaultCategoryName}`);
              }}
              onCreateChannel={() =>
                onLog(`create channel in ${defaultCategoryName}`)
              }
              onToggle={() => toggleCollapsed('')}
              phone={phone}
            />
            {!state.collapsed.has('') && (
              <Box
                sx={{
                  pt: `${RETICULUM_CATEGORY_CONTENT_GAP_PX}px`,
                  px: `${padding.inner}px`,
                }}
              >
                {(state.channels[''] ?? []).map(renderChannel)}
              </Box>
            )}
            {CATEGORIES.map(renderCategory)}
          </Box>
        </SortableContext>
      </DndContext>
    </Box>
  );
}

/**
 * The phone chat header at `width`: stand-ins for the back arrow and the
 * call/search/more buttons around the real opener, laid out like ChatGroup's
 * header row.
 */
function PhoneChatHeader({
  channelName,
  groupName,
  width,
}: {
  channelName: string;
  groupName: string;
  width: number;
}) {
  const h = RETICULUM_PHONE_CHAT_HEADER;
  const frameRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const expected = reticulumPhoneChatHeaderWidths(width).channelName;

  useLayoutEffect(() => {
    const span = [...(frameRef.current?.querySelectorAll('span') ?? [])].find(
      (node) => node.textContent === channelName
    );
    // The span is as wide as its text when the name fits; its flex
    // container's free width is what the name may use.
    const line = span?.parentElement;
    if (!span || !line) return;
    const icons = [...line.children].filter((node) => node !== span);
    const used = icons.reduce(
      (sum, node) => sum + node.getBoundingClientRect().width,
      0
    );
    const gaps = h.channelLineGap * icons.length;
    setMeasured(Math.round(line.getBoundingClientRect().width - used - gaps));
  }, [channelName, h.channelLineGap, width]);

  const square = {
    color: 'text.secondary',
    flexShrink: 0,
    height: h.actionSize,
    width: h.actionSize,
    '& .MuiSvgIcon-root': { fontSize: h.iconSize },
  } as const;

  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        Phone {width}px chat header: channel name {measured ?? '?'}px (layout
        says {expected}px)
      </div>
      <Box
        ref={frameRef}
        sx={{
          alignItems: 'center',
          backgroundColor: 'background.default',
          borderRadius: '12px',
          display: 'flex',
          flexWrap: 'nowrap',
          gap: `${h.itemGap}px`,
          minHeight: 50,
          // An outline, not a border, so the frame is exactly `width` inside.
          outline: '1px solid rgba(128,128,128,0.4)',
          overflow: 'hidden',
          px: `${h.paddingX}px`,
          width,
        }}
      >
        <IconButton
          aria-label="back"
          sx={{ ...square, ml: `-${h.backBleed}px` }}
        >
          <ArrowBackRoundedIcon />
        </IconButton>
        <ReticulumPhoneChannelOpener
          channelName={channelName}
          groupName={groupName}
          onToggle={() => setOpen((value) => !value)}
          open={open}
          // The app shows it below md only; the frames are phones.
          sx={{ display: { xs: 'flex', md: 'flex' } }}
        />
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexShrink: 0,
            gap: `${h.actionsGap}px`,
            ml: 'auto',
            mr: `-${h.actionsBleed}px`,
          }}
        >
          <IconButton aria-label="call" sx={{ ...square, borderRadius: '8px' }}>
            <CallIcon />
          </IconButton>
          <IconButton
            aria-label="search"
            sx={{ ...square, borderRadius: '8px' }}
          >
            <SearchRoundedIcon />
          </IconButton>
          <IconButton aria-label="more" sx={square}>
            <MoreVertRoundedIcon />
          </IconButton>
        </Box>
      </Box>
    </div>
  );
}

function SearchChips() {
  const theme = useTheme();
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        Search filter chips: phone, then desktop (the x is the remove target)
      </div>
      {[true, false].map((phone) => (
        <Box
          key={String(phone)}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1 }}
        >
          {['from: alice', 'in: #announcements', 'has: image'].map((label) => (
            <Chip
              key={label}
              label={label}
              onDelete={() => {}}
              size="small"
              sx={reticulumSearchChipSx(theme, phone)}
            />
          ))}
        </Box>
      ))}
    </div>
  );
}

function Frame({
  children,
  label,
  width,
}: {
  children: ReactNode;
  label: string;
  width: number;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>{label}</div>
      <div
        style={{
          border: '1px solid rgba(128,128,128,0.4)',
          borderRadius: 12,
          display: 'flex',
          height: 680,
          overflow: 'hidden',
          position: 'relative',
          width,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [state, setState] = useState<ListState>({
    admin: true,
    channels: INITIAL_CHANNELS,
    collapsed: new Set(),
    longDefaultName: false,
    scale: 'default',
    selected: 'general',
    showAnchor: false,
  });
  const [log, setLog] = useState('tap a channel, or hold one to drag it');
  const update = (patch: Partial<ListState>) =>
    setState((current) => ({ ...current, ...patch }));
  const listProps = {
    onLog: setLog,
    setChannels: (channels: Record<string, Channel[]>) => update({ channels }),
    setSelected: (selected: string) => update({ selected }),
    state,
    toggleCollapsed: (categoryId: string) =>
      setState((current) => {
        const collapsed = new Set(current.collapsed);
        if (collapsed.has(categoryId)) collapsed.delete(categoryId);
        else collapsed.add(categoryId);
        return { ...current, collapsed };
      }),
  };

  return (
    <div style={{ padding: 8 }}>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}
      >
        {(['default', 'medium', 'high'] as const).map((scale) => (
          <button
            key={scale}
            onClick={() => update({ scale })}
            style={{ fontWeight: scale === state.scale ? 700 : 400 }}
          >
            text: {scale}
          </button>
        ))}
        <button onClick={() => update({ admin: !state.admin })}>
          admin: {state.admin ? 'on' : 'off'}
        </button>
        <button onClick={() => update({ showAnchor: !state.showAnchor })}>
          tour anchor: {state.showAnchor ? 'shown' : 'hidden'}
        </button>
        <button
          onClick={() => update({ longDefaultName: !state.longDefaultName })}
        >
          default category name: {state.longDefaultName ? 'long' : 'short'}
        </button>
        <button onClick={toggleTheme}>{themeMode}</button>
        <span style={{ alignSelf: 'center', fontSize: 12, marginLeft: 8 }}>
          {log}
        </span>
      </div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 16 }}
      >
        {[360, 393, 320].map((width) => (
          <PhoneChatHeader
            key={width}
            channelName="announcements"
            groupName="Qortal Hub Community Builders"
            width={width}
          />
        ))}
        <SearchChips />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        <Frame label="Phone 360px, drawer open" width={360}>
          <Box
            sx={{
              flexShrink: 0,
              maxWidth: RETICULUM_CHANNEL_DRAWER_PHONE_MAX_WIDTH,
              minWidth: 264,
              width: RETICULUM_CHANNEL_DRAWER_PHONE_WIDTH_PX,
            }}
          >
            <ChannelList phone {...listProps} />
          </Box>
          <Box sx={{ backgroundColor: 'rgba(0,0,0,0.45)', flex: 1 }} />
        </Frame>
        <Frame label="Phone 320px, drawer open" width={320}>
          <Box
            sx={{
              flexShrink: 0,
              maxWidth: RETICULUM_CHANNEL_DRAWER_PHONE_MAX_WIDTH,
              minWidth: 264,
              width: RETICULUM_CHANNEL_DRAWER_PHONE_WIDTH_PX,
            }}
          >
            <ChannelList phone {...listProps} />
          </Box>
          <Box sx={{ backgroundColor: 'rgba(0,0,0,0.45)', flex: 1 }} />
        </Frame>
        <Frame label="Desktop sidebar (unchanged)" width={242}>
          <Box sx={{ width: 242 }}>
            <ChannelList phone={false} {...listProps} />
          </Box>
        </Frame>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
