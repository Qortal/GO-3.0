import { useEffect, useRef } from 'react';
import {
  alpha,
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  Typography,
  useTheme,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useTranslation } from 'react-i18next';
import { CachedUserAvatar } from './CachedAvatars';
import { getFallbackAvatarOutlineSx } from '../Chat/clickableAvatarStyles';
import {
  segmentsForMatch,
  shortAddressSegments,
  type MemberSearchResult,
  type MemberTextSegment,
} from './memberSearch';

const SUGGESTIONS_ID = 'members-search-suggestions';
const capitalize = { postProcess: 'capitalizeFirstChar' } as const;

type MembersSearchFieldProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /** Leave the search (the back arrow, Escape). */
  onClose: () => void;
  /** The keyboard's Enter / search key. */
  onSubmit: () => void;
  /** Suggestions are showing under the field. */
  expanded: boolean;
};

/**
 * The search row of the phone Members screen: back arrow, the field (focused
 * as soon as it opens) and a clear X once something is typed.
 */
export function MembersSearchField({
  query,
  onQueryChange,
  onClose,
  onSubmit,
  expanded,
}: MembersSearchFieldProps) {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = t('group:members_screen.search.open', capitalize);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <Box
      role="search"
      sx={{
        alignItems: 'center',
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        display: 'flex',
        flexShrink: 0,
        gap: 0.5,
        minHeight: 52,
        pl: 0.5,
        pr: 1,
      }}
    >
      <IconButton
        aria-label={t('group:members_screen.search.close', capitalize)}
        onClick={onClose}
        sx={{ flexShrink: 0, height: 40, width: 40 }}
      >
        <ArrowBackRoundedIcon />
      </IconButton>
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: alpha(
            theme.palette.text.primary,
            theme.palette.mode === 'dark' ? 0.08 : 0.06
          ),
          borderRadius: '999px',
          display: 'flex',
          flex: 1,
          gap: 0.75,
          height: 40,
          minWidth: 0,
          pl: 1.25,
          transition: 'box-shadow 120ms ease',
          '&:focus-within': {
            boxShadow: `inset 0 0 0 1.5px ${alpha(theme.palette.primary.main, 0.65)}`,
          },
        }}
      >
        <SearchRoundedIcon
          aria-hidden
          sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 20 }}
        />
        <InputBase
          inputRef={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder={label}
          inputProps={{
            'aria-autocomplete': 'list',
            'aria-controls': expanded ? SUGGESTIONS_ID : undefined,
            'aria-expanded': expanded,
            'aria-label': label,
            autoCapitalize: 'none',
            autoComplete: 'off',
            autoCorrect: 'off',
            enterKeyHint: 'search',
            role: 'combobox',
            spellCheck: false,
          }}
          sx={{
            flex: 1,
            fontSize: 15,
            minWidth: 0,
            '& input': { p: 0 },
            '& input::placeholder': { color: 'text.secondary', opacity: 1 },
          }}
        />
        {query && (
          <IconButton
            aria-label={t('group:members_screen.search.clear', capitalize)}
            onClick={() => {
              onQueryChange('');
              inputRef.current?.focus({ preventScroll: true });
            }}
            sx={{
              color: 'text.secondary',
              flexShrink: 0,
              height: 40,
              width: 40,
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 19 }} />
          </IconButton>
        )}
      </Box>
    </Box>
  );
}

