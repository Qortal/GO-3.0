/**
 * GO's phone call UI, mounted once by App.tsx on the Android app in place of
 * the Hub's call widgets (MobileVoiceCallBar, the incoming-call card, the
 * group stage that never showed on phones). It decides which call view is on
 * screen:
 *
 * - ringing 1:1 call -> MobileIncomingCallScreen (over everything, also over
 *   GO's lock: only the call is shown, the wallet and chats stay locked);
 * - outgoing / active 1:1 or Qortal group call -> MobileCallScreen, opened
 *   automatically when the call starts, minimized to MobileCallStrip with the
 *   chevron, a swipe down or Android back;
 * - "Call ended" for a moment, then nothing.
 *
 * It also mounts the Android call session (ringing / ongoing notification,
 * mic service, lock screen) and plays the in-app ring. A 1:1 call that rings
 * during a group call rings beside it: the session stays on the group call.
 *
 * Over the phone's own lock (Android keyguard) only the call shows: the call
 * views go above every GO layer, an opaque cover lies under them (and stays
 * a few seconds after, while Android still shows GO there), the rest of the
 * page is made inert, and Android back takes GO off screen.
 *
 * All call actions go through the existing engines (useVoiceCall,
 * GroupCallContext): nothing here changes what goes on the wire.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQdnAvatar } from '../../../lib/qdnAvatars/useQdnAvatar';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { App as CapacitorApp } from '@capacitor/app';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  qortalGroupCallPrimaryNamesAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { useVoiceCallContext } from '../../../context/VoiceCallContext';
import { useGroupCallContext } from '../../../contexts/GroupCallContext';
import {
  isDirectVoiceCallChatId,
  peerAddressFromDirectVoiceChatId,
} from '../../../lib/call/directVoiceCallChatId';
import { startDirectIncomingRingtone } from '../../../lib/call/directIncomingRingtone';
import { useGoLayout, type GoLayout } from '../../../layout/goLayout';
import { BACK_PRIORITY, useAndroidBack } from '../../../utils/androidBack';
import { executeEvent } from '../../../utils/events';
import { getBaseApiReact } from '../../../utils/globalApi';
import {
  buildQdnAvatarUrl,
  QDN_AVATAR_DEFAULT_IDENTIFIER,
} from '../../../lib/qdnAvatars/keys';
import {
  getAppLockLayerContainer,
  isolateAppLockLayer,
} from '../../App/AppLockLayer';
import { getPrimaryNameForAvatar } from '../../Group/groupApi';
import {
  buildGroupParticipants,
  CALL_ENDED_HOLD_MS,
  deriveDirectPhase,
  deriveGroupPhase,
  directTransport,
  groupRelaying,
  groupTransport,
  incomingSwitchPlan,
  isQortalGroupRoom,
  MAX_GROUP_CALL_PARTICIPANTS,
  nativeCallStrings,
  nativeStateForView,
  shortCallAddress,
  type MobileCallView,
} from './callUiModel';
import {
  pushNativeCallStrings,
  useCallAudioRoutes,
  useNativeCallSessionAdapter,
  useNativeSideRing,
} from './callBridgeAdapters';
import {
  CALL_INCOMING_LOCKED_Z,
  CALL_INCOMING_Z,
  CALL_KEYGUARD_BACK_PRIORITY,
  CALL_KEYGUARD_COVER_Z,
  CALL_RING_BACK_PRIORITY,
  CALL_SCREEN_KEYGUARD_Z,
  CALL_SCREEN_LOCKED_Z,
  CALL_SCREEN_Z,
  getGoCallLayerContainer,
  KEYGUARD_COVER_GRACE_MS,
  mobileCallScreenOpenAtom,
  publishCallStrip,
  readHostedGroupRelaying,
  setGoCallRingOverAppLock,
  useCallStripSlotUsable,
  type CallStripActions,
} from './goCallUi';
import { MobileCallScreen } from './MobileCallScreen';
import {
  MobileIncomingCallScreen,
  type IncomingSwitchFrom,
} from './MobileIncomingCallScreen';
import { MobileCallStrip } from './MobileCallStrip';
import { MobileCallLockCover } from './MobileCallLockCover';
import { MobileFullScreenRingNotice } from './MobileFullScreenRingNotice';

const selectShortLandscape = (l: GoLayout) => l.landscape && l.short;
const selectWide = (l: GoLayout) => l.widthClass !== 'compact';

// Primary names already looked up this session (calls repeat the same few).
const primaryNameCache = new Map<string, string>();

function usePrimaryName(address: string): string {
  const [name, setName] = useState(
    () => (address && primaryNameCache.get(address)) || ''
  );
  useEffect(() => {
    if (!address) {
      setName('');
      return undefined;
    }
    const cached = primaryNameCache.get(address);
    if (cached !== undefined) {
      setName(cached);
      return undefined;
    }
    setName('');
    let cancelled = false;
    getPrimaryNameForAvatar(address)
      .then((value) => {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        primaryNameCache.set(address, trimmed);
        if (!cancelled) setName(trimmed);
      })
      .catch(() => {
        if (!cancelled) setName('');
      });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return name;
}

/**
 * Registered names for group call participants the group's member list did
 * not name (looked up once per address per session, same cache as above).
 */
