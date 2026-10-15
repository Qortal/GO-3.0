/**
 * Dev-only preview of a Q-Chat channel with a group invite link in it (the
 * card that grows under a qortal://use-group/action-join/... message), to
 * watch the list while scrolling past it. Run `npm run dev` and open
 * /tools/preview/chat-invite-scroll.html at phone width.
 *
 * window.__track(ms) records, every frame for that long, the scrollTop and
 * where the reply row below the invite sits on screen; window.__jumps()
 * lists frames where that row moved by more than the scroll did.
 * Not a build input, so it never ships.
 */
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline } from '@mui/material';
import {
  ThemeProvider as MuiThemeProvider,
  unstable_createBreakpoints as createBreakpoints,
  type Theme,
} from '@mui/material/styles';
import { Provider, createStore } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import '../../src/components/Chat/chat.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { QORTAL_APP_CONTEXT } from '../../src/App';
import { ChatList } from '../../src/components/Chat/ChatList';

const ME = 'QMeAddressPreview000000000000000000';
const VIP = 'QVipAddressPreview000000000000000000';
const BEAR = 'QBearAddressPreview00000000000000000';
const OTHER = 'QOtherAddressPreview0000000000000000';

const GROUPS: Record<string, Record<string, unknown>> = {
  '1183': {
    groupId: 1183,
    groupName: 'Qortal Voting',
    description:
      'A daily question or vote about Qortal, its future and what the community wants next.',
    isOpen: true,
    memberCount: 8,
    created: Date.now() - 2 * 365 * 86_400_000,
    owner: VIP,
  },
  '77': {
    groupId: 77,
    groupName: 'Qortal Developers and Q-App Builders Worldwide',
    description: 'Building Q-Apps together.',
    isOpen: false,
    memberCount: 1,
    owner: OTHER,
  },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(
    typeof input === 'object' && 'url' in input ? input.url : input
  );
  const groupMatch = url.match(/\/groups\/(\d+)$/);
  if (groupMatch && GROUPS[groupMatch[1]]) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return json(GROUPS[groupMatch[1]]);
  }
  if (/\/groups\/balances/.test(url)) {
    return json(
      Object.values(GROUPS).map((group) => ({ ...group, balance: 4200 }))
    );
  }
  if (/\/admin\/info/.test(url)) return json({ currentTimestamp: Date.now() });
  if (/\/groups\/|\/names\/|\/arbitrary\//.test(url)) {
    return new Response('[]', { status: 200 });
  }
  return realFetch(input, init);
}) as typeof window.fetch;

// The Group Score badge reads public group activity from the chat engine.
(window as any).reticulumChat = {
  getPublicGroupActivitySnapshot: async () => ({
    availableGroupIds: [1183],
    summaries: [
      {
        activeAuthors7d: 6,
        confidence: 1,
        groupId: 1183,
        messages24h: 4,
        messages7d: 52,
        observedAt: Date.now(),
      },
    ],
  }),
  setPublicGroupDirectory: async () => {},
};

let clock = Date.now() - 3 * 60 * 60_000;
const post = (
  id: string,
  sender: string,
  senderName: string,
  html: string,
  extra: Record<string, unknown> = {}
) => {
  clock += 4 * 60_000;
  return {
    id,
    eventId: id,
    signature: id,
    timestamp: clock,
    sender,
    senderAddress: sender,
    senderName,
    text: html,
    message: html,
    messageText: html,
    reticulumChat: true,
    ...extra,
  };
};

const filler = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) =>
    post(
      `${prefix}-${index}`,
      index % 2 ? OTHER : ME,
      index % 2 ? 'other' : 'me',
      index % 3
        ? `<p>Short message ${prefix} ${index}</p>`
        : `<p>A somewhat longer message ${prefix} ${index} that wraps onto a second line on a narrow phone screen.</p>`
    )
  );

const BEFORE = [
  ...filler(24, 'before'),
  post('netflix', OTHER, 'other', '<p>i downloaded movie in netflix :))</p>'),
];

const INVITE = post(
  'invite',
  VIP,
  'VIPcrypto',
  '<p>qortal://use-group/action-join/groupid-1183</p>'
);

const SECOND_INVITE_HTML =
  '<p>and this one: qortal://use-group/action-join/groupid-77</p>';

