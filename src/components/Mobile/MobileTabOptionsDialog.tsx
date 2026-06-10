import {
  Box,
  Dialog,
  Divider,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import FolderOffRoundedIcon from '@mui/icons-material/FolderOffRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  dialogModalBackdropSx,
  getDialogPaperSx,
} from '../App/dialogSurface';
import { MOBILE_TABS_DIALOG_Z } from './mobileLayout';
import type { TabFolder } from './mobileTabOrganization';
import type { OpenTab } from './useOpenTabs';

type OptionRowProps = {
  icon: typeof CreateNewFolderRoundedIcon;
  label: string;
  onClick: () => void;
  accent?: 'primary' | 'warning' | 'neutral';
  delayMs?: number;
};

function OptionRow({
  icon: Icon,
  label,
  onClick,
  accent = 'primary',
  delayMs = 0,
}: OptionRowProps) {
  const theme = useTheme();
  const accentColor =
    accent === 'warning'
      ? theme.palette.warning.main
      : accent === 'neutral'
        ? theme.palette.text.secondary
        : theme.palette.primary.main;

  return (
    <Box
      role="menuitem"
      onClick={onClick}
      sx={{
        '@keyframes tabOptionIn': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        alignItems: 'center',
        animation: `tabOptionIn 220ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms forwards`,
        borderRadius: '12px',
        cursor: 'pointer',
        display: 'flex',
        gap: 1,
        opacity: 0,
        px: 0.85,
        py: 0.9,
        transition: 'background-color 120ms ease',
        '&:active': {
          bgcolor: alpha(theme.palette.text.primary, 0.08),
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: alpha(accentColor, 0.12),
          borderRadius: '10px',
          color: accentColor,
          display: 'flex',
          flexShrink: 0,
          height: 34,
          justifyContent: 'center',
          width: 34,
        }}
      >
        <Icon sx={{ fontSize: 18 }} />
      </Box>
      <Typography sx={{ flex: 1, fontSize: '0.92rem', fontWeight: 600 }}>
        {label}
      </Typography>
    </Box>
  );
}

type MobileTabOptionsDialogProps = {
  open: boolean;
  tab: OpenTab | null;
  tabTitle: string;
  folders: TabFolder[];
  currentFolderId: string | null;
  hasCustomLabel: boolean;
  onClose: () => void;
  onCreateFolder: () => void;
  onAddToFolder: (folderId: string) => void;
  onRemoveFromFolder: () => void;
  onRename: () => void;
  onChangeAddress: () => void;
  onRestoreName: () => void;
};

export function MobileTabOptionsDialog({
  open,
  tab,
  tabTitle,
  folders,
  currentFolderId,
  hasCustomLabel,
  onClose,
  onCreateFolder,
  onAddToFolder,
  onRemoveFromFolder,
  onRename,
  onChangeAddress,
  onRestoreName,
}: MobileTabOptionsDialogProps) {
  const theme = useTheme();
  const isInternal = Boolean(tab?.internal);
  let optionIndex = 0;
  const nextDelay = () => 50 + optionIndex++ * 40;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
      slotProps={{
        backdrop: { sx: dialogModalBackdropSx },
      }}
      PaperProps={{
        sx: {
          ...getDialogPaperSx(theme, { maxWidth: 360, radius: 20 }),
          mx: 'auto',
        },
      }}
    >
      <Box sx={{ px: 2, pt: 1.75, pb: 2 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            mb: 1.25,
          }}
        >
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
            <Box
              sx={{
                alignItems: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.14),
                borderRadius: '12px',
                color: theme.palette.primary.main,
                display: 'flex',
                height: 40,
                justifyContent: 'center',
                width: 40,
              }}
            >
              <TuneRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: '1.02rem', fontWeight: 700 }}>
                Tab options
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.78rem',
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tabTitle}
              </Typography>
            </Box>
          </Box>
          <IconButton size="small" aria-label="Close" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <OptionRow
            delayMs={nextDelay()}
            icon={CreateNewFolderRoundedIcon}
            label="New folder & add"
            onClick={onCreateFolder}
          />
          <OptionRow
            delayMs={nextDelay()}
            icon={DriveFileRenameOutlineRoundedIcon}
            label="Rename tab"
            onClick={onRename}
          />
          {!isInternal ? (
            <OptionRow
              delayMs={nextDelay()}
              icon={LinkRoundedIcon}
              label="Change qortal:// address"
              onClick={onChangeAddress}
            />
          ) : null}
          {hasCustomLabel ? (
            <OptionRow
              delayMs={nextDelay()}
              accent="neutral"
              icon={RestoreRoundedIcon}
              label="Restore original name"
              onClick={onRestoreName}
            />
          ) : null}
          {currentFolderId ? (
            <OptionRow
              delayMs={nextDelay()}
              accent="warning"
              icon={FolderOffRoundedIcon}
              label="Remove from folder"
              onClick={onRemoveFromFolder}
            />
          ) : null}
        </Box>

        {folders.length > 0 ? (
          <>
            <Divider sx={{ my: 1.5, opacity: 0.65 }} />
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: 0.6,
                mb: 0.75,
                px: 0.85,
                textTransform: 'uppercase',
              }}
            >
              Move to:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
              {folders.map((folder, index) => (
                <OptionRow
                  key={folder.id}
                  accent={folder.id === currentFolderId ? 'neutral' : 'primary'}
                  delayMs={nextDelay() + index * 20}
                  icon={FolderRoundedIcon}
                  label={folder.name}
                  onClick={() => onAddToFolder(folder.id)}
                />
              ))}
            </Box>
          </>
        ) : null}
      </Box>
    </Dialog>
  );
}
