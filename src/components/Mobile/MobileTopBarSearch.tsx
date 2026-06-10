import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ButtonBase,
  ClickAwayListener,
  IconButton,
  InputBase,
  Paper,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import LinkIcon from '@mui/icons-material/Link';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { availableQappsAtom, appOpenCountsAtom } from '../../atoms/appsAtoms';
import { AppThumbnailAvatar } from '../Apps/AppThumbnailAvatar';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { MOBILE_TOP_BAR_HEIGHT_PX } from './MobileTopBar';
import { MOBILE_TABS_OVERLAY_Z } from './mobileLayout';
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
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  showActiveTabUrl?: boolean;
  tabsOverlayOpen?: boolean;
};

export const MobileTopBarSearch = ({
  activeTabUrl = '',
  expanded,
  onExpandedChange,
  showActiveTabUrl = false,
  tabsOverlayOpen = false,
}: MobileTopBarSearchProps) => {
  const theme = useTheme();
  const availableQapps = useAtomValue(availableQappsAtom);
  const openCounts = useAtomValue(appOpenCountsAtom);
  const [query, setQuery] = useState('');
  const [draftTouched, setDraftTouched] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation(['core']);

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
    if (showActiveTabUrl) {
      setDropdownOpen(false);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(timer);
    }
    setDropdownOpen(true);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [expanded, showActiveTabUrl]);

  const collapse = useCallback(() => {
    setDraftTouched(false);
    setQuery(showActiveTabUrl && activeTabUrl ? activeTabUrl : '');
    setDropdownOpen(false);
    onExpandedChange(false);
  }, [activeTabUrl, onExpandedChange, showActiveTabUrl]);

  const openAsLink = useCallback(() => {
    if (openAppsSearchLink(query)) {
      setQuery('');
      collapse();
    }
  }, [collapse, query]);

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

  const resultsTop = `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + env(safe-area-inset-top, 0px))`;

  const resultsPanel = showDropdown ? (
    <Box
      sx={{
        left: 'max(10px, env(safe-area-inset-left, 0px))',
        position: 'fixed',
        right: 'max(10px, env(safe-area-inset-right, 0px))',
        top: resultsTop,
        zIndex: (tabsOverlayOpen ? MOBILE_TABS_OVERLAY_Z : 0) + 3,
      }}
    >
      <Paper
        elevation={8}
        sx={{
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '16px',
          boxSizing: 'border-box',
          maxHeight: `calc(100vh - ${MOBILE_TOP_BAR_HEIGHT_PX}px - env(safe-area-inset-top, 0px) - 72px)`,
          overflowX: 'hidden',
          overflowY: 'auto',
          py: 0.5,
          width: '100%',
        }}
      >
        {suggestions.length === 0 ? (
          <Box sx={{ color: theme.palette.text.secondary, fontSize: 14, px: 2, py: 2 }}>
            {t('core:action.search_apps', { postProcess: 'capitalizeFirstChar' })}
          </Box>
        ) : null}
        {suggestions.map((item, index) => {
          if (item.type === 'link') {
            return (
              <ButtonBase
                key="qortal-link"
                onClick={openAsLink}
                sx={{
                  backgroundColor:
                    highlightedIndex === index
                      ? theme.palette.action.hover
                      : 'transparent',
                  borderRadius: '8px',
                  gap: 1.25,
                  justifyContent: 'flex-start',
                  mx: 0.5,
                  px: 2,
                  py: 1.35,
                  textAlign: 'left',
                  width: 'calc(100% - 8px)',
                }}
              >
                <LinkIcon
                  sx={{ color: theme.palette.primary.main, flexShrink: 0, fontSize: 20 }}
                />
                <Box sx={{ color: theme.palette.text.primary, flexShrink: 0, fontSize: 14 }}>
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
                alignItems: 'center',
                backgroundColor:
                  highlightedIndex === index
                    ? theme.palette.action.hover
                    : 'transparent',
                borderRadius: '8px',
                gap: 1.25,
                justifyContent: 'flex-start',
                mx: 0.5,
                px: 2,
                py: 1.1,
                textAlign: 'left',
                width: 'calc(100% - 8px)',
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

  if (expanded) {
    return (
      <ClickAwayListener onClickAway={collapse}>
        <Box
          ref={searchContainerRef}
          sx={{
            alignItems: 'center',
            backgroundColor:
              theme.palette.mode === 'dark'
                ? 'rgb(28, 30, 36)'
                : theme.palette.background.paper,
            display: 'flex',
            gap: 0.75,
            inset: 0,
            paddingLeft: 'max(10px, env(safe-area-inset-left, 0px))',
            paddingRight: 'max(10px, env(safe-area-inset-right, 0px))',
            position: 'absolute',
            zIndex: 2,
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
          {resultsPanel}
        </Box>
      </ClickAwayListener>
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
          maxWidth: showActiveTabUrl ? '100%' : expanded ? '100%' : 240,
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
