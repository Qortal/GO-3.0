import {
  Box,
  ButtonBase,
  Dialog,
  IconButton,
  InputAdornment,
  LinearProgress,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { SAFE_AREA_BOTTOM } from '../../utils/mobileSafeArea';
import { MobilePanelHeader } from '../Mobile/MobilePanelHeader';
import { DirectRowAvatar } from './DirectRowAvatar';
import { formatEmailDate } from './qmailUtils';
import { CHAT_LIST_AVATAR_SIZE } from './chatListRowStyles';
import {
  DM_SEARCH_FETCH_LIMIT,
  DM_SEARCH_MIN_LENGTH,
  directSearchHits,
  directSearchSnippet,
  type DirectSearchEvent,
  type DirectSearchHit,
} from './directMessageSearch';

/** Typing pause before a search runs. */
const SEARCH_DEBOUNCE_MS = 250;

type SearchStatus = 'idle' | 'searching' | 'done' | 'unavailable';

interface DirectListEntry {
  address?: string;
  name?: string;
  savedMessages?: boolean;
}

export interface DirectMessageSearchPanelProps {
  open: boolean;
  onClose: () => void;
  myAddress: string;
  /** The DM list: names (and Saved Messages) for the results. */
  directs: readonly DirectListEntry[];
  /** A result was tapped: open that chat at that message. */
  onOpenResult: (hit: DirectSearchHit, direct: DirectListEntry) => void;
}

/**
 * Search the text of every DM on this device: newest matches first, each
 * with who it is with, when, and the words around the match. Tapping one
 * opens that chat at the message. Phones get it full screen with the panel
 * header the group panels use; Android back closes it.
 */
export function DirectMessageSearchPanel({
  open,
  onClose,
  myAddress,
  directs,
  onOpenResult,
}: DirectMessageSearchPanelProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group', 'reticulum']);
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [hits, setHits] = useState<DirectSearchHit[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const requestRef = useRef(0);

  useAndroidBack(
    () => {
      onClose();
      return true;
    },
    { priority: BACK_PRIORITY.dialog, enabled: open }
  );

  // A new search each time it opens.
  useEffect(() => {
    if (open) return;
    requestRef.current += 1;
    setQuery('');
    setSearchedQuery('');
    setHits([]);
    setStatus('idle');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    const request = requestRef.current + 1;
    requestRef.current = request;
    if (trimmed.length < DM_SEARCH_MIN_LENGTH) {
      setHits([]);
      setSearchedQuery('');
      setStatus('idle');
      return;
    }
    const search = window.reticulumChat?.searchDirectMessages;
    if (typeof search !== 'function' || !myAddress) {
      setStatus('unavailable');
      return;
    }
    setStatus('searching');
    const timer = window.setTimeout(() => {
      void search(myAddress, trimmed, DM_SEARCH_FETCH_LIMIT)
        .then((events) => {
          if (requestRef.current !== request) return;
          setHits(
            directSearchHits(
              Array.isArray(events) ? (events as DirectSearchEvent[]) : [],
              trimmed,
              myAddress
            )
          );
          setSearchedQuery(trimmed);
          setStatus('done');
        })
        .catch(() => {
          if (requestRef.current !== request) return;
          setHits([]);
          setStatus('unavailable');
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [myAddress, open, query]);

  const directsByAddress = useMemo(() => {
    const map = new Map<string, DirectListEntry>();
    for (const direct of directs) {
      if (direct?.address) map.set(direct.address, direct);
    }
    return map;
  }, [directs]);

  const directFor = (address: string): DirectListEntry =>
    directsByAddress.get(address) ?? { address };

  const shortAddress = (address: string) =>
    address.length > 14
      ? `${address.slice(0, 6)}…${address.slice(-4)}`
      : address;

  const message = (() => {
    const sentence = { postProcess: 'capitalizeFirstChar' };
    if (status === 'unavailable') {
      return t('reticulum:dm_search.unavailable', sentence);
    }
    if (status === 'idle') return t('reticulum:dm_search.hint', sentence);
    if (status === 'done' && hits.length === 0) {
      return t('reticulum:dm_search.empty', sentence);
    }
    return '';
  })();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isPhone}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          backgroundColor: 'background.paper',
          backgroundImage: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          ...(isPhone
            ? { paddingBottom: SAFE_AREA_BOTTOM }
            : {
                borderRadius: '12px',
                height: 'min(720px, calc(100vh - 64px))',
              }),
        },
      }}
    >
      <MobilePanelHeader
        icon={<SearchRoundedIcon />}
        title={t('reticulum:dm_search.title', {
          postProcess: 'capitalizeFirstChar',
        })}
        onClose={onClose}
        safeAreaTop={isPhone}
      />
      <Box sx={{ flexShrink: 0, px: 1.5, pt: 1.5, pb: 1 }}>
        <TextField
          autoFocus
          fullWidth
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter puts the keyboard away so the results show.
            if (event.key === 'Enter') {
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder={t('reticulum:dm_search.placeholder', {
            postProcess: 'capitalizeFirstChar',
          })}
          slotProps={{
            htmlInput: {
              'aria-label': t('reticulum:dm_search.title', {
                postProcess: 'capitalizeFirstChar',
              }),
              autoCapitalize: 'off',
              autoCorrect: 'off',
              enterKeyHint: 'search',
              spellCheck: false,
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={t('reticulum:dm_search.clear', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    edge="end"
                    onClick={() => setQuery('')}
                    sx={{ height: 40, width: 40 }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </InputAdornment>
              ) : null,
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              backgroundColor: theme.palette.action.hover,
              borderRadius: '12px',
              fontSize: 16,
              minHeight: 48,
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'transparent',
            },
          }}
        />
      </Box>
      <Box sx={{ flexShrink: 0, height: 2 }}>
        {status === 'searching' && <LinearProgress sx={{ height: 2 }} />}
      </Box>
      <Box
        role="list"
        aria-busy={status === 'searching'}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          px: 1,
          py: 0.5,
        }}
      >
        {message ? (
          <Box
            sx={{
              alignItems: 'center',
              color: 'text.secondary',
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              px: 3,
              py: 6,
              textAlign: 'center',
            }}
          >
            <SearchRoundedIcon sx={{ fontSize: 44, opacity: 0.35 }} />
            <Typography sx={{ fontSize: 15 }}>{message}</Typography>
          </Box>
        ) : null}
        {hits.map((hit) => {
          const direct = directFor(hit.peerAddress);
          const label = direct.name || shortAddress(hit.peerAddress);
          const snippet = directSearchSnippet(hit.text, searchedQuery);
          return (
            <ButtonBase
              key={hit.messageId}
              role="listitem"
              onClick={() => onOpenResult(hit, direct)}
              sx={{
                alignItems: 'center',
                borderRadius: '12px',
                display: 'flex',
                gap: 1.5,
                justifyContent: 'flex-start',
                minHeight: 68,
                px: 1.25,
                py: 1,
                textAlign: 'left',
                width: '100%',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <DirectRowAvatar
                name={direct.savedMessages ? undefined : direct.name}
                label={label}
                savedMessages={direct.savedMessages === true}
                size={CHAT_LIST_AVATAR_SIZE}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box
                  sx={{
                    alignItems: 'baseline',
                    display: 'flex',
                    gap: 1,
                    minWidth: 0,
                  }}
                >
                  <Typography
                    noWrap
                    sx={{
                      color: 'text.primary',
                      flex: 1,
                      fontSize: 15,
                      fontWeight: 700,
                      minWidth: 0,
                    }}
                  >
                    {label}
                  </Typography>
                  <Typography
                    sx={{
                      color: 'text.secondary',
                      flexShrink: 0,
                      fontSize: 12,
                    }}
                  >
                    {hit.timestamp ? formatEmailDate(hit.timestamp) : ''}
                  </Typography>
                </Box>
                <Typography
                  component="div"
                  sx={{
                    color: 'text.secondary',
                    display: '-webkit-box',
                    fontSize: 14,
                    lineHeight: 1.4,
                    mt: 0.25,
                    overflow: 'hidden',
                    overflowWrap: 'anywhere',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                  }}
                >
                  {hit.fromMe && (
                    <Box
                      component="span"
                      sx={{ color: 'text.primary', fontWeight: 600 }}
                    >
                      {`${t('group:last_message_you')}: `}
                    </Box>
                  )}
                  {snippet.before}
                  {snippet.match && (
                    <Box
                      component="mark"
                      sx={{
                        backgroundColor: alpha(theme.palette.primary.main, 0.2),
                        borderRadius: '4px',
                        color: 'text.primary',
                        fontWeight: 700,
                        px: '2px',
                      }}
                    >
                      {snippet.match}
                    </Box>
                  )}
                  {snippet.after}
                </Typography>
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Dialog>
  );
}
