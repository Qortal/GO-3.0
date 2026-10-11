/**
 * Dev-only preview of sharing into chats from Android's share sheet: what
 * "GO Groups" / "GO DMs" put in the phone Q-Chat header (the share in place
 * of search, new and settings, with an X) and what a tap on a chat does
 * (logged on the page). A group tapped while a share waits shows the real
 * channel step (ChatShareChannelStep): "Qortal GO testers" has categories,
 * unread badges and an admins-only channel, "Qortal General" has one
 * channel (straight in), and in "Q-Apps builders" you are an admin. The
 * lists and channels are faked, so no node is needed. Run `npm run dev` and
 * open /tools/preview/chat-share.html. Not a build input, so it never ships.
 */
import { createRoot } from 'react-dom/client';
import { Box, Button, CssBaseline, Typography } from '@mui/material';
import { getDefaultStore, useAtom } from 'jotai';
import { useEffect, useState } from 'react';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { MobileChatListHeader } from '../../src/components/Group/MobileChatListHeader';
import type { ChatScope } from '../../src/components/Group/ChatScopeSwitch';
import { ChatShareHost } from '../../src/components/Chat/share/ChatShareHost';
import { ChatShareChannelStep } from '../../src/components/Chat/share/ChatShareChannelStep';
import { routeChatShare } from '../../src/components/Chat/share/chatShareIntake';
import { pendingChatShareAtom } from '../../src/components/Chat/share/chatShareState';
import { reticulumChatSummariesAtom } from '../../src/atoms/global';

const ME = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';

const GROUPS = [
  { groupId: 101, groupName: 'Qortal GO testers', isAdmin: false },
  { groupId: 102, groupName: 'Qortal General', isAdmin: false },
  { groupId: 103, groupName: 'Q-Apps builders', isAdmin: true },
];
const DIRECTS = ['Saved Messages', 'crowetic', 'Kalle'];

const channel = (
  groupId: number,
  channelId: string,
  name: string,
  position: number,
  extra: Record<string, unknown> = {}
) => ({
  archived: false,
  channelId,
  createdAt: 1,
  createdBy: ME,
  groupId,
  name,
  position,
  updatedAt: 1,
  ...extra,
});

const CHANNELS: Record<number, { channels: unknown[]; categories: unknown[] }> =
  {
    101: {
      channels: [
        channel(101, 'general', 'general', 0),
        channel(101, 'off-topic', 'off-topic', 1),
        channel(101, 'announcements', 'announcements', 2, {
          writeMode: 'admins',
        }),
        channel(101, 'builds', 'apk-builds', 0, {
          categoryId: 'cat-build',
          expiryDurationMs: 7 * 86_400_000,
        }),
        channel(101, 'bugs', 'bug-reports', 1, { categoryId: 'cat-build' }),
      ],
      categories: [
        { categoryId: 'cat-build', groupId: 101, name: 'Testing', position: 0 },
      ],
    },
    102: { channels: [channel(102, 'general', 'general', 0)], categories: [] },
    103: {
      channels: [
        channel(103, 'general', 'general', 0),
        channel(103, 'help', 'help', 1),
        channel(103, 'releases', 'releases', 2, { writeMode: 'admins' }),
      ],
      categories: [],
    },
  };

// The group chat's channel source, as on the phone.
window.reticulumChat = {
  subscribeGroup: async () => ({ success: true }),
  getChannelMetadataBundle: async (groupId: number) => {
    // A little like a phone reading its database.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { ...CHANNELS[groupId], ready: true, snapshotVersion: 1 };
  },
} as unknown as typeof window.reticulumChat;

getDefaultStore().set(reticulumChatSummariesAtom, {
  '101': {
    groupId: 101,
    channels: [
      { groupId: 101, channelId: 'off-topic', unreadCount: 4 },
      { groupId: 101, channelId: 'bugs', replyCount: 2, unreadCount: 2 },
    ],
  },
});

