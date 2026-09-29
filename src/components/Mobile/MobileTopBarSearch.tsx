import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { MOBILE_TOP_BAR_HEIGHT_PX } from './MobileTopBar';
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
} from './appsDashboardSearch';

type MobileTopBarSearchProps = {
  activeTabUrl?: string;
  activeTabTitle?: string;
  activeTabId?: string;
  onRefreshActiveTab?: () => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  showActiveTabUrl?: boolean;
  tabsOverlayOpen?: boolean;
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
    if (!expanded || availableQapps.length > 0 || appsCatalogFetchStartedRef.current) {
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
  const displayTitle =
    activeTabTitle.trim() ||
    (activeTabUrl ? activeTabUrl.replace(/^qortal:\/\//i, '') : '');

  const handleCopyUrl = useCallback(async () => {
    if (!currentUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
    } catch {
      // Clipboard can fail in locked WebViews; ignore quietly.
    }
  }, [currentUrl]);

  const handleShareUrl = useCallback(async () => {
    if (!currentUrl) return;
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
  }, [currentUrl, displayTitle]);

  const handleRefresh = useCallback(() => {
    if (onRefreshActiveTab) {
      onRefreshActiveTab();
      return;
    }
    if (!activeTabId) return;
    executeEvent('refreshApp', { tabId: activeTabId });
  }, [activeTabId, onRefreshActiveTab]);

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
          <LinkIcon sx={{ color: theme.palette.primary.main, flexShrink: 0, fontSize: 16 }} />
        ) : (
          <SearchIcon sx={{ color: theme.palette.text.secondary, fontSize: 16 }} />
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
        placeholder={showActiveTabUrl ? undefined : MOBILE_APPS_SEARCH_PLACEHOLDER}
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
            color: query ? theme.palette.primary.main : theme.palette.text.secondary,
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

  const resultsPanel = showDropdown ? (
    <Box
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
              transform: 'scale(0.96) translateY(-10px)',
            },
            to: {
              opacity: 1,
              transform: 'scale(1) translateY(0)',
            },
          },
          animation:
            'searchPanelIn 220ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
          backgroundColor:
            theme.palette.mode === 'dark'
              ? 'rgb(34, 36, 42)'
              : theme.palette.background.paper,
          backgroundImage: 'none',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '16px',
          boxShadow:
            theme.palette.mode === 'dark'
              ? `0 16px 40px ${alpha('#000', 0.45)}`
              : `0 14px 36px ${alpha('#1E3248', 0.14)}`,
          boxSizing: 'border-box',
          maxHeight: `calc(100dvh - ${MOBILE_TOP_BAR_HEIGHT_PX}px - ${SAFE_AREA_TOP} - 72px)`,
          overflowX: 'hidden',
          overflowY: 'auto',
          py: 0.5,
          transformOrigin: 'top center',
          width: '100%',
        }}
      >
        {suggestions.length === 0 ? (
          <Box sx={{ color: theme.palette.text.secondary, fontSize: 14, px: 2, py: 2 }}>
            {t('core:action.search_apps', { postProcess: 'capitalizeFirstChar' })}
          </Box>
        ) : null}
        {suggestions.map((item, index) => {
          // Stagger the first rows like the account menu; cap so long lists
          // don't take forever to settle.
          const itemAnimationSx = {
            '@keyframes searchItemIn': {
              from: {
                opacity: 0,
                transform: 'translateY(-10px)',
              },
              to: {
                opacity: 1,
                transform: 'translateY(0)',
              },
            },
            // `both` (not an `opacity: 0` base) so rows stay visible on
            // WebViews that never run CSS animations.
            animation: `searchItemIn 200ms cubic-bezier(0.22, 1, 0.36, 1) ${
              40 + Math.min(index, 8) * 35
            }ms both`,
          };

          if (item.type === 'link') {
            return (
              <ButtonBase
                key="qortal-link"
                onClick={openAsLink}
                sx={{
                  ...itemAnimationSx,
                  backgroundColor:
                    highlightedIndex === index
                      ? theme.palette.action.hover
                      : 'transparent',
                  borderRadius: '12px',
                  gap: 1.25,
                  justifyContent: 'flex-start',
                  mx: 0.75,
                  px: 1.25,
                  py: 1.1,
                  textAlign: 'left',
                  transition: 'background-color 120ms ease',
                  width: 'calc(100% - 12px)',
                  '&:active': {
                    backgroundColor: alpha(theme.palette.text.primary, 0.08),
                  },
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    backgroundColor: alpha(theme.palette.primary.main, 0.1),
                    borderRadius: '10px',
                    color: theme.palette.primary.main,
                    display: 'flex',
                    flexShrink: 0,
                    height: 36,
                    justifyContent: 'center',
                    width: 36,
                  }}
                >
                  <LinkIcon sx={{ fontSize: 20 }} />
                </Box>
                <Box
                  sx={{
                    color: theme.palette.text.primary,
                    flexShrink: 0,
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {item.label}
                </Box>
                <Box
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: 12,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {normalizeQortalInput(query)}
                </Box>
              </ButtonBase>
            );
          }

          const app = item.app;
          const title = app?.metadata?.title || app?.name || '';
          return (
            <ButtonBase
              key={`${app?.service}-${app?.name}`}
              onClick={() => openApp(app)}
              sx={{
                ...itemAnimationSx,
                alignItems: 'center',
                backgroundColor:
                  highlightedIndex === index
                    ? theme.palette.action.hover
                    : 'transparent',
                borderRadius: '12px',
                gap: 1.25,
                justifyContent: 'flex-start',
                mx: 0.75,
                px: 1.25,
                py: 0.9,
                textAlign: 'left',
                transition: 'background-color 120ms ease',
                width: 'calc(100% - 12px)',
                '&:active': {
                  backgroundColor: alpha(theme.palette.text.primary, 0.08),
                },
              }}
            >
              <AppThumbnailAvatar
                alt={title}
                appName={app?.privateAppProperties?.logo ? undefined : app?.name}
                fallbackSize={24}
                privateLogo={app?.privateAppProperties?.logo}
                sx={{ flexShrink: 0, height: 36, width: 36 }}
                variant="rounded"
              />
              <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <Box
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: 14,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {title}
                </Box>
                {app?.name ? (
                  <Box
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: 12,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {app.name}
                  </Box>
                ) : null}
              </Box>
            </ButtonBase>
          );
        })}
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
        {/* Covers the open app/page below so scroll/touch dismisses search. */}
        <Box
          aria-hidden
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
