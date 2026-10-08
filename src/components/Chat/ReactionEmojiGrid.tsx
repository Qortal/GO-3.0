import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  Box,
  ButtonBase,
  CircularProgress,
  IconButton,
  InputBase,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import EmojiFlagsOutlinedIcon from '@mui/icons-material/EmojiFlagsOutlined';
import EmojiFoodBeverageOutlinedIcon from '@mui/icons-material/EmojiFoodBeverageOutlined';
import EmojiNatureOutlinedIcon from '@mui/icons-material/EmojiNatureOutlined';
import EmojiObjectsOutlinedIcon from '@mui/icons-material/EmojiObjectsOutlined';
import EmojiSymbolsOutlinedIcon from '@mui/icons-material/EmojiSymbolsOutlined';
import EmojiTransportationOutlinedIcon from '@mui/icons-material/EmojiTransportationOutlined';
import { useTranslation } from 'react-i18next';
import {
  getRecentReactionsForPicker,
  loadReactionEmojiData,
  searchReactionEmojis,
  type ReactionEmojiCategory,
  type ReactionEmojiData,
} from './reactionEmojiData';
import {
  EXPANDED_GRID_PADDING_X_PX,
  getExpandedGridColumns,
} from './messageActionsPopupLayout';

type SectionId = 'recent' | ReactionEmojiCategory;

const TAB_ICONS: Record<SectionId, ReactNode> = {
  recent: <AccessTimeRoundedIcon />,
  smileys_people: <EmojiEmotionsOutlinedIcon />,
  animals_nature: <EmojiNatureOutlinedIcon />,
  food_drink: <EmojiFoodBeverageOutlinedIcon />,
  activities: <EmojiEventsOutlinedIcon />,
  travel_places: <EmojiTransportationOutlinedIcon />,
  objects: <EmojiObjectsOutlinedIcon />,
  symbols: <EmojiSymbolsOutlinedIcon />,
  flags: <EmojiFlagsOutlinedIcon />,
};

const TAB_ORDER: SectionId[] = [
  'recent',
  'smileys_people',
  'animals_nature',
  'food_drink',
  'activities',
  'travel_places',
  'objects',
  'symbols',
  'flags',
];

const TAB_ROW_HEIGHT_PX = 46;
const SEARCH_ROW_HEIGHT_PX = 48;
const PICKER_TITLE_HEIGHT_PX = 44;
export const EMOJI_CELL_HEIGHT_PX = 42;
const SECTION_TITLE_HEIGHT_PX = 30;
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;

type ReactionEmojiGridProps = {
  width: number;
  height: number;
  /** Emoji the viewer already reacted with on this message. */
  selected: ReadonlySet<string>;
  /** `cell` is the button picked, for the landing animation's start. */
  onPick: (emoji: string, cell?: HTMLElement) => void;
  /** Ringed in blue: what a double tap on a message sends here. */
  doubleTapEmoji?: string;
  /** Long press on an emoji; makes it the double-tap one. */
  onLongPressEmoji?: (emoji: string) => void;
  /** Shows the gear that opens the reaction settings. */
  onOpenSettings?: () => void;
  /** Picking for a setting: a title row with a back arrow on top. */
  pickerTitle?: string;
  onBack?: () => void;
};

/**
 * Telegram-style emoji grid the reaction pill grows into: category tabs on
 * top, every emoji below in one scrolling list with a small title per
 * category. Recently used comes first and needs no data, so it shows while
 * the full list loads; the categories then mount one per frame so the
 * expanding panel never stutters.
 */