const SHARES = [
  {
    label: 'Photo → GO Groups',
    share: {
      target: 'chats:groups',
      items: [
        {
          path: '/qortal192.png',
          name: 'IMG_20261008_101500.png',
          mimeType: 'image/png',
          size: 18_234,
        },
      ],
      extraCount: 2,
    },
  },
  {
    label: 'Video → GO DMs',
    share: {
      target: 'chats:directs',
      items: [
        {
          path: '/q-tube-preview.webm',
          name: 'VID_20261008_0930.webm',
          mimeType: 'video/webm',
          size: 4_200_000,
        },
      ],
    },
  },
  {
    label: 'PDF → GO Groups',
    share: {
      target: 'chats:groups',
      items: [
        {
          path: '/qortino-debug.html',
          name: 'Qortal whitepaper final version 2026.pdf',
          mimeType: 'application/pdf',
          size: 912_000,
        },
      ],
    },
  },
  {
    label: 'Link → GO DMs',
    share: {
      target: 'chats:directs',
      items: [],
      text: 'https://qortal.dev/news/go-3-share-to-chats',
    },
  },
  {
    label: 'Text → GO Groups',
    share: {
      target: 'chats:groups',
      items: [],
      text: 'meet at the node tonight, bring the new build',
    },
  },
];

const Preview = () => {
  const { themeMode, toggleTheme } = useThemeContext();
  const [share, setShare] = useAtom(pendingChatShareAtom);
  const [scope, setScope] = useState<ChatScope>('groups');
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog((lines) => [line, ...lines]);

  // A group tapped while a share waits: its channel step (Group.tsx).
  const [stepGroup, setStepGroup] = useState<(typeof GROUPS)[number] | null>(
    null
  );

  // ?demo=channel-step (for screenshots): a photo shared into the first
  // group, its channel step up.
  const demo =
    new URLSearchParams(window.location.search).get('demo') === 'channel-step';
  useEffect(() => {
    if (demo) routeChatShare(SHARES[0].share);
  }, [demo]);
  useEffect(() => {
    if (demo && share) setStepGroup((group) => group ?? GROUPS[0]);
  }, [demo, share]);

  // What Group.tsx does on a row tap while a share waits.
  const tap = (chat: string, channel?: string | null) => {
    note(
      share
        ? `${chat}${channel ? ` #${channel}` : ''}: opens with the ${
            share.items[0]?.name ?? 'text'
          } in its composer`
        : `${chat}: opens`
    );
    setShare(null);
  };

  // The list the share-sheet entry named.
  const shownScope: ChatScope =
    share && share.scope !== 'self' ? share.scope : scope;
  const rows = shownScope === 'groups' ? GROUPS : DIRECTS;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, p: 2 }}>
      <Box
        sx={{
          backgroundColor: 'background.default',
          border: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          height: 520,
          overflow: 'hidden',
          width: 375,
        }}
      >
        <MobileChatListHeader
          scope={shownScope}
          onScopeChange={setScope}
          onFindGroups={() => note('find groups')}
          onCreateGroup={() => note('create group')}
          onSearchMessages={() => note('search messages')}
          onNewChat={() => note('new chat')}
          share={share}
          sharePicksChannel={Boolean(share && stepGroup)}
          onCancelShare={() => {
            note('share dropped');
            setShare(null);
            setStepGroup(null);
          }}
        />
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            minHeight: 0,
            position: 'relative',
          }}
        >
          {rows.map((row) => {
            const name = typeof row === 'string' ? row : row.groupName;
            return (
              <Box
                key={name}
                component="button"
                onClick={() =>
                  share && typeof row !== 'string'
                    ? setStepGroup(row)
                    : tap(name)
                }
                sx={{
                  background: 'none',
                  border: 0,
                  borderBottom: 1,
                  borderColor: 'divider',
                  color: 'text.primary',
                  cursor: 'pointer',
                  font: 'inherit',
                  px: 2,
                  py: 2,
                  textAlign: 'left',
                }}
              >
                {name}
              </Box>
            );
          })}
          {share && stepGroup ? (
            <ChatShareChannelStep
              group={stepGroup}
              isAdmin={stepGroup.isAdmin}
              onBack={() => {
                note('back to the groups');
                setStepGroup(null);
              }}
              onPick={(channel) => {
                tap(stepGroup.groupName, channel);
                setStepGroup(null);
              }}
            />
          ) : null}
        </Box>
      </Box>
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: 300 }}
      >
        <Typography variant="h6">Share into GO chats</Typography>
        {SHARES.map(({ label, share: next }) => (
          <Button
            key={label}
            variant="contained"
            onClick={() => routeChatShare(next)}
          >
            {label}
          </Button>
        ))}
        <Box
          component="pre"
          sx={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {log.join('\n')}
        </Box>
      </Box>
      <ChatShareHost account={ME} />
      <button
        onClick={toggleTheme}
        style={{ position: 'fixed', bottom: 8, left: 8, zIndex: 99999 }}
      >
        {themeMode}
      </button>
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
