import { Box, ButtonBase, useTheme } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ReticulumUnreadCountBadge } from '../common/ReticulumUnreadCountBadge';
import {
  CHAT_LIST_HEADER_CONTAINER,
  CHAT_LIST_HEADER_NARROW_PX,
  CHAT_SCOPE_PILL_INSET,
  CHAT_SCOPE_SEGMENT_HEIGHT,
} from './chatListRowStyles';

export type ChatScope = 'groups' | 'directs';

/**
 * Segmented Groups / DMs switch for the top-left of the mobile list headers.
 *
 * Both list views show the same control in the same spot so switching scope
 * never depends on remembering where a back arrow leads. Each segment is a
 * full 44px touch target; the active pill is drawn 2px inside it. The labels
 * carry the switch on their own: segment icons did not fit beside both labels
 * and three header buttons when the list is swiped in over an open chat, and
 * one look in both places reads better than icons that come and go.
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
  const { t } = useTranslation(['reticulum']);

  const segment = (
    scope: ChatScope,
    label: string,
    badge?: ReactNode,
    dataTour?: string
  ) => {
    const active = value === scope;
    return (
      <ButtonBase
        aria-label={label}
        aria-pressed={active}
        data-tour={dataTour}
        onClick={() => {
          if (!active) onChange(scope);
        }}
        sx={{
          alignItems: 'center',
          borderRadius: '9px',
          color: active ? 'text.primary' : 'text.secondary',
          display: 'flex',
          flex: '0 1 auto',
          fontFamily: 'Inter',
          fontSize: 14,
          fontWeight: 700,
          height: CHAT_SCOPE_SEGMENT_HEIGHT,
          // The pill below paints under the label and the ripple.
          isolation: 'isolate',
          justifyContent: 'center',
          minWidth: 0,
          overflow: 'visible',
          position: 'relative',
          px: 1.5,
          transition: 'color 160ms ease',
          '&::before': {
            backgroundColor: active
              ? theme.palette.background.paper
              : 'transparent',
            borderRadius: '9px',
            bottom: CHAT_SCOPE_PILL_INSET,
            boxShadow: active ? theme.shadows[1] : 'none',
            content: '""',
            left: 0,
            position: 'absolute',
            right: 0,
            top: CHAT_SCOPE_PILL_INSET,
            transition: 'background-color 160ms ease',
            zIndex: -1,
          },
          // Only on the narrowest headers (the swiped-in list on a small
          // phone): tighter sides keep both labels whole.
          [`@container ${CHAT_LIST_HEADER_CONTAINER} (max-width: ${
            CHAT_LIST_HEADER_NARROW_PX - 0.05
          }px)`]: { px: 1 },
        }}
      >
        {/* Long translations shorten rather than push the header buttons
            off a narrow phone. */}
        <Box
          component="span"
          sx={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Box>
        {badge}
      </ButtonBase>
    );
  };

  return (
    <Box
      role="group"
      aria-label={t('reticulum:chat_scope.label', {
        postProcess: 'capitalizeFirstChar',
      })}
      sx={{
        backgroundColor: theme.palette.action.hover,
        borderRadius: '11px',
        display: 'flex',
        flexShrink: 1,
        gap: '2px',
        minWidth: 0,
        overflow: 'visible',
        // No vertical padding: the segments themselves fill the track's
        // height so the whole bar is tappable.
        px: `${CHAT_SCOPE_PILL_INSET}px`,
      }}
    >
      {segment(
        'groups',
        t('reticulum:chat_scope.groups', {
          postProcess: 'capitalizeFirstChar',
        })
      )}
      {segment(
        'directs',
        t('reticulum:chat_scope.direct_messages', {
          postProcess: 'capitalizeFirstChar',
        }),
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
              // Same spot on the pill as before the segment grew to the
              // full track height.
              top: -6 + CHAT_SCOPE_PILL_INSET,
              zIndex: 2,
            }}
          />
        ) : null,
        // The onboarding tour points at the DMs segment on phones (the
        // desktop rail has its own anchor).
        'hub-direct-messages'
      )}
    </Box>
  );
}
