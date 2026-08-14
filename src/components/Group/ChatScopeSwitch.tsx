import { Box, ButtonBase, useTheme } from '@mui/material';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import type { ReactNode } from 'react';
import { ReticulumUnreadCountBadge } from '../common/ReticulumUnreadCountBadge';

export type ChatScope = 'groups' | 'directs';

/**
 * Segmented Groups / DMs switch for the top-left of the mobile list headers.
 *
 * Both list views show the same control in the same spot so switching scope
 * never depends on remembering where a back arrow leads.
 */
export function ChatScopeSwitch({
  directHasUnread = false,
  directUnreadCount = 0,
  onChange,
  value,
}: {
  directHasUnread?: boolean;
  directUnreadCount?: number;
  onChange: (scope: ChatScope) => void;
  value: ChatScope;
}) {
  const theme = useTheme();

  const segment = (
    scope: ChatScope,
    label: string,
    icon: ReactNode,
    badge?: ReactNode
  ) => {
    const active = value === scope;
    return (
      <ButtonBase
        aria-label={label}
        aria-pressed={active}
        onClick={() => {
          if (!active) onChange(scope);
        }}
        sx={{
          alignItems: 'center',
          backgroundColor: active
            ? theme.palette.background.paper
            : 'transparent',
          borderRadius: '7px',
          boxShadow: active ? theme.shadows[1] : 'none',
          color: active ? 'text.primary' : 'text.secondary',
          display: 'flex',
          gap: '5px',
          fontFamily: 'Inter',
          fontSize: 12,
          fontWeight: 700,
          height: 30,
          justifyContent: 'center',
          overflow: 'visible',
          position: 'relative',
          px: 1.1,
          transition: 'background-color 160ms ease, color 160ms ease',
        }}
      >
        {icon}
        {label}
        {badge}
      </ButtonBase>
    );
  };

  return (
    <Box
      role="group"
      sx={{
        backgroundColor: theme.palette.action.hover,
        borderRadius: '9px',
        display: 'flex',
        flexShrink: 0,
        gap: '2px',
        overflow: 'visible',
        p: '2px',
      }}
    >
      {segment(
        'groups',
        'Groups',
        <ForumRoundedIcon sx={{ fontSize: 16 }} />
      )}
      {segment(
        'directs',
        'DMs',
        <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 16 }} />,
        directHasUnread ? (
          <ReticulumUnreadCountBadge
            count={directUnreadCount}
            outlineColor={
              value === 'directs'
                ? theme.palette.background.paper
                : theme.palette.action.hover
            }
            sx={{
              position: 'absolute',
              right: -5,
              top: -6,
              zIndex: 2,
            }}
          />
        ) : null
      )}
    </Box>
  );
}
