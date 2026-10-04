import { useCallback, useContext, useEffect, useState } from 'react';
import Logo2 from '../../assets/svgs/Logo2.svg';
import {
  QORTAL_APP_CONTEXT,
  getArbitraryEndpointReact,
  getBaseApiReact,
} from '../../App';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogContent,
  DialogTitle,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import { Spacer } from '../../common/Spacer';
import ImageUploader from '../../common/ImageUploader';
import { getFee } from '../../background/background.ts';
import { fileToBase64 } from '../../utils/fileReading';
import { LoadingButton } from '@mui/lab';
import ErrorIcon from '@mui/icons-material/Error';
import { useTranslation } from 'react-i18next';
import { MAX_SIZE_AVATAR } from '../../constants/constants.ts';
import {
  putQdnAvatarImage,
  qdnGroupAvatarIdentifier,
  useQdnGroupAvatar,
} from '../../lib/qdnAvatars';
import {
  buildGroupAvatarPreviewUrl,
  noteAvatarPublishedHere,
} from '../Group/avatarPreviewUrls';
import { useFullSizeAvatarSrc } from '../Group/useFullSizeAvatarSrc';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getClickableAvatarSx } from './clickableAvatarStyles';

export const GroupAvatar = ({
  myName,
  balance,
  setOpenSnack,
  setInfoSnack,
  groupId,
  dialogOpen = false,
  externalOnly = false,
  onDialogClose,
}) => {
  const [hasAvatar, setHasAvatar] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [tempAvatar, setTempAvatar] = useState(null);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  // What the preview shows: the avatar just published from here (a local
  // image), or the cached avatar with the full size loaded from the node.
  const [previewKind, setPreviewKind] = useState<'published' | 'cached' | null>(
    null
  );
  const [previewFullUrl, setPreviewFullUrl] = useState<string | null>(null);
  // Handle child element click to open Popover
  const handleChildClick = (event) => {
    event.stopPropagation(); // Prevent parent onClick from firing
    setAnchorEl(event.currentTarget);
  };

  // Handle closing the Popover
  const handleClose = () => {
    setAnchorEl(null);
    onDialogClose?.();
  };

  // Determine if the popover is open
  const open = Boolean(anchorEl) || dialogOpen;
  const id = open ? 'avatar-img' : undefined;

  // Shows the device copy at once; the node only refreshes it.
  const { src: cachedAvatarSrc } = useQdnGroupAvatar(myName, groupId, {
    enabled: !externalOnly,
  });

  const checkIfAvatarExists = useCallback(async (name, groupId) => {
    try {
      const identifier = qdnGroupAvatarIdentifier(groupId);
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=THUMBNAIL&identifier=${identifier}&limit=1&name=${name}&includemetadata=false&prefix=true`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();
      if (responseData?.length > 0) {
        setHasAvatar(true);
      }
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    // Only the avatar view needs to know; the publish dialog does not.
    if (externalOnly || !myName || !groupId) return;
    checkIfAvatarExists(myName, groupId);
  }, [myName, groupId, checkIfAvatarExists, externalOnly]);

  // The avatar shows the cached copy (at most 128 px); only the preview
  // loads the full size from the node, the cached copy showing until then.
  const fullSizePreviewSrc = useFullSizeAvatarSrc(
    previewKind === 'cached' ? cachedAvatarSrc : undefined,
    previewFullUrl,
    previewKind === 'cached'
  );
  const shownPreviewSrc =
    previewKind === 'published' ? tempAvatar : fullSizePreviewSrc;

  const openPublishedPreview = useCallback(() => {
    if (!tempAvatar) return;
    setPreviewFullUrl(null);
    setPreviewKind('published');
  }, [tempAvatar]);

  const openCachedPreview = useCallback(() => {
    if (!cachedAvatarSrc) return;
    // Read the node address now: the user can switch nodes.
    setPreviewFullUrl(
      buildGroupAvatarPreviewUrl(getBaseApiReact(), myName, groupId)
    );
    setPreviewKind('cached');
  }, [cachedAvatarSrc, myName, groupId]);

  const closePreview = useCallback(() => {
    setPreviewKind(null);
    setPreviewFullUrl(null);
  }, []);

  // The cached image went away (cache cleared): close the preview so it does
  // not pop up again when an image arrives later.
  useEffect(() => {
    if (previewKind === 'cached' && !cachedAvatarSrc) closePreview();
  }, [previewKind, cachedAvatarSrc, closePreview]);

  const avatarPreviewModal = (
    <AvatarPreviewModal
      open={Boolean(previewKind && shownPreviewSrc)}
      src={shownPreviewSrc}
      alt={myName}
      onClose={closePreview}
    />
  );

  const publishAvatar = async () => {
    try {
      if (!groupId) return;
      const fee = await getFee('ARBITRARY');

      if (+balance < +fee.fee)
        throw new Error(
          t('core:message.generic.avatar_publish_fee', {
            fee: fee.fee,
            postProcess: 'capitalizeFirstChar',
          })
        );

      await show({
        message: t('core:message.question.publish_avatar', {
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoading(true);
      const avatarBase64 = await fileToBase64(avatarFile);

      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: avatarBase64,
            identifier: qdnGroupAvatarIdentifier(groupId),
            service: 'THUMBNAIL',
            uploadType: 'base64',
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
      const publishedAvatar = `data:image/webp;base64,${avatarBase64}`;
      // Every group list shows the new avatar at once, not the old cached
      // one, and previews do not swap in the old file the node still has.
      void putQdnAvatarImage(myName, publishedAvatar, {
        identifier: qdnGroupAvatarIdentifier(groupId),
      });
      noteAvatarPublishedHere(myName, qdnGroupAvatarIdentifier(groupId));
      setAvatarFile(null);
      setTempAvatar(publishedAvatar);
      handleClose();
    } catch (error) {
      if (error?.message) {
        setOpenSnack(true);
        setInfoSnack({
          type: 'error',
          message: error?.message,
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (externalOnly) {
    return (
      <>
        <PopoverComp
          myName={myName}
          avatarFile={avatarFile}
          setAvatarFile={setAvatarFile}
          id={id}
          open={open}
          anchorEl={anchorEl}
          handleClose={handleClose}
          publishAvatar={publishAvatar}
          isLoading={isLoading}
          dialogOpen={dialogOpen}
        />
        {avatarPreviewModal}
      </>
    );
  }

  if (tempAvatar) {
    return (
      <>
        <Avatar
          sx={{
            height: '138px',
            width: '138px',
            ...getClickableAvatarSx(theme, Boolean(tempAvatar)),
          }}
          src={tempAvatar}
          alt={myName}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openPublishedPreview();
          }}
        >
          {myName?.charAt(0)}
        </Avatar>

        <ButtonBase onClick={handleChildClick}>
          <Typography
            sx={{
              fontSize: '16px',
              opacity: 0.5,
            }}
          >
            {t('core:action.change_avatar', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </ButtonBase>

        <PopoverComp
          myName={myName}
          avatarFile={avatarFile}
          setAvatarFile={setAvatarFile}
          id={id}
          open={open}
          anchorEl={anchorEl}
          handleClose={handleClose}
          publishAvatar={publishAvatar}
          isLoading={isLoading}
          dialogOpen={false}
        />
        {avatarPreviewModal}
      </>
    );
  }

  if (hasAvatar || cachedAvatarSrc) {
    const canPreview = Boolean(cachedAvatarSrc);
    return (
      <>
        <Avatar
          sx={{
            height: '138px',
            width: '138px',
            ...getClickableAvatarSx(theme, canPreview),
          }}
          src={cachedAvatarSrc}
          alt={myName}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (canPreview) openCachedPreview();
          }}
        >
          {myName?.charAt(0)}
        </Avatar>

        <ButtonBase onClick={handleChildClick}>
          <Typography
            sx={{
              fontSize: '16px',
              opacity: 0.5,
            }}
          >
            {t('core:action.change_avatar', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </ButtonBase>

        <PopoverComp
          myName={myName}
          avatarFile={avatarFile}
          setAvatarFile={setAvatarFile}
          id={id}
          open={open}
          anchorEl={anchorEl}
          handleClose={handleClose}
          publishAvatar={publishAvatar}
          isLoading={isLoading}
          dialogOpen={false}
        />
        {avatarPreviewModal}
      </>
    );
  }

  return (
    <>
      <img src={Logo2} />
      <ButtonBase onClick={handleChildClick}>
        <Typography
          sx={{
            fontSize: '16px',
            opacity: 0.5,
          }}
        >
          {t('core:action.set_avatar', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
      </ButtonBase>

      <PopoverComp
        myName={myName}
        avatarFile={avatarFile}
        setAvatarFile={setAvatarFile}
        id={id}
        open={open}
        anchorEl={anchorEl}
        handleClose={handleClose}
        publishAvatar={publishAvatar}
        isLoading={isLoading}
        dialogOpen={false}
      />
      {avatarPreviewModal}
    </>
  );
};

// TODO the following part is the same as in MainAvatar.tsx
const PopoverComp = ({
  avatarFile,
  setAvatarFile,
  id,
  open,
  anchorEl,
  handleClose,
  publishAvatar,
  isLoading,
  myName,
  dialogOpen,
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);

  const content = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 2 }}>
      <Typography
        sx={{
          fontSize: '12px',
        }}
      >
        {t('core:message.generic.avatar_size', {
          size: MAX_SIZE_AVATAR,
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>

      <ImageUploader onPick={(file) => setAvatarFile(file)}>
        <Button
          variant="contained"
          sx={{
            backgroundColor: theme.palette.other.positive,
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 0.7,
            '&:hover': {
              backgroundColor: theme.palette.other.positive,
              color: 'black',
              opacity: 1,
            },
          }}
        >
          {t('core:action.choose_image', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </ImageUploader>

      {avatarFile?.name}

      <Spacer height="25px" />

      {!myName && (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '5px',
          }}
        >
          <ErrorIcon
            sx={{
              color: theme.palette.text.primary,
            }}
          />
          <Typography>
            {t('group:message.generic.avatar_registered_name', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      )}

      <Spacer height="25px" />

      <LoadingButton
        loading={isLoading}
        disabled={!avatarFile || !myName}
        onClick={publishAvatar}
        variant="contained"
        sx={{
          backgroundColor: theme.palette.other.positive,
          color: theme.palette.text.primary,
          fontWeight: 'bold',
          opacity: 0.7,
          '&:hover': {
            backgroundColor: theme.palette.other.positive,
            color: 'black',
            opacity: 1,
          },
        }}
      >
        {t('group:action.publish_avatar', {
          postProcess: 'capitalizeFirstChar',
        })}
      </LoadingButton>
    </Box>
  );

  if (dialogOpen) {
    return (
      <Dialog
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '8px',
            maxWidth: 420,
            width: 'calc(100vw - 32px)',
          },
        }}
      >
        <DialogTitle sx={{ fontSize: 19, fontWeight: 800, pb: 0.5 }}>
          Change Group Avatar
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>{content}</DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover
      id={id}
      open={open}
      anchorEl={anchorEl}
      onClose={handleClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'center',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'center',
      }}
    >
      {content}
    </Popover>
  );
};
