/**
 * Dev-only preview of the GO avatar menu (MobileAccountPanel) with the status
 * picker and the Settings item, at phone widths. Actions only log. Run
 * `npm run dev` and open /tools/preview/account-panel.html. Not a build
 * input, so it never ships.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import PersonSearchRoundedIcon from '@mui/icons-material/PersonSearchRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import SystemUpdateAltRoundedIcon from '@mui/icons-material/SystemUpdateAltRounded';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import {
  MobileAccountPanel,
  type AccountAction,
} from '../../src/components/Mobile/MobileAccountPanel';
import { useMyStatus } from '../../src/hooks/usePresence';

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const [myStatus] = useMyStatus();
  const note = (line: string) => () =>
    setLog((lines) => [line, ...lines].slice(0, 6));

  const actions: AccountAction[] = [
    {
      icon: NotificationsRoundedIcon,
      label: 'Notifications',
      onClick: note('Notifications'),
    },
    {
      icon: AccountBalanceWalletRoundedIcon,
      label: 'Wallets',
      onClick: note('Wallets'),
    },
    { icon: SendRoundedIcon, label: 'Send QORT', onClick: note('Send QORT') },
    {
      icon: PersonSearchRoundedIcon,
      label: 'Address book',
      onClick: note('Address book'),
    },
    { icon: SavingsRoundedIcon, label: 'Minting', onClick: note('Minting') },
    { icon: SettingsRoundedIcon, label: 'Node', onClick: note('Node') },
    {
      icon: ManageAccountsRoundedIcon,
      label: 'Settings',
      onClick: note('Settings'),
    },
    {
      icon: SystemUpdateAltRoundedIcon,
      label: 'GO updates',
      onClick: note('Updates'),
    },
    { icon: LogoutRoundedIcon, label: 'Logout', onClick: note('Logout') },
  ];

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button onClick={() => setOpen(true)}>open</button>
        <button onClick={toggleTheme}>{themeMode}</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          status={myStatus} {log.join('  ·  ')}
        </span>
      </div>
      <MobileAccountPanel
        open={open}
        anchor={{ top: 40, right: 10 }}
        actions={actions}
        address="QfX9KhXn1234567890YcyQyH"
        primaryName="Simon James"
        cachedAvatarEntry={null}
        onClose={() => setOpen(false)}
        onLockNow={note('Lock now')}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
