import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  Avatar,
  Badge,
  Box,
  ButtonBase,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import ManageSearchRoundedIcon from '@mui/icons-material/ManageSearchRounded';
import {
  getWallets,
  storeWallets,
  walletVersion,
} from '../background/background.ts';
import { getPrimaryNamesForAddresses } from './Group/groupApi';
import {
  getWalletAvatarCacheEntries,
  syncWalletAvatarCachesForAddresses,
  resolveWalletAvatarSrc,
  type WalletAvatarCacheEntry,
} from '../utils/walletAvatarCache';
import { QortalUserAvatar } from './QortalUserAvatar';
import PhraseWallet from '../utils/generateWallet/phrase-wallet.ts';
import { decryptStoredWalletFromSeedPhrase } from '../utils/decryptWallet.ts';
import { crypto } from '../constants/decryptWallet.ts';
import { prewarmKdfWorkers } from '../encryption/kdf';
import { PasswordField } from './index.ts';
import { AuthButton, AuthSectionLabel } from './Auth/AuthShell';
import type { AuthUnlockTransitionSnapshot } from '../types/authTransition';
import {
  hasAttemptedLastWalletAutoSelectThisSession,
  markLastWalletAutoSelectAttemptedThisSession,
} from '../utils/lastAuthenticatedWallet';
import { mobileLoginSettingsOpenAtom } from '../atoms/global';
import { isCapacitor } from '../utils/platform';
import { getBiometricEnabledAddresses, getBiometricEnabledAddressesSync, prefetchWalletSessionProbe, prewarmBiometricUnlockKdf, syncBiometricAutoPromptFlag, syncBiometricPasswordCache, updateEarlyBiometricPromptForTopWallet, warmUpBiometricHardware } from '../utils/walletBiometricAuth';
import { isQortalBiometricHardwareAvailable } from '../plugins/QortalBiometric';

const parsefilenameQortal = (filename) => {
  return filename.startsWith('qortal_backup_') ? filename.slice(14) : filename;
};

const shortenAddress = (address?: string) => {
  if (!address) return '';
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
};

/** Keeps Enter Qortal list height stable while filtering/scrolling */
const ENTRY_WALLET_SCROLL_HEIGHT_PX = 292;

type WalletsProps = {
  setExtState: (state: any) => void;
  setRawWallet: (wallet: any) => void;
  rawWallet?: any;
  mode?: 'entry' | 'import';
  onImportViewChange?: (view: ImportView) => void;
  onReady?: () => void;
  onWalletUnlockStart?: (snapshot: AuthUnlockTransitionSnapshot) => void;
  /** Fired whenever the saved wallet list changes (for login settings on entry). */
  onWalletsChange?: (wallets: any[]) => void;
  /** Scan fingerprint from the account list and unlock without an extra prompt on the unlock screen. */
  onBiometricWalletUnlock?: (
    wallet: any,
    transitionSnapshot?: AuthUnlockTransitionSnapshot
  ) => Promise<boolean>;
  /** Called before navigating to the password unlock screen after a failed list fingerprint scan. */
  onWalletPasswordFallbackUnlock?: () => void;
};

type ImportView = 'choice' | 'backup' | 'seedphrase' | 'authenticate';

