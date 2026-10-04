/**
 * Dev-only preview of the Q-Chat message actions: reaction chips, the replies
 * chip, the tap toolbar, the long-press menu and a file offer's Accept
 * button. Run `npm run dev` and open
 * /tools/preview/message-actions.html. Phone sizes apply below 900px of
 * viewport width (tap a message for the toolbar, long-press or right-click
 * for the menu). Not a build input, so it never ships.
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
    message: post(
      'preview-2',
      ME,
      'me',
      'Yes, the buttons are much easier to hit now.',
      30
    ),
    replies: 1,
    reactions: { '❤️': [{ sender: ALICE, senderName: 'alice' }] } as Reactions,
  },
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
      setReactionsById((current) => {
        const list = (current[message.id]?.[emoji] || []).filter(
          (item) => item.sender !== ME
        );
        return {
          ...current,
          [message.id]: {
            ...current[message.id],
            [emoji]: add ? [...list, { sender: ME, senderName: 'me' }] : list,
          },
        };
      });
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
          sx={{ bgcolor: 'background.default', mt: 1, py: 1 }}
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