const LONG_REPLY = post(
  'bear-reply',
  BEAR,
  'Green say Bear',
  `<p>We already have the "Welcome to Qortal" group for people to ask questions regarding the platform etc.<br>I made a separate channel on here called "Voting on the QPS" so members can have a say in proceedings around here.</p><p></p><p>I have been saying for ages Qortal should simply scrap the levelling system altogether. For a start newbies actually earn more qort than people who have been here for years.</p><p></p><p>Your level was supposed to add more weight if asked to vote on a issue.</p><p></p><p>So for 5 Qort can somebody tell me the last time this "community driven" platform asked us all to vote on anything?</p><p></p><p>It is what it is but it's the deceit I can't be doing with, the whole fiasco with the "General Chat" showed us once &amp; for all the complete contempt Jack &amp; co have for us Qortians.</p>`,
  { repliedTo: 'invite' }
);

const MESSAGES = [
  ...BEFORE,
  INVITE,
  LONG_REPLY,
  ...filler(14, 'after'),
  post('invite-2', OTHER, 'other', SECOND_INVITE_HTML),
  ...filler(2, 'end'),
];

const phoneTheme = (outer: Theme): Theme => ({
  ...outer,
  breakpoints: createBreakpoints({
    values: { xs: 0, sm: 600, md: 100_000, lg: 100_001, xl: 100_002 },
  }),
});

const appContext = {
  getIndividualUserInfo: async () => null,
  show: async () => true,
};

function Preview() {
  const { themeMode } = useThemeContext();
  return (
    <MuiThemeProvider theme={phoneTheme}>
      <CssBaseline />
      <QORTAL_APP_CONTEXT.Provider value={appContext as any}>
        <Box
          data-theme-mode={themeMode}
          sx={{
            bgcolor: 'background.default',
            display: 'flex',
            flexDirection: 'column',
            height: '100dvh',
          }}
        >
          <ChatList
            chatId="preview-group:general"
            chatReferences={{}}
            handleReaction={() => {}}
            initialMessages={MESSAGES}
            myAddress={ME}
            myName="me"
            onEdit={() => {}}
            onOpenReticulumDiscussion={() => {}}
            onReply={() => {}}
            reticulumChatEnabled
            reticulumDiscussionReplyCounts={{ invite: 9 }}
            reticulumGroupDisplayName="Qortal Public Square"
            reticulumInitialHistoryReady
            reticulumMemberRolesByAddress={{ [BEAR]: 'owner' }}
            selectedGroup="preview-group"
            tempChatReferences={[]}
            tempMessages={[]}
          />
        </Box>
      </QORTAL_APP_CONTEXT.Provider>
    </MuiThemeProvider>
  );
}

type Sample = { t: number; scrollTop: number; rowTop: number | null };
let samples: Sample[] = [];

const scroller = () =>
  [...document.querySelectorAll<HTMLElement>('*')].find(
    (node) =>
      node.scrollHeight > node.clientHeight + 40 &&
      /auto|scroll/.test(getComputedStyle(node).overflowY)
  ) || null;

(window as any).__scroller = scroller;
(window as any).__track = (ms = 3000) =>
  new Promise<number>((resolve) => {
    samples = [];
    const start = performance.now();
    const tick = () => {
      const element = scroller();
      const row =
        document.querySelector<HTMLElement>(
          '[data-preview-key="bear-reply"]'
        ) ||
        [...document.querySelectorAll<HTMLElement>('[data-index]')].find(
          (node) => node.innerText.includes('Green say Bear')
        );
      samples.push({
        t: Math.round(performance.now() - start),
        scrollTop: element ? element.scrollTop : -1,
        rowTop: row ? Math.round(row.getBoundingClientRect().top) : null,
      });
      if (performance.now() - start < ms) requestAnimationFrame(tick);
      else resolve(samples.length);
    };
    requestAnimationFrame(tick);
  });
(window as any).__samples = () => samples;
(window as any).__jumps = (tolerance = 3) => {
  const out: any[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    if (before.rowTop === null || after.rowTop === null) continue;
    const scrolled = after.scrollTop - before.scrollTop;
    const moved = before.rowTop - after.rowTop;
    if (Math.abs(moved - scrolled) > tolerance) {
      out.push({ t: after.t, scrolled, moved, scrollTop: after.scrollTop });
    }
  }
  return out;
};

createRoot(document.getElementById('root')!).render(
  <Provider store={createStore()}>
    <ThemeProvider>
      <Preview />
    </ThemeProvider>
  </Provider>
);
