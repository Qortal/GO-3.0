import { useEffect, useMemo, useState } from 'react';
import {
  alpha,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../App';
import {
  buildGroupAvatarUrl,
  buildGroupAvatarUrlAsyncFallback,
} from '../../utils/groupAvatarUrl';
import { getGroupAdmins, getGroupMembers } from './groupApi';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getDialogPaperSx } from '../App/dialogSurface';
import { QortalUserAvatar } from '../QortalUserAvatar';
import { SAFE_AREA_TOP } from '../../utils/mobileSafeArea';

type GroupDetailsDialogProps = {
  open: boolean;
  onClose: () => void;
  groupId?: string | number | null;
  groupName?: string | null;
  ownerName?: string | null;
  isPrivate?: boolean | null;
};

type GroupInfo = {
  owner?: string;
  description?: string;
  memberCount?: number;
  isOpen?: boolean;
  created?: number;
};

const shortenAddress = (address?: string) =>
  address && address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address || '';

const MAX_LISTED = 200;

export const GroupDetailsDialog = ({
  open,
  onClose,
  groupId,
  groupName,
  ownerName,
  isPrivate,
}: GroupDetailsDialogProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [members, setMembers] = useState<
    { member: string; primaryName?: string }[]
  >([]);
  const [admins, setAdmins] = useState<{ name: string; address: string }[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const avatarUrl = useMemo(
    () => buildGroupAvatarUrl(ownerName, groupId),
    [ownerName, groupId]
  );
  const avatarPreviewUrl = useMemo(
    () => buildGroupAvatarUrlAsyncFallback(avatarUrl),
    [avatarUrl]
  );

  useEffect(() => {
    if (!open || groupId == null || groupId === '') return;
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    setMembers([]);
    setAdmins([]);
    const idNum = Number(groupId);
    Promise.allSettled([
      fetch(`${getBaseApiReact()}/groups/${groupId}`).then((r) => r.json()),
      getGroupMembers(idNum),
      getGroupAdmins(idNum),
    ])
      .then(([infoRes, membersRes, adminsRes]) => {
        if (cancelled) return;
        if (infoRes.status === 'fulfilled') setInfo(infoRes.value || null);
        if (membersRes.status === 'fulfilled') {
          setMembers(membersRes.value?.members || []);
        }
        if (adminsRes.status === 'fulfilled') {
          setAdmins(adminsRes.value?.both || []);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, groupId]);

  const memberCount = info?.memberCount ?? members.length;
  const adminAddresses = useMemo(
    () => new Set(admins.map((a) => a.address)),
    [admins]
  );
  const nonAdminMembers = useMemo(
    () => members.filter((m) => !adminAddresses.has(m.member)),
    [members, adminAddresses]
  );

  const isLight = theme.palette.mode === 'light';
  const sectionLabelSx = {
    color: theme.palette.text.secondary,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  };

  const renderPerson = (name: string | undefined, address: string) => (
    <Box
      key={address}
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1,
        py: 0.6,
      }}
    >
      <QortalUserAvatar
        primaryName={name || undefined}
        walletAddress={address}
        fallbackIconSize={16}
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.16),
          color: theme.palette.primary.main,
          fontSize: 12,
          fontWeight: 700,
          height: 26,
          width: 26,
        }}
      />
      <Typography
        sx={{
          color: name ? theme.palette.text.primary : theme.palette.text.secondary,
          fontSize: '0.86rem',
          fontWeight: name ? 600 : 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name || shortenAddress(address)}
      </Typography>
    </Box>
  );

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="xs"
        sx={{
          // Keep the dialog clear of the status bar / camera notch at the top.
          '& .MuiDialog-container': { alignItems: 'flex-start' },
        }}
        PaperProps={{
          sx: {
            ...getDialogPaperSx(theme, { maxWidth: 440, radius: 20 }),
            display: 'flex',
            flexDirection: 'column',
            marginTop: `calc(${SAFE_AREA_TOP} + 16px)`,
            marginBottom: '16px',
            maxHeight: `calc(100dvh - ${SAFE_AREA_TOP} - 40px)`,
          },
        }}
      >
        <IconButton
          aria-label={t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={onClose}
          size="small"
          sx={{
            color: theme.palette.text.secondary,
            position: 'absolute',
            right: 8,
            top: 8,
            zIndex: 2,
          }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>

        <DialogContent
          sx={{ px: 2.5, py: 3, overflowY: 'auto', flex: 1, minHeight: 0 }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              textAlign: 'center',
            }}
          >
            <Avatar
              src={avatarUrl || undefined}
              alt={groupName || 'Group'}
              onClick={() => {
                if (avatarPreviewUrl) setPreviewOpen(true);
              }}
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.16),
                color: theme.palette.primary.main,
                cursor: avatarPreviewUrl ? 'zoom-in' : 'default',
                fontSize: 42,
                fontWeight: 700,
                height: 104,
                width: 104,
                boxShadow: isLight
                  ? '0 8px 24px rgba(30,50,72,0.16)'
                  : '0 10px 28px rgba(0,0,0,0.5)',
              }}
            >
              {(groupName || '?').trim().charAt(0).toUpperCase()}
            </Avatar>

            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '1.18rem',
                fontWeight: 700,
                lineHeight: 1.25,
                mt: 0.5,
                wordBreak: 'break-word',
              }}
            >
              {groupName}
            </Typography>

            <Chip
              size="small"
              icon={
                isPrivate === false ? (
                  <NoEncryptionGmailerrorredIcon />
                ) : (
                  <LockRoundedIcon />
                )
              }
              label={
                isPrivate === false
                  ? t('group:group.public', {
                      defaultValue: 'Public',
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('group:group.private', {
                      defaultValue: 'Private',
                      postProcess: 'capitalizeFirstChar',
                    })
              }
              sx={{
                '& .MuiChip-icon': {
                  color:
                    isPrivate === false
                      ? theme.palette.other.danger
                      : theme.palette.other.positive,
                  fontSize: 16,
                },
                bgcolor: alpha(
                  isPrivate === false
                    ? theme.palette.other.danger
                    : theme.palette.other.positive,
                  0.12
                ),
                color: theme.palette.text.primary,
                fontWeight: 600,
              }}
            />

            {groupId != null && (
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.76rem',
                }}
              >
                {t('group:group_id', { defaultValue: 'Group ID' })}: {groupId}
              </Typography>
            )}
          </Box>

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2.5 }}>
              <CircularProgress size={22} />
            </Box>
          )}

          {!loading && (
            <>
              <Box
                sx={{
                  display: 'flex',
                  gap: 1.2,
                  justifyContent: 'center',
                  mt: 2,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    bgcolor: isLight
                      ? alpha(theme.palette.primary.main, 0.06)
                      : alpha('#FFFFFF', 0.04),
                    border: `1px solid ${alpha(theme.palette.divider, isLight ? 0.9 : 0.4)}`,
                    borderRadius: '12px',
                    display: 'flex',
                    flex: 1,
                    flexDirection: 'column',
                    gap: 0.25,
                    py: 1.1,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      color: theme.palette.text.primary,
                      display: 'flex',
                      gap: 0.6,
                    }}
                  >
                    <PeopleAltRoundedIcon sx={{ fontSize: 18 }} />
                    <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }}>
                      {memberCount}
                    </Typography>
                  </Box>
                  <Typography sx={sectionLabelSx}>
                    {t('core:member', {
                      count: memberCount,
                      defaultValue: 'Members',
                    })}
                  </Typography>
                </Box>

                <Box
                  sx={{
                    alignItems: 'center',
                    bgcolor: isLight
                      ? alpha(theme.palette.primary.main, 0.06)
                      : alpha('#FFFFFF', 0.04),
                    border: `1px solid ${alpha(theme.palette.divider, isLight ? 0.9 : 0.4)}`,
                    borderRadius: '12px',
                    display: 'flex',
                    flex: 1,
                    flexDirection: 'column',
                    gap: 0.25,
                    py: 1.1,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      color: theme.palette.text.primary,
                      display: 'flex',
                      gap: 0.6,
                    }}
                  >
                    <AdminPanelSettingsRoundedIcon sx={{ fontSize: 18 }} />
                    <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }}>
                      {admins.length}
                    </Typography>
                  </Box>
                  <Typography sx={sectionLabelSx}>
                    {t('core:admin', {
                      count: admins.length,
                      defaultValue: 'Admins',
                    })}
                  </Typography>
                </Box>
              </Box>

              {info?.description && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ ...sectionLabelSx, mb: 0.6 }}>
                    {t('core:description', { defaultValue: 'Description' })}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: '0.88rem',
                      lineHeight: 1.55,
                      wordBreak: 'break-word',
                    }}
                  >
                    {info.description}
                  </Typography>
                </Box>
              )}

              {admins.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ ...sectionLabelSx, mb: 0.4 }}>
                    {t('core:admin_other', { defaultValue: 'Admins' })}
                  </Typography>
                  <Box>
                    {admins
                      .slice(0, MAX_LISTED)
                      .map((a) => renderPerson(a.name, a.address))}
                  </Box>
                </Box>
              )}

              {nonAdminMembers.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ ...sectionLabelSx, mb: 0.4 }}>
                    {t('core:member_other', { defaultValue: 'Members' })}
                  </Typography>
                  <Box sx={{ pr: 0.5 }}>
                    {nonAdminMembers
                      .slice(0, MAX_LISTED)
                      .map((m) => renderPerson(m.primaryName, m.member))}
                    {nonAdminMembers.length > MAX_LISTED && (
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.8rem',
                          mt: 0.8,
                        }}
                      >
                        {t('core:and_more', {
                          count: nonAdminMembers.length - MAX_LISTED,
                          defaultValue: `+${nonAdminMembers.length - MAX_LISTED} more`,
                        })}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AvatarPreviewModal
        open={previewOpen}
        src={avatarPreviewUrl}
        alt={groupName || 'Group'}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
};