export const Wallets = ({
  setExtState,
  setRawWallet,
  mode = 'import',
  onImportViewChange,
  onReady,
  onWalletUnlockStart,
  onWalletsChange,
  onBiometricWalletUnlock,
  onWalletPasswordFallbackUnlock,
}: WalletsProps) => {
  const { t } = useTranslation(['auth']);
  const nativeShell = isCapacitor();
  const isLoginSettingsOpen = useAtomValue(mobileLoginSettingsOpenAtom);
  const [biometricEnabledAddresses, setBiometricEnabledAddresses] = useState<
    Set<string>
  >(() => new Set());
  const [wallets, setWallets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [seedValue, setSeedValue] = useState('');
  const [seedError, setSeedError] = useState('');
  const [password, setPassword] = useState('');
  const [isLoadingEncryptSeed, setIsLoadingEncryptSeed] = useState(false);
  const [isSeedVisible, setIsSeedVisible] = useState(false);
  const [importView, setImportView] = useState<ImportView>('choice');
  const [backupImportHint, setBackupImportHint] = useState('');
  /** Insertion slot index in the wallet list — line appears before wallets[idx] when idx < length */
  const [walletDropGapBeforeIndex, setWalletDropGapBeforeIndex] = useState<
    number | null
  >(null);
  /** Row being dragged — dim original while reordering */
  const [walletReorderDragSourceIndex, setWalletReorderDragSourceIndex] =
    useState<number | null>(null);
  const [primaryNamesByAddress, setPrimaryNamesByAddress] = useState<
    Record<string, string>
  >({});
  const [primaryNamesLoaded, setPrimaryNamesLoaded] = useState(false);
  const [walletAvatarsByAddress, setWalletAvatarsByAddress] = useState<
    Record<string, WalletAvatarCacheEntry>
  >({});
  const [qortalAvatarsByAddress, setQortalAvatarsByAddress] = useState<
    Record<string, boolean | null | undefined>
  >({});
  const [walletEntrySearchOpen, setWalletEntrySearchOpen] = useState(false);
  const [walletEntryFilterQuery, setWalletEntryFilterQuery] = useState('');
  const accountsScrollRef = useRef<HTMLDivElement | null>(null);
  /** True while reordering wallets; dragover hits header/footer/etc. unless we listen on document */
  const walletReorderDragActiveRef = useRef(false);
  /** Entry-mode pointer drag: index of the row lifted, and how far it follows the finger */
  const [walletDragActiveIndex, setWalletDragActiveIndex] = useState<
    number | null
  >(null);
  const [walletDragTranslateY, setWalletDragTranslateY] = useState(0);
  /** Distance between adjacent rows (measured live) — drives neighbour shifts. */
  const [walletDragRowStride, setWalletDragRowStride] = useState(0);
  const walletDragSessionRef = useRef<{
    sourceIdx: number;
    startY: number;
    lastClientY: number;
    pointerId: number;
    activated: boolean;
    longPressTimer: number | null;
    gapBeforeIndex: number;
    el: HTMLElement | null;
    // Original (pre-transform) row geometry snapshot + scroll baseline, so the
    // drop target is computed against stable positions — not the live rects
    // that shift as neighbours animate (which would feed back and jitter).
    rowSnapshot: { top: number; height: number }[];
    scrollTop0: number;
    rowStride: number;
  } | null>(null);
  const walletDragAutoScrollRef = useRef<{ raf: number | null; dir: number }>({
    raf: null,
    dir: 0,
  });
  /** Removes the active-drag document touch listeners when the drag ends. */
  const walletDragListenerCleanupRef = useRef<null | (() => void)>(null);
  const attemptedLastWalletAutoSelectRef = useRef(
    hasAttemptedLastWalletAutoSelectThisSession()
  );
  const entryModeRef = useRef(mode);
  entryModeRef.current = mode;
  const theme = useTheme();

  /** HTML5 drag: scroll only when cursor is above/below the list clip (header/footer overlap), never from inside */
  useEffect(() => {
    const onDocumentDragOver = (event: globalThis.DragEvent) => {
      if (!walletReorderDragActiveRef.current) return;
      if (entryModeRef.current !== 'entry') return;
      const el = accountsScrollRef.current;
      if (!el || el.scrollHeight <= el.clientHeight) return;

      const rect = el.getBoundingClientRect();
      const x = event.clientX;
      const y = event.clientY;
      const horizontalPad = 80;
      if (x < rect.left - horizontalPad || x > rect.right + horizontalPad)
        return;

      /** Only past the clipped top/bottom — no scrolling from the interior of the list */
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      let delta = 0;

      if (el.scrollTop > 0 && y < rect.top) {
        const depthPx = rect.top - y;
        const t = Math.min(1, depthPx / 100);
        delta -= Math.round((8 + 28) * (0.25 + 0.75 * t));
      }
      if (el.scrollTop < maxScroll && y > rect.bottom) {
        const depthPx = y - rect.bottom;
        const t = Math.min(1, depthPx / 100);
        delta += Math.round((8 + 28) * (0.25 + 0.75 * t));
      }

      if (delta !== 0) {
        event.preventDefault();
        el.scrollTop = Math.min(maxScroll, Math.max(0, el.scrollTop + delta));
      }
    };

    document.addEventListener('dragover', onDocumentDragOver);
    return () => document.removeEventListener('dragover', onDocumentDragOver);
  }, []);

  const registerReorderDragActive = useCallback((active: boolean) => {
    walletReorderDragActiveRef.current = active;
  }, []);

  const handleWalletReorderDragStart = useCallback((sourceIdx: number) => {
    setWalletReorderDragSourceIndex(sourceIdx);
  }, []);

  const handleWalletReorderDragEnd = useCallback(() => {
    setWalletReorderDragSourceIndex(null);
    setWalletDropGapBeforeIndex(null);
  }, []);

  const handleWalletReorderHover = useCallback(
    (rowIdx: number, event: ReactDragEvent<HTMLElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const gapBeforeIdx =
        event.clientY < bounds.top + bounds.height / 2 ? rowIdx : rowIdx + 1;
      setWalletDropGapBeforeIndex(gapBeforeIdx);
    },
    []
  );

  const handleWalletReorderHoverLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (
        nextTarget instanceof Node &&
        event.currentTarget.contains(nextTarget)
      ) {
        return;
      }
      setWalletDropGapBeforeIndex(null);
    },
    []
  );

  const changeImportView = useCallback(
    (view: ImportView) => {
      setImportView(view);
      onImportViewChange?.(view);
    },
    [onImportViewChange]
  );

  const walletAddressKey = useMemo(() => {
    return wallets
      .map((wallet) => wallet?.address0)
      .filter(Boolean)
      .join('|');
  }, [wallets]);
  const walletAddresses = useMemo(
    () => (walletAddressKey ? walletAddressKey.split('|') : []),
    [walletAddressKey]
  );

  const registerCardRef = useCallback((address: string) => {
    return (el: HTMLElement | null) => {
      if (!el) return;
      el.setAttribute('data-address', address);
    };
  }, []);

  useEffect(() => {
    if (walletAddresses.length === 0) {
      setPrimaryNamesByAddress({});
      setPrimaryNamesLoaded(false);
      setWalletAvatarsByAddress({});
      return;
    }

    let canceled = false;
    setPrimaryNamesLoaded(false);

    getPrimaryNamesForAddresses(walletAddresses)
      .then((namesByAddress) => {
        if (!canceled) {
          setPrimaryNamesByAddress(namesByAddress);
          setPrimaryNamesLoaded(true);
        }
      })
      .catch((error) => {
        console.error('Unable to fetch wallet primary names:', error);
        if (!canceled) {
          setPrimaryNamesLoaded(true);
        }
      });

    getWalletAvatarCacheEntries()
      .then((avatarsByAddress) => {
        if (!canceled) {
          setWalletAvatarsByAddress(avatarsByAddress);
        }
      })
      .catch((error) => {
        console.error('Unable to load cached wallet avatars:', error);
      });

    return () => {
      canceled = true;
    };
  }, [walletAddresses]);

  useEffect(() => {
    if (walletAddresses.length === 0) {
      setQortalAvatarsByAddress({});
      return;
    }

    let canceled = false;

    void (async () => {
      const { hasAvatarByAddress, entriesByAddress } =
        await syncWalletAvatarCachesForAddresses(
          walletAddresses,
          primaryNamesByAddress,
          { namesLoaded: primaryNamesLoaded }
        );

      if (!canceled) {
        setQortalAvatarsByAddress(hasAvatarByAddress);
        setWalletAvatarsByAddress(entriesByAddress);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [walletAddresses, primaryNamesByAddress, primaryNamesLoaded]);

  useEffect(() => {
    if (mode !== 'entry' || !nativeShell || walletAddresses.length === 0) {
      setBiometricEnabledAddresses(new Set());
      return;
    }

    setBiometricEnabledAddresses(
      new Set(getBiometricEnabledAddressesSync(walletAddresses))
    );

    let canceled = false;

    getBiometricEnabledAddresses(walletAddresses)
      .then((addresses) => {
        if (!canceled) {
          setBiometricEnabledAddresses(new Set(addresses));
        }
      })
      .catch((error) => {
        console.error('Unable to load fingerprint unlock settings:', error);
      });

    return () => {
      canceled = true;
    };
  }, [isLoginSettingsOpen, mode, nativeShell, walletAddresses]);

  useEffect(() => {
    if (mode !== 'entry' || !nativeShell || biometricEnabledAddresses.size === 0) {
      return;
    }
    void prewarmKdfWorkers();
    void warmUpBiometricHardware();
    void isQortalBiometricHardwareAvailable();
    syncBiometricAutoPromptFlag();

    const enabledList = [...biometricEnabledAddresses];
    void syncBiometricPasswordCache(enabledList);

    // The top wallet is auto-opened on reopen, so warm its KDF first.
    const topAddress = wallets[0]?.address0;
    const prewarmTargets = wallets.filter(
      (wallet) =>
        wallet?.address0 &&
        biometricEnabledAddresses.has(wallet.address0.trim())
    );
    prewarmTargets.sort((a, b) => {
      if (a.address0 === topAddress) return -1;
      if (b.address0 === topAddress) return 1;
      return 0;
    });

    // KDF for one wallet already saturates the worker pool; prewarming the
    // whole list burns CPU the unlock tap is about to need. Two most likely
    // wallets, sequentially.
    (async () => {
      for (const wallet of prewarmTargets.slice(0, 2)) {
        prefetchWalletSessionProbe(wallet.address0);
        await prewarmBiometricUnlockKdf(wallet.address0, wallet).catch(
          () => {}
        );
      }
    })();
  }, [biometricEnabledAddresses, mode, nativeShell, wallets]);

  // Arm the native launch-time fingerprint sheet only when the TOP wallet (the
  // one auto-opened on reopen) has biometric — re-runs on load and after every
  // reorder so the flag always follows whichever account sits at the top.
  useEffect(() => {
    if (mode !== 'entry' || !nativeShell) return;
    updateEarlyBiometricPromptForTopWallet(wallets[0]?.address0);
  }, [biometricEnabledAddresses, mode, nativeShell, wallets]);

  const persistWallets = useCallback(async (nextWallets: any[]) => {
    setWallets(nextWallets);
    await storeWallets(nextWallets);
  }, []);

  const getLatestWallets = useCallback(async () => {
    // Import flows can outlive the initial wallet load/migration. Re-read
    // storage before merging so a stale local list cannot overwrite accounts.
    const latestWallets = await getWallets();
    return Array.isArray(latestWallets) ? latestWallets : wallets;
  }, [wallets]);

  useEffect(() => {
    setIsLoading(true);
    getWallets()
      .then((res) => {
        if (res && Array.isArray(res)) {
          setWallets(res);
          if (mode === 'entry' && nativeShell) {
            const addresses = res
              .map((wallet) => wallet?.address0)
              .filter(Boolean) as string[];
            setBiometricEnabledAddresses(
              new Set(getBiometricEnabledAddressesSync(addresses))
            );
          }
          if (mode === 'entry' && !attemptedLastWalletAutoSelectRef.current) {
            // On reopen, auto-open the account at the TOP of the (user-ordered)
            // list: its unlock screen shows the biometric prompt if configured,
            // otherwise the password field. Reorder to choose which account this
            // is; tapping back to the picker won't re-trap you here (guarded to
            // once per session).
            const topWallet = res[0];
            if (topWallet?.address0) {
              attemptedLastWalletAutoSelectRef.current = true;
              markLastWalletAutoSelectAttemptedThisSession();
              setRawWallet(topWallet);
              setExtState('wallet-dropped');
            }
          }
        }
        setIsLoading(false);
      })
      .catch((error) => {
        console.error(error);
        setIsLoading(false);
      });
  }, [mode, nativeShell, setExtState, setRawWallet]);

  useEffect(() => {
    if (!isLoading) {
      onReady?.();
    }
  }, [isLoading, onReady]);

  useEffect(() => {
    if (!isLoading) {
      onWalletsChange?.(wallets);
    }
  }, [isLoading, onWalletsChange, wallets]);

  useEffect(() => {
    if (wallets.length <= 8) {
      setWalletEntrySearchOpen(false);
      setWalletEntryFilterQuery('');
    }
  }, [wallets.length]);

  const selectedWalletFunc = (
    wallet,
    transitionSnapshot?: AuthUnlockTransitionSnapshot,
    options?: { startWithPasswordFallback?: boolean }
  ) => {
    if (options?.startWithPasswordFallback) {
      onWalletPasswordFallbackUnlock?.();
    }

    if (transitionSnapshot && mode === 'entry') {
      onWalletUnlockStart?.(transitionSnapshot);
      window.setTimeout(() => {
        setRawWallet(wallet);
        setExtState('wallet-dropped');
      }, 130);
      return;
    }

    setRawWallet(wallet);
    setExtState('wallet-dropped');
  };

  const handleBiometricUnlock = useCallback(
    async (
      wallet: any,
      transitionSnapshot?: AuthUnlockTransitionSnapshot
    ): Promise<boolean> => {
      if (!onBiometricWalletUnlock) return false;

      const unlocked = await onBiometricWalletUnlock(wallet, transitionSnapshot);
      if (unlocked && transitionSnapshot && mode === 'entry') {
        onWalletUnlockStart?.(transitionSnapshot);
      }
      return unlocked;
    },
    [mode, onBiometricWalletUnlock, onWalletUnlockStart]
  );

  const finalizeWalletReorder = useCallback(
    (fromIndex: number, gapBeforeIndex: number) => {
      const n = wallets.length;
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(gapBeforeIndex) ||
        fromIndex < 0 ||
        fromIndex >= n ||
        gapBeforeIndex < 0 ||
        gapBeforeIndex > n
      )
        return;

      const nextWallets = [...wallets];
      const [movedWallet] = nextWallets.splice(fromIndex, 1);
      const rawInsert =
        gapBeforeIndex > fromIndex ? gapBeforeIndex - 1 : gapBeforeIndex;
      const insertAt = Math.max(0, Math.min(rawInsert, nextWallets.length));
      nextWallets.splice(insertAt, 0, movedWallet);

      const unchanged =
        wallets.length === nextWallets.length &&
        wallets.every(
          (walletItem, walletIdx) =>
            walletItem?.address0 === nextWallets[walletIdx]?.address0
        );
      if (unchanged) return;

      void persistWallets(nextWallets).catch(console.error);
    },
    [persistWallets, wallets]
  );

  // ---- Entry-mode pointer-based reorder ---------------------------------
  // HTML5 drag-and-drop is janky inside the Android WebView (screenshot ghost,
  // no live tracking). For the Enter Qortal list we instead long-press to lift
  // a row, translate it under the finger, and commit on release — smooth and
  // touch-native. (Settings keeps the HTML5 path.)
  // Declared after finalizeWalletReorder so the callbacks can reference it
  // without hitting a temporal-dead-zone during render.

  /**
   * Drop slot for a given finger Y, measured against the snapshot taken when the
   * drag started (adjusted for any scrolling since). Using the snapshot — not
   * live rects — keeps the target stable while neighbours animate.
   */
  const computeReorderGapBeforeIndex = useCallback((clientY: number): number => {
    const session = walletDragSessionRef.current;
    if (!session) return 0;
    const snapshot = session.rowSnapshot;
    if (!snapshot.length) return session.sourceIdx;
    const container = accountsScrollRef.current;
    const scrollDelta = (container?.scrollTop ?? 0) - session.scrollTop0;
    for (let i = 0; i < snapshot.length; i += 1) {
      const midpoint = snapshot[i].top - scrollDelta + snapshot[i].height / 2;
      if (clientY < midpoint) return i;
    }
    return snapshot.length;
  }, []);

  const stopReorderAutoScroll = useCallback(() => {
    const state = walletDragAutoScrollRef.current;
    if (state.raf !== null) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    state.dir = 0;
  }, []);

  const runReorderAutoScroll = useCallback(
    (clientY: number) => {
      const el = accountsScrollRef.current;
      const state = walletDragAutoScrollRef.current;
      if (!el || el.scrollHeight <= el.clientHeight) {
        stopReorderAutoScroll();
        return;
      }
      const rect = el.getBoundingClientRect();
      const edge = 56;
      if (clientY < rect.top + edge) state.dir = -1;
      else if (clientY > rect.bottom - edge) state.dir = 1;
      else state.dir = 0;

      if (state.dir === 0) {
        stopReorderAutoScroll();
        return;
      }
      if (state.raf !== null) return;
      const step = () => {
        const cur = walletDragAutoScrollRef.current;
        const node = accountsScrollRef.current;
        const session = walletDragSessionRef.current;
        if (!node || cur.dir === 0 || !session?.activated) {
          cur.raf = null;
          return;
        }
        const max = Math.max(0, node.scrollHeight - node.clientHeight);
        node.scrollTop = Math.min(
          max,
          Math.max(0, node.scrollTop + cur.dir * 10)
        );
        const gap = computeReorderGapBeforeIndex(session.lastClientY);
        session.gapBeforeIndex = gap;
        setWalletDropGapBeforeIndex(gap);
        cur.raf = requestAnimationFrame(step);
      };
      state.raf = requestAnimationFrame(step);
    },
    [computeReorderGapBeforeIndex, stopReorderAutoScroll]
  );

  const endWalletRowDrag = useCallback(
    (commit: boolean) => {
      const session = walletDragSessionRef.current;
      walletDragSessionRef.current = null;
      if (walletDragListenerCleanupRef.current) {
        walletDragListenerCleanupRef.current();
        walletDragListenerCleanupRef.current = null;
      }
      stopReorderAutoScroll();
      if (session?.longPressTimer != null) {
        window.clearTimeout(session.longPressTimer);
      }
      if (session?.activated && commit) {
        finalizeWalletReorder(session.sourceIdx, session.gapBeforeIndex);
      }
      setWalletDragActiveIndex(null);
      setWalletReorderDragSourceIndex(null);
      setWalletDropGapBeforeIndex(null);
      setWalletDragTranslateY(0);
      setWalletDragRowStride(0);
      walletReorderDragActiveRef.current = false;
    },
    [finalizeWalletReorder, stopReorderAutoScroll]
  );

  // Long-press to lift a row, then drag. Movement while active is driven by a
  // NATIVE non-passive touchmove listener: for touch-originated gestures only
  // touch-event preventDefault() stops the WebView from scroll-stealing the
  // pointer (which otherwise fires pointercancel and aborts the drag).
  const handleWalletRowTouchStart = useCallback(
    (sourceIdx: number, event: ReactTouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      const target = event.target as HTMLElement | null;
      // Never start a drag from an interactive control (fingerprint / unlock).
      if (target && target.closest('button, [data-no-drag]')) return;

      const startY = touch.clientY;
      const session = {
        sourceIdx,
        startY,
        lastClientY: startY,
        pointerId: -1,
        activated: false,
        longPressTimer: null as number | null,
        gapBeforeIndex: sourceIdx,
        el: event.currentTarget as HTMLElement,
        rowSnapshot: [] as { top: number; height: number }[],
        scrollTop0: 0,
        rowStride: 0,
      };
      walletDragSessionRef.current = session;
      session.longPressTimer = window.setTimeout(() => {
        const current = walletDragSessionRef.current;
        if (!current || current.activated) return;
        current.activated = true;
        current.longPressTimer = null;

        // Snapshot the untransformed row geometry now (before we apply any
        // transforms). Measured live so it adapts to any device size, density,
        // tablet layout or orientation — nothing here is hard-coded.
        const container = accountsScrollRef.current;
        const rowEls = container
          ? (Array.from(
              container.querySelectorAll('[data-address]')
            ) as HTMLElement[])
          : [];
        const snapshot = rowEls.map((el) => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        });
        current.rowSnapshot = snapshot;
        current.scrollTop0 = container?.scrollTop ?? 0;
        current.rowStride =
          snapshot.length >= 2
            ? snapshot[1].top - snapshot[0].top
            : snapshot[0]?.height ?? 0;
        setWalletDragRowStride(current.rowStride);

        try {
          navigator.vibrate?.(12);
        } catch {
          /* no haptics */
        }

        const onMove = (nativeEvent: globalThis.TouchEvent) => {
          const active = walletDragSessionRef.current;
          if (!active || !active.activated) return;
          if (nativeEvent.cancelable) nativeEvent.preventDefault();
          const point = nativeEvent.touches[0];
          if (!point) return;
          active.lastClientY = point.clientY;
          setWalletDragTranslateY(point.clientY - active.startY);
          const gap = computeReorderGapBeforeIndex(point.clientY);
          active.gapBeforeIndex = gap;
          setWalletDropGapBeforeIndex(gap);
          runReorderAutoScroll(point.clientY);
        };
        const onEnd = () => endWalletRowDrag(true);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onEnd);
        walletDragListenerCleanupRef.current = () => {
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
          document.removeEventListener('touchcancel', onEnd);
        };

        walletReorderDragActiveRef.current = true;
        setWalletReorderDragSourceIndex(sourceIdx);
        setWalletDragActiveIndex(sourceIdx);
        setWalletDropGapBeforeIndex(sourceIdx);
        setWalletDragTranslateY(0);
      }, 200);
    },
    [computeReorderGapBeforeIndex, runReorderAutoScroll, endWalletRowDrag]
  );

  /** Pre-activation only: a real move means scroll/tap, so drop the pending lift. */
  const handleWalletRowTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const session = walletDragSessionRef.current;
      if (!session || session.activated) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (Math.abs(touch.clientY - session.startY) > 9) {
        if (session.longPressTimer != null) {
          window.clearTimeout(session.longPressTimer);
        }
        walletDragSessionRef.current = null;
      }
    },
    []
  );

  /** Pre-activation tap release: clear the pending lift (active drags end via the native listener). */
  const handleWalletRowTouchEnd = useCallback(() => {
    const session = walletDragSessionRef.current;
    if (session && !session.activated) {
      if (session.longPressTimer != null) {
        window.clearTimeout(session.longPressTimer);
      }
      walletDragSessionRef.current = null;
    }
  }, []);

  const importSeedphrase = async () => {
    try {
      setIsLoadingEncryptSeed(true);
      setSeedError('');
      const res = await decryptStoredWalletFromSeedPhrase(seedValue.trim());
      const wallet2 = new PhraseWallet(res, walletVersion);
      const wallet = await wallet2.generateSaveWalletData(
        password,
        crypto.kdfThreads,
        () => {}
      );

      if (wallet?.address0) {
        const latestWallets = await getLatestWallets();
        const existsAlready = latestWallets.some(
          (existingWallet) => existingWallet?.address0 === wallet.address0
        );
        const nextWallets = existsAlready
          ? latestWallets
          : [
              ...latestWallets,
              {
                ...wallet,
                name: '',
              },
            ];

        if (!existsAlready) {
          await persistWallets(nextWallets);
        }
        setSeedValue('');
        setPassword('');
        changeImportView('choice');
        setBackupImportHint(
          existsAlready
            ? t('auth:entry.seed_import_duplicate')
            : t('auth:entry.seed_import_success')
        );
        if (!existsAlready) {
          setExtState('not-authenticated');
        }
      } else {
        setSeedError(t('auth:entry.seed_import_error'));
      }
    } catch (error: any) {
      setSeedError(error?.message || t('auth:entry.seed_import_error'));
    } finally {
      setIsLoadingEncryptSeed(false);
    }
  };

  const readWalletFiles = useCallback(
    async (acceptedFiles: File[]) => {
      const importedWallets: any[] = [];

      for (const file of acceptedFiles) {
        try {
          const fileContents = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onabort = () =>
              reject(new Error(t('auth:entry.import_file_read_aborted')));
            reader.onerror = () =>
              reject(new Error(t('auth:entry.import_file_read_failed')));
            reader.onload = () => resolve(reader.result);
            reader.readAsText(file);
          });
          if (typeof fileContents !== 'string') continue;
          const parsedData = JSON.parse(fileContents);
          importedWallets.push({ ...parsedData, filename: file.name });
        } catch (error) {
          console.error(error);
        }
      }

      const uniqueInitialMap = new Map();
      importedWallets.forEach((wallet) => {
        if (!wallet?.address0) return;
        if (!uniqueInitialMap.has(wallet.address0)) {
          uniqueInitialMap.set(wallet.address0, wallet);
        }
      });

      return Array.from(uniqueInitialMap.values());
    },
    [t]
  );

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'application/json': ['.json'],
    },
    onDrop: async (acceptedFiles) => {
      const uniqueWallets = await readWalletFiles(acceptedFiles as File[]);
      if (!uniqueWallets.length) return;

      const latestWallets = await getLatestWallets();
      const uniqueNewWallets = uniqueWallets.filter(
        (newWallet) =>
          !latestWallets.some(
            (existingWallet) => existingWallet?.address0 === newWallet?.address0
          )
      );

      if (uniqueNewWallets.length > 0) {
        const nextWallets = [...latestWallets, ...uniqueNewWallets];
        await persistWallets(nextWallets);
      }

      setBackupImportHint(
        uniqueNewWallets.length > 0
          ? t('auth:entry.import_backup_success', {
              count: uniqueNewWallets.length,
            })
          : t('auth:entry.import_backup_duplicate')
      );
      changeImportView('choice');
      if (uniqueNewWallets.length > 0) {
        setExtState('not-authenticated');
      }
    },
  });

  const {
    getRootProps: getAuthenticateRootProps,
    getInputProps: getAuthenticateInputProps,
  } = useDropzone({
    accept: {
      'application/json': ['.json'],
    },
    multiple: false,
    onDrop: async (acceptedFiles) => {
      const uniqueWallets = await readWalletFiles(acceptedFiles as File[]);
      const wallet = uniqueWallets[0];

      if (!wallet?.address0) {
        setBackupImportHint(t('auth:entry.import_backup_invalid'));
        return;
      }

      setBackupImportHint('');
      setRawWallet(wallet);
      setExtState('wallet-dropped');
    },
  });

  const displayedWallets = useMemo(() => {
    const base = wallets.map((wallet, idx) => ({ wallet, idx }));

    if (mode !== 'entry' || wallets.length <= 8) {
      return base;
    }

    const q = walletEntryFilterQuery.trim().toLowerCase();
    if (!q) return base;

    return base.filter(({ wallet }) => {
      const address = String(wallet?.address0 || '').toLowerCase();
      const primary = String(
        wallet?.address0 ? primaryNamesByAddress[wallet.address0] || '' : ''
      ).toLowerCase();
      const name = String(wallet?.name || '').toLowerCase();
      const note = String(wallet?.note || '').toLowerCase();
      const fileLabel =
        wallet?.filename != null
          ? String(parsefilenameQortal(wallet.filename)).toLowerCase()
          : '';
      return (
        address.includes(q) ||
        primary.includes(q) ||
        name.includes(q) ||
        note.includes(q) ||
        fileLabel.includes(q)
      );
    });
  }, [mode, primaryNamesByAddress, walletEntryFilterQuery, wallets]);

  if (isLoading) return null;

  const showsEntryWalletFilter =
    mode === 'entry' && wallets.length > 8;

  const entryFilteredNoMatches =
    showsEntryWalletFilter &&
    walletEntryFilterQuery.trim().length > 0 &&
    displayedWallets.length === 0;

  const entryListFixedViewport = mode === 'entry';

  // Pointer reorder is only coherent when the rendered rows match the stored
  // wallet order 1:1 — i.e. entry mode, more than one account, and no active
  // filter narrowing the list.
  const entryReorderEnabled =
    mode === 'entry' &&
    wallets.length > 1 &&
    displayedWallets.length === wallets.length &&
    !walletEntryFilterQuery.trim();

  const accountsList = (
    <Box
      ref={accountsScrollRef}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: mode === 'entry' ? 1.4 : 0,
        ...(entryListFixedViewport
          ? {
              maxHeight: ENTRY_WALLET_SCROLL_HEIGHT_PX,
              minHeight: ENTRY_WALLET_SCROLL_HEIGHT_PX,
              overflowY: 'auto',
              pr: 0.35,
            }
          : {
              maxHeight: 'none',
              overflowY: 'visible',
              pr: 0,
            }),
        width: '100%',
      }}
    >
      {entryFilteredNoMatches ? (
        <Box
          sx={{
            alignItems: 'center',
            alignSelf: 'stretch',
            display: 'flex',
            flexGrow: 1,
            justifyContent: 'center',
            minHeight: 0,
            px: 1,
          }}
        >
          <Typography
            sx={{
              color: 'rgba(214,221,233,0.56)',
              fontSize: '0.9rem',
              lineHeight: 1.55,
              textAlign: 'center',
            }}
          >
            {t('auth:entry.filter_no_results')}
          </Typography>
        </Box>
      ) : (
        <>
          {displayedWallets.map(({ wallet, idx }) => (
            <Fragment key={wallet?.address0}>
              {mode !== 'entry' &&
                walletDropGapBeforeIndex !== null &&
                walletReorderDragSourceIndex !== null &&
                walletDropGapBeforeIndex === idx && (
                  <Box
                    aria-hidden
                    sx={{
                      alignSelf: 'stretch',
                      backgroundColor: theme.palette.primary.main,
                      borderRadius: '999px',
                      boxShadow:
                        theme.palette.mode === 'light'
                          ? `0 0 0 1px ${alpha(theme.palette.primary.dark, 0.12)}, 0 3px 16px ${alpha(theme.palette.primary.main, 0.38)}`
                          : `0 0 0 1px ${alpha(theme.palette.primary.light, 0.28)}, 0 0 20px ${alpha(theme.palette.primary.main, 0.45)}`,
                      flexShrink: 0,
                      height: mode === 'entry' ? 5 : 4,
                      mx: mode === 'entry' ? 0.85 : 0,
                    }}
                  />
                )}
              <WalletRow
                idx={idx}
                biometricUnlockEnabled={
                  mode === 'entry' &&
                  Boolean(
                    wallet?.address0 &&
                      biometricEnabledAddresses.has(wallet.address0.trim())
                  )
                }
                finalizeWalletReorder={finalizeWalletReorder}
                mode={mode}
                onBiometricUnlock={handleBiometricUnlock}
                onReorderDragEnd={handleWalletReorderDragEnd}
                onReorderDragStart={handleWalletReorderDragStart}
                primaryName={
                  wallet?.address0
                    ? primaryNamesByAddress[wallet.address0]
                    : undefined
                }
                cachedAvatarEntry={
                  wallet?.address0
                    ? walletAvatarsByAddress[wallet.address0]
                    : undefined
                }
                hasQortalAvatar={
                  wallet?.address0
                    ? qortalAvatarsByAddress[wallet.address0]
                    : false
                }
                registerCardRef={registerCardRef}
                registerReorderDragActive={
                  mode === 'entry' ? registerReorderDragActive : undefined
                }
                reorderDragHover={handleWalletReorderHover}
                reorderDragHoverLeave={handleWalletReorderHoverLeave}
                reorderDragSourceIndex={walletReorderDragSourceIndex}
                pointerReorderEnabled={entryReorderEnabled}
                pointerDragActive={walletDragActiveIndex === idx}
                pointerDragTranslateY={walletDragTranslateY}
                reorderActiveSourceIndex={walletDragActiveIndex}
                reorderGapIndex={walletDropGapBeforeIndex}
                reorderRowStride={walletDragRowStride}
                onRowTouchStart={handleWalletRowTouchStart}
                onRowTouchMove={handleWalletRowTouchMove}
                onRowTouchEnd={handleWalletRowTouchEnd}
                setSelectedWallet={selectedWalletFunc}
                wallet={wallet}
              />
            </Fragment>
          ))}
          {mode !== 'entry' &&
            walletDropGapBeforeIndex !== null &&
            walletReorderDragSourceIndex !== null &&
            walletDropGapBeforeIndex === wallets.length && (
              <Box
                aria-hidden
                sx={{
                  alignSelf: 'stretch',
                  backgroundColor: theme.palette.primary.main,
                  borderRadius: '999px',
                  boxShadow:
                    theme.palette.mode === 'light'
                      ? `0 0 0 1px ${alpha(theme.palette.primary.dark, 0.12)}, 0 3px 16px ${alpha(theme.palette.primary.main, 0.38)}`
                      : `0 0 0 1px ${alpha(theme.palette.primary.light, 0.28)}, 0 0 20px ${alpha(theme.palette.primary.main, 0.45)}`,
                  flexShrink: 0,
                  height: mode === 'entry' ? 5 : 4,
                  mx: mode === 'entry' ? 0.85 : 0,
                }}
              />
            )}
        </>
      )}
    </Box>
  );

  const entryAccountListColumn = (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}
    >
      {showsEntryWalletFilter && (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 0.75,
            width: '100%',
          }}
        >
          <Tooltip placement="top" title={t('auth:entry.filter_accounts_aria')}>
            <IconButton
              aria-expanded={walletEntrySearchOpen}
              aria-label={t('auth:entry.filter_accounts_aria')}
              size="small"
              tabIndex={walletEntrySearchOpen ? 0 : -1}
              onClick={() => setWalletEntrySearchOpen((open) => !open)}
              sx={{
                '&:hover': {
                  backgroundColor: alpha(theme.palette.primary.main, 0.1),
                },
                border: `1px solid ${
                  walletEntrySearchOpen || walletEntryFilterQuery.trim()
                    ? alpha(theme.palette.primary.main, 0.45)
                    : alpha(theme.palette.text.primary, 0.12)
                }`,
                borderRadius: '9px',
                color: theme.palette.text.secondary,
                flexShrink: 0,
                height: 34,
                width: 34,
              }}
            >
              <Badge
                color="primary"
                invisible={!walletEntryFilterQuery.trim()}
                variant="dot"
              >
                <ManageSearchRoundedIcon sx={{ fontSize: 21 }} />
              </Badge>
            </IconButton>
          </Tooltip>
          {walletEntrySearchOpen && (
            <TextField
              autoFocus
              fullWidth
              placeholder={t('auth:entry.filter_placeholder')}
              size="small"
              value={walletEntryFilterQuery}
              variant="outlined"
              InputProps={{
                endAdornment: walletEntryFilterQuery ? (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={t('auth:entry.filter_clear')}
                      edge="end"
                      size="small"
                      sx={{ color: theme.palette.text.secondary }}
                      onClick={() => setWalletEntryFilterQuery('')}
                    >
                      <ClearRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
              onChange={(e) => setWalletEntryFilterQuery(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: alpha(theme.palette.background.paper, 0.45),
                  borderRadius: '9px',
                  fontSize: '0.875rem',
                  minHeight: 36,
                },
                minWidth: 0,
              }}
            />
          )}
        </Box>
      )}
      {accountsList}
    </Box>
  );

  if (mode === 'entry') {
    return wallets.length === 0 ? (
      <Typography
        sx={{
          color: 'rgba(214,221,233,0.56)',
          fontSize: '0.92rem',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        {t('auth:entry.no_accounts')}
      </Typography>
    ) : (
      entryAccountListColumn
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        width: '100%',
      }}
    >
      {importView === 'choice' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <ChoiceRow
            description={t('auth:entry.import_choice_backup_description')}
            icon={<DescriptionRoundedIcon sx={{ fontSize: 22 }} />}
            onClick={() => changeImportView('backup')}
            title={t('auth:entry.import_choice_backup_title')}
          />
          <ChoiceRow
            description={t('auth:entry.import_choice_authenticate_description')}
            icon={<LoginRoundedIcon sx={{ fontSize: 22 }} />}
            onClick={() => changeImportView('authenticate')}
            title={t('auth:entry.import_choice_authenticate_title')}
          />
          <ChoiceRow
            description={t('auth:entry.import_choice_seed_description')}
            icon={<VpnKeyRoundedIcon sx={{ fontSize: 22 }} />}
            onClick={() => changeImportView('seedphrase')}
            title={t('auth:entry.import_choice_seed_title')}
          />
          {backupImportHint && (
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.56)',
                fontSize: '0.84rem',
              }}
            >
              {backupImportHint}
            </Typography>
          )}
        </Box>
      )}

      {importView === 'backup' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          <InlineReturn onClick={() => changeImportView('choice')} />
          <Box
            {...getRootProps()}
            sx={{
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.12)',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.8,
              justifyContent: 'center',
              minHeight: 170,
              px: 3,
              py: 3,
              textAlign: 'center',
              transition:
                'background-color 160ms ease, border-color 160ms ease',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderColor: 'rgba(255,255,255,0.18)',
              },
            }}
          >
            <input {...getInputProps()} />
            <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>
              {t('auth:entry.import_backup_heading')}
            </Typography>
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.56)',
                fontSize: '0.88rem',
                lineHeight: 1.6,
                maxWidth: 300,
              }}
            >
              {t('auth:entry.import_backup_drop_hint')}
            </Typography>
          </Box>
          {backupImportHint && (
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.56)',
                fontSize: '0.84rem',
              }}
            >
              {backupImportHint}
            </Typography>
          )}
        </Box>
      )}

      {importView === 'authenticate' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          <InlineReturn onClick={() => changeImportView('choice')} />
          <Box
            {...getAuthenticateRootProps()}
            sx={{
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.12)',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.8,
              justifyContent: 'center',
              minHeight: 170,
              px: 3,
              py: 3,
              textAlign: 'center',
              transition:
                'background-color 160ms ease, border-color 160ms ease',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderColor: 'rgba(255,255,255,0.18)',
              },
            }}
          >
            <input {...getAuthenticateInputProps()} />
            <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>
              {t('auth:entry.import_authenticate_heading')}
            </Typography>
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.56)',
                fontSize: '0.88rem',
                lineHeight: 1.6,
                maxWidth: 300,
              }}
            >
              {t('auth:entry.import_authenticate_drop_hint')}
            </Typography>
          </Box>
          {backupImportHint && (
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.56)',
                fontSize: '0.84rem',
              }}
            >
              {backupImportHint}
            </Typography>
          )}
        </Box>
      )}

      {importView === 'seedphrase' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          <InlineReturn onClick={() => changeImportView('choice')} />

          <Box>
            <AuthSectionLabel>
              {t('auth:entry.import_seed_label')}
            </AuthSectionLabel>
            <TextField
              fullWidth
              multiline
              minRows={4}
              value={seedValue}
              onChange={(event) => setSeedValue(event.target.value)}
              placeholder={t('auth:entry.import_seed_placeholder')}
              sx={seedTextFieldSx(theme, isSeedVisible)}
              InputProps={{
                endAdornment: (
                  <ButtonBase
                    onClick={() => setIsSeedVisible((prev) => !prev)}
                    sx={{
                      alignSelf: 'flex-start',
                      color: 'rgba(214,221,233,0.62)',
                      mt: 1,
                    }}
                  >
                    {isSeedVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </ButtonBase>
                ),
              }}
            />
          </Box>

          <Box>
            <AuthSectionLabel>
              {t('auth:entry.import_wallet_password')}
            </AuthSectionLabel>
            <PasswordField
              id="wallet-import-password"
              name="wallet-import-password"
              onChange={(event) => setPassword(event.target.value)}
              suppressAutofill
              sx={{ width: '100%' }}
              value={password}
            />
          </Box>

          {seedError && (
            <Typography
              sx={{
                color: theme.palette.other.danger,
                fontSize: '0.84rem',
              }}
            >
              {seedError}
            </Typography>
          )}

          <AuthButton
            disabled={
              !seedValue.trim() || !password.trim() || isLoadingEncryptSeed
            }
            onClick={importSeedphrase}
          >
            {isLoadingEncryptSeed
              ? t('auth:entry.importing_account')
              : t('auth:entry.import_account')}
          </AuthButton>
        </Box>
      )}
    </Box>
  );
};