export const ReactionEmojiGrid = ({
  width,
  height,
  selected,
  onPick,
  doubleTapEmoji,
  onLongPressEmoji,
  onOpenSettings,
  pickerTitle,
  onBack,
}: ReactionEmojiGridProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const isDark = theme.palette.mode === 'dark';
  const columns = getExpandedGridColumns(width);
  const [recent] = useState(getRecentReactionsForPicker);
  const [data, setData] = useState<ReactionEmojiData | null>(null);
  const sections = data?.sections ?? null;
  const [failed, setFailed] = useState(false);
  const [mountedCount, setMountedCount] = useState(0);
  const [activeId, setActiveId] = useState<SectionId>('recent');
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingJumpRef = useRef<SectionId | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const holdRef = useRef<{
    timer: number | null;
    x: number;
    y: number;
    fired: boolean;
  }>({ timer: null, x: 0, y: 0, fired: false });
  const searching = query.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    loadReactionEmojiData()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One category per frame after the first, so the grid fills in while the
  // panel finishes growing instead of blocking it.
  useEffect(() => {
    if (!sections || mountedCount >= sections.length) return;
    const frame = window.requestAnimationFrame(() =>
      setMountedCount((count) => Math.min(sections.length, count + 1))
    );
    return () => window.cancelAnimationFrame(frame);
  }, [mountedCount, sections]);

  const labelFor = useCallback(
    (id: SectionId) =>
      t(`group:message_item.emoji_category.${id}`, {
        postProcess: 'capitalizeFirstChar',
      }),
    [t]
  );

  const visibleSections = useMemo(
    () => [
      { id: 'recent' as SectionId, emojis: recent },
      ...(sections ?? []).slice(0, mountedCount),
    ],
    [mountedCount, recent, sections]
  );

  const scrollToSection = useCallback((id: SectionId) => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(
      `[data-emoji-section="${id}"]`
    );
    if (!container || !target) return false;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
    } else {
      container.scrollTop = target.offsetTop;
    }
    return true;
  }, []);

  const jumpTo = useCallback(
    (id: SectionId) => {
      setActiveId(id);
      if (scrollToSection(id)) return;
      // Not mounted yet: mount everything, then jump once it is there.
      pendingJumpRef.current = id;
      if (sections) setMountedCount(sections.length);
    },
    [scrollToSection, sections]
  );

  useEffect(() => {
    const pending = pendingJumpRef.current;
    if (pending && scrollToSection(pending)) pendingJumpRef.current = null;
  }, [scrollToSection, visibleSections]);

  const syncActiveTab = useCallback(() => {
    scrollFrameRef.current = null;
    const container = scrollRef.current;
    if (!container || pendingJumpRef.current) return;
    const marks = container.querySelectorAll<HTMLElement>(
      '[data-emoji-section]'
    );
    let current: SectionId = 'recent';
    for (const mark of Array.from(marks)) {
      if (mark.offsetTop <= container.scrollTop + 12) {
        current = mark.dataset.emojiSection as SectionId;
      }
    }
    setActiveId(current);
  }, []);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    []
  );

  const handleScroll = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(syncActiveTab);
  };

  const results = useMemo(
    () =>
      searching && data
        ? searchReactionEmojis(query, data.sections, data.names)
        : [],
    [data, query, searching]
  );

  // Back to the top for every new search, not left halfway down.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [query]);

  const cancelHold = () => {
    if (holdRef.current.timer !== null) {
      window.clearTimeout(holdRef.current.timer);
      holdRef.current.timer = null;
    }
  };

  useEffect(() => cancelHold, []);

  const cellFrom = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-emoji]') ??
    null;

  // A long press on any emoji makes it the double-tap one. Scrolling the grid
  // moves the finger (or cancels the pointer), which calls it off.
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    holdRef.current.fired = false;
    if (!onLongPressEmoji) return;
    const emoji = cellFrom(event.target)?.dataset.emoji;
    if (!emoji) return;
    cancelHold();
    holdRef.current.x = event.clientX;
    holdRef.current.y = event.clientY;
    holdRef.current.timer = window.setTimeout(() => {
      holdRef.current.timer = null;
      holdRef.current.fired = true;
      onLongPressEmoji(emoji);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (holdRef.current.timer === null) return;
    if (
      Math.abs(event.clientX - holdRef.current.x) > LONG_PRESS_SLOP_PX ||
      Math.abs(event.clientY - holdRef.current.y) > LONG_PRESS_SLOP_PX
    ) {
      cancelHold();
    }
  };

  // One listener for ~1,800 cells instead of one per button.
  const handleGridClick = (event: MouseEvent<HTMLDivElement>) => {
    if (holdRef.current.fired) {
      holdRef.current.fired = false;
      return;
    }
    const cell = cellFrom(event.target);
    const emoji = cell?.dataset.emoji;
    if (emoji) onPick(emoji, cell ?? undefined);
  };

  const renderCell = (emoji: string) => (
    <button
      aria-pressed={selected.has(emoji)}
      data-double-tap={emoji === doubleTapEmoji ? 'true' : undefined}
      data-emoji={emoji}
      key={emoji}
      type="button"
    >
      {emoji}
    </button>
  );

  const searchLabel = t('group:message_item.search_emoji', {
    postProcess: 'capitalizeFirstChar',
  });

  const availableTabs = TAB_ORDER.filter(
    (id) =>
      id === 'recent' ||
      !sections ||
      sections.some((section) => section.id === id)
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height,
        width,
        '@keyframes reactionGridIn': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        animation: 'reactionGridIn 180ms ease-out 60ms both',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      {pickerTitle && (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexShrink: 0,
            gap: '4px',
            height: PICKER_TITLE_HEIGHT_PX,
            pl: '4px',
            pr: '12px',
          }}
        >
          {onBack && (
            <IconButton
              aria-label={t('core:action.back', {
                postProcess: 'capitalizeFirstChar',
              })}
              onClick={onBack}
              size="small"
              sx={{ height: 40, width: 40 }}
            >
              <ArrowBackRoundedIcon />
            </IconButton>
          )}
          <Typography
            noWrap
            sx={{ fontSize: '15px', fontWeight: 600, minWidth: 0 }}
          >
            {pickerTitle}
          </Typography>
        </Box>
      )}
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          gap: '4px',
          height: SEARCH_ROW_HEIGHT_PX,
          pl: `${EXPANDED_GRID_PADDING_X_PX + 4}px`,
          pr: onOpenSettings ? '2px' : `${EXPANDED_GRID_PADDING_X_PX + 4}px`,
          pt: '6px',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(
              theme.palette.text.primary,
              isDark ? 0.08 : 0.06
            ),
            borderRadius: '12px',
            color: 'text.secondary',
            display: 'flex',
            flex: 1,
            gap: '6px',
            height: 38,
            minWidth: 0,
            pl: '10px',
            pr: searching ? '2px' : '10px',
            '& svg': { fontSize: 20 },
          }}
        >
          <SearchRoundedIcon />
          <InputBase
            inputProps={{
              'aria-label': searchLabel,
              enterKeyHint: 'search',
              type: 'search',
            }}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchLabel}
            sx={{
              color: 'text.primary',
              flex: 1,
              fontSize: '15px',
              minWidth: 0,
              '& input': { p: 0 },
              '& input::-webkit-search-cancel-button': { display: 'none' },
            }}
            value={query}
          />
          {searching && (
            <IconButton
              aria-label={t('group:message_item.clear_search', {
                postProcess: 'capitalizeFirstChar',
              })}
              onClick={() => setQuery('')}
              size="small"
              sx={{ height: 34, width: 34 }}
            >
              <CloseRoundedIcon />
            </IconButton>
          )}
        </Box>
        {onOpenSettings && (
          <IconButton
            aria-label={t('group:message_item.reaction_settings', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={onOpenSettings}
            sx={{ color: 'text.secondary', height: 44, width: 44 }}
          >
            <SettingsOutlinedIcon />
          </IconButton>
        )}
      </Box>
      <Box
        aria-label={t('group:message_item.emoji_categories', {
          postProcess: 'capitalizeFirstChar',
        })}
        role="tablist"
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: alpha(theme.palette.text.primary, isDark ? 0.08 : 0.1),
          // Search results replace the categories, so their tabs step aside.
          display: searching ? 'none' : 'flex',
          flexShrink: 0,
          gap: '2px',
          height: TAB_ROW_HEIGHT_PX,
          overflowX: 'auto',
          px: `${EXPANDED_GRID_PADDING_X_PX}px`,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {availableTabs.map((id) => {
          const active = id === activeId;
          return (
            <ButtonBase
              aria-label={labelFor(id)}
              aria-selected={active}
              key={id}
              onClick={() => jumpTo(id)}
              role="tab"
              sx={{
                backgroundColor: active
                  ? alpha(theme.palette.text.primary, isDark ? 0.12 : 0.09)
                  : 'transparent',
                borderRadius: '11px',
                color: active ? 'text.primary' : 'text.secondary',
                flex: '1 0 32px',
                height: 34,
                maxWidth: 44,
                transition: 'background-color 160ms ease, color 160ms ease',
                '& svg': { fontSize: 21 },
              }}
            >
              {TAB_ICONS[id]}
            </ButtonBase>
          );
        })}
      </Box>
      <Box
        onClick={handleGridClick}
        // Android reports a long press as a context menu too, maybe before
        // the hold timer; either way it is the same long press.
        onContextMenu={(event) => {
          event.preventDefault();
          const emoji = cellFrom(event.target)?.dataset.emoji;
          if (!onLongPressEmoji || !emoji) return;
          cancelHold();
          holdRef.current.fired = true;
          onLongPressEmoji(emoji);
        }}
        onPointerCancel={cancelHold}
        onPointerDown={handlePointerDown}
        onPointerLeave={cancelHold}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelHold}
        onScroll={handleScroll}
        ref={scrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          pb: '8px',
          position: 'relative',
          px: `${EXPANDED_GRID_PADDING_X_PX}px`,
          WebkitOverflowScrolling: 'touch',
          '& [data-emoji]': {
            alignItems: 'center',
            appearance: 'none',
            backgroundColor: 'transparent',
            border: 0,
            borderRadius: '12px',
            color: 'inherit',
            cursor: 'pointer',
            display: 'flex',
            fontFamily:
              '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
            fontSize: '27px',
            height: `${EMOJI_CELL_HEIGHT_PX}px`,
            justifyContent: 'center',
            lineHeight: 1,
            minWidth: 0,
            padding: 0,
            transition: 'transform 120ms ease, background-color 120ms ease',
            WebkitTapHighlightColor: 'transparent',
            '&:active': {
              backgroundColor: alpha(theme.palette.text.primary, 0.1),
              transform: 'scale(0.86)',
            },
            '&:focus-visible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: '-2px',
            },
          },
          '& [data-emoji][aria-pressed="true"]': {
            backgroundColor: alpha(theme.palette.primary.main, 0.24),
          },
          '& [data-emoji][data-double-tap="true"]': {
            borderRadius: '50%',
            boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
          },
          // Long-pressing an emoji must not start a text selection.
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {searching && (
          <Box component="section" sx={{ pt: '4px' }}>
            {results.length > 0 ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {results.map(renderCell)}
              </Box>
            ) : data ? (
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: '14px',
                  px: '8px',
                  py: '24px',
                  textAlign: 'center',
                }}
              >
                {t('group:message_item.no_emoji_found', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            ) : null}
          </Box>
        )}
        {!searching &&
          visibleSections.map((section, index) => (
            <Box
              aria-label={labelFor(section.id)}
              component="section"
              data-emoji-section={section.id}
              key={section.id}
              sx={{
                // Off-screen categories skip layout and paint; the exact size
                // keeps the scroll height (and the tab jumps) right.
                containIntrinsicSize: `auto ${
                  (index > 0 ? SECTION_TITLE_HEIGHT_PX : 4) +
                  Math.ceil(section.emojis.length / columns) *
                    EMOJI_CELL_HEIGHT_PX
                }px`,
                contentVisibility: index > 0 ? 'auto' : 'visible',
              }}
            >
              {index > 0 ? (
                <Box
                  aria-hidden="true"
                  sx={{
                    alignItems: 'flex-end',
                    color: 'text.secondary',
                    display: 'flex',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    height: SECTION_TITLE_HEIGHT_PX,
                    pb: '5px',
                    px: '6px',
                  }}
                >
                  {labelFor(section.id)}
                </Box>
              ) : (
                <Box sx={{ height: 4 }} />
              )}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {section.emojis.map(renderCell)}
              </Box>
            </Box>
          ))}
        {!sections && !failed && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={22} />
          </Box>
        )}
      </Box>
    </Box>
  );
};
