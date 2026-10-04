import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { useTheme, type AvatarProps } from '@mui/material';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { getNotificationAppIcon } from '../../utils/notificationAppIcon';
import { getBaseApiReact } from '../../utils/globalApi';
import { QdnNameAvatar } from '../common/QdnNameAvatar';

type NotificationAppAvatarProps = Omit<AvatarProps, 'src' | 'children'> & {
  notification: { appName?: unknown; image?: unknown } | null | undefined;
  isQChatMention: boolean;
  isQMail: boolean;
};

/**
 * App icon of a bell notification: the app's QDN avatar from the device
 * cache (or its bundled icon), another image of the user's own node, or the
 * fallback (mail icon for Q-Mail, else the small Qortal logo). Q-Chat
 * mentions and images on other hosts show the fallback without a request.
 */
export function NotificationAppAvatar({
  notification,
  isQChatMention,
  isQMail,
  ...rest
}: NotificationAppAvatarProps) {
  const theme = useTheme();
  const appIcon = getNotificationAppIcon(notification, {
    isQChatMention,
    getApiBase: getBaseApiReact,
  });
  // The bundled logo is the fallback below too, at its usual small size.
  const overrideSrc = appIcon.src === LogoSelected ? '' : appIcon.src;
  return (
    <QdnNameAvatar
      {...rest}
      avatarName={appIcon.avatar?.name}
      avatarIdentifier={appIcon.avatar?.identifier}
      overrideSrc={overrideSrc}
    >
      {isQMail ? (
        <MailOutlineIcon
          sx={{
            color: theme.palette.primary.main,
            fontSize: 18,
          }}
        />
      ) : (
        <img alt="" src={LogoSelected} style={{ height: 'auto', width: 20 }} />
      )}
    </QdnNameAvatar>
  );
}