const ChoiceRow = ({ icon, title, description, onClick }) => {
  const theme = useTheme();
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        display: 'flex',
        gap: 1.2,
        justifyContent: 'space-between',
        minHeight: 88,
        px: 1.4,
        py: 1.2,
        textAlign: 'left',
        transition: 'background-color 160ms ease, border-color 160ms ease',
        '&:hover': {
          backgroundColor: 'rgba(255,255,255,0.035)',
          borderColor: 'rgba(255,255,255,0.12)',
        },
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.2 }}>
        <Box
          sx={{
            alignItems: 'center',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: 'rgba(214,221,233,0.74)',
            display: 'inline-flex',
            height: 42,
            justifyContent: 'center',
            width: 42,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.98rem', fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography
            sx={{
              color: 'rgba(214,221,233,0.56)',
              fontSize: '0.84rem',
              lineHeight: 1.55,
              mt: 0.25,
            }}
          >
            {description}
          </Typography>
        </Box>
      </Box>
      <ArrowForwardRoundedIcon
        sx={{ color: theme.palette.text.secondary, fontSize: 18 }}
      />
    </ButtonBase>
  );
};

const InlineReturn = ({ onClick }: { onClick: () => void }) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <ButtonBase
      aria-label={t('core:action.back', {
        postProcess: 'capitalizeFirstChar',
      })}
      onClick={onClick}
      sx={{
        alignItems: 'center',
        alignSelf: 'flex-start',
        color: 'rgba(214,221,233,0.62)',
        display: 'inline-flex',
        minWidth: 0,
        p: 0,
        '&:hover': {
          color: theme.palette.text.primary,
        },
      }}
    >
      <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
    </ButtonBase>
  );
};

