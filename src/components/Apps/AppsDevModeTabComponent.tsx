import { TabParent } from './Apps-styles';
import { NavCloseTab } from '../../assets/Icons/NavCloseTab.tsx';
import { Avatar, ButtonBase } from '@mui/material';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { useQdnAvatar } from '../../lib/qdnAvatars';
import { executeEvent } from '../../utils/events';

export const AppsDevModeTabComponent = ({ isSelected, app }) => {
  // Cached QDN icon of a published app; the Qortal logo while there is none.
  const { src: qdnIconSrc } = useQdnAvatar(app?.name, {
    enabled: !app?.customIcon && !!app?.service,
  });
  return (
    <ButtonBase
      onClick={() => {
        if (isSelected) {
          executeEvent('removeTabDevMode', {
            data: app,
          });
          return;
        }
        executeEvent('open-dev-mode', {});
        executeEvent('setSelectedTabDevMode', {
          data: app,
          isDevMode: true,
        });
      }}
    >
      <TabParent
        sx={{
          border: isSelected && '1px solid #FFFFFF',
        }}
      >
        {isSelected && (
          <NavCloseTab
            style={{
              position: 'absolute',
              top: '-5px',
              right: '-5px',
              zIndex: 1,
            }}
          />
        )}
        <Avatar
          sx={{
            height: '28px',
            width: '28px',
          }}
          alt=""
          src={``}
        >
          <img
            style={{
              width: '28px',
              height: 'auto',
            }}
            src={app?.customIcon || qdnIconSrc || LogoSelected}
            alt="center-icon"
          />
        </Avatar>
      </TabParent>
    </ButtonBase>
  );
};