/** Plain text with the typed letters brighter and bolder. */
function MatchedText({ segments }: { segments: MemberTextSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <Box
            component="span"
            key={index}
            sx={{ color: 'text.primary', fontWeight: 800 }}
          >
            {segment.text}
          </Box>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}

type MembersSearchSuggestionsProps = {
  results: MemberSearchResult[];
  /** Every match, including the ones not listed. */
  total: number;
  onPick: (address: string) => void;
  /** A tap on the dimmed list around the suggestions. */
  onDismiss: () => void;
};

/**
 * Matching members over the (dimmed) member list, best first. The first row
 * is the one the keyboard's search key picks.
 */
export function MembersSearchSuggestions({
  results,
  total,
  onPick,
  onDismiss,
}: MembersSearchSuggestionsProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const more = Math.max(0, total - results.length);
  const dark = theme.palette.mode === 'dark';
  const ownerColor = dark
    ? theme.palette.warning.light
    : theme.palette.warning.dark;
  // The app blue is too pale for small text on the light theme's paper.
  const adminColor = dark
    ? theme.palette.primary.main
    : theme.palette.info.dark;

  const roleTag = (result: MemberSearchResult) => {
    if (!result.isOwner && !result.isAdmin) return null;
    const color = result.isOwner ? ownerColor : adminColor;
    return (
      <Box
        component="span"
        sx={{
          bgcolor: alpha(color, 0.14),
          borderRadius: '6px',
          color,
          flexShrink: 0,
          fontSize: 10.5,
          fontWeight: 700,
          height: 18,
          letterSpacing: '0.02em',
          lineHeight: '18px',
          px: 0.75,
        }}
      >
        {result.isOwner
          ? t('group:group.owner', capitalize)
          : t('core:admin', capitalize)}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        inset: 0,
        position: 'absolute',
        zIndex: 3,
      }}
    >
      <Box
        aria-hidden
        onClick={onDismiss}
        sx={{
          bgcolor: alpha(theme.palette.background.default, dark ? 0.7 : 0.6),
          inset: 0,
          position: 'absolute',
        }}
      />
      <Box
        sx={{
          '@keyframes membersSearchIn': {
            from: { opacity: 0, transform: 'translateY(-6px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
          animation:
            'membersSearchIn 160ms cubic-bezier(0.22, 1, 0.36, 1) both',
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          borderRadius: '0 0 14px 14px',
          boxShadow: theme.shadows[dark ? 8 : 4],
          maxHeight: '100%',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          position: 'relative',
          py: 0.5,
        }}
      >
        {results.length === 0 ? (
          <Typography
            role="status"
            sx={{
              color: 'text.secondary',
              fontSize: 13,
              px: 2,
              py: 2,
              textAlign: 'center',
            }}
          >
            {t('group:members_screen.search.no_match')}
          </Typography>
        ) : (
          <Box
            id={SUGGESTIONS_ID}
            role="listbox"
            aria-label={t('group:members_screen.search.open', capitalize)}
          >
            {results.map((result, index) => {
              const active = index === 0;
              const addressSegments = shortAddressSegments(
                result.address,
                result.addressMatch
              );
              return (
                <ButtonBase
                  key={result.address}
                  role="option"
                  aria-selected={active}
                  onClick={() => onPick(result.address)}
                  sx={{
                    alignItems: 'center',
                    bgcolor: active
                      ? alpha(theme.palette.primary.main, dark ? 0.12 : 0.08)
                      : 'transparent',
                    display: 'flex',
                    gap: 1.25,
                    justifyContent: 'flex-start',
                    minHeight: 56,
                    px: 1.5,
                    py: 0.75,
                    textAlign: 'left',
                    transition: 'background-color 120ms ease',
                    width: '100%',
                    '&:hover, &.Mui-focusVisible': {
                      bgcolor: alpha(theme.palette.text.primary, 0.06),
                    },
                    '&:active': {
                      bgcolor: alpha(theme.palette.text.primary, 0.1),
                    },
                  }}
                >
                  <CachedUserAvatar
                    alt={result.name || result.address}
                    name={result.name || undefined}
                    countUse={false}
                    sx={{
                      flexShrink: 0,
                      height: 36,
                      width: 36,
                      ...(!result.name
                        ? getFallbackAvatarOutlineSx(theme)
                        : {}),
                    }}
                  />
                  <Box
                    component="span"
                    sx={{
                      display: 'flex',
                      flex: 1,
                      flexDirection: 'column',
                      minWidth: 0,
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: 0.75,
                        minWidth: 0,
                      }}
                    >
                      <Typography
                        component="span"
                        noWrap
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.78),
                          fontSize: 15,
                          fontWeight: 600,
                          minWidth: 0,
                        }}
                      >
                        <MatchedText
                          segments={
                            result.name
                              ? segmentsForMatch(result.name, result.nameMatch)
                              : addressSegments
                          }
                        />
                      </Typography>
                      {roleTag(result)}
                    </Box>
                    {result.name && (
                      <Typography
                        component="span"
                        noWrap
                        sx={{
                          color: 'text.secondary',
                          fontSize: 12,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        <MatchedText segments={addressSegments} />
                      </Typography>
                    )}
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>
        )}
        {more > 0 && (
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: 12,
              px: 2,
              py: 1,
              textAlign: 'center',
            }}
          >
            {t('group:members_screen.search.more', { count: more })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
