/**
 * Dev-only preview of sharing into chats from Android's share sheet: what
 * "GO Groups" / "GO DMs" put in the phone Q-Chat header (the share in place
 * of search, new and settings, with an X) and what a tap on a chat does
 * (logged on the page). The lists are faked, so no node is needed. Run
 * `npm run dev` and open /tools/preview/chat-share.html. Not a build input,
 * so it never ships.
 */
import { createRoot } from 'react-dom/client';
import { Box, Button, CssBaseline, Typography } from '@mui/material';
import { useAtom } from 'jotai';
import { useState } from 'react';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { MobileChatListHeader } from '../../src/components/Group/MobileChatListHeader';
import type { ChatScope } from '../../src/components/Group/ChatScopeSwitch';
import { ChatShareHost } from '../../src/components/Chat/share/ChatShareHost';
import { routeChatShare } from '../../src/components/Chat/share/chatShareIntake';
import { pendingChatShareAtom } from '../../src/components/Chat/share/chatShareState';

const ME = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';

const GROUPS = ['Qortal GO testers', 'Qortal General', 'Q-Apps builders'];
const DIRECTS = ['Saved Messages', 'crowetic', 'Kalle'];

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

  // What Group.tsx does on a row tap while a share waits.
  const tap = (chat: string) => {
    note(
      share
        ? `${chat}: opens with the ${share.items[0]?.name ?? 'text'} in its composer`
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
          onCancelShare={() => {
            note('share dropped');
            setShare(null);
          }}
        />
        {rows.map((name) => (
          <Box
            key={name}
            component="button"
            onClick={() => tap(name)}
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
        ))}
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
