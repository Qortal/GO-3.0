import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  ButtonBase,
  ClickAwayListener,
  IconButton,
  InputBase,
  Paper,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import LinkIcon from '@mui/icons-material/Link';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import ShareRoundedIcon from '@mui/icons-material/ShareRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { availableQappsAtom, appOpenCountsAtom } from '../../atoms/appsAtoms';
import { AppThumbnailAvatar } from '../Apps/AppThumbnailAvatar';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { executeEvent } from '../../utils/events';
import { getBaseApiReact } from '../../utils/globalApi';
import {
  MOBILE_TAB_BAR_HEIGHT_PX,
  MOBILE_TOP_BAR_HEIGHT_PX,
} from './mobileBarHeights';
import { useSoftKeyboardInset } from '../../hooks/useSoftKeyboardInset';
import { MOBILE_TABS_OVERLAY_Z } from './mobileLayout';
import {
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../utils/mobileSafeArea';
import {
  MOBILE_APPS_SEARCH_PLACEHOLDER,
  buildAppsSearchSuggestions,
  canOpenQueryAsQortalLink,
  normalizeQortalInput,
  openAppsSearchApp,
  openAppsSearchLink,
  splitFirstMatch,
} from './appsDashboardSearch';

/** Space left between the results and the keyboard (or the tab buttons). */
const RESULTS_GAP_PX = 10;
const RESULTS_MIN_HEIGHT_PX = 160;

const readSafeAreaBottom = () => {
  try {
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--safe-area-inset-bottom'
      )
    );
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

type MobileTopBarSearchProps = {
  activeTabUrl?: string;
  activeTabTitle?: string;
  activeTabId?: string;
  onRefreshActiveTab?: () => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  showActiveTabUrl?: boolean;
  tabsOverlayOpen?: boolean;
  /** The bar floats see-through on a page's own colour (immersive mode):
   * the field is a neutral tint of it, not GO's paper. */
  floating?: boolean;
};

export const MobileTopBarSearch = ({
  activeTabUrl = '',
  activeTabTitle = '',
  activeTabId = '',
  onRefreshActiveTab,
  expanded,
  onExpandedChange,
  showActiveTabUrl = false,
  tabsOverlayOpen = false,
  floating = false,
}: MobileTopBarSearchProps) => {
  const theme = useTheme();
  // Tablet tier (600-900px): give the collapsed search more room.
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const [availableQapps, setAvailableQapps] = useAtom(availableQappsAtom);
  const openCounts = useAtomValue(appOpenCountsAtom);
  const [query, setQuery] = useState('');
  const [draftTouched, setDraftTouched] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const appsCatalogFetchStartedRef = useRef(false);
  const { t } = useTranslation(['core']);

  // Top-bar search can open before the Apps library has filled the catalog.
  // Fetch once so queries like "QWB" can match published apps.
  useEffect(() => {
    if (
      !expanded ||
      availableQapps.length > 0 ||
      appsCatalogFetchStartedRef.current
    ) {
      return;
    }
    appsCatalogFetchStartedRef.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const base = getBaseApiReact();
        const [appsRes, websitesRes] = await Promise.all([
          fetch(
            `${base}/arbitrary/resources/search?service=APP&default=true&mode=ALL&limit=0&includestatus=true&includemetadata=true`,
            { signal: controller.signal }
          ),
          fetch(
            `${base}/arbitrary/resources/search?service=WEBSITE&default=true&mode=ALL&limit=0&includestatus=true&includemetadata=true`,
            { signal: controller.signal }
          ),
        ]);
        if (!appsRes.ok || !websitesRes.ok) return;
        const [apps, websites] = await Promise.all([
          appsRes.json(),
          websitesRes.json(),
        ]);
        if (controller.signal.aborted) return;
        const combined = [...(apps || []), ...(websites || [])].filter(
          (res) => !res?.identifier
        );
        if (combined.length > 0) {
          setAvailableQapps(combined);
        }
      } catch {
        /* network / abort — AppsDesktop poll may still fill the atom later */
        appsCatalogFetchStartedRef.current = false;
      }
    })();
    return () => {
      controller.abort();
    };
  }, [availableQapps.length, expanded, setAvailableQapps]);

  const openAsLinkLabel = t('core:action.open_as_qortal_link', {
    postProcess: 'capitalizeFirstChar',
  });

  const suggestions = useMemo(
    () =>
      buildAppsSearchSuggestions(
        query,
        availableQapps,
        openAsLinkLabel,
        openCounts
      ),
    [availableQapps, openAsLinkLabel, openCounts, query]
  );

  const showDropdown =
    expanded &&
    dropdownOpen &&
    !showActiveTabUrl &&
    !(activeTabUrl && !draftTouched) &&
    (query.trim().length > 0 || suggestions.length > 0);

  useEffect(() => {
    if (draftTouched) return;
    if (showActiveTabUrl && activeTabUrl) {
      setQuery(activeTabUrl);
      return;
    }
    if (!expanded) {
      setQuery('');
    }
  }, [activeTabUrl, draftTouched, expanded, showActiveTabUrl]);

  useEffect(() => {
    if (!expanded) {
      setDraftTouched(false);
    }
  }, [expanded]);

  useEffect(() => {
    setHighlightedIndex((index) =>
      suggestions.length ? Math.min(index, suggestions.length - 1) : 0
    );
  }, [suggestions.length]);

  useEffect(() => {
    if (!expanded) {
      setDropdownOpen(false);
      return;
    }
    // Active-tab address editing: show the Share/Copy/Edit/Refresh card first;
    // open suggestions only once the user starts changing the draft.
    if (showActiveTabUrl || (activeTabUrl && !draftTouched)) {
      setDropdownOpen(false);
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
        if (activeTabUrl && !draftTouched) {
          inputRef.current?.select();
        }
      }, 60);
      return () => window.clearTimeout(timer);
    }
    setDropdownOpen(true);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [activeTabUrl, draftTouched, expanded, showActiveTabUrl]);

  const collapse = useCallback(() => {
    setDraftTouched(false);
    setQuery(showActiveTabUrl && activeTabUrl ? activeTabUrl : '');
    setDropdownOpen(false);
    onExpandedChange(false);
  }, [activeTabUrl, onExpandedChange, showActiveTabUrl]);

  const currentUrl = (query.trim() || activeTabUrl).trim();
  // Only while the address field is open for editing — never while browsing.
  const showUrlActions = expanded && Boolean(activeTabUrl);

  // The results reach down to just above the keyboard (the visible part of
  // the screen), or above the round tab buttons while it is closed.
  const keyboardInset = useSoftKeyboardInset();
  const resultsBoxRef = useRef<HTMLDivElement | null>(null);
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!showDropdown) return;
    const measure = () => {
      const box = resultsBoxRef.current;
      if (!box) return;
      const top = box.getBoundingClientRect().top;
      const viewport = window.visualViewport;
      const visibleBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight;
      const reserve =
        keyboardInset > 0
          ? RESULTS_GAP_PX
          : MOBILE_TAB_BAR_HEIGHT_PX + readSafeAreaBottom() + RESULTS_GAP_PX;
      setPanelMaxHeight(
        Math.max(
          RESULTS_MIN_HEIGHT_PX,
          Math.floor(visibleBottom - top - reserve)
        )
      );
    };
    measure();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [keyboardInset, showDropdown, showUrlActions]);
  const displayTitle =
    activeTabTitle.trim() ||
    (activeTabUrl ? activeTabUrl.replace(/^qortal:\/\//i, '') : '');

  // Share / Copy / Refresh each close the address window once tapped.
  const handleCopyUrl = useCallback(async () => {
    if (!currentUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
    } catch {
      // Clipboard can fail in locked WebViews; ignore quietly.
    }
    collapse();
  }, [collapse, currentUrl]);

  const handleShareUrl = useCallback(async () => {
    if (!currentUrl) return;
    // Close first so the share sheet opens over the page, not the edit bar.
    collapse();
    try {
      // Native Android/iOS share sheet (chooser). Prefer Capacitor over
      // navigator.share — WebView often lacks a real OS share target list.
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: displayTitle || 'Qortal',
          text: currentUrl,
          dialogTitle: 'Share link',
        });
        return;
      }
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: displayTitle || 'Qortal',
          text: currentUrl,
        });
      }
    } catch {
      // User cancelled the share sheet — do nothing.
    }
  }, [collapse, currentUrl, displayTitle]);

  const handleRefresh = useCallback(() => {
    if (onRefreshActiveTab) {
      onRefreshActiveTab();
    } else if (activeTabId) {
      executeEvent('refreshApp', { tabId: activeTabId });
    } else {
      return;
    }
    collapse();
  }, [activeTabId, collapse, onRefreshActiveTab]);

  const urlActionButtonSx = {
    borderRadius: '50%',
    color: theme.palette.text.secondary,
    flexShrink: 0,
    p: 0.85,
    '&:active': {
      backgroundColor: alpha(theme.palette.text.primary, 0.08),
      color: theme.palette.text.primary,
    },
  } as const;

  const urlActions = showUrlActions ? (
    <Box
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        flexShrink: 0,
        gap: 0.25,
        width: 'auto',
      }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <IconButton
        aria-label="Share link"
        size="medium"
        onClick={() => void handleShareUrl()}
        sx={urlActionButtonSx}
      >
        <ShareRoundedIcon sx={{ fontSize: 24 }} />
      </IconButton>
      <IconButton
        aria-label="Copy link"
        size="medium"
        onClick={() => void handleCopyUrl()}
        sx={urlActionButtonSx}
      >
        <ContentCopyRoundedIcon sx={{ fontSize: 24 }} />
      </IconButton>
      <IconButton
        aria-label="Refresh"
        size="medium"
        onClick={handleRefresh}
        disabled={!activeTabId && !onRefreshActiveTab}
        sx={urlActionButtonSx}
      >
        <RefreshRoundedIcon sx={{ fontSize: 24 }} />
      </IconButton>
    </Box>
  ) : null;

  const openAsLink = useCallback(() => {
    if (openAppsSearchLink(query, availableQapps)) {
      setQuery('');
      collapse();
    }
  }, [availableQapps, collapse, query]);

  const openApp = useCallback(
    (app: any) => {
      openAppsSearchApp(app);
      setQuery('');
      collapse();
    },
    [collapse]
  );

  const handleSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const suggestion = suggestions[highlightedIndex];
    if (suggestion?.type === 'link') {
      openAsLink();
      return;
    }
    if (suggestion?.type === 'app') {
      openApp(suggestion.app);
      return;
    }
    if (canOpenQueryAsQortalLink(trimmed)) {
      openAsLink();
      return;
    }
    const firstApp = suggestions.find((item) => item.type === 'app');
    if (firstApp?.type === 'app') {
      openApp(firstApp.app);
    }
  }, [highlightedIndex, openApp, openAsLink, query, suggestions]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!dropdownOpen || suggestions.length === 0) {
        if (event.key === 'Enter') handleSubmit();
        if (event.key === 'Escape') collapse();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length
        );
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
        return;
      }
      if (event.key === 'Escape') {
        collapse();
      }
    },
    [collapse, dropdownOpen, handleSubmit, suggestions.length]
  );

  const searchField = (
    <Paper
      elevation={0}
      sx={{
        alignItems: 'center',
        backgroundColor:
          theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.06)'
            : floating && !expanded
              ? alpha(theme.palette.common.black, 0.045)
              : theme.palette.background.paper,
        border: `1px solid ${
          expanded ? theme.palette.primary.main : theme.palette.divider
        }`,
        borderRadius: expanded ? '14px' : '999px',
        boxShadow: expanded
          ? `0 0 0 1px ${theme.palette.primary.main}22`
          : 'none',
        display: 'flex',
        gap: 0.75,
        minWidth: 0,
        px: expanded ? 1 : 1.25,
        py: expanded ? 0.35 : 0.25,
        transition:
          'border-color 180ms ease, box-shadow 180ms ease, border-radius 180ms ease',
        width: '100%',
      }}
    >
      {!expanded ? (
        showActiveTabUrl ? (
          <LinkIcon
            sx={{
              color: theme.palette.primary.main,
              flexShrink: 0,
              fontSize: 16,
            }}
          />
        ) : (
          <SearchIcon
            sx={{ color: theme.palette.text.secondary, fontSize: 16 }}
          />
        )
      ) : null}
      <InputBase
        inputRef={inputRef}
        readOnly={showActiveTabUrl && !expanded}
        value={query}
        onChange={(event) => {
          setDraftTouched(true);
          setQuery(event.target.value);
          setDropdownOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={() => {
          if (!expanded) {
            onExpandedChange(true);
            return;
          }
          if (!showActiveTabUrl) {
            setDropdownOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          showActiveTabUrl ? undefined : MOBILE_APPS_SEARCH_PLACEHOLDER
        }
        autoComplete="off"
        autoCorrect="off"
        inputProps={{
          'aria-label': t('core:action.search_apps_or_link', {
            postProcess: 'capitalizeFirstChar',
          }),
        }}
        sx={{
          flex: 1,
          fontSize: expanded ? '15px' : '12px',
          minWidth: 0,
          color: theme.palette.text.primary,
          '& .MuiInputBase-input': {
            fontFamily: showActiveTabUrl
              ? 'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace'
              : undefined,
            fontSize: showActiveTabUrl && !expanded ? '11px' : undefined,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            py: expanded ? 0.85 : 0.55,
          },
          '& .MuiInputBase-input::placeholder': {
            color: theme.palette.text.secondary,
            opacity: 1,
          },
        }}
      />
      {expanded && query ? (
        <ButtonBase
          onClick={() => {
            setQuery('');
            setHighlightedIndex(0);
            inputRef.current?.focus();
          }}
          sx={{ borderRadius: '50%', p: 0.5, flexShrink: 0 }}
          aria-label="Clear search"
        >
          <img src={IconClearInput} alt="" style={{ width: 16, height: 16 }} />
        </ButtonBase>
      ) : null}
      {expanded ? (
        <ButtonBase
          onClick={handleSubmit}
          sx={{
            borderRadius: '50%',
            color: query
              ? theme.palette.primary.main
              : theme.palette.text.secondary,
            flexShrink: 0,
            p: 0.75,
          }}
          aria-label="Search"
        >
          <ArrowOutwardIcon sx={{ fontSize: 20 }} />
        </ButtonBase>
      ) : null}
    </Paper>
  );

  const searchChromeZ = (tabsOverlayOpen ? MOBILE_TABS_OVERLAY_Z : 1300) + 4;
  const resultsTop = showUrlActions
    ? `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + ${SAFE_AREA_TOP} + 48px)`
    : `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + ${SAFE_AREA_TOP})`;

  const panelSurface =
    theme.palette.mode === 'dark'
      ? alpha('rgb(30, 32, 38)', 0.94)
      : alpha(theme.palette.background.paper, 0.96);

  // The typed letters stand out a little (brighter and bolder), the way a
  // search box marks them; the rest of the line keeps its colour.
  const highlightedText = (text: string) => {
    const { before, match, after } = splitFirstMatch(text, query);
    if (!match) return text;
    return (
      <>
        {before}
        <Box
          component="span"
          sx={{ color: theme.palette.text.primary, fontWeight: 800 }}
        >
          {match}
        </Box>
        {after}
      </>
    );
  };

  const rowSx = (index: number) => {
    const active = highlightedIndex === index;
    return {
      // Stagger the first rows like the account menu; cap so long lists
      // don't take forever to settle. `both` (not an `opacity: 0` base) so
      // rows stay visible on WebViews that never run CSS animations.
      '@keyframes searchItemIn': {
        from: { opacity: 0, transform: 'translateY(-8px)' },
        to: { opacity: 1, transform: 'translateY(0)' },
      },
      animation: `searchItemIn 200ms cubic-bezier(0.22, 1, 0.36, 1) ${
        40 + Math.min(index, 8) * 30
      }ms both`,
      alignItems: 'center',
      backgroundColor: active
        ? alpha(theme.palette.primary.main, 0.12)
        : 'transparent',
      borderRadius: '14px',
      display: 'flex',
      gap: 1.5,
      justifyContent: 'flex-start',
      minHeight: 58,
      mx: 0.75,
      px: 1.25,
      py: 0.875,
      textAlign: 'left',
      transition: 'background-color 120ms ease',
      width: 'calc(100% - 12px)',
      '&:active': {
        backgroundColor: alpha(theme.palette.text.primary, 0.08),
      },
    } as const;
  };

  // The row the keyboard's Go key opens (see handleSubmit).
  const goMark = (index: number) =>
    highlightedIndex === index ? (
      <ArrowOutwardIcon
        aria-hidden
        sx={{ color: theme.palette.primary.main, flexShrink: 0, fontSize: 18 }}
      />
    ) : null;

  const tileSx = {
    alignItems: 'center',
    border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
    borderRadius: '12px',
    display: 'flex',
    flexShrink: 0,
    height: 42,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 42,
  } as const;

  const typeTag = (service: string) => {
    const website = String(service || '').toUpperCase() === 'WEBSITE';
    return (
      <Box
        component="span"
        sx={{
          alignItems: 'center',
          backgroundColor: website
            ? alpha(theme.palette.text.primary, 0.08)
            : alpha(theme.palette.primary.main, 0.14),
          borderRadius: '6px',
          color: website
            ? theme.palette.text.secondary
            : theme.palette.primary.main,
          display: 'inline-flex',
          flexShrink: 0,
          fontSize: 10.5,
          fontWeight: 700,
          gap: 0.375,
          height: 18,
          letterSpacing: '0.02em',
          px: 0.75,
        }}
      >
        {website ? (
          <LanguageRoundedIcon sx={{ fontSize: 12 }} />
        ) : (
          <AppsRoundedIcon sx={{ fontSize: 12 }} />
        )}
        {website
          ? t('core:website', { postProcess: 'capitalizeFirstChar' })
          : t('core:app', { postProcess: 'capitalizeFirstChar' })}
      </Box>
    );
  };

  const resultsPanel = showDropdown ? (
    <Box
      ref={resultsBoxRef}
      sx={{
        left: `max(10px, ${SAFE_AREA_LEFT})`,
        position: 'fixed',
        right: `max(10px, ${SAFE_AREA_RIGHT})`,
        top: `calc(${resultsTop} + 6px)`,
        zIndex: searchChromeZ + 2,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          '@keyframes searchPanelIn': {
            from: {
              opacity: 0,
              transform: 'scale(0.97) translateY(-8px)',
            },
            to: {
              opacity: 1,
              transform: 'scale(1) translateY(0)',
            },
          },
          animation:
            'searchPanelIn 220ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
          backdropFilter: 'blur(18px) saturate(140%)',
          backgroundColor: panelSurface,
          backgroundImage: 'none',
          border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          borderRadius: '20px',
          boxShadow:
            theme.palette.mode === 'dark'
              ? `0 18px 48px ${alpha('#000', 0.5)}`
              : `0 16px 40px ${alpha('#1E3248', 0.16)}`,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          // Down to just above the keyboard, or above the round tab buttons
          // while it is closed (measured, see panelMaxHeight).
          maxHeight:
            panelMaxHeight !== null
              ? `${panelMaxHeight}px`
              : `calc(100dvh - ${MOBILE_TOP_BAR_HEIGHT_PX}px - ${SAFE_AREA_TOP} - 72px)`,
          overflow: 'hidden',
          transformOrigin: 'top center',
          width: '100%',
        }}
      >
        <Box
          sx={{
            color: theme.palette.text.secondary,
            flexShrink: 0,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            pb: 0.5,
            pt: 1.25,
            px: 2,
            textTransform: 'uppercase',
          }}
        >
          {query.trim()
            ? t('core:search.apps_and_websites')
            : t('core:search.suggested')}
        </Box>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            pb: 0.75,
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { width: 3 },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: alpha(theme.palette.text.primary, 0.2),
              borderRadius: 3,
            },
          }}
        >
          {suggestions.length === 0 ? (
            <Box
              sx={{
                alignItems: 'center',
                color: theme.palette.text.secondary,
                display: 'flex',
                fontSize: 14,
                gap: 1,
                px: 2,
                py: 2,
              }}
            >
              <SearchIcon sx={{ fontSize: 18, opacity: 0.7 }} />
              {t('core:action.search_apps', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Box>
          ) : null}
          {suggestions.map((item, index) => {
            if (item.type === 'link') {
              return (
                <ButtonBase
                  key="qortal-link"
                  onClick={openAsLink}
                  sx={rowSx(index)}
                >
                  <Box
                    sx={{
                      ...tileSx,
                      backgroundColor: alpha(theme.palette.primary.main, 0.12),
                      color: theme.palette.primary.main,
                    }}
                  >
                    <LinkIcon sx={{ fontSize: 22 }} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: 15,
                        fontWeight: 600,
                        lineHeight: 1.3,
                      }}
                    >
                      {item.label}
                    </Box>
                    <Box
                      sx={{
                        color: theme.palette.text.secondary,
                        fontFamily:
                          'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
                        fontSize: 12,
                        mt: 0.25,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {normalizeQortalInput(query)}
                    </Box>
                  </Box>
                  {goMark(index)}
                </ButtonBase>
              );
            }

            const app = item.app;
            const title = app?.metadata?.title || app?.name || '';
            return (
              <ButtonBase
                key={`${app?.service}-${app?.name}`}
                onClick={() => openApp(app)}
                sx={rowSx(index)}
              >
                <Box sx={tileSx}>
                  <AppThumbnailAvatar
                    alt={title}
                    appName={
                      app?.privateAppProperties?.logo ? undefined : app?.name
                    }
                    fallbackSize={26}
                    privateLogo={app?.privateAppProperties?.logo}
                    sx={{ borderRadius: 0, height: 42, width: 42 }}
                    variant="rounded"
                  />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: 15,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {highlightedText(title)}
                  </Box>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 0.75,
                      minWidth: 0,
                      mt: 0.375,
                    }}
                  >
                    {typeTag(app?.service)}
                    {app?.name ? (
                      <Box
                        component="span"
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: 12.5,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {highlightedText(app.name)}
                      </Box>
                    ) : null}
                  </Box>
                </Box>
                {goMark(index)}
              </ButtonBase>
            );
          })}
        </Box>
      </Paper>
    </Box>
  ) : null;

  const actionsBarBackground =
    theme.palette.mode === 'dark'
      ? 'rgb(34, 36, 42)'
      : theme.palette.background.paper;

  const urlActionsCard = showUrlActions ? (
    <Paper
      elevation={0}
      sx={{
        alignItems: 'center',
        backgroundColor: actionsBarBackground,
        backgroundImage: 'none',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '999px',
        display: 'inline-flex',
        mt: 0.75,
        px: 0.5,
        py: 0.2,
        position: 'absolute',
        right: 0,
        top: `calc(100% + 2px)`,
        width: 'fit-content',
        zIndex: 2,
      }}
    >
      {urlActions}
    </Paper>
  ) : null;

  if (expanded) {
    return (
      <>
        {/* Covers the open app/page below so scroll/touch dismisses search.
            Also keeps immersive mode's bars out while search is open. */}
        <Box
          aria-hidden
          data-immersive-hold
          onClick={collapse}
          onWheel={collapse}
          onTouchMove={collapse}
          sx={{
            backgroundColor: 'transparent',
            bottom: 0,
            left: 0,
            position: 'fixed',
            right: 0,
            top: `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + ${SAFE_AREA_TOP})`,
            zIndex: searchChromeZ,
          }}
        />
        <ClickAwayListener onClickAway={collapse}>
          <Box
            ref={searchContainerRef}
            sx={{
              '@keyframes searchOverlayIn': {
                from: {
                  opacity: 0,
                  transform: 'scaleX(0.92)',
                },
                to: {
                  opacity: 1,
                  transform: 'scaleX(1)',
                },
              },
              animation:
                'searchOverlayIn 220ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? 'rgb(28, 30, 36)'
                  : theme.palette.background.paper,
              // Fixed chrome so the action strip stays above the dismiss layer
              // (absolute-inside-top-bar was stacking under the fixed backdrop).
              left: 0,
              paddingLeft: `max(10px, ${SAFE_AREA_LEFT})`,
              paddingRight: `max(10px, ${SAFE_AREA_RIGHT})`,
              paddingTop: SAFE_AREA_TOP,
              position: 'fixed',
              right: 0,
              top: 0,
              transformOrigin: 'center right',
              zIndex: searchChromeZ + 1,
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 0.75,
                minHeight: MOBILE_TOP_BAR_HEIGHT_PX,
                position: 'relative',
                width: '100%',
              }}
            >
              <IconButton
                aria-label="Close search"
                edge="start"
                onClick={collapse}
                size="small"
                sx={{ flexShrink: 0 }}
              >
                <CloseRoundedIcon sx={{ fontSize: 20 }} />
              </IconButton>
              <Box sx={{ flex: 1, minWidth: 0 }}>{searchField}</Box>
              {urlActionsCard}
            </Box>
            {resultsPanel}
          </Box>
        </ClickAwayListener>
      </>
    );
  }

  return (
    <ClickAwayListener onClickAway={() => setDropdownOpen(false)}>
      <Box
        ref={searchContainerRef}
        onClick={() => {
          if (showActiveTabUrl && !expanded) {
            onExpandedChange(true);
            return;
          }
          if (!showActiveTabUrl) {
            onExpandedChange(true);
          }
        }}
        sx={{
          cursor: 'text',
          flex: 1,
          maxWidth: showActiveTabUrl
            ? '100%'
            : expanded
              ? '100%'
              : isTablet
                ? 420
                : 240,
          minWidth: showActiveTabUrl ? 0 : 64,
          mx: showActiveTabUrl ? 0 : 0.25,
          transition: 'max-width 220ms ease, margin 220ms ease',
        }}
      >
        {searchField}
      </Box>
    </ClickAwayListener>
  );
};