const WalletRow = ({
  wallet,
  idx,
  setSelectedWallet,
  primaryName,
  cachedAvatarEntry,
  hasQortalAvatar,
  registerCardRef,
  finalizeWalletReorder,
  registerReorderDragActive,
  reorderDragSourceIndex,
  reorderDragHover,
  reorderDragHoverLeave,
  onReorderDragStart,
  onReorderDragEnd,
  pointerReorderEnabled = false,
  pointerDragActive = false,
  pointerDragTranslateY = 0,
  reorderActiveSourceIndex = null,
  reorderGapIndex = null,
  reorderRowStride = 0,
  onRowTouchStart,
  onRowTouchMove,
  onRowTouchEnd,
  mode,
  biometricUnlockEnabled = false,
  onBiometricUnlock,
}) => {
  const { t } = useTranslation(['auth', 'core']);
  const [biometricUnlockBusy, setBiometricUnlockBusy] = useState(false);
  const addressRef = useRef<HTMLParagraphElement | null>(null);
  const avatarRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLParagraphElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  // Set when a pointer drag actually lifted this row, so the click fired on
  // release doesn't also select/unlock the account.
  const pointerDraggedRef = useRef(false);
  const theme = useTheme();
  const effectivePrimaryName =
    primaryName?.trim() || wallet?.name?.trim() || '';
  const resolvedAvatarSrc = resolveWalletAvatarSrc({
    primaryName: effectivePrimaryName,
    walletAddress: wallet?.address0,
    cachedAvatarEntry,
  });
  const displayName =
    effectivePrimaryName ||
    wallet?.name ||
    (wallet?.filename ? parsefilenameQortal(wallet.filename) : null) ||
    t('auth:authentication_form.unnamed_account');
  const addressLabel = shortenAddress(wallet?.address0);

  // While another row is being dragged, this row slides up/down by exactly one
  // slot to open a gap at the drop target and close the one the dragged row
  // left behind — the iOS-style "make room" animation. Stride is measured live
  // so it's correct on any device size, density, tablet or orientation.
  let neighbourShiftPx = 0;
  if (
    !pointerDragActive &&
    reorderActiveSourceIndex !== null &&
    reorderGapIndex !== null &&
    reorderRowStride > 0 &&
    idx !== reorderActiveSourceIndex
  ) {
    const source = reorderActiveSourceIndex;
    const landing = reorderGapIndex > source ? reorderGapIndex - 1 : reorderGapIndex;
    const reduced = idx < source ? idx : idx - 1;
    const finalSlot = reduced + (reduced >= landing ? 1 : 0);
    neighbourShiftPx = (finalSlot - idx) * reorderRowStride;
  }

  // KDF prewarm runs once at list level (top targets only); per-row we only
  // prefetch the cheap session probe so resume-unlocks skip the KDF entirely.
  useEffect(() => {
    if (mode !== 'entry' || !biometricUnlockEnabled || !wallet?.address0) {
      return;
    }
    prefetchWalletSessionProbe(wallet.address0);
  }, [biometricUnlockEnabled, mode, wallet]);

  // Remember that this row was lifted so the click synthesized on release is
  // swallowed by handleSelectWallet instead of opening the account.
  useEffect(() => {
    if (pointerDragActive) pointerDraggedRef.current = true;
  }, [pointerDragActive]);

  const getTransitionSnapshot = ():
    | AuthUnlockTransitionSnapshot
    | undefined => {
    if (
      mode !== 'entry' ||
      !avatarRef.current ||
      !nameRef.current ||
      !addressRef.current
    ) {
      return undefined;
    }

    const rectToObject = (rect: DOMRect) => ({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });

    return {
      addressLabel,
      addressRect: rectToObject(addressRef.current.getBoundingClientRect()),
      avatarRect: rectToObject(avatarRef.current.getBoundingClientRect()),
      avatarSrc: resolvedAvatarSrc,
      displayName,
      nameRect: rectToObject(nameRef.current.getBoundingClientRect()),
      primaryName: effectivePrimaryName || undefined,
      walletAddress: wallet?.address0,
    };
  };

  const handleSelectWallet = () => {
    if (isDraggingRef.current) return;
    if (pointerDraggedRef.current) {
      pointerDraggedRef.current = false;
      return;
    }
    setSelectedWallet(wallet, getTransitionSnapshot());
  };

  const handleBiometricUnlockClick = async (event: ReactMouseEvent) => {
    event.stopPropagation();
    if (isDraggingRef.current || biometricUnlockBusy || !onBiometricUnlock) {
      return;
    }

    setBiometricUnlockBusy(true);
    try {
      const snapshot = getTransitionSnapshot();
      const unlocked = await onBiometricUnlock(wallet, snapshot);
      if (!unlocked) {
        setSelectedWallet(wallet, snapshot, { startWithPasswordFallback: true });
      }
    } finally {
      setBiometricUnlockBusy(false);
    }
  };

  const isLight = theme.palette.mode === 'light';
  const entryRowBackground = isLight
    ? 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(246,249,253,0.98))'
    : 'linear-gradient(180deg, rgba(7,12,21,0.9), rgba(4,7,12,0.94))';
  const entryRowHoverBackground = isLight
    ? 'linear-gradient(180deg, rgba(255,255,255,0.99), rgba(239,245,252,0.99))'
    : 'linear-gradient(180deg, rgba(8,14,24,0.93), rgba(5,8,14,0.96))';

  return (
    <>
      {biometricUnlockBusy && (
        <Box
          // Swallow taps while the native fingerprint prompt is being armed —
          // otherwise (e.g. during the brief window before the system dialog
          // appears) a tap falls through to the account row behind and can
          // navigate away mid-unlock.
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: 1400,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            bgcolor: 'rgba(0,0,0,0.88)',
            pointerEvents: 'auto',
          }}
        >
          <FingerprintRoundedIcon
            sx={{
              fontSize: 80,
              color: theme.palette.primary.main,
              animation: 'biometricPulse 1.2s ease-in-out infinite',
              '@keyframes biometricPulse': {
                '0%, 100%': { opacity: 0.55, transform: 'scale(1)' },
                '50%': { opacity: 1, transform: 'scale(1.08)' },
              },
            }}
          />
          <Typography
            variant="h6"
            sx={{ color: '#fff', fontWeight: 600, px: 3, textAlign: 'center' }}
          >
            {t('auth:mobile_login_settings.biometric_place_finger')}
          </Typography>
        </Box>
      )}
      <Box
      ref={(element: HTMLDivElement | null) => {
        rowRef.current = element;
        if (wallet?.address0) {
          registerCardRef(wallet.address0)(element);
        }
      }}
      draggable={mode !== 'entry'}
      onDragStart={
        mode !== 'entry'
          ? (event) => {
              isDraggingRef.current = true;
              registerReorderDragActive?.(true);
              onReorderDragStart?.(idx);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', String(idx));
            }
          : undefined
      }
      onDragOver={
        mode !== 'entry'
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              reorderDragHover?.(idx, event);
            }
          : undefined
      }
      onDragLeave={
        mode !== 'entry'
          ? (event) => {
              reorderDragHoverLeave?.(event);
            }
          : undefined
      }
      onDrop={
        mode !== 'entry'
          ? (event) => {
              event.preventDefault();
              const fromIndex = Number(
                event.dataTransfer.getData('text/plain')
              );

              const bounds = (
                event.currentTarget as HTMLElement
              ).getBoundingClientRect();
              const gapBeforeIndex =
                event.clientY < bounds.top + bounds.height / 2 ? idx : idx + 1;

              if (Number.isInteger(fromIndex)) {
                finalizeWalletReorder(fromIndex, gapBeforeIndex);
              }
              onReorderDragEnd?.();
            }
          : undefined
      }
      onDragEnd={
        mode !== 'entry'
          ? () => {
              registerReorderDragActive?.(false);
              onReorderDragEnd?.();
              window.setTimeout(() => {
                isDraggingRef.current = false;
              }, 0);
            }
          : undefined
      }
      onTouchStart={
        pointerReorderEnabled
          ? (event) => {
              pointerDraggedRef.current = false;
              onRowTouchStart?.(idx, event);
            }
          : undefined
      }
      onTouchMove={
        pointerReorderEnabled
          ? (event) => onRowTouchMove?.(event)
          : undefined
      }
      onTouchEnd={
        pointerReorderEnabled
          ? (event) => onRowTouchEnd?.(event)
          : undefined
      }
      onContextMenu={
        pointerReorderEnabled
          ? (event) => event.preventDefault()
          : undefined
      }
      sx={{
        borderBottom:
          mode === 'entry' ? 'none' : '1px solid rgba(255,255,255,0.06)',
        opacity: pointerDragActive
          ? 0.98
          : reorderDragSourceIndex !== null && reorderDragSourceIndex === idx
            ? 0.46
            : 1,
        pb: mode === 'entry' ? 0 : 0,
        pt: mode === 'entry' ? 0 : 0.2,
        transition: pointerDragActive
          ? 'none'
          : 'transform 190ms cubic-bezier(0.2,0,0,1), opacity 160ms ease',
        // Long-press must lift the row, not start native text selection or the
        // context/callout menu, which would steal the gesture and cancel the
        // pointer capture (leaving you unable to drag).
        ...(mode === 'entry'
          ? {
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }
          : {}),
        ...(pointerDragActive
          ? {
              transform: `translateY(${pointerDragTranslateY}px) scale(1.04)`,
              zIndex: 60,
              position: 'relative',
              touchAction: 'none',
              filter: 'brightness(1.03)',
              boxShadow:
                theme.palette.mode === 'light'
                  ? '0 20px 44px rgba(45,72,112,0.34)'
                  : '0 20px 44px rgba(0,0,0,0.72)',
              cursor: 'grabbing',
            }
          : {
              transform: `translateY(${neighbourShiftPx}px)`,
              willChange: neighbourShiftPx !== 0 ? 'transform' : undefined,
            }),
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          background:
            mode === 'entry' ? entryRowBackground : 'transparent',
          border:
            mode === 'entry'
              ? isLight
                ? `1px solid ${theme.palette.border.subtle}`
                : '1px solid rgba(123,145,174,0.2)'
              : 'none',
          borderRadius: mode === 'entry' ? '8px' : '7px',
          cursor: 'grab',
          display: 'grid',
          gap: mode === 'entry' ? 1.3 : 1,
          gridTemplateColumns:
            mode === 'entry'
              ? '54px minmax(0,1fr) auto auto'
              : '36px minmax(0,1fr) auto',
          minHeight: mode === 'entry' ? 86 : 60,
          px: mode === 'entry' ? 1.6 : 0.55,
          py: mode === 'entry' ? 1.15 : 0.5,
          transition:
            'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
          '&:hover': {
            background:
              mode === 'entry' ? entryRowHoverBackground : 'rgba(255,255,255,0.03)',
            borderColor:
              mode === 'entry'
                ? isLight
                  ? theme.palette.border.main
                  : 'rgba(188,213,246,0.34)'
                : undefined,
            boxShadow:
              mode === 'entry'
                ? isLight
                  ? '0 2px 12px rgba(45, 72, 112, 0.06)'
                  : '0 0 0 1px rgba(70,120,210,0.04)'
                : 'none',
          },
          '&:active': {
            cursor: 'grabbing',
          },
        }}
        onClick={handleSelectWallet}
      >
        <QortalUserAvatar
          key={`${wallet?.address0 || idx}-${resolvedAvatarSrc ?? 'none'}`}
          ref={avatarRef}
          alt={displayName}
          primaryName={effectivePrimaryName}
          walletAddress={wallet?.address0}
          cachedAvatarEntry={cachedAvatarEntry}
          fallbackIconSize={mode === 'entry' ? 27 : 22}
          sx={{
            alignSelf: 'center',
            flexShrink: 0,
            height: mode === 'entry' ? 46 : 34,
            width: mode === 'entry' ? 46 : 34,
          }}
        />

        <Box sx={{ minWidth: 0 }}>
          <Box
            sx={{
              alignItems: 'baseline',
              display: 'inline-flex',
              flexWrap: 'wrap',
              gap: 0.35,
              maxWidth: '100%',
              minWidth: 0,
            }}
          >
            <Typography
              ref={nameRef}
              sx={{
                color: theme.palette.text.primary,
                fontSize: mode === 'entry' ? '1rem' : '0.95rem',
                fontWeight: 700,
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden',
                overflowWrap: 'anywhere',
                lineHeight: 1.2,
              }}
            >
              {displayName}
            </Typography>
            {wallet?.note && (
              <Typography
                sx={{
                  color:
                    mode === 'entry'
                      ? alpha(theme.palette.text.secondary, 0.72)
                      : 'rgba(214,221,233,0.42)',
                  fontSize: '0.72rem',
                  fontStyle: 'italic',
                  fontWeight: 400,
                  lineHeight: 1,
                  maxWidth: { xs: 120, sm: 180 },
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {wallet.note}
              </Typography>
            )}
          </Box>
          <Typography
            ref={addressRef}
            sx={{
              color:
                mode === 'entry'
                  ? theme.palette.text.secondary
                  : 'rgba(214,221,233,0.56)',
              fontSize: mode === 'entry' ? '0.84rem' : '0.79rem',
              lineHeight: 1.35,
              mt: 0.05,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {addressLabel}
          </Typography>
        </Box>

        <Box data-no-drag onClick={(event) => event.stopPropagation()}>
          {mode === 'entry' && biometricUnlockEnabled ? (
            <IconButton
              aria-label={t('auth:mobile_login_settings.biometric_unlock')}
              disabled={biometricUnlockBusy}
              onClick={(event) => void handleBiometricUnlockClick(event)}
              sx={{
                background: isLight
                  ? alpha(theme.palette.primary.main, 0.1)
                  : 'rgba(118,164,255,0.12)',
                border: isLight
                  ? `1px solid ${alpha(theme.palette.primary.main, 0.28)}`
                  : '1px solid rgba(118,164,255,0.28)',
                borderRadius: '50%',
                color: theme.palette.primary.main,
                height: 46,
                width: 46,
                '&:hover': {
                  background: isLight
                    ? alpha(theme.palette.primary.main, 0.16)
                    : 'rgba(118,164,255,0.18)',
                },
                '&:disabled': {
                  opacity: 0.55,
                },
              }}
            >
              <FingerprintRoundedIcon sx={{ fontSize: 26 }} />
            </IconButton>
          ) : (
            <AuthButton
              fullWidth={false}
              prominence="subtle"
              onClick={handleSelectWallet}
            >
              {t('auth:authentication_form.unlock')}
            </AuthButton>
          )}
        </Box>
        {mode === 'entry' && (
          <ChevronRightRoundedIcon
            sx={{
              color: alpha(theme.palette.text.secondary, 0.65),
              fontSize: 24,
              opacity: 0.82,
            }}
          />
        )}
      </Box>
    </Box>
    </>
  );
};

const seedTextFieldSx = (theme, isVisible: boolean) => ({
  '& .MuiOutlinedInput-root': {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    '& fieldset': {
      borderColor: 'rgba(255,255,255,0.08)',
    },
    '&:hover fieldset': {
      borderColor: 'rgba(255,255,255,0.12)',
    },
    '&.Mui-focused fieldset': {
      borderColor: 'rgba(90,136,243,0.42)',
    },
  },
  '& textarea': {
    WebkitTextSecurity: isVisible ? 'none' : 'disc',
    color: theme.palette.text.primary,
    fontSize: '0.95rem',
    lineHeight: 1.6,
  },
});
