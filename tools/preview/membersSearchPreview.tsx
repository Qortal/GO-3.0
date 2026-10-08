/**
 * Dev-only preview of the phone Members screen with its member search: the
 * magnifier in the header, suggestions while typing and the jump to a member
 * in the list. The node is faked (a few dozen members), so no Core is needed.
 * Run `npm run dev` and open /tools/preview/members-search.html; add
 * `?admin=1` for the admin tab strip. Not a build input, so it never ships.
 */
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { QORTAL_APP_CONTEXT } from '../../src/App';
import { ManageMembers } from '../../src/components/Group/ManageMembers';

const NAMES = [
  'Alice',
  'Alan Turing',
  'Big Al',
  'Salvador',
  'Zoë Ångström',
  'Bob',
  'Crowetic',
  'Kalle',
  'Hal',
  'Valerie',
  'Opal',
  'Coral Reef',
  'Dave',
  'Eve',
  'Frank',
  'Grace',
  'Heidi',
  'Ivan',
  'Judy',
  'Mallory',
  'Niaj',
  'Olivia',
  'Peggy',
  'Rupert',
  'Sybil',
  'Trent',
  'Uma',
  'Victor',
  'Walter',
  'Xena',
  'Yolanda',
  'Zed',
];
const OWNER = 'QPreviewOwner0000000000000000000000';
const members = [
  ...NAMES.map((primaryName, index) => ({
    member:
      index === 0
        ? OWNER
        : `Q${primaryName.replace(/[^A-Za-z]/g, '')}${'x'.repeat(30)}`.slice(
            0,
            34
          ),
    primaryName,
    isAdmin: index < 3,
  })),
  { member: 'QnoNameMember9999999999999999999999' },
];

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('/groups/members/')) {
    return new Response(JSON.stringify({ members }), { status: 200 });
  }
  if (/\/groups\/\d+$/.test(url)) {
    return new Response(
      JSON.stringify({ groupId: 7, groupName: 'Preview', owner: OWNER }),
      { status: 200 }
    );
  }
  if (url.includes('/arbitrary/') || url.includes('/names/')) {
    return new Response('', { status: 404 });
  }
  return realFetch(input, init);
}) as typeof window.fetch;

const admin = new URLSearchParams(window.location.search).has('admin');

const Preview = () => {
  const { themeMode, toggleTheme } = useThemeContext();
  return (
    <QORTAL_APP_CONTEXT.Provider value={{ show: async () => true } as any}>
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <ManageMembers
          inline
          reticulumSidebar
          open
          setOpen={() => undefined}
          selectedGroup={{ groupId: 7, groupName: 'Preview' }}
          isAdmin={admin}
          isOwner={false}
          onJoinRequestCountChange={() => undefined}
          onClose={() => undefined}
        />
      </Box>
      <button
        onClick={toggleTheme}
        style={{ position: 'fixed', bottom: 8, left: 8, zIndex: 9999 }}
      >
        {themeMode}
      </button>
    </QORTAL_APP_CONTEXT.Provider>
  );
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
