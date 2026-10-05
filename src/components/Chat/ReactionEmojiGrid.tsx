import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Box, ButtonBase, CircularProgress, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
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
  loadReactionEmojiSections,
  type ReactionEmojiCategory,
  type ReactionEmojiSection,
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
export const EMOJI_CELL_HEIGHT_PX = 42;
const SECTION_TITLE_HEIGHT_PX = 30;

type ReactionEmojiGridProps = {
  width: number;
  height: number;
  /** Emoji the viewer already reacted with on this message. */
  selected: ReadonlySet<string>;
  onPick: (emoji: string) => void;
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
}: ReactionEmojiGridProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const isDark = theme.palette.mode === 'dark';
  const columns = getExpandedGridColumns(width);
  const [recent] = useState(getRecentReactionsForPicker);
  const [sections, setSections] = useState<ReactionEmojiSection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [mountedCount, setMountedCount] = useState(0);
  const [activeId, setActiveId] = useState<SectionId>('recent');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingJumpRef = useRef<SectionId | null>(null);
  const scrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadReactionEmojiSections()
      .then((loaded) => {
        if (!cancelled) setSections(loaded);
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

  // One listener for ~1,800 cells instead of one per button.
  const handleGridClick = (event: MouseEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-emoji]'
    );
    const emoji = cell?.dataset.emoji;
    if (emoji) onPick(emoji);
  };

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
      <Box
        aria-label={t('group:message_item.emoji_categories', {
          postProcess: 'capitalizeFirstChar',
        })}
        role="tablist"
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: alpha(theme.palette.text.primary, isDark ? 0.08 : 0.1),
          display: 'flex',
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
        }}
      >
        {visibleSections.map((section, index) => (
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
              {section.emojis.map((emoji) => (
                <button
                  aria-pressed={selected.has(emoji)}
                  data-emoji={emoji}
                  key={emoji}
                  type="button"
                >
                  {emoji}
                </button>
              ))}
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
