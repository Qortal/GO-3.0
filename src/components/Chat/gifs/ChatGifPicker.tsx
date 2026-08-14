import { useEffect, useMemo, useState } from 'react';
import { Box, ButtonBase, CircularProgress, InputBase, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { GifImage, GifViewportContext } from './GifImage';
import { mostUsedGifs, recordGifUse } from './gifUsage';
import {
  persistLibraryGif,
  peekGifAspect,
  prefetchLibraryGifs,
} from './gifMediaCache';
import {
  filterLibraryGifs,
  getLibraryGifCatalog,
  gifTagCounts,
  libraryGifKey,
  type LibraryGif,
} from './libraryGifs';

type ChatGifPickerProps = {
  height: number;
  onSelect: (gif: LibraryGif) => void;
};

const GRID_COLUMNS = 3;

const hideScrollbar = {
  msOverflowStyle: 'none',
  scrollbarWidth: 'none',
  '&::-webkit-scrollbar': { display: 'none' },
} as const;

export const ChatGifPicker = ({ height, onSelect }: ChatGifPickerProps) => {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [catalog, setCatalog] = useState<LibraryGif[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [usageTick, setUsageTick] = useState(0);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getLibraryGifCatalog()
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalog([]);
          setError(err?.message || 'Could not load GIFs');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const favorites = useMemo(() => mostUsedGifs(8), [usageTick]);
  const categories = useMemo(() => gifTagCounts(catalog, 16), [catalog]);
  const gifs = useMemo(
    () => filterLibraryGifs(catalog, debouncedQuery, activeTag),
    [activeTag, catalog, debouncedQuery]
  );
  const visibleFavorites = useMemo(
    () =>
      activeTag
        ? filterLibraryGifs(favorites, '', activeTag)
        : favorites,
    [activeTag, favorites]
  );
  const showFavorites = !debouncedQuery && visibleFavorites.length > 0;

  useEffect(() => {
    prefetchLibraryGifs(favorites, 14);
  }, [favorites]);

  useEffect(() => {
    const next: Record<string, number> = {};
    [...catalog, ...favorites].forEach((gif) => {
      const key = libraryGifKey(gif);
      const ratio = peekGifAspect(key);
      if (ratio) next[key] = ratio;
    });
    if (Object.keys(next).length === 0) return;
    setAspects((prev) => ({ ...next, ...prev }));
  }, [catalog, favorites]);

  const noteAspect = (key: string, ratio: number) => {
    setAspects((prev) => (prev[key] === ratio ? prev : { ...prev, [key]: ratio }));
  };

  const favoriteWidth = (gif: LibraryGif) => {
    const ratio = aspects[libraryGifKey(gif)] || 1;
    return Math.round(Math.min(132, Math.max(44, 64 * ratio)));
  };

  const columns = useMemo(() => {
    const next: LibraryGif[][] = Array.from(
      { length: GRID_COLUMNS },
      () => []
    );
    gifs.forEach((gif, index) => {
      next[index % GRID_COLUMNS].push(gif);
    });
    return next;
  }, [gifs]);

  const handleSelect = (gif: LibraryGif) => {
    recordGifUse(gif);
    persistLibraryGif(gif);
    setUsageTick((value) => value + 1);
    onSelect(gif);
  };

  const emptyLabel = useMemo(() => {
    if (loading) return '';
    if (error) return error;
    if (debouncedQuery || activeTag) return 'No GIFs match those words';
    return 'No GIFs published yet';
  }, [activeTag, debouncedQuery, error, loading]);

  const chipSx = (active: boolean) => ({
    backgroundColor: active
      ? theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.16)'
        : 'rgba(0, 0, 0, 0.12)'
      : theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(0, 0, 0, 0.05)',
    borderRadius: '999px',
    color: active ? theme.palette.text.primary : theme.palette.text.secondary,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    px: 1.25,
    py: 0.45,
  });

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height,
        minHeight: 0,
        width: '100%',
      }}
    >
      <Box sx={{ px: 1.25, pt: 1, pb: 0.5 }}>
        <InputBase
          fullWidth
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search GIFs"
          value={query}
          sx={{
            backgroundColor:
              theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.06)'
                : 'rgba(0, 0, 0, 0.05)',
            borderRadius: '10px',
            fontSize: 14,
            px: 1.25,
            py: 0.75,
          }}
        />
      </Box>
      {showFavorites && (
        <Box sx={{ pb: 0.5, px: 1.25 }}>
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.3,
              pb: 0.5,
              textTransform: 'uppercase',
            }}
          >
            Most used
          </Typography>
          <Box
            sx={{
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              ...hideScrollbar,
            }}
          >
            {visibleFavorites.map((gif) => (
              <Box
                key={`fav-${libraryGifKey(gif)}`}
                component="button"
                onClick={() => handleSelect(gif)}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
                sx={{
                  backgroundColor:
                    theme.palette.mode === 'dark' ? '#0e1016' : '#e8ebf2',
                  border: 0,
                  borderRadius: '10px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  height: 64,
                  overflow: 'hidden',
                  p: 0,
                  width: favoriteWidth(gif),
                }}
              >
                <GifImage
                  eager
                  fill
                  fit="contain"
                  gif={gif}
                  onAspect={(ratio) => noteAspect(libraryGifKey(gif), ratio)}
                  spinnerSize={14}
                />
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {categories.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            gap: '6px',
            overflowX: 'auto',
            pb: 0.75,
            px: 1.25,
            ...hideScrollbar,
          }}
        >
          {activeTag && (
            <ButtonBase
              onClick={() => setActiveTag('')}
              onMouseDown={(event) => event.preventDefault()}
              sx={chipSx(false)}
            >
              All
            </ButtonBase>
          )}
          {categories.map(({ tag, count }) => {
            const active = activeTag === tag;
            return (
              <ButtonBase
                key={tag}
                onClick={() => setActiveTag(active ? '' : tag)}
                onMouseDown={(event) => event.preventDefault()}
                sx={chipSx(active)}
              >
                {tag}
                <Box
                  component="span"
                  sx={{
                    color: 'text.disabled',
                    fontWeight: 600,
                    ml: 0.5,
                  }}
                >
                  {count}
                </Box>
              </ButtonBase>
            );
          })}
        </Box>
      )}
      <GifViewportContext.Provider value={scrollRoot}>
        <Box
          ref={setScrollRoot}
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            px: 1,
            pb: 1,
          }}
        >
          {loading ? (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                height: '100%',
                justifyContent: 'center',
              }}
            >
              <CircularProgress size={22} />
            </Box>
          ) : gifs.length === 0 ? (
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 13,
                px: 1,
                py: 3,
                textAlign: 'center',
              }}
            >
              {emptyLabel}
            </Typography>
          ) : (
            <Box
              sx={{
                '@keyframes qortal-gif-grid-in': {
                  from: { opacity: 0, transform: 'translateY(8px)' },
                  to: { opacity: 1, transform: 'translateY(0)' },
                },
                alignItems: 'flex-start',
                animation: 'qortal-gif-grid-in 220ms ease',
                display: 'flex',
                gap: '6px',
              }}
            >
              {columns.map((column, columnIndex) => (
                <Box
                  key={columnIndex}
                  sx={{
                    display: 'flex',
                    flex: '1 1 0',
                    flexDirection: 'column',
                    gap: '6px',
                    minWidth: 0,
                  }}
                >
                  {column.map((gif) => (
                    <Box
                      key={libraryGifKey(gif)}
                      component="button"
                      onClick={() => handleSelect(gif)}
                      onMouseDown={(event) => event.preventDefault()}
                      type="button"
                      sx={{
                        backgroundColor:
                          theme.palette.mode === 'dark' ? '#0e1016' : '#e8ebf2',
                        border: 0,
                        borderRadius: '10px',
                        cursor: 'pointer',
                        lineHeight: 0,
                        overflow: 'hidden',
                        p: 0,
                        width: '100%',
                      }}
                    >
                      <GifImage
                        gif={gif}
                        natural
                        onAspect={(ratio) =>
                          noteAspect(libraryGifKey(gif), ratio)
                        }
                        spinnerSize={16}
                      />
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </GifViewportContext.Provider>
    </Box>
  );
};
