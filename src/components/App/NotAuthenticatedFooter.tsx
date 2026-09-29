import { Box, IconButton, Tooltip } from '@mui/material';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../Language/LanguageSelector';
import ThemeSelector from '../Theme/ThemeSelector';
import { useSoftKeyboardOpen } from '../../hooks/useSoftKeyboardOpen';
import { isCapacitor } from '../../utils/platform';
import { mobileLoginSettingsOpenAtom } from '../../atoms/global';

type NotAuthenticatedFooterProps = {
  showCoreSetup: boolean;
  onOpenCoreSetup: () => void;
};

export function NotAuthenticatedFooter({
  showCoreSetup,
  onOpenCoreSetup,
}: NotAuthenticatedFooterProps) {
  const { t } = useTranslation(['core', 'auth']);
  const keyboardOpen = useSoftKeyboardOpen();
  const nativeShell = isCapacitor();
  const setLoginSettingsOpen = useSetAtom(mobileLoginSettingsOpenAtom);

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: keyboardOpen ? 'none' : 'flex',
        gap: 0.35,
        justifyContent: 'flex-end',
        opacity: 0.62,
        pointerEvents: 'auto',
        position: 'absolute',
        right: '12px',
        bottom: 'calc(10px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
        width: 'auto',
        zIndex: 2000,
      }}
    >
      {nativeShell ? (
        <Box>
          <Tooltip title={t('auth:mobile_login_settings.title')}>
            <IconButton onClick={() => setLoginSettingsOpen(true)}>
              <TuneRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ) : (
        showCoreSetup && (
          <Box>
            <Tooltip title={t('core:aria.core_controls')}>
              <IconButton onClick={onOpenCoreSetup}>
                <SettingsRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )
      )}
      <ThemeSelector footer />
      <Box>
        <LanguageSelector />
      </Box>
    </Box>
  );
}
