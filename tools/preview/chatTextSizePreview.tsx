/**
 * Dev-only preview of the Q-Chat text size (chat settings → Text size): real
 * chat rows (MessageItem) with replies, mentions, lists, code and plain text,
 * a thread, the DM call and friend rows, the typing line and the message box,
 * beside the settings panel. Run `npm run dev` and open
 * /tools/preview/chat-text-size.html. The page always uses the phone layout;
 * a window under 900px also gets the phone message box padding.
 *
 * The size buttons set the same atom as the settings, so everything follows
 * either. window.__textSizeCheck() reports the sizes the chat settled on and
 * anything that spills sideways; ?view=chat|thread|settings shows one part.
 * Not a build input, so it never ships.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  CssBaseline,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ThemeProvider as MuiThemeProvider,
  unstable_createBreakpoints as createBreakpoints,
  type Theme,
} from '@mui/material/styles';
import SendIcon from '@mui/icons-material/Send';
import { Provider, createStore, useAtom } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import '../../src/components/Chat/chat.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { QORTAL_APP_CONTEXT } from '../../src/App';
import { reticulumChatTextScaleAtom } from '../../src/atoms/global';
import { MessageItem } from '../../src/components/Chat/MessageItem';
import Tiptap from '../../src/components/Chat/TipTap';
import { ComposerDiscardButton } from '../../src/components/Chat/ComposerDiscardButton';
import { DirectCallHistoryRow } from '../../src/components/Chat/DirectCallHistoryRow';
import { DirectFriendEventRow } from '../../src/components/Chat/DirectFriendEventRow';
import { ReticulumTextSizeSettings } from '../../src/components/Chat/ReticulumTextSizeSettings';
import {
  RETICULUM_CHAT_TEXT_SCALES,
  qchatMetaTextSize,
  reticulumChatTextScaleClassName,
} from '../../src/components/Chat/reticulumChatTextScale';
import {
  COMPOSER_SEND_BUTTON_PX,
  COMPOSER_SEND_ICON_PX,
} from '../../src/components/Chat/composerCornerLayout';

const ME = 'QMeAddressPreview000000000000000000';
const ALICE = 'QAliceAddressPreview0000000000000000';
const BOB = 'QBobAddressPreview000000000000000000';

const post = (
  id: string,
  sender: string,
  senderName: string,
  html: string,
  minutesAgo: number,
  extra: Record<string, unknown> = {}
) => ({
  id,
  eventId: id,
  signature: id,
  timestamp: Date.now() - minutesAgo * 60_000,
  sender,
  senderAddress: sender,
  senderName,
  text: html,
  message: html,
  messageText: html,
  reticulumChat: true,
  ...extra,
});

const FIRST = post(
  'ts-1',
  ALICE,
  'alice',
  '<p>Anyone tried the new release on a phone yet?</p>',
  95
);

type Row = {
  message: ReturnType<typeof post>;
  grouped?: boolean;
  reply?: ReturnType<typeof post>;
  replies?: number;
  reactions?: Record<string, { sender: string; senderName: string }[]>;
};

const ROWS: Row[] = [
  {
    message: FIRST,
    replies: 3,
    reactions: {
      '👍': [
        { sender: BOB, senderName: 'bob' },
        { sender: ME, senderName: 'me' },
      ],
    },
  },
  {
    message: post(
      'ts-2',
      ALICE,
      'alice',
      '<p>The text size setting is in the chat settings now.</p>',
      94
    ),
    grouped: true,
  },
  {
    message: post(
      'ts-3',
      ME,
      'me',
      '<p>Yes! The <strong>buttons</strong> are much easier to hit now, and long messages still wrap nicely on a narrow phone screen.</p>',
      80,
      { editTimestamp: Date.now() - 70 * 60_000, isEdit: true }
    ),
  },
  {
    message: post(
      'ts-4',
      BOB,
      'bob',
      '<p>Works for me too, <span class="mention" data-type="mention" data-id="alice" data-label="alice">@alice</span> 🎉</p>',
      40,
      { repliedTo: 'ts-1' }
    ),
    reply: FIRST,
  },
  {
    message: post(
      'ts-5',
      ALICE,
      'alice',
      '<p>What changed:</p><ul><li><p>Small, Default and Large text</p></li><li><p>DMs and threads follow it too</p></li></ul><p>Run <code>npm test</code> before you push.</p>',
      30
    ),
  },
  {
    message: post('ts-6', BOB, 'bob', 'plain text, no paragraph around it', 20),
  },
  {
    message: post(
      'ts-7',
      BOB,
      'bob',
      "<h3>Snippet</h3><pre><code>const size = 'large';</code></pre>",
      19
    ),
    grouped: true,
  },
  {
    message: post('ts-8', ME, 'me', '<p>Perfect, thanks 🙏</p>', 2, {
      expiresAt: Date.now() + 2 * 60 * 60_000,
    }),
  },
];

const CALL = {
  direction: 'incoming',
  endedAt: Date.now() - 10 * 60_000,
  outcome: 'missed',
};
const FRIEND = {
  dmFriendEvent: {
    actorAddress: ALICE,
    actorName: 'alice',
    callsAvailable: true,
    targetAddress: ME,
    targetName: 'me',
  },
};

const phoneTheme = (outer: Theme): Theme => ({
  ...outer,
  breakpoints: createBreakpoints({
    values: { xs: 0, sm: 600, md: 100_000, lg: 100_001, xl: 100_002 },
  }),
});

const appContext = { getIndividualUserInfo: async () => null };

const SendButton = () => {
  const theme = useTheme();
  return (
    <IconButton
      aria-label="Send"
      className="compact-composer-send"
      size="small"
      sx={{
        bgcolor: theme.palette.primary.main,
        borderRadius: '50%',
        color: theme.palette.primary.contrastText,
        flexShrink: 0,
        height: COMPOSER_SEND_BUTTON_PX,
        width: COMPOSER_SEND_BUTTON_PX,
      }}
    >
      <SendIcon sx={{ fontSize: COMPOSER_SEND_ICON_PX }} />
    </IconButton>
  );
};

function Frame({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        maxWidth: '100%',
        overflow: 'hidden',
        width: 390,
      }}
    >
      <Box sx={{ color: 'text.secondary', fontSize: 11, px: 1.5, py: 0.5 }}>
        {title}
      </Box>
      {children}
    </Box>
  );
}

function ChatRows({ thread = false }: { thread?: boolean }) {
  const noop = useCallback(() => {}, []);
  const rows = thread ? ROWS.slice(0, 4) : ROWS;
  return (
    <>
      {rows.map(({ message, grouped, reply, replies, reactions }, index) => {
        const item = (
          <MessageItem
            {...({
              handleReaction: noop,
              isGroupedWithPrevious: !thread && grouped,
              isLast: false,
              isPrivate: false,
              isTemp: false,
              isUpdating: false,
              lastSignature: '',
              message,
              myAddress: ME,
              onDelete: noop,
              onEdit: noop,
              onOpenReticulumDiscussion: noop,
              onReply: noop,
              onSeen: noop,
              reactions: thread ? null : (reactions ?? null),
              reply: reply ?? null,
              replyIndex: 0,
              reticulumChatEnabled: true,
              reticulumDiscussionReplyCount: thread ? 0 : (replies ?? 0),
              reticulumDiscussionRootId: thread ? FIRST.signature : undefined,
              reticulumDiscussionView: thread,
              scrollToItem: noop,
            } as any)}
          />
        );
        if (!thread) return <Box key={message.id}>{item}</Box>;
        return (
          <Box
            className={`reticulum-discussion-message ${
              index === 0
                ? 'reticulum-discussion-message--initial'
                : 'reticulum-discussion-message--reply'
            }`}
            key={message.id}
            sx={{ borderRadius: '12px', mb: 1.25, mx: '10px', p: '12px' }}
          >
            {item}
          </Box>
        );
      })}
    </>
  );
}

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [scale, setScale] = useAtom(reticulumChatTextScaleAtom);
  const view = new URLSearchParams(window.location.search).get('view');
  const show = (part: string) => !view || view === part;

  return (
    <QORTAL_APP_CONTEXT.Provider value={appContext as any}>
      <Box sx={{ bgcolor: 'background.paper', minHeight: '100dvh' }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            p: '6px',
            '& button': { fontSize: 12 },
          }}
        >
          {RETICULUM_CHAT_TEXT_SCALES.map((option) => (
            <button
              key={option}
              onClick={() => setScale(option)}
              style={{ fontWeight: option === scale ? 700 : 400 }}
            >
              {option}
            </button>
          ))}
          <button onClick={toggleTheme}>{themeMode}</button>
        </Box>
        <Box
          sx={{
            alignItems: 'flex-start',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            p: '6px',
          }}
        >
          {show('chat') && (
            <Frame title="group chat / DM">
              <Box
                className={reticulumChatTextScaleClassName(scale)}
                data-preview-chat=""
                sx={{ bgcolor: 'background.default' }}
              >
                <Box data-reticulum-chat-root="true" sx={{ py: 1 }}>
                  <ChatRows />
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      py: 1,
                    }}
                  >
                    <DirectCallHistoryRow record={CALL} />
                    <DirectFriendEventRow message={FRIEND} myAddress={ME} />
                  </Box>
                </Box>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: qchatMetaTextSize(12),
                    fontStyle: 'italic',
                    lineHeight: 1.5,
                    px: 2.25,
                    py: '4px',
                  }}
                >
                  alice is typing...
                </Typography>
                <Box sx={{ p: '6px 8px' }}>
                  <Box
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: '22px',
                      padding: '3px 5px',
                    }}
                  >
                    <Tiptap
                      compactActions={() => (
                        <>
                          <ComposerDiscardButton idle onDiscard={() => {}} />
                          <SendButton />
                        </>
                      )}
                      compactChat
                      isChat
                      onEnter={() => {}}
                      placeholder="Message channel..."
                      setEditorRef={() => {}}
                      insertFiles={() => {}}
                    />
                  </Box>
                </Box>
              </Box>
            </Frame>
          )}
          {show('thread') && (
            <Frame title="thread">
              <Box
                className={reticulumChatTextScaleClassName(scale)}
                data-preview-thread=""
                sx={{ bgcolor: 'background.default', py: 1.5 }}
              >
                <Box data-reticulum-chat-root="true">
                  <ChatRows thread />
                </Box>
              </Box>
            </Frame>
          )}
          {show('settings') && (
            <Frame title="chat settings → text size">
              <Box sx={{ p: '20px 16px' }}>
                <ReticulumTextSizeSettings />
              </Box>
            </Frame>
          )}
        </Box>
      </Box>
    </QORTAL_APP_CONTEXT.Provider>
  );
}

const fontOf = (selector: string, root: ParentNode = document) => {
  const node = root.querySelector(selector);
  return node ? getComputedStyle(node).fontSize : null;
};

/** The sizes the chat settled on, and anything spilling out sideways. */
const textSizeCheck = () => {
  const chat = document.querySelector<HTMLElement>('[data-preview-chat]');
  if (!chat) return { error: 'open the page without ?view or with ?view=chat' };
  const rows = [...chat.querySelectorAll<HTMLElement>('.message-item-row')];
  const spills = [...chat.querySelectorAll<HTMLElement>('*')]
    .filter((node) => {
      const box = node.getBoundingClientRect();
      const frame = chat.getBoundingClientRect();
      return box.width > 0 && box.right > frame.right + 1;
    })
    .map((node) => node.className || node.tagName)
    .slice(0, 10);
  return {
    scale: chat.className,
    body: fontOf('.message-item-row .tiptap:not(.isReply) p', chat),
    bareText: fontOf('[id="ts-6"] .tiptap', chat),
    heading: fontOf('[id="ts-7"] .tiptap h3', chat),
    code: fontOf('[id="ts-7"] .tiptap pre', chat),
    inlineCode: fontOf('[id="ts-5"] .tiptap p code', chat),
    name: rows[0]
      ? getComputedStyle(rows[0].querySelector('.MuiTypography-root')!).fontSize
      : null,
    replyText: fontOf('.reticulum-inline-reply-card .tiptap.isReply p', chat),
    composer: fontOf('.tiptap-chat-composer .tiptap p', chat),
    composerHeight: Math.round(
      chat.querySelector('.tiptap-chat-composer')?.getBoundingClientRect()
        .height ?? 0
    ),
    spills,
  };
};

declare global {
  interface Window {
    __textSizeCheck: typeof textSizeCheck;
  }
}
window.__textSizeCheck = textSizeCheck;

createRoot(document.getElementById('root')!).render(
  <Provider store={createStore()}>
    <ThemeProvider>
      <MuiThemeProvider theme={phoneTheme}>
        <CssBaseline />
        <Preview />
      </MuiThemeProvider>
    </ThemeProvider>
  </Provider>
);
