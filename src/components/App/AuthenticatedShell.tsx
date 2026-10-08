import { Box } from '@mui/material';
import { shellWashGradient } from './shellBackground';
import { Group } from '../Group/Group';
import { ReticulumGroupAboutModal } from '../Group/ReticulumGroupAbout';
import { AuthenticatedProfile } from '../Profile';

/**
 * Authenticated main layout: Group (left) + AuthenticatedProfile (right).
 * Lazy-loaded so the Group bundle is not loaded until the user is authenticated.
 */
export type AuthenticatedShellProps = {
  // Group
  desktopViewMode: string;
  isMain: boolean;
  logoutFunc: () => Promise<void>;
  myAddress: string;
  setDesktopViewMode: (mode: string) => void;
  // AuthenticatedProfile
  balance: number;
  userInfo: any;
  rawWallet: any;
  qortBalanceLoading: boolean;
  setOpenSnack: (open: boolean) => void;
  setInfoSnack: (info: any) => void;
  onRefreshBalance: () => void;
  onOpenSendQort: () => void;
  onOpenRegisterName: () => void;
  extState: string;
  isMainWindow: boolean;
  onOpenSettings: () => void;
  onOpenDrawerLookup: () => void;
  onOpenWalletsApp: () => void;
  getUserInfo: (useTimer?: boolean) => Promise<void>;
  onOpenMinting: () => void;
  showTutorial: (key: string, force?: boolean) => void;
  onBackupWallet: () => void;
};

export function AuthenticatedShell({
  balance,
  desktopViewMode,
  isMain,
  logoutFunc,
  myAddress,
  setDesktopViewMode,
  userInfo,
  rawWallet,
  qortBalanceLoading,
  setOpenSnack,
  setInfoSnack,
  onRefreshBalance,
  onOpenSendQort,
  onOpenRegisterName,
  extState,
  isMainWindow,
  onOpenSettings,
  onOpenDrawerLookup,
  onOpenWalletsApp,
  getUserInfo,
  onOpenMinting,
  showTutorial,
  onBackupWallet,
}: AuthenticatedShellProps) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        isolation: 'isolate',
        position: 'relative',
        width: '100%',
        willChange: 'opacity, transform',
        '&::before': {
          background: shellWashGradient(theme),
          content: '""',
          inset: 0,
          pointerEvents: 'none',
          position: 'absolute',
          zIndex: 0,
          // Phones: Home has the plain page colour, as the Q-Apps library and
          // Chat do, so the sections match side by side.
          [theme.breakpoints.down('md')]: { display: 'none' },
        },
        '& > *': {
          position: 'relative',
          zIndex: 1,
        },
      })}
    >
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
        <Group
          desktopViewMode={desktopViewMode}
          isMain={isMain}
          logoutFunc={logoutFunc}
          myAddress={myAddress}
          onOpenSettings={onOpenSettings}
          setDesktopViewMode={setDesktopViewMode}
        />
      </Box>
      <AuthenticatedProfile
        userInfo={userInfo}
        balance={balance}
        rawWallet={rawWallet}
        qortBalanceLoading={qortBalanceLoading}
        setOpenSnack={setOpenSnack}
        setInfoSnack={setInfoSnack}
        onRefreshBalance={onRefreshBalance}
        onOpenSendQort={onOpenSendQort}
        onOpenRegisterName={onOpenRegisterName}
        desktopViewMode={desktopViewMode}
        extState={extState}
        isMainWindow={isMainWindow}
        onLogout={logoutFunc}
        onOpenSettings={onOpenSettings}
        onOpenDrawerLookup={onOpenDrawerLookup}
        onOpenWalletsApp={onOpenWalletsApp}
        getUserInfo={getUserInfo}
        onOpenMinting={onOpenMinting}
        showTutorial={showTutorial}
        onBackupWallet={onBackupWallet}
      />
      {/* Hosted at shell root so About Group never depends on Q-Chat remounts. */}
      <ReticulumGroupAboutModal />
    </Box>
  );
}