function useLookedUpNames(addresses: string[]): Record<string, string> {
  const key = addresses.join(',');
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const list = key ? key.split(',') : [];
    let cancelled = false;
    const known: Record<string, string> = {};
    for (const address of list) {
      const cached = primaryNameCache.get(address);
      if (cached) known[address] = cached;
    }
    setNames((prev) => {
      const keys = Object.keys(known);
      const same =
        keys.length === Object.keys(prev).length &&
        keys.every((address) => prev[address] === known[address]);
      return same ? prev : known;
    });
    for (const address of list) {
      if (primaryNameCache.has(address)) continue;
      getPrimaryNameForAvatar(address)
        .then((value) => {
          const trimmed = typeof value === 'string' ? value.trim() : '';
          primaryNameCache.set(address, trimmed);
          if (!cancelled && trimmed) {
            setNames((prev) => ({ ...prev, [address]: trimmed }));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return names;
}

/** How often the hosted manager's relaying answer is read during a group call. */
const RELAYING_RECHECK_MS = 2_500;

/**
 * The hosted Hub manager's "this phone forwards others' audio" for the room
 * (null when GO's bridge does not offer it). Read on every render the call
 * changes and every few seconds while connected (topology changes do not
 * always change what the engine context shows).
 */
function useHostedGroupRelaying(roomId: string, connected: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!connected || !roomId) return undefined;
    const id = window.setInterval(
      () => tick((n) => n + 1),
      RELAYING_RECHECK_MS
    );
    return () => window.clearInterval(id);
  }, [connected, roomId]);
  return connected ? readHostedGroupRelaying(roomId) : null;
}

/** Seconds since `running` turned true for this `key` (0 otherwise). */
function useConnectedSeconds(running: boolean, key: string): number {
  const startedRef = useRef<{ key: string; at: number } | null>(null);
  const [, tick] = useState(0);
  if (!running) {
    startedRef.current = null;
  } else if (!startedRef.current || startedRef.current.key !== key) {
    startedRef.current = { key, at: Date.now() };
  }
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => tick((n) => n + 1), 1_000);
    return () => window.clearInterval(id);
  }, [running]);
  return startedRef.current
    ? Math.floor((Date.now() - startedRef.current.at) / 1000)
    : 0;
}

function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      if (condition() || Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(id);
        resolve();
      }
    }, 80);
  });
}

/** GO off screen, as the bridge does when nothing handles back. */
function minimizeGo(): void {
  try {
    void CapacitorApp.minimizeApp().catch(() => undefined);
  } catch {
    /* Android only */
  }
}

function avatarUrlForName(name: string): string | null {
  if (!name) return null;
  try {
    const base = getBaseApiReact();
    if (!base) return null;
    return buildQdnAvatarUrl(base, {
      name,
      identifier: QDN_AVATAR_DEFAULT_IDENTIFIER,
    });
  } catch {
    return null;
  }
}

export type MobileCallRootProps = {
  /** GO's app lock screen is up (App's lockScreenActive). */
  isAppLocked: boolean;
  /**
   * The Home section is on screen (App's desktopViewMode). The Android 14+
   * full-screen ring card only shows there. Default true (tests, preview).
   */
  onHomeSection?: boolean;
};

