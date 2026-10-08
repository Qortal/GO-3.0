/**
 * Dev-only preview of the Q-Chat message actions: reaction chips, the replies
 * chip, the phone popup (MessageActionsPopup) and a file offer's Accept
 * button. Run `npm run dev` and open
 * /tools/preview/message-actions.html. Below 900px of viewport width a tap
 * opens the short popup and a long press or right-click the full one with
 * the details; wider, the desktop hover toolbar and right-click menu show.
 * Not a build input, so it never ships.
 */
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, useMediaQuery, useTheme } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { QORTAL_APP_CONTEXT } from '../../src/App';
import { MessageItem } from '../../src/components/Chat/MessageItem';

// No strings are injected: MessageItem's English defaultValues cover the keys
// the locales do not carry yet, exactly as in the app.

const ME = 'QMeAddressPreview000000000000000000';
const ALICE = 'QAliceAddressPreview0000000000000000';
const BOB = 'QBobAddressPreview000000000000000000';

type Reaction = { sender: string; senderName: string };
type Reactions = Record<string, Reaction[]>;

const post = (
  id: string,
  sender: string,
  senderName: string,
  text: string,
  minutesAgo: number
) => ({
  id,
  eventId: id,
  signature: id,
  timestamp: Date.now() - minutesAgo * 60_000,
  sender,
  senderAddress: sender,
  senderName,
  text: `<p>${text}</p>`,
  message: `<p>${text}</p>`,
  messageText: text,
  reticulumChat: true,
});

const MESSAGES = [
  {
    message: post(
      'preview-1',
      ALICE,
      'alice',
      'Anyone tried the new release on a phone yet?',
      42
    ),
    replies: 3,
    reactions: {
      '👍': [
        { sender: BOB, senderName: 'bob' },
        { sender: ME, senderName: 'me' },
      ],
      '😂': [{ sender: BOB, senderName: 'bob' }],
    } as Reactions,
  },
  {
    // Own, edited and expiring: the long-press details show all three rows.
    message: {
      ...post(
        'preview-2',
        ME,
        'me',
        'Yes, the buttons are much easier to hit now.',
        30
      ),
      editTimestamp: Date.now() - 20 * 60_000,
      expiresAt: Date.now() + 3 * 24 * 60 * 60_000,
      isEdit: true,
    },
    replies: 1,
    reactions: { '❤️': [{ sender: ALICE, senderName: 'alice' }] } as Reactions,
  },
  ...[
    'Double tap any message to react with the chat’s double-tap emoji.',
    'Long press an emoji in the pill to make it the double-tap one.',
    'The gear in the full emoji panel has the reaction settings.',
    'Reacting to the last message scrolls its reaction into view.',
  ].map((text, index) => ({
    message: post(`preview-filler-${index}`, ALICE, 'alice', text, 20 - index),
    replies: 0,
    reactions: {} as Reactions,
  })),
  {
    message: post('preview-3', BOB, 'bob', 'Nice, no reactions here yet.', 5),
    replies: 0,
    reactions: {} as Reactions,
  },
  {
    // A Q-Chat file offer: the Accept button is 44px tall on phones.
    message: {
      ...post('preview-4', BOB, 'bob', '', 2),
      reticulumChat: undefined,
      recipientAddress: ME,
      decryptedData: {
        type: 'qchat-dm-file-transfer',
        data: {
          status: 'offer',
          transferId: 'preview-transfer',
          fileName: 'holiday-photos.zip',
          size: 4_200_000,
          expiresAt: Date.now() + 60 * 60_000,
        },
      },
    },
    replies: 0,
    reactions: {} as Reactions,
    extraProps: {
      isPrivate: true,
      onAcceptQchatFileTransfer: () => {},
      qchatCompletedTransfers: {},
      qchatFileTransferStates: {},
    },
  },
];

const appContext = { getIndividualUserInfo: async () => null };

function Preview() {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('md'));
  const { themeMode, toggleTheme } = useThemeContext();
  const [lastAction, setLastAction] = useState('none yet');
  const [reactionsById, setReactionsById] = useState<Record<string, Reactions>>(
    () => Object.fromEntries(MESSAGES.map((m) => [m.message.id, m.reactions]))
  );

  const handleReaction = useCallback(
    (emoji: string, message: { id: string }, add: boolean) => {
      setLastAction(`${add ? 'react' : 'unreact'} ${emoji}`);
      // Like the send queue: the chip shows a moment after the tap.
      window.setTimeout(
        () =>
          setReactionsById((current) => {
            const list = (current[message.id]?.[emoji] || []).filter(
              (item) => item.sender !== ME
            );
            return {
              ...current,
              [message.id]: {
                ...current[message.id],
                [emoji]: add
                  ? [...list, { sender: ME, senderName: 'me' }]
                  : list,
              },
            };
          }),
        120
      );
    },
    []
  );

  return (
    <QORTAL_APP_CONTEXT.Provider value={appContext as any}>
      <Box
        sx={{
          color: 'text.primary',
          fontSize: 13,
          maxWidth: 720,
          mx: 'auto',
          p: '8px 0',
        }}
      >
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, px: 2 }}>
          <button onClick={toggleTheme}>{themeMode}</button>
          <span>
            {isPhone ? 'phone sizes' : 'desktop sizes'} ({window.innerWidth}
            px) · last action: {lastAction}
          </span>
        </Box>
        <Box
          data-reticulum-chat-root="true"
          sx={{
            bgcolor: 'background.default',
            // A chat-like scroller, so a reaction under the last message
            // has to scroll into view.
            height: 'calc(100vh - 48px)',
            mt: 1,
            overflowY: 'auto',
            py: 1,
          }}
        >
          {MESSAGES.map(({ message, replies, extraProps }) => (
            <MessageItem
              key={message.id}
              {...({
                handleReaction,
                isLast: false,
                isPrivate: false,
                message,
                myAddress: ME,
                onDelete: () => setLastAction('delete'),
                onEdit: () => setLastAction('edit'),
                onOpenReticulumDiscussion: () =>
                  setLastAction('open discussion'),
                onReply: () => setLastAction('reply'),
                onSeen: () => {},
                reactionChatKey: 'group:preview',
                reactions: reactionsById[message.id],
                reticulumChatEnabled: true,
                reticulumDiscussionReplyCount: replies,
                scrollToItem: () => {},
                ...extraProps,
              } as any)}
            />
          ))}
        </Box>
      </Box>
    </QORTAL_APP_CONTEXT.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
