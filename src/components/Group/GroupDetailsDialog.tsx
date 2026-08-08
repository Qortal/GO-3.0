import { useEffect, useMemo, useReducer, useState } from 'react';
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
import {
  ensureAvatarPresence,
  isAvatarKnownPresent,
} from '../../utils/groupMemberAvatars';
import { executeEvent } from '../../utils/events';
import { formatTimestamp } from '../../utils/time';

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

type ListedPerson = {
  name?: string;
  address: string;
  joined?: number;
};

const shortenAddress = (address?: string) =>
  address && address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address || '';

const sortNewestJoinedFirst = (a: ListedPerson, b: ListedPerson) =>
  (b.joined || 0) - (a.joined || 0);

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
    { member: string; primaryName?: string; joined?: number }[]
  >([]);
  const [admins, setAdmins] = useState<
    { name: string; address: string; joined?: number }[]
  >([]);
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
  const ownerAddress = info?.owner?.trim() || '';

  const ownerPerson = useMemo<ListedPerson | null>(() => {
    if (!ownerAddress && !ownerName) return null;
    const fromMembers = members.find((m) => m.member === ownerAddress);
    return {
      address: ownerAddress || fromMembers?.member || '',
      name: ownerName || fromMembers?.primaryName || undefined,
      joined: fromMembers?.joined,
    };
  }, [ownerAddress, ownerName, members]);

  const adminAddresses = useMemo(
    () => new Set(admins.map((a) => a.address)),
    [admins]
  );

  const renderedAdmins = useMemo(
    () =>
      admins
        .filter((a) => a.address !== ownerAddress)
        .map(
          (a): ListedPerson => ({
            address: a.address,
            name: a.name || undefined,
            joined: a.joined,
          })
        )
        .sort(sortNewestJoinedFirst),
    [admins, ownerAddress]
  );

  const renderedMembers = useMemo(
    () =>
      members
        .filter(
          (m) =>
            !adminAddresses.has(m.member) && m.member !== ownerAddress
        )
        .map(
          (m): ListedPerson => ({
            address: m.member,
            name: m.primaryName,
            joined: m.joined,
          })
        )
        .sort(sortNewestJoinedFirst),
    [members, adminAddresses, ownerAddress]
  );

  // Bulk-detect which listed users actually have a published avatar so only
  // those load an image (avatar-less users render an instant local fallback
  // with zero network). Re-render as each detection batch streams in.
  const [, refreshAvatars] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!open) return;
    ensureAvatarPresence(
      [
        ownerPerson?.name,
        ...renderedAdmins.map((a) => a.name),
        ...renderedMembers.map((m) => m.name),
      ],
      refreshAvatars
    );
  }, [open, ownerPerson?.name, renderedAdmins, renderedMembers]);

  const isLight = theme.palette.mode === 'light';
  const sectionLabelSx = {
    color: theme.palette.text.secondary,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  };

  const openUserProfile = (name: string | undefined, address: string) => {
    const target = name?.trim() || address?.trim();
    if (!target) return;
    // Close the group panel first so the profile lookup sits cleanly on top.
    onClose();
    executeEvent('openUserLookupDrawer', { addressOrName: target });
  };

  const renderPerson = (
    person: ListedPerson,
    options?: { roleLabel?: string }
  ) => {
    const { name, address, joined } = person;
    const avatarSx = {
      bgcolor: alpha(theme.palette.primary.main, 0.16),
      color: theme.palette.primary.main,
      fontSize: 12,
      fontWeight: 700,
      height: 26,
      width: 26,
    };
    // Only mount an image-loading avatar for users confirmed to have one.
    const showImageAvatar = isAvatarKnownPresent(name);
    return (
      <Box
        key={address || name || options?.roleLabel}
        onClick={() => openUserProfile(name, address)}
        role="button"
        tabIndex={0}
        sx={{
          alignItems: 'center',
          borderRadius: '10px',
          cursor: 'pointer',
          display: 'flex',
          gap: 1,
          mx: -0.75,
          px: 0.75,
          py: 0.6,
          transition: 'background-color 0.15s ease',
          '&:hover': {
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
          },
          '&:active': {
            backgroundColor: alpha(theme.palette.primary.main, 0.14),
          },
        }}
      >
        {showImageAvatar ? (
          <QortalUserAvatar
            primaryName={name || undefined}
            walletAddress={address}
            fallbackIconSize={16}
            sx={avatarSx}
          />
        ) : (
          <Avatar sx={avatarSx}>
            {(name || address || '?').trim().charAt(0).toUpperCase()}
          </Avatar>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={{
              alignItems: 'baseline',
              display: 'flex',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <Typography
              sx={{
                color: name
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
                fontSize: '0.86rem',
                fontWeight: name ? 600 : 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name || shortenAddress(address)}
            </Typography>
            {options?.roleLabel ? (
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  flexShrink: 0,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {options.roleLabel}
              </Typography>
            ) : null}
          </Box>
          {joined ? (
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.72rem',
                lineHeight: 1.2,
                mt: 0.15,
              }}
            >
              {t('group:joined', {
                defaultValue: 'Joined',
              })}{' '}
              {formatTimestamp(joined)}
            </Typography>
          ) : null}
        </Box>
      </Box>
    );
  };

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

              {ownerPerson && (ownerPerson.address || ownerPerson.name) && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ ...sectionLabelSx, mb: 0.4 }}>
                    {t('core:owner', { defaultValue: 'Owner' })}
                  </Typography>
                  <Box>
                    {renderPerson(ownerPerson, {
                      roleLabel: t('core:owner', { defaultValue: 'Owner' }),
                    })}
                  </Box>
                </Box>
              )}

              {renderedAdmins.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ ...sectionLabelSx, mb: 0.4 }}>
                    {t('core:admin_other', { defaultValue: 'Admins' })}
                  </Typography>
                  <Box>
                    {renderedAdmins.map((a) => renderPerson(a))}
                  </Box>
                </Box>
              )}

              {renderedMembers.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ ...sectionLabelSx, mb: 0.4 }}>
                    {t('core:member_other', { defaultValue: 'Members' })}
                  </Typography>
                  <Box sx={{ pr: 0.5 }}>
                    {renderedMembers.map((m) => renderPerson(m))}
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
