import { memo } from 'react';
import { ProfileLeft, ProfileLeftProps } from './ProfileLeft';

export type AuthenticatedProfileProps = ProfileLeftProps & {
  desktopViewMode: string;
  extState: string;
  isMainWindow: boolean;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenDrawerLookup: () => void;
  onOpenWalletsApp: () => void;
  getUserInfo: (useTimer?: boolean) => Promise<void>;
  onOpenMinting: () => void;
  showTutorial: (key: string, force?: boolean) => void;
  onBackupWallet: () => void;
};

export const AuthenticatedProfile = ({
  userInfo,
  balance,
  rawWallet,
  qortBalanceLoading,
  setOpenSnack,
  setInfoSnack,
  onRefreshBalance,
  onOpenSendQort,
  onOpenRegisterName,
  onCloseDrawer,
  desktopViewMode,
}: AuthenticatedProfileProps) => {
  const showLeftColumn =
    desktopViewMode !== 'apps' &&
    desktopViewMode !== 'dev' &&
    desktopViewMode !== 'chat' &&
    desktopViewMode !== 'home' &&
    desktopViewMode !== 'widgets';

  if (!showLeftColumn) {
    return null;
  }

  return (
    <ProfileLeft
      userInfo={userInfo}
      balance={balance}
      rawWallet={rawWallet}
      qortBalanceLoading={qortBalanceLoading}
      setOpenSnack={setOpenSnack}
      setInfoSnack={setInfoSnack}
      onRefreshBalance={onRefreshBalance}
      onOpenSendQort={onOpenSendQort}
      onOpenRegisterName={onOpenRegisterName}
      onCloseDrawer={onCloseDrawer}
    />
  );
};

export default memo(AuthenticatedProfile);
