import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { alpha, darken } from '@mui/material/styles';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  SECTION_ATTR,
  SECTION_SURFACE_TOUCH_ACTION,
  SECTION_SWIPE_SURFACE_ATTR,
} from '../../Mobile/sectionSwipe/sectionSwipe';
import ErrorBoundary from '../../../common/ErrorBoundary';
import { Spacer } from '../../../common/Spacer';
import { HomeProfileCard } from '../HomeProfileCard';
import { GETTING_STARTED_LS_KEY } from '../gettingStartedStorage';
import { HomeQortinoWorkspaceCard } from '../HomeQortinoWorkspaceCard';
import { HomeQuickToolsPad } from '../HomeQuickToolsPad';
import { HomeFeaturedApps } from '../HomeFeaturedApps';
import { HomeQuitterComposer } from '../../Widgets/quitter/HomeQuitterComposer';
import { useTranslation } from 'react-i18next';
import {
  LazyMotion,
  domAnimation,
  motion,
  useReducedMotion,
} from 'framer-motion';
import { getBaseApiReact } from '../../../App';
import { executeEvent } from '../../../utils/events';
import { openQChatTab } from '../../../utils/openQChatTab';
import {
  dashboardPanelSx,
  useDashboardPanelMouseLight,
} from '../dashboardPanelEffects';
import { DashboardWidgetFrame } from '../../Widgets/DashboardWidgetFrame';
import { GroupsWidget } from '../../Widgets/GroupsWidget';
import { QuitterFeedWidget } from '../../Widgets/QuitterFeedWidget';
import { InfoPreviewPanel } from './InfoPreviewPanel';
import { HomeDesktopWalletActivity } from './HomeDesktopWalletActivity';
import {
  HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
  HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS,
  HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS,
  HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT,
  HOME_CUSTOMIZABLE_CARD_RESIZE_STEP_PX,
  HOME_DASHBOARD_VERTICAL_GAP_PX,
  HOME_DASHBOARD_WIDGET_DISPLAY_MODE,
  HOME_DASHBOARD_WIDGET_HEIGHT_PX,
  HOME_EMBEDDED_QAPP_PANEL_HEIGHT_PX,
  HOME_GROUP_ACTIVITY_CARD_DEFAULT_HEIGHT_PX,
  HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX,
  HOME_LEFT_CENTER_GRID_TEMPLATE_COLUMNS,
  HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS,
  HOME_QUITTER_WIDGET_INITIAL_BATCH_SIZES,
  HOME_QUITTER_WIDGET_LOAD_MORE_BATCH_SIZES,
  HOME_QUITTER_WIDGET_SEARCH_LIMITS,
  HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX,
  HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX,
  HOME_SHARED_SIDE_RAIL_WIDTH_XL,
  HOME_WIDE_DASHBOARD_MIN_WIDTH_PX,
} from './homeDesktopConstants';
import type {
  HomeCustomizableCardId,
  HomeCustomizableCardsLayout,
  HomeLayoutDebugKey,
  HomeLayoutDebugMetric,
} from './types';
import {
  clampHomeCustomizableCardHeight,
  measureHomeLayoutDebugMetric,
  parseHomeCustomizableCardsLayout,
} from './utils';
import { returnToQChat } from './homeNavigation';
import {
  composerAppName,
  useComposerTarget,
} from '../../Widgets/quitter/composerTarget';
import {
  HOME_WINDOW_ORDER_DEFAULT,
  type HomeWindowId,
  mergeVisibleWindowOrder,
  readHomeWindowOrder,
  useHomeModuleVisibility,
  writeHomeWindowOrder,
} from './homeLayout';
import { type HomeWindow, HomeWindowStack } from './HomeWindowStack';

