import { type ReactNode } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Switch,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useTranslation } from 'react-i18next';
import {
  getDoubleTapReaction,
  OTHER_CHATS_KEY,
  resetQuickReactions,
  setQuickReactionMode,
  type ReactionPrefs,
} from './reactionPreferences';

/** What a tap in the settings asks the emoji grid to pick for. */
export type ReactionPickTarget =
  | { kind: 'double_tap'; chatKey: string }
  | { kind: 'quick_slot'; slot: number };

type ReactionSettingsPanelProps = {
  width: number;
  height: number;
  /** This DM or group; without one only the all-chats choice shows. */
  chatKey?: string;
  prefs: ReactionPrefs;
  /** What the pill shows now (the most-used ones when that is on). */
  quickReactions: readonly string[];
  onBack: () => void;
  onPick: (target: ReactionPickTarget) => void;
};

const EmojiButton = ({
  emoji,
  label,
  onClick,
  disabled = false,
  ringed = false,
  fluid = false,
}: {
  emoji: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  ringed?: boolean;
  /** Fills its grid cell (up to 44px) instead of a fixed 44px. */
  fluid?: boolean;
}) => {
  const theme = useTheme();
  return (
    <ButtonBase
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      sx={{
        backgroundColor: alpha(
          theme.palette.text.primary,
          theme.palette.mode === 'dark' ? 0.08 : 0.06
        ),
        borderRadius: '50%',
        boxShadow: ringed
          ? `inset 0 0 0 2px ${theme.palette.primary.main}`
          : 'none',
        aspectRatio: '1',
        flexShrink: 0,
        fontSize: fluid ? '22px' : '24px',
        justifySelf: 'center',
        lineHeight: 1,
        maxWidth: 44,
        opacity: disabled ? 0.55 : 1,
        width: fluid ? '100%' : 44,
        '&:active': { transform: 'scale(0.9)' },
        transition: 'transform 120ms ease',
      }}
    >
      {emoji}
    </ButtonBase>
  );
};

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <Typography
    sx={{
      color: 'primary.main',
      fontSize: '12.5px',
      fontWeight: 700,
      letterSpacing: '0.02em',
      pb: '4px',
      pt: '14px',
      px: '16px',
    }}
  >
    {children}
  </Typography>
);

const SettingRow = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) => (
  <Box
    sx={{
      alignItems: 'center',
      display: 'flex',
      gap: '12px',
      minHeight: 52,
      px: '16px',
    }}
  >
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: '15px', fontWeight: 500, lineHeight: 1.3 }}>
        {label}
      </Typography>
      {hint && (
        <Typography
          sx={{ color: 'text.secondary', fontSize: '12.5px', lineHeight: 1.3 }}
        >
          {hint}
        </Typography>
      )}
    </Box>
    {children}
  </Box>
);

/**
 * Reaction settings inside the expanded emoji panel (the gear): the double
 * tap emoji for this chat and for all others, and the pill's quick
 * reactions, either chosen one by one or the viewer's most used.
 */
export const ReactionSettingsPanel = ({
  width,
  height,
  chatKey,
  prefs,
  quickReactions,
  onBack,
  onPick,
}: ReactionSettingsPanelProps) => {
  const { t } = useTranslation(['core', 'group']);
  const capitalized = { postProcess: 'capitalizeFirstChar' } as const;
  const mostUsed = prefs.quickMode === 'most_used';
  const thisChat = getDoubleTapReaction(prefs, chatKey);
  const otherChats = getDoubleTapReaction(prefs, OTHER_CHATS_KEY);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height,
        width,
        '@keyframes reactionSettingsIn': {
          from: { opacity: 0, transform: 'translateX(14px)' },
          to: { opacity: 1, transform: 'none' },
        },
        animation: 'reactionSettingsIn 200ms ease-out both',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          gap: '4px',
          height: 48,
          pl: '4px',
          pr: '12px',
        }}
      >
        <IconButton
          aria-label={t('core:action.back', capitalized)}
          onClick={onBack}
          size="small"
          sx={{ height: 40, width: 40 }}
        >
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography noWrap sx={{ fontSize: '16px', fontWeight: 600 }}>
          {t('group:message_item.reaction_settings', capitalized)}
        </Typography>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          pb: '10px',
        }}
      >
        <SectionTitle>
          {t('group:message_item.double_tap_reaction', capitalized)}
        </SectionTitle>
        {chatKey && (
          <SettingRow label={t('group:message_item.this_chat', capitalized)}>
            <EmojiButton
              emoji={thisChat}
              label={t('group:message_item.change_double_tap_this_chat', {
                ...capitalized,
                emoji: thisChat,
              })}
              onClick={() => onPick({ kind: 'double_tap', chatKey })}
              ringed
            />
          </SettingRow>
        )}
        <SettingRow
          label={t(
            chatKey
              ? 'group:message_item.other_chats'
              : 'group:message_item.all_chats',
            capitalized
          )}
        >
          <EmojiButton
            emoji={otherChats}
            label={t('group:message_item.change_double_tap_other_chats', {
              ...capitalized,
              emoji: otherChats,
            })}
            onClick={() =>
              onPick({ kind: 'double_tap', chatKey: OTHER_CHATS_KEY })
            }
          />
        </SettingRow>
        <Typography
          sx={{
            color: 'text.secondary',
            fontSize: '12.5px',
            lineHeight: 1.35,
            px: '16px',
            pb: '2px',
          }}
        >
          {t('group:message_item.double_tap_long_press_hint', capitalized)}
        </Typography>

        <SectionTitle>
          {t('group:message_item.quick_reactions', capitalized)}
        </SectionTitle>
        <SettingRow
          hint={t('group:message_item.most_used_hint', capitalized)}
          label={t('group:message_item.most_used', capitalized)}
        >
          <Switch
            checked={mostUsed}
            inputProps={{
              'aria-label': t('group:message_item.most_used', capitalized),
            }}
            onChange={(event) =>
              setQuickReactionMode(
                event.target.checked ? 'most_used' : 'custom'
              )
            }
          />
        </SettingRow>
        <Box
          role="group"
          aria-label={t('group:message_item.quick_reactions', capitalized)}
          sx={{
            display: 'grid',
            gap: '4px',
            // Every slot on one line, however narrow the panel.
            gridTemplateColumns: `repeat(${quickReactions.length}, minmax(0, 1fr))`,
            px: '12px',
            py: '6px',
          }}
        >
          {quickReactions.map((emoji, slot) => (
            <EmojiButton
              disabled={mostUsed}
              emoji={emoji}
              fluid
              key={`${slot}-${emoji}`}
              label={t('group:message_item.change_quick_reaction', {
                ...capitalized,
                emoji,
                number: slot + 1,
              })}
              onClick={() => onPick({ kind: 'quick_slot', slot })}
            />
          ))}
        </Box>
        {!mostUsed && (
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: '12.5px',
              lineHeight: 1.35,
              px: '16px',
            }}
          >
            {t('group:message_item.quick_reactions_hint', capitalized)}
          </Typography>
        )}
        <Box sx={{ px: '8px', pt: '6px' }}>
          <Button onClick={resetQuickReactions} size="small">
            {t('group:message_item.reset_quick_reactions', capitalized)}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};