export function MobileCallRoot({
  isAppLocked,
  onHomeSection = true,
}: MobileCallRootProps) {
  const { t, i18n } = useTranslation(['core']);
  const dm = useVoiceCallContext();
  const gc = useGroupCallContext();
  const userInfo = useAtomValue(userInfoAtom);
  const qcallNames = useAtomValue(qortalGroupCallPrimaryNamesAtom);
  const setQcallNames = useSetAtom(qortalGroupCallPrimaryNamesAtom);
  const [screenOpen, setScreenOpen] = useAtom(mobileCallScreenOpenAtom);
  const shortLandscape = useGoLayout(selectShortLandscape);
  const wide = useGoLayout(selectWide);
  const slotUsable = useCallStripSlotUsable();
  const myAddress = userInfo?.address ?? '';

  // Latest engines for callbacks handed to native code / timers.
  const dmRef = useRef(dm);
  dmRef.current = dm;
  const gcRef = useRef(gc);
  gcRef.current = gc;

  // ---- 1:1 -----------------------------------------------------------------
  const dmChatId = dm.activeCallChatId;
  const dmActive =
    (dm.callState === 'calling' || dm.callState === 'connected') &&
    isDirectVoiceCallChatId(dmChatId);
  const dmPeerAddress =
    dmActive && dmChatId && myAddress
      ? (peerAddressFromDirectVoiceChatId(dmChatId, myAddress) ?? '')
      : '';
  const dmPeerName = usePrimaryName(dmPeerAddress);

  // Audio flowed earlier in this call: losing it reads as "Reconnecting…".
  const hadMediaRef = useRef<{ key: string | null; had: boolean }>({
    key: null,
    had: false,
  });
  if (hadMediaRef.current.key !== dmChatId) {
    hadMediaRef.current = { key: dmChatId, had: false };
  }
  if (dm.callState === 'connected' && dm.callMediaReady) {
    hadMediaRef.current.had = true;
  }

  // ---- Group ---------------------------------------------------------------
  const groupActive =
    isQortalGroupRoom(gc.roomId) &&
    (gc.roomState === 'joining' || gc.roomState === 'connected');
  const groupConnected = groupActive && gc.roomState === 'connected';
  const groupSeconds = useConnectedSeconds(groupConnected, gc.roomId);
  const hostedRelaying = useHostedGroupRelaying(gc.roomId, groupConnected);
  // Participants the group's member list did not name (e.g. a call joined
  // from outside the group's chat): look their names up.
  const memberNames = useMemo(
    () => ({ ...(gc.memberPrimaryNames ?? {}), ...qcallNames }),
    [gc.memberPrimaryNames, qcallNames]
  );
  const unnamedParticipants = useMemo(() => {
    if (!groupActive) return [];
    const out: string[] = [];
    for (const participant of gc.participants ?? []) {
      const address = participant?.address?.trim?.() ?? '';
      if (
        !address ||
        address === myAddress ||
        address.toLowerCase() === 'unknown' ||
        memberNames[address]?.trim() ||
        out.includes(address)
      ) {
        continue;
      }
      out.push(address);
    }
    return out.sort();
  }, [groupActive, gc.participants, memberNames, myAddress]);
  const lookedUpNames = useLookedUpNames(unnamedParticipants);

  const youLabel = t('core:go_call.you');
  const activeView: MobileCallView | null = useMemo(() => {
    if (dmActive && dmChatId) {
      return {
        kind: 'direct',
        phase:
          deriveDirectPhase({
            callState: dm.callState,
            callMediaReady: dm.callMediaReady,
            hadMediaReady: hadMediaRef.current.had,
          }) ?? 'calling',
        callKey: dmChatId,
        title: dmPeerName || shortCallAddress(dmPeerAddress),
        address: dmPeerAddress,
        avatarName: dmPeerName || undefined,
        durationSec: dm.callState === 'connected' ? dm.callDuration : 0,
        muted: dm.isMuted,
        transport: directTransport(dm.audioMode),
        delayed: Boolean(dm.startupStatus?.delayed),
        participants: [],
        maxParticipants: 2,
        relaying: false,
      };
    }
    if (groupActive) {
      const participants = buildGroupParticipants({
        participants: gc.participants ?? [],
        activeSpeakers: gc.activeSpeakers ?? [],
        myAddress,
        myName: userInfo?.name,
        muted: gc.muted,
        names: { ...lookedUpNames, ...memberNames },
        youLabel,
      });
      return {
        kind: 'group',
        phase:
          deriveGroupPhase({
            roomState: gc.roomState,
            stage: gc.startupStatus?.stage ?? 'idle',
          }) ?? 'joining',
        callKey: gc.roomId,
        title: gc.memberGateGroupName?.trim() || '',
        durationSec: groupSeconds,
        muted: gc.muted,
        transport: groupTransport(gc.topologyLabel),
        delayed: Boolean(gc.startupStatus?.delayed),
        participants,
        maxParticipants: MAX_GROUP_CALL_PARTICIPANTS,
        // "You're relaying audio": the hosted Hub manager's own rule when
        // GO's bridge offers it, else a forwarder role in a 3+ room.
        relaying: groupRelaying({
          connected: gc.roomState === 'connected',
          hosted: hostedRelaying,
          role: gc.myRole,
          participantCount: participants.length,
        }),
      };
    }
    return null;
  }, [
    dmActive,
    dmChatId,
    dm.callState,
    dm.callMediaReady,
    dm.callDuration,
    dm.isMuted,
    dm.audioMode,
    dm.startupStatus?.delayed,
    dmPeerName,
    dmPeerAddress,
    groupActive,
    gc.roomState,
    gc.startupStatus?.stage,
    gc.startupStatus?.delayed,
    gc.roomId,
    gc.memberGateGroupName,
    groupSeconds,
    gc.muted,
    gc.topologyLabel,
    gc.participants,
    gc.activeSpeakers,
    gc.myRole,
    memberNames,
    lookedUpNames,
    hostedRelaying,
    myAddress,
    userInfo?.name,
    youLabel,
  ]);

  // ---- "Call ended" for a moment ---------------------------------------------
  // Derived while rendering (React's "state from the previous render"
  // pattern), so the screen goes straight from the call to "Call ended"
  // without a frame in between that would close it.
  const [lastActive, setLastActive] = useState<MobileCallView | null>(null);
  const [endedView, setEndedView] = useState<MobileCallView | null>(null);
  if (activeView !== lastActive) {
    setLastActive(activeView);
    if (activeView) {
      if (endedView) setEndedView(null);
    } else if (lastActive) {
      setEndedView({ ...lastActive, phase: 'ended' });
    }
  }
  useEffect(() => {
    if (!endedView) return undefined;
    const id = window.setTimeout(() => setEndedView(null), CALL_ENDED_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [endedView]);
  const shownView = activeView ?? endedView;
  const lastViewRef = useRef<MobileCallView | null>(null);
  useEffect(() => {
    if (shownView) lastViewRef.current = shownView;
  }, [shownView]);

  // Leaving a group call: forget its member names, as the Hub stage does.
  const prevGroupActiveRef = useRef(groupActive);
  useEffect(() => {
    if (prevGroupActiveRef.current && !groupActive) setQcallNames({});
    prevGroupActiveRef.current = groupActive;
  }, [groupActive, setQcallNames]);

  // A new call opens the full screen; minimizing stays minimized for it.
  // `needsAutoOpen` shows it in the very first render (no strip flash), the
  // effect then records it.
  const activeKey = activeView?.callKey ?? null;
  const [autoOpenedKey, setAutoOpenedKey] = useState<string | null>(null);
  const needsAutoOpen = Boolean(activeKey) && activeKey !== autoOpenedKey;
  useEffect(() => {
    if (!activeKey) {
      setAutoOpenedKey(null);
      return;
    }
    if (activeKey !== autoOpenedKey) {
      setScreenOpen(true);
      setAutoOpenedKey(activeKey);
    }
  }, [activeKey, autoOpenedKey, setScreenOpen]);
  const anyShown = Boolean(shownView);
  useEffect(() => {
    if (!anyShown) setScreenOpen(false);
  }, [anyShown, setScreenOpen]);

  // ---- Incoming --------------------------------------------------------------
  const ringing =
    dm.callState === 'ringing' &&
    Boolean(dm.incomingCall) &&
    isDirectVoiceCallChatId(dm.incomingCall?.chatId);
  const incomingAddress = ringing ? (dm.incomingCall?.fromAddress ?? '') : '';
  const incomingName = usePrimaryName(incomingAddress);
  const incomingTitle = incomingName || shortCallAddress(incomingAddress);
  const switchPlan = incomingSwitchPlan({
    directState: dm.callState,
    groupRoomState: groupActive ? gc.roomState : 'idle',
  });
  const switchFrom: IncomingSwitchFrom = !ringing
    ? null
    : switchPlan.dropGroup
      ? 'group'
      : switchPlan.dropDirect
        ? 'direct'
        : null;

  const [silenced, setSilenced] = useState(false);
  useEffect(() => {
    if (!ringing) setSilenced(false);
  }, [ringing]);

  const [accepting, setAccepting] = useState(false);
  const busyRef = useRef(false);

  const acceptIncoming = useCallback(async () => {
    if (busyRef.current) return;
    if (dmRef.current.callState !== 'ringing') return;
    busyRef.current = true;
    setAccepting(true);
    try {
      const plan = incomingSwitchPlan({
        directState: dmRef.current.callState,
        groupRoomState: isQortalGroupRoom(gcRef.current.roomId)
          ? gcRef.current.roomState
          : 'idle',
      });
      if (plan.dropGroup) {
        await gcRef.current.leaveGroupCall().catch(() => undefined);
        await waitFor(() => gcRef.current.roomState === 'idle', 6_000);
      }
      if (dmRef.current.callState === 'ringing') {
        await dmRef.current.acceptCall();
      }
    } finally {
      busyRef.current = false;
      setAccepting(false);
    }
  }, []);

  const declineIncoming = useCallback(() => {
    if (busyRef.current) return;
    if (dmRef.current.callState !== 'ringing') return;
    void dmRef.current.rejectCall();
  }, []);

  // ---- Active call actions --------------------------------------------------
  const shownKindRef = useRef<MobileCallView['kind'] | null>(null);
  shownKindRef.current = shownView?.kind ?? null;
  const shownMutedRef = useRef(false);
  shownMutedRef.current = Boolean(shownView?.muted);

  const hangUpActive = useCallback(() => {
    if (shownKindRef.current === 'group') {
      void gcRef.current.leaveGroupCall();
    } else if (shownKindRef.current === 'direct') {
      void dmRef.current.hangUp();
    }
  }, []);

  const toggleMuteActive = useCallback(() => {
    if (shownKindRef.current === 'group') {
      gcRef.current.setMuted(!gcRef.current.muted);
    } else if (shownKindRef.current === 'direct') {
      dmRef.current.toggleMute();
    }
  }, []);

  const openScreen = useCallback(() => {
    setLockPeek(false);
    setScreenOpen(true);
  }, [setScreenOpen]);
  const minimize = useCallback(() => setScreenOpen(false), [setScreenOpen]);

  const messagePeer = useCallback(() => {
    const view = lastViewRef.current;
    if (!view || view.kind !== 'direct' || !view.address) return;
    setScreenOpen(false);
    executeEvent('openDirectMessageInternal', {
      address: view.address,
      name: view.avatarName || view.address,
    });
  }, [setScreenOpen]);

  // ---- Native call session ----------------------------------------------------
  // A 1:1 call that rings while another call runs (a group call; useVoiceCall
  // only rings while its own state is idle) rings beside it: Android's call
  // session stays on the running call (mic service, Wi-Fi lock, ongoing
  // notification), the ring is posted on its own. A ring that started that
  // way stays so (also while "End & accept" leaves the group), so it is not
  // torn down and posted again halfway.
  const incomingCallId = ringing ? (dm.incomingCall?.callId ?? '') : null;
  const sideRingRef = useRef<string | null>(null);
  if (incomingCallId === null) {
    sideRingRef.current = null;
  } else if (activeView && sideRingRef.current !== incomingCallId) {
    sideRingRef.current = incomingCallId;
  }
  const sideRing =
    incomingCallId !== null && sideRingRef.current === incomingCallId;
  const ringInSession = ringing && !sideRing;

  // The notification gets the same picture as the call screen: GO's avatar
  // cache hands out same-origin object URLs the native side can be given as
  // data, whereas a node URL is often not readable from the page (CORS).
  const nativeAvatarName = ringInSession
    ? incomingName
    : (shownView?.avatarName ?? '');
  const nativeAvatar = useQdnAvatar(nativeAvatarName || null, {
    enabled: Boolean(nativeAvatarName),
    countUse: false,
  });
  const sideRingAvatar = useQdnAvatar(incomingName || null, {
    enabled: sideRing && Boolean(incomingName),
    countUse: false,
  });

  const nativeInfo = useNativeCallSessionAdapter({
    callState: nativeStateForView(shownView, ringInSession),
    callId: ringInSession
      ? (dm.incomingCall?.callId ?? null)
      : (shownView?.callKey ?? null),
    peerName: ringInSession ? incomingTitle : (shownView?.title ?? ''),
    peerAvatarUrl: nativeAvatar.src || avatarUrlForName(nativeAvatarName),
    peerAddress: ringInSession ? incomingAddress : (shownView?.address ?? null),
    isGroup: !ringInSession && shownView?.kind === 'group',
    muted: Boolean(shownView?.muted),
    onAccept: () => void acceptIncoming(),
    onDecline: declineIncoming,
    onHangup: hangUpActive,
    // The notification says which way (Mute / Unmute): only flip when the
    // call is not already there.
    onToggleMute: (nextMuted) => {
      if (
        typeof nextMuted === 'boolean' &&
        nextMuted === shownMutedRef.current
      ) {
        return;
      }
      toggleMuteActive();
    },
    onOpen: openScreen,
    // Lets Android ring a call for this account while the page is frozen.
    // (No `activeCall`: a ring while a call runs is a side ring, so the
    // session's own inputs always describe the running call.)
    localAddress: myAddress || null,
  });

  const sideRingNative = useNativeSideRing({
    enabled: sideRing,
    callId: incomingCallId || null,
    fromAddress: incomingAddress,
    fromName: incomingTitle,
    avatarUrl: sideRingAvatar.src || avatarUrlForName(incomingName),
    onAccept: () => void acceptIncoming(),
    onDecline: declineIncoming,
  });

  const keyguardLocked = Boolean(nativeInfo.keyguardLocked);
  const locked = isAppLocked || keyguardLocked;

  // Over the phone's lock only the call may show. Android shows GO there for
  // a ring or a call and a few seconds after (KEYGUARD_COVER_GRACE_MS); the
  // page starting counts too (GO opened from a ring over the lock). Outside
  // that window nothing is drawn: the phone locking with GO open is not a
  // call, and a cover left in the page would flash on the next unlock.
  const callSurface =
    ringing || Boolean(shownView) || Boolean(nativeInfo.nativeRinging);
  const [surfaceSeen, setSurfaceSeen] = useState(() => ({
    on: callSurface,
    endedAt: Date.now(),
  }));
  if (surfaceSeen.on !== callSurface) {
    setSurfaceSeen({
      on: callSurface,
      endedAt: callSurface ? surfaceSeen.endedAt : Date.now(),
    });
  }
  const coverGraceLeftMs =
    surfaceSeen.endedAt + KEYGUARD_COVER_GRACE_MS - Date.now();
  const [, setCoverTick] = useState(0);
  useEffect(() => {
    if (!keyguardLocked || callSurface) return undefined;
    const left = surfaceSeen.endedAt + KEYGUARD_COVER_GRACE_MS - Date.now();
    if (left <= 0) return undefined;
    const id = window.setTimeout(() => setCoverTick((n) => n + 1), left + 50);
    return () => window.clearTimeout(id);
  }, [keyguardLocked, callSurface, surfaceSeen.endedAt]);
  // GO's own lock screen covers everything by itself.
  const keyguardCall =
    keyguardLocked && !isAppLocked && (callSurface || coverGraceLeftMs > 0);

  // GO's own lock during a call: "Unlock" steps the call screen aside so the
  // lock screen can be used; the call stays reachable as the pill above it.
  const [lockPeek, setLockPeek] = useState(false);
  const hasShownView = Boolean(shownView);
  useEffect(() => {
    if (!isAppLocked || !hasShownView) setLockPeek(false);
  }, [isAppLocked, hasShownView]);

  // Android's call notifications speak GO's language.
  const language = i18n.language;
  useEffect(() => {
    pushNativeCallStrings(nativeCallStrings(t));
  }, [language, t]);

  // ---- Ring -------------------------------------------------------------------
  const webRing = ringing && !silenced && !nativeInfo.nativeRinging;
  useEffect(() => {
    if (!webRing) return undefined;
    return startDirectIncomingRingtone();
  }, [webRing]);

  const silenceRinger = useCallback(() => {
    setSilenced(true);
    try {
      if (sideRing) sideRingNative.silence();
      else nativeInfo.silenceRinger?.();
    } catch {
      /* best effort */
    }
  }, [nativeInfo, sideRing, sideRingNative]);

  // ---- Which view ---------------------------------------------------------------
  const forcedByLock = keyguardLocked || (isAppLocked && !lockPeek);
  const showScreen =
    Boolean(shownView) &&
    (forcedByLock || (!isAppLocked && (screenOpen || needsAutoOpen)));
  // Never over the phone's lock; over GO's lock only after "Unlock".
  const showStrip = Boolean(shownView) && !showScreen && !keyguardLocked;

  const unlockFromCall = keyguardLocked
    ? nativeInfo.requestUnlock
      ? () => void nativeInfo.requestUnlock?.()
      : undefined
    : isAppLocked
      ? () => {
          setScreenOpen(false);
          setLockPeek(true);
        }
      : undefined;

  // Ring screen: back silences the ring (it does not decline). It is drawn
  // over everything, so it goes before a Q-App approval that may sit under it.
  useAndroidBack(
    () => {
      silenceRinger();
      return true;
    },
    { priority: CALL_RING_BACK_PRIORITY, enabled: ringing }
  );
  useAndroidBack(
    () => {
      setScreenOpen(false);
      return true;
    },
    { priority: BACK_PRIORITY.call, enabled: showScreen && !locked }
  );
  // Over the phone's lock: back takes GO off screen (the lock shows), as with
  // GO's own lock. Nothing hidden under the call (a chat, an approval) reacts.
  useAndroidBack(
    () => {
      minimizeGo();
      return true;
    },
    { priority: CALL_KEYGUARD_BACK_PRIORITY, enabled: keyguardCall && !ringing }
  );

  // GO's back-button lock gate lets back through to the ring (useAppLock).
  const ringOverAppLock = ringing && isAppLocked;
  useEffect(() => {
    setGoCallRingOverAppLock(ringOverAppLock);
    return () => setGoCallRingOverAppLock(false);
  }, [ringOverAppLock]);

  // The in-bar strip (App's top bar slot) reads this.
  const stripActions: CallStripActions = useMemo(
    () => ({
      open: openScreen,
      toggleMute: toggleMuteActive,
      hangUp: hangUpActive,
    }),
    [hangUpActive, openScreen, toggleMuteActive]
  );
  useEffect(() => {
    publishCallStrip({
      view: shownView,
      actions: stripActions,
      // The top bar sits under GO's lock: the pill floats there instead.
      show: showStrip && !isAppLocked,
    });
  }, [shownView, stripActions, showStrip, isAppLocked]);
  useEffect(
    () => () => publishCallStrip({ view: null, actions: null, show: false }),
    []
  );

  const audio = useCallAudioRoutes(
    Boolean(activeView) && activeView?.phase !== 'ended'
  );

  // ---- Over the lock ---------------------------------------------------------
  // GO's lock makes every other body child inert, so while it is up the call
  // UI is drawn inside the lock's own layer, above the lock screen.
  const overLock = isAppLocked && (ringing || showScreen || showStrip);
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!overLock) return undefined;
    const layer = layerRef.current;
    if (!layer) return undefined;
    // The lock's modal hides its siblings from TalkBack when it opens; the
    // call is the one thing that must stay reachable.
    const unhide = () => {
      if (layer.getAttribute('aria-hidden') === 'true') {
        layer.removeAttribute('aria-hidden');
      }
      if (layer.hasAttribute('inert')) layer.removeAttribute('inert');
    };
    unhide();
    const observer = new MutationObserver(unhide);
    observer.observe(layer, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'inert'],
    });
    // Do not leave the lock's password field focused (and the keyboard up)
    // under the call.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.tagName === 'INPUT' &&
      layer.parentElement?.contains(active)
    ) {
      active.blur();
    }
    return () => observer.disconnect();
  }, [overLock]);

  const portalTarget =
    typeof document === 'undefined'
      ? null
      : overLock
        ? getAppLockLayerContainer()
        : getGoCallLayerContainer();

  // Over the phone's lock the rest of the page is inert and hidden from
  // TalkBack (dialogs opened before or during the call included), the same
  // way GO's own lock isolates its layer.
  useEffect(() => {
    if (!keyguardCall) return undefined;
    const container = getGoCallLayerContainer();
    if (!container) return undefined;
    return isolateAppLockLayer(container);
  }, [keyguardCall]);

  const unlockPhone = nativeInfo.requestUnlock
    ? () => void nativeInfo.requestUnlock?.()
    : undefined;

  const callLayer =
    portalTarget && (!isAppLocked || overLock)
      ? createPortal(
          <div data-go-call-layer="" ref={layerRef}>
            {/* Over the phone's lock: under the call views (also while they
                fade), and alone between them. */}
            {keyguardCall ? (
              <MobileCallLockCover
                zIndex={CALL_KEYGUARD_COVER_Z}
                backdrop={ringing || showScreen}
                onUnlock={unlockPhone}
              />
            ) : null}
            <AnimatePresence>
              {showScreen && shownView ? (
                <MobileCallScreen
                  key={`call-${shownView.callKey}`}
                  view={shownView}
                  locked={locked}
                  zIndex={
                    overLock
                      ? CALL_SCREEN_LOCKED_Z
                      : keyguardLocked
                        ? CALL_SCREEN_KEYGUARD_Z
                        : CALL_SCREEN_Z
                  }
                  landscape={shortLandscape}
                  wide={wide}
                  audio={{
                    routes: audio.routes,
                    current: audio.current,
                    onSelect: audio.select,
                  }}
                  onMinimize={minimize}
                  onToggleMute={toggleMuteActive}
                  onHangUp={hangUpActive}
                  onMessage={
                    shownView.kind === 'direct' ? messagePeer : undefined
                  }
                  onUnlock={unlockFromCall}
                />
              ) : null}
            </AnimatePresence>
            <AnimatePresence>
              {ringing ? (
                <MobileIncomingCallScreen
                  key={`ring-${dm.incomingCall?.callId ?? ''}`}
                  callerName={incomingTitle}
                  callerAddress={incomingAddress}
                  avatarName={incomingName || undefined}
                  zIndex={overLock ? CALL_INCOMING_LOCKED_Z : CALL_INCOMING_Z}
                  locked={locked}
                  switchFrom={switchFrom}
                  ringerSilenced={silenced}
                  busy={accepting}
                  landscape={shortLandscape}
                  onAccept={() => void acceptIncoming()}
                  onDecline={declineIncoming}
                />
              ) : null}
            </AnimatePresence>
            {/* Over GO's lock after "Unlock": the call as a pill above it. */}
            <AnimatePresence>
              {overLock && showStrip && shownView ? (
                <MobileCallStrip
                  key="call-strip-locked"
                  view={shownView}
                  variant="floating"
                  zIndex={CALL_SCREEN_LOCKED_Z}
                  onOpen={openScreen}
                  onToggleMute={toggleMuteActive}
                  onHangUp={hangUpActive}
                />
              ) : null}
            </AnimatePresence>
          </div>,
          portalTarget
        )
      : null;

  const floatingStrip =
    typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
            {showStrip && !isAppLocked && !slotUsable && shownView ? (
              <MobileCallStrip
                key="call-strip"
                view={shownView}
                variant="floating"
                onOpen={openScreen}
                onToggleMute={toggleMuteActive}
                onHangUp={hangUpActive}
              />
            ) : null}
          </AnimatePresence>,
          document.body
        )
      : null;

  // Android 14+: incoming calls can only show over the lock screen with the
  // user's OK. A small card says so once per app start, on Home only (not
  // over a call, a ring or a lock; the card itself also waits while the
  // user types).
  const fullScreenNotice =
    typeof document !== 'undefined'
      ? createPortal(
          <MobileFullScreenRingNotice
            blocked={
              callSurface || locked || Boolean(endedView) || !onHomeSection
            }
          />,
          document.body
        )
      : null;

  return (
    <>
      {callLayer}
      {floatingStrip}
      {fullScreenNotice}
    </>
  );
}

export default MobileCallRoot;