const HomeDesktopInner = ({
  myAddress,
  setGroupSection,
  setDesktopViewMode,
  desktopViewMode,
  onOpenSettings,
  onOpenQortalLand,
}) => {
  const groupActivityPanelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const groupActivityCardHeightRef = useRef<HTMLDivElement | null>(null);
  const quitterCardHeightRef = useRef<HTMLDivElement | null>(null);
  const homeLayoutDebugRootRef = useRef<HTMLDivElement | null>(null);
  const accountOverviewDebugRef = useRef<HTMLDivElement | null>(null);
  const infoDebugRef = useRef<HTMLDivElement | null>(null);
  const profileCardDebugRef = useRef<HTMLDivElement | null>(null);
  const toolsDebugRef = useRef<HTMLDivElement | null>(null);
  const featuredAppsDebugRef = useRef<HTMLDivElement | null>(null);
  const walletActivityDebugRef = useRef<HTMLDivElement | null>(null);
  const rightRailRef = useRef<HTMLDivElement | null>(null);
  const layoutStabilizeFrameRef = useRef<number | null>(null);
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [walletActivityTargetHeightPx, setWalletActivityTargetHeightPx] =
    useState<number | null>(null);
  const [qortinoCardTargetHeightPx, setQortinoCardTargetHeightPx] = useState<
    number | null
  >(null);
  const [customizableCardsLayout, setCustomizableCardsLayout] =
    useState<HomeCustomizableCardsLayout>(() =>
      parseHomeCustomizableCardsLayout(
        localStorage.getItem(HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY)
      )
    );
  // What Home shows (Profile settings) and, on a phone, in which order.
  const moduleVisibility = useHomeModuleVisibility();
  const isGroupActivityModuleVisible = moduleVisibility.groupActivity;
  const isQuitterFeedModuleVisible = moduleVisibility.feed;
  const [homeScroller, setHomeScroller] = useState<HTMLDivElement | null>(null);
  const [groupWidgetRefreshToken, setGroupWidgetRefreshToken] = useState(0);
  const [isGroupWidgetRefreshing, setIsGroupWidgetRefreshing] = useState(false);
  const [quitterWidgetRefreshToken, setQuitterWidgetRefreshToken] = useState(0);
  const [isQuitterWidgetRefreshing, setIsQuitterWidgetRefreshing] =
    useState(false);
  const reduce = useReducedMotion();
  const { t } = useTranslation(['core', 'group', 'tutorial', 'auth']);
  const td = useCallback(
    (key: string, defaultValue: string, options: Record<string, string> = {}) =>
      t(`group:dashboard.${key}`, { defaultValue, ...options }),
    [t]
  );
  const theme = useTheme();
  // The feed shows the app the Home composer posts to: Quitter or Torq.
  const feedApp = composerAppName(useComposerTarget());
  const isSplitDashboardLayout = useMediaQuery(theme.breakpoints.up('md'));
  const isWideDashboardLayout = useMediaQuery(
    theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)
  );
  const resolvedWideLeftLowerRowPanelHeightPx = isWideDashboardLayout
    ? HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX
    : null;
  const resolvedQortinoCardHeightPx = isSplitDashboardLayout
    ? (qortinoCardTargetHeightPx ?? HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX)
    : null;
  const resolvedWalletActivityHeightPx = isWideDashboardLayout
    ? (walletActivityTargetHeightPx ??
      HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX)
    : null;

  const infoPanelMaxExpandedHeightPx =
    isWideDashboardLayout && resolvedWalletActivityHeightPx != null
      ? HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX +
        HOME_DASHBOARD_VERTICAL_GAP_PX +
        resolvedWalletActivityHeightPx +
        2
      : null;
  const handleOpenReceiveQort = useCallback(
    (target: HTMLElement | null) => {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const rightRailRect = isWideDashboardLayout
        ? rightRailRef.current?.getBoundingClientRect()
        : null;
      executeEvent('openReceiveQortInternal', {
        address: myAddress ?? '',
        anchorRect: {
          height: rect.height,
          left: rect.left,
          top: rect.top,
          width: rect.width,
        },
        targetRect: rightRailRect
          ? {
              height: rightRailRect.height,
              left: rightRailRect.left,
              top: rightRailRect.top,
              width: rightRailRect.width,
            }
          : null,
      });
    },
    [isWideDashboardLayout, myAddress]
  );
  const assignGroupActivityPanelNode = useCallback(
    (node: HTMLDivElement | null) => {
      groupActivityPanelRef.current = node;
      groupActivityCardHeightRef.current = node;
    },
    [groupActivityPanelRef]
  );

  useEffect(() => {
    localStorage.setItem(
      HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
      JSON.stringify(customizableCardsLayout)
    );
  }, [customizableCardsLayout]);

  useEffect(() => {
    setCustomizableCardsLayout((currentLayout) => {
      let changed = false;
      const nextHeights: Partial<Record<HomeCustomizableCardId, number>> = {
        ...currentLayout.heights,
      };

      HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT.forEach((cardId) => {
        const currentHeight = currentLayout.heights[cardId];
        if (
          typeof currentHeight !== 'number' ||
          !Number.isFinite(currentHeight)
        ) {
          return;
        }
        const clampedHeight = clampHomeCustomizableCardHeight(
          cardId,
          currentHeight
        );
        if (clampedHeight !== currentHeight) {
          nextHeights[cardId] = clampedHeight;
          changed = true;
        }
      });

      if (!changed) return currentLayout;
      return {
        ...currentLayout,
        heights: nextHeights,
      };
    });
  }, []);

  useLayoutEffect(() => {
    const rootNode = homeLayoutDebugRootRef.current;

    if (!rootNode || desktopViewMode !== 'home') {
      setWalletActivityTargetHeightPx(null);
      return;
    }

    const measureDebugLayout = () => {
      const rootRect = rootNode.getBoundingClientRect();
      const nextMetrics: Partial<
        Record<HomeLayoutDebugKey, HomeLayoutDebugMetric>
      > = {};

      if (accountOverviewDebugRef.current) {
        nextMetrics.accountOverview = measureHomeLayoutDebugMetric(
          accountOverviewDebugRef.current,
          rootRect
        );
      }

      if (infoDebugRef.current) {
        nextMetrics.info = measureHomeLayoutDebugMetric(
          infoDebugRef.current,
          rootRect
        );
      }

      if (profileCardDebugRef.current) {
        nextMetrics.profileCard = measureHomeLayoutDebugMetric(
          profileCardDebugRef.current,
          rootRect
        );
      }

      if (toolsDebugRef.current) {
        nextMetrics.tools = measureHomeLayoutDebugMetric(
          toolsDebugRef.current,
          rootRect
        );
      }

      if (featuredAppsDebugRef.current) {
        nextMetrics.featuredApps = measureHomeLayoutDebugMetric(
          featuredAppsDebugRef.current,
          rootRect
        );
      }

      if (walletActivityDebugRef.current) {
        nextMetrics.walletActivity = measureHomeLayoutDebugMetric(
          walletActivityDebugRef.current,
          rootRect
        );
      }

      if (isWideDashboardLayout) {
        const profileMetric = nextMetrics.profileCard;
        const leftRowMetric =
          nextMetrics.featuredApps ?? nextMetrics.tools ?? undefined;
        const featuredMetric = nextMetrics.featuredApps;
        const toolsMetric = nextMetrics.tools;
        const walletMetric = nextMetrics.walletActivity;

        if (profileMetric && featuredMetric && toolsMetric) {
          const nextQortinoTargetHeight = Math.max(
            HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX,
            Math.round(
              profileMetric.height + featuredMetric.height - toolsMetric.height
            )
          );

          setQortinoCardTargetHeightPx((currentHeight) =>
            currentHeight !== null &&
            Math.abs(currentHeight - nextQortinoTargetHeight) < 0.25
              ? currentHeight
              : nextQortinoTargetHeight
          );
        } else {
          setQortinoCardTargetHeightPx(null);
        }

        if (leftRowMetric && walletMetric) {
          const nextTargetHeight = Math.max(
            0,
            leftRowMetric.bottom - walletMetric.top
          );

          setWalletActivityTargetHeightPx((currentHeight) =>
            currentHeight !== null &&
            Math.abs(currentHeight - nextTargetHeight) < 0.25
              ? currentHeight
              : nextTargetHeight
          );
        } else {
          setWalletActivityTargetHeightPx(null);
        }
      } else {
        setQortinoCardTargetHeightPx(null);
        setWalletActivityTargetHeightPx(null);
      }

      return {
        accountOverviewTop: nextMetrics.accountOverview?.top ?? 0,
        featuredBottom: nextMetrics.featuredApps?.bottom ?? 0,
        featuredTop: nextMetrics.featuredApps?.top ?? 0,
        infoBottom: nextMetrics.info?.bottom ?? 0,
        toolsBottom: nextMetrics.tools?.bottom ?? 0,
        walletBottom: nextMetrics.walletActivity?.bottom ?? 0,
        walletTop: nextMetrics.walletActivity?.top ?? 0,
      };
    };

    const cancelLayoutStabilizePass = () => {
      if (layoutStabilizeFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutStabilizeFrameRef.current);
        layoutStabilizeFrameRef.current = null;
      }
    };

    const startLayoutStabilizePass = () => {
      cancelLayoutStabilizePass();

      const startTime = performance.now();
      let lastSnapshot = '';
      let stableFrameCount = 0;

      const step = () => {
        const snapshot = measureDebugLayout();
        const snapshotKey = JSON.stringify(snapshot);

        if (snapshotKey === lastSnapshot) {
          stableFrameCount += 1;
        } else {
          lastSnapshot = snapshotKey;
          stableFrameCount = 0;
        }

        const elapsed = performance.now() - startTime;
        if (stableFrameCount >= 3 || elapsed > 900) {
          layoutStabilizeFrameRef.current = null;
          return;
        }

        layoutStabilizeFrameRef.current = window.requestAnimationFrame(step);
      };

      layoutStabilizeFrameRef.current = window.requestAnimationFrame(step);
    };

    measureDebugLayout();
    startLayoutStabilizePass();

    const fonts = (
      document as Document & {
        fonts?: { ready?: Promise<unknown> };
      }
    ).fonts;

    if (fonts?.ready) {
      fonts.ready.then(() => {
        startLayoutStabilizePass();
      });
    }

    const observedNodes = [
      rootNode,
      accountOverviewDebugRef.current,
      infoDebugRef.current,
      profileCardDebugRef.current,
      toolsDebugRef.current,
      featuredAppsDebugRef.current,
      walletActivityDebugRef.current,
    ].filter(Boolean) as HTMLElement[];

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureDebugLayout);

      return () => {
        window.removeEventListener('resize', measureDebugLayout);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      startLayoutStabilizePass();
    });

    observedNodes.forEach((node) => {
      resizeObserver.observe(node);
    });
    window.addEventListener('resize', startLayoutStabilizePass);

    return () => {
      cancelLayoutStabilizePass();
      resizeObserver.disconnect();
      window.removeEventListener('resize', startLayoutStabilizePass);
    };
  }, [desktopViewMode, isOnboardingComplete, isWideDashboardLayout]);

  useEffect(() => {
    if (!myAddress) {
      setIsOnboardingComplete(false);
      return;
    }

    const isComplete =
      localStorage.getItem(`${GETTING_STARTED_LS_KEY}_${myAddress}`) ===
      'completed';
    setIsOnboardingComplete(isComplete);
  }, [myAddress]);

  const handleGettingStartedComplete = useCallback(() => {
    setIsOnboardingComplete(true);
  }, []);

  const handleRefreshGroupActivity = useCallback(() => {
    setGroupWidgetRefreshToken((value) => value + 1);
  }, []);

  const handleRefreshQuitterWidget = useCallback(() => {
    setQuitterWidgetRefreshToken((value) => value + 1);
  }, []);

  const handleSwapDashboardWidgets = useCallback(() => {
    setCustomizableCardsLayout((currentLayout) => ({
      ...currentLayout,
      order: [...currentLayout.order].reverse(),
    }));
  }, []);

  const handleOpenAppsPanel = useCallback(() => {
    executeEvent('newTabWindow', {});
    setDesktopViewMode('apps');
  }, [setDesktopViewMode]);
  const handleOpenEmbeddedQuitter = useCallback(() => {
    executeEvent('addTab', { data: { service: 'APP', name: feedApp } });
    executeEvent('open-apps-mode', {});
  }, [feedApp]);
  const handleOpenQChatPanel = useCallback(() => {
    returnToQChat(setGroupSection, openQChatTab);
  }, [setGroupSection]);
  const handleOpenGroupsWidget = useCallback(() => {
    handleOpenQChatPanel();
  }, [handleOpenQChatPanel]);

  const qortinoWorkspaceShellFallback = (
    <Box
      sx={{
        ...dashboardPanelSx(theme, 'utility'),
        alignItems: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
        justifyContent: 'center',
        p: '20px',
      }}
    >
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}
      >
        {td('qortino_runtime_title', 'QORTINO card shell hit a runtime snag.')}
      </Typography>
      <Typography
        sx={{
          color: alpha(theme.palette.text.secondary, 0.82),
          fontSize: '0.82rem',
          lineHeight: 1.5,
          maxWidth: '34ch',
        }}
      >
        {td(
          'qortino_runtime_body',
          'The rest of the dashboard is still safe. Refresh GO and if this keeps happening report it to the team.'
        )}
      </Typography>
    </Box>
  );
  const groupActivityCardOrder = Math.max(
    0,
    customizableCardsLayout.order.indexOf('groupActivity')
  );
  const quitterCardOrder = Math.max(
    0,
    customizableCardsLayout.order.indexOf('quitter')
  );
  const quitterWidgetInitialBatchSize =
    HOME_QUITTER_WIDGET_INITIAL_BATCH_SIZES[HOME_DASHBOARD_WIDGET_DISPLAY_MODE];
  const quitterWidgetLoadMoreBatchSize =
    HOME_QUITTER_WIDGET_LOAD_MORE_BATCH_SIZES[
      HOME_DASHBOARD_WIDGET_DISPLAY_MODE
    ];
  const quitterWidgetSearchLimit =
    HOME_QUITTER_WIDGET_SEARCH_LIMITS[HOME_DASHBOARD_WIDGET_DISPLAY_MODE];
  const areBothDashboardModulesVisible =
    isGroupActivityModuleVisible && isQuitterFeedModuleVisible;
  const isFeaturedAppsVisible = moduleVisibility.featured;
  const isStatusVisible = moduleVisibility.status;
  // Phones: one column of windows in the user's order (long press one to
  // move it). Wider screens keep the dashboard layout.
  const isPhoneStack = !isSplitDashboardLayout;

  const handlePhoneReorder = useCallback((visibleOrder: HomeWindowId[]) => {
    writeHomeWindowOrder(
      mergeVisibleWindowOrder(readHomeWindowOrder(), visibleOrder)
    );
  }, []);

  const qortinoWorkspaceCard = (
    // The card stays built while Home is parked (its <Activity> stops the
    // card's work), so Home keeps its layout: unmounting it collapsed Home
    // by the card's height, and Home came back (or slid in with the section
    // swipe) shifted from where it was left. Its sheet lives on Group.
    <ErrorBoundary fallback={qortinoWorkspaceShellFallback}>
      <HomeQortinoWorkspaceCard
        onGettingStartedComplete={handleGettingStartedComplete}
        onOpenAppsPanel={handleOpenAppsPanel}
        showQortino={moduleVisibility.qortino}
      />
    </ErrorBoundary>
  );
  const profileCard = <HomeProfileCard onOpenReceive={handleOpenReceiveQort} />;
  const composerCard = (
    <HomeQuitterComposer onPublished={handleRefreshQuitterWidget} />
  );
  const quickToolsCard = (
    <HomeQuickToolsPad
      fillHeight={false}
      onOpenApps={handleOpenAppsPanel}
      onOpenChat={handleOpenQChatPanel}
      onOpenQortalLand={onOpenQortalLand}
      onOpenSettings={onOpenSettings}
    />
  );
  const featuredAppsSx = {
    display: 'flex',
    height:
      resolvedWideLeftLowerRowPanelHeightPx != null
        ? `${resolvedWideLeftLowerRowPanelHeightPx}px`
        : undefined,
    minWidth: 0,
    overflow: 'visible',
    position: 'relative',
    width: '100%',
    '& > *': {
      height: '100%',
      position: 'relative',
      width: '100%',
      zIndex: 1,
    },
  } as const;
  const statusPanel = (
    <InfoPreviewPanel maxExpandedHeightPx={infoPanelMaxExpandedHeightPx} />
  );
  const groupActivityCard = (
    <DashboardWidgetFrame
      actionIcon={<ForumRoundedIcon sx={{ fontSize: '0.86rem' }} />}
      actionLabel={td('open_in_q_chat', 'Open in Q-Chat')}
      height={HOME_DASHBOARD_WIDGET_HEIGHT_PX}
      onAction={handleOpenGroupsWidget}
      onRefresh={handleRefreshGroupActivity}
      onSwap={
        areBothDashboardModulesVisible && !isPhoneStack
          ? handleSwapDashboardWidgets
          : undefined
      }
      order={isPhoneStack ? undefined : groupActivityCardOrder}
      panelRef={assignGroupActivityPanelNode}
      refreshing={isGroupWidgetRefreshing}
      title={t('group:home.group_activity', {
        postProcess: 'capitalizeFirstChar',
      })}
      widgetId="groups"
    >
      <GroupsWidget
        displayMode={HOME_DASHBOARD_WIDGET_DISPLAY_MODE}
        myAddress={myAddress}
        onRefreshStateChange={setIsGroupWidgetRefreshing}
        refreshToken={groupWidgetRefreshToken}
      />
    </DashboardWidgetFrame>
  );
  const feedTitle =
    feedApp === 'Torq'
      ? td('torq_feed', 'Torq Feed')
      : td('quitter_feed', 'Quitter Feed');
  const feedCard = (
    <DashboardWidgetFrame
      actionIcon={<OpenInNewRoundedIcon sx={{ fontSize: '0.86rem' }} />}
      actionLabel={td('open_in_q_apps', 'Open in Q-Apps')}
      height={HOME_DASHBOARD_WIDGET_HEIGHT_PX}
      onAction={handleOpenEmbeddedQuitter}
      onRefresh={handleRefreshQuitterWidget}
      onSwap={
        areBothDashboardModulesVisible && !isPhoneStack
          ? handleSwapDashboardWidgets
          : undefined
      }
      order={isPhoneStack ? undefined : quitterCardOrder}
      panelRef={quitterCardHeightRef}
      refreshing={isQuitterWidgetRefreshing}
      title={feedTitle}
      widgetId="quitter"
    >
      <QuitterFeedWidget
        batchSize={quitterWidgetLoadMoreBatchSize}
        displayMode={HOME_DASHBOARD_WIDGET_DISPLAY_MODE}
        initialBatchSize={quitterWidgetInitialBatchSize}
        onRefreshStateChange={setIsQuitterWidgetRefreshing}
        refreshToken={quitterWidgetRefreshToken}
        searchLimit={quitterWidgetSearchLimit}
      />
    </DashboardWidgetFrame>
  );

  const phoneWindows: HomeWindow[] = [];
  if (isPhoneStack) {
    const byId: Partial<Record<HomeWindowId, Omit<HomeWindow, 'id'>>> = {
      workspace: {
        icon: <AppsRoundedIcon fontSize="small" />,
        label: moduleVisibility.qortino
          ? td('home_window_hotkeys_qortino', 'Hotkeys and Qortino')
          : td('home_window_hotkeys', 'Hotkeys'),
        node: qortinoWorkspaceCard,
      },
      account: {
        icon: <PersonRoundedIcon fontSize="small" />,
        label: td('account_overview', 'Account Overview'),
        node: profileCard,
      },
      composer: {
        icon: <EditRoundedIcon fontSize="small" />,
        label: td('home_window_composer', 'Post to {{app}}', {
          app: feedApp,
        }),
        node: composerCard,
      },
      tools: {
        icon: <WidgetsRoundedIcon fontSize="small" />,
        label: td('home_window_quick_tools', 'Quick tools'),
        node: quickToolsCard,
      },
      featured: isFeaturedAppsVisible
        ? {
            icon: <StarRoundedIcon fontSize="small" />,
            label: td('featured_q_apps', 'Featured Q-Apps'),
            node: (
              <Box sx={featuredAppsSx}>
                <HomeFeaturedApps />
              </Box>
            ),
          }
        : undefined,
      status: isStatusVisible
        ? {
            icon: <MonitorHeartRoundedIcon fontSize="small" />,
            label: td('home_window_status', 'Status'),
            node: <Box sx={{ '& > *': { height: '100%' } }}>{statusPanel}</Box>,
          }
        : undefined,
      wallet: {
        icon: <AccountBalanceWalletRoundedIcon fontSize="small" />,
        label: td('wallet_activity', 'Wallet Activity'),
        node: (
          <Box sx={{ minHeight: '182px', '& > *': { height: '100%' } }}>
            <HomeDesktopWalletActivity />
          </Box>
        ),
      },
      groupActivity: isGroupActivityModuleVisible
        ? {
            icon: <ForumRoundedIcon fontSize="small" />,
            label: t('group:home.group_activity', {
              postProcess: 'capitalizeFirstChar',
            }),
            node: groupActivityCard,
          }
        : undefined,
      feed: isQuitterFeedModuleVisible
        ? {
            icon: <DynamicFeedRoundedIcon fontSize="small" />,
            label: feedTitle,
            node: feedCard,
          }
        : undefined,
    };
    // In a fixed order: the stack shows them in the saved one (CSS order),
    // so a new order never re-renders Home.
    HOME_WINDOW_ORDER_DEFAULT.forEach((id) => {
      const entry = byId[id];
      if (entry) phoneWindows.push({ id, ...entry });
    });
  }

  return (
    // Shown and hidden by the <Activity> around it in Group: this component
    // is only ever on screen as Home, and never re-renders just to switch.
    <LazyMotion features={domAnimation}>
      <motion.div
        ref={setHomeScroller}
        data-tour="hub-home-page"
        // The sideways swipe between Home, Apps and Chat (phones).
        {...{
          [SECTION_ATTR]: 'home',
          [SECTION_SWIPE_SURFACE_ATTR]: '',
        }}
        key="home"
        initial={{ opacity: 0, scale: 1 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        custom={reduce}
        style={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflowX: 'hidden',
          overflowY: 'auto',
          scrollbarGutter: 'stable',
          // A sideways start never scrolls the page: it is the section
          // swipe's (carousels inside keep their own sideways scroll).
          touchAction: SECTION_SURFACE_TOUCH_ACTION,
          width: '100%',
          willChange: 'opacity',
          backfaceVisibility: 'hidden',
        }}
      >
        <Spacer height="20px" />
        <Box
          ref={homeLayoutDebugRootRef}
          sx={{
            alignItems: 'flex-start',
            display: 'flex',
            flexDirection: 'column',
            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
            maxWidth: '1320px',
            padding: { xs: '0 12px', sm: '0 20px' },
            position: 'relative',
            width: '100%',
            [theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)]: {
              maxWidth: '1520px',
            },
          }}
        >
          {isPhoneStack ? (
            <HomeWindowStack
              gap={HOME_DASHBOARD_VERTICAL_GAP_PX}
              onReorder={handlePhoneReorder}
              scroller={homeScroller}
              windows={phoneWindows}
            />
          ) : (
            <>
              <Box
                sx={{
                  alignItems: 'start',
                  display: 'grid',
                  gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                  gridTemplateColumns: '1fr',
                  width: '100%',
                  [theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)]: {
                    alignItems: 'stretch',
                    gridTemplateColumns: `minmax(0, 1fr) ${HOME_SHARED_SIDE_RAIL_WIDTH_XL}`,
                  },
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                    minWidth: 0,
                    width: '100%',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      width: '100%',
                    }}
                  >
                    {isWideDashboardLayout ? (
                      <Box
                        sx={{
                          alignItems: 'start',
                          display: 'grid',
                          gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                          gridTemplateColumns:
                            HOME_LEFT_CENTER_GRID_TEMPLATE_COLUMNS.xl,
                          width: '100%',
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                            minWidth: 0,
                            width: '100%',
                          }}
                        >
                          <Box
                            ref={accountOverviewDebugRef}
                            sx={{
                              display: 'block',
                              height:
                                resolvedQortinoCardHeightPx != null
                                  ? `${resolvedQortinoCardHeightPx}px`
                                  : undefined,
                              minWidth: 0,
                              position: 'relative',
                              '& > *': { height: '100%' },
                            }}
                          >
                            {qortinoWorkspaceCard}
                          </Box>
                          <Box
                            ref={toolsDebugRef}
                            sx={{
                              display: 'block',
                              minWidth: 0,
                              position: 'relative',
                              width: '100%',
                            }}
                          >
                            {quickToolsCard}
                          </Box>
                        </Box>
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                            minWidth: 0,
                            width: '100%',
                          }}
                        >
                          <Box
                            ref={profileCardDebugRef}
                            sx={{
                              display: 'block',
                              minWidth: 0,
                              position: 'relative',
                              width: '100%',
                              '& > *': { width: '100%' },
                            }}
                          >
                            {profileCard}
                          </Box>
                          <Box
                            sx={{
                              display: 'block',
                              minWidth: 0,
                              position: 'relative',
                              width: '100%',
                              '& > *': { width: '100%' },
                            }}
                          >
                            {composerCard}
                          </Box>
                          {isFeaturedAppsVisible ? (
                            <Box ref={featuredAppsDebugRef} sx={featuredAppsSx}>
                              <HomeFeaturedApps />
                            </Box>
                          ) : null}
                        </Box>
                      </Box>
                    ) : (
                      <>
                        <Box
                          sx={{
                            display: 'grid',
                            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                            gridTemplateColumns:
                              HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS,
                            alignItems: 'stretch',
                            width: '100%',
                          }}
                        >
                          <Box
                            ref={accountOverviewDebugRef}
                            sx={{
                              display: 'block',
                              height:
                                resolvedQortinoCardHeightPx != null
                                  ? `${resolvedQortinoCardHeightPx}px`
                                  : undefined,
                              minWidth: 0,
                              position: 'relative',
                              '& > *': { height: '100%' },
                            }}
                          >
                            {qortinoWorkspaceCard}
                          </Box>
                          <Box
                            ref={profileCardDebugRef}
                            sx={{
                              display: 'block',
                              minWidth: 0,
                              position: 'relative',
                              width: '100%',
                              '& > *': { width: '100%' },
                            }}
                          >
                            {profileCard}
                          </Box>
                        </Box>
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                            width: '100%',
                          }}
                        >
                          <Box
                            sx={{
                              display: 'block',
                              minWidth: 0,
                              position: 'relative',
                              width: '100%',
                              '& > *': { width: '100%' },
                            }}
                          >
                            {composerCard}
                          </Box>
                          <Box
                            sx={{
                              display: 'grid',
                              gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                              gridTemplateColumns:
                                HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS,
                              alignItems: 'stretch',
                              width: '100%',
                            }}
                          >
                            <Box
                              ref={toolsDebugRef}
                              sx={{
                                display: 'block',
                                minWidth: 0,
                                position: 'relative',
                                width: '100%',
                              }}
                            >
                              {quickToolsCard}
                            </Box>
                            {isFeaturedAppsVisible ? (
                              <Box
                                ref={featuredAppsDebugRef}
                                sx={featuredAppsSx}
                              >
                                <HomeFeaturedApps />
                              </Box>
                            ) : null}
                          </Box>
                        </Box>
                      </>
                    )}
                  </Box>
                </Box>
                <Box
                  ref={rightRailRef}
                  data-home-right-rail=""
                  sx={{
                    alignContent: 'start',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                    minWidth: 0,
                    [theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)]: {
                      display: 'grid',
                      gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                      gridTemplateRows: `${
                        isStatusVisible
                          ? `${HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX}px `
                          : ''
                      }${
                        resolvedWalletActivityHeightPx != null
                          ? `${resolvedWalletActivityHeightPx}px`
                          : 'auto'
                      }`,
                      marginTop: `${HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX}px`,
                    },
                  }}
                >
                  {isStatusVisible ? (
                    <Box
                      ref={infoDebugRef}
                      sx={{
                        minWidth: 0,
                        position: 'relative',
                        width: '100%',
                        '& > *': { height: '100%' },
                      }}
                    >
                      {statusPanel}
                    </Box>
                  ) : null}
                  <Box
                    ref={walletActivityDebugRef}
                    sx={{
                      maxWidth: { xs: '100%', md: '360px' },
                      position: 'relative',
                      width: '100%',
                      minHeight: '182px',
                      height:
                        resolvedWalletActivityHeightPx != null
                          ? `${resolvedWalletActivityHeightPx}px`
                          : undefined,
                      '& > *': { height: '100%' },
                    }}
                  >
                    <HomeDesktopWalletActivity />
                  </Box>
                </Box>
              </Box>

              {isGroupActivityModuleVisible || isQuitterFeedModuleVisible ? (
                <Box
                  sx={{
                    alignItems: 'start',
                    display: 'grid',
                    gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                    gridTemplateColumns: '1fr',
                    width: '100%',
                    [theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)]: {
                      gridTemplateColumns: areBothDashboardModulesVisible
                        ? 'repeat(2, minmax(0, 1fr))'
                        : '1fr',
                    },
                  }}
                >
                  {isGroupActivityModuleVisible ? groupActivityCard : null}
                  {isQuitterFeedModuleVisible ? feedCard : null}
                </Box>
              ) : null}
            </>
          )}
        </Box>
        <Spacer height="120px" />
      </motion.div>
    </LazyMotion>
  );
};

type HomeDesktopProps = {
  myAddress?: string;
  setGroupSection?: unknown;
  setDesktopViewMode?: unknown;
  desktopViewMode?: string;
  onOpenSettings?: unknown;
  onOpenQortalLand?: unknown;
  [other: string]: unknown;
};

/**
 * Home re-renders only for its own inputs. It is always given
 * desktopViewMode 'home' (Group's <Activity> shows and hides it), and the
 * rest of what Group passes is unused: without this, every Group update and
 * every section switch re-rendered the whole Home page, hidden or not, right
 * as a swipe needed the time.
 */
export const HomeDesktop = memo(
  HomeDesktopInner,
  (prev: HomeDesktopProps, next: HomeDesktopProps) =>
    prev.myAddress === next.myAddress &&
    prev.setGroupSection === next.setGroupSection &&
    prev.setDesktopViewMode === next.setDesktopViewMode &&
    prev.onOpenSettings === next.onOpenSettings &&
    prev.onOpenQortalLand === next.onOpenQortalLand
);
