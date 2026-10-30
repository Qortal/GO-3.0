import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { isPendingDeepLinkFresh } from '../lib/appLock';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';
import {
  clearPendingJoinGroupRequest,
  clearPendingPaymentRequest,
  getPendingJoinGroupRequest,
  getPendingPaymentRequest,
} from '../utils/paymentLink';

type SendQortOverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
} | null;

/** What `openPaymentInternal` carries (deep links, profiles, chat). */
type OpenPaymentDetail = {
  address?: string;
  name?: string;
  amount?: number | string;
  anchorRect?: SendQortOverlayRect;
  targetRect?: SendQortOverlayRect;
};

type UseSendQortOverlayOptions = {
  /** Authenticated, main window, lock screen down (from `useAppLock`). */
  walletUnlocked: boolean;
  /** Same, current during render: event handlers read it. */
  walletUnlockedRef: MutableRefObject<boolean>;
  /** The signed-in account; a pending link is replayed once it is known. */
  address?: string | null;
  now?: () => number;
};

const toRect = (rect?: SendQortOverlayRect): SendQortOverlayRect =>
  rect
    ? {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }
    : null;

const toAmount = (raw: unknown): number | undefined => {
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
};

/**
 * The Send QORT overlay and the payment / join-group deep links (GO-10).
 *
 * - Send opens only in an open, unlocked wallet. A payment link that arrives
 *   at the login or lock screen waits as the pending request in
 *   `utils/paymentLink.ts` and opens Send right after the login or unlock,
 *   unless it is older than `PENDING_DEEP_LINK_TTL_MS`. A pending join-group
 *   link is replayed the same way.
 * - Closing Send only closes it; nothing here touches who is signed in.
 * - The recipient and amount never outlive the overlay: closing it, a
 *   completed send and a manual open all start from empty fields, so a later
 *   Send never offers the previous recipient again.
 */
export function useSendQortOverlay({
  walletUnlocked,
  walletUnlockedRef,
  address,
  now = Date.now,
}: UseSendQortOverlayOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSuccessOpen, setIsSuccessOpen] = useState(false);
  const [paymentTo, setPaymentTo] = useState('');
  const [paymentAmount, setPaymentAmount] = useState<number | undefined>(
    undefined
  );
  const [originRect, setOriginRect] = useState<SendQortOverlayRect>(null);
  const [targetRect, setTargetRect] = useState<SendQortOverlayRect>(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  // When a deep link that is still waiting was first seen.
  const pendingSeenAtRef = useRef<number | null>(null);

  const resetFields = useCallback(() => {
    setPaymentTo('');
    setPaymentAmount(undefined);
    setOriginRect(null);
    setTargetRect(null);
  }, []);

  /** Back / X on Send: close it and forget what was typed or prefilled. */
  const close = useCallback(() => {
    setIsOpen(false);
    resetFields();
    // Screens that opened Send (Qortal Card's top up) come back.
    executeEvent('sendQortFinished', { sent: false });
  }, [resetFields]);

  /** Send button on Home: always an empty form. */
  const openManual = useCallback(() => {
    resetFields();
    executeEvent('openSendQortInternal', {});
    setIsOpen(true);
  }, [resetFields]);

  /** The payment went through: Send closes, the success screen shows. */
  const markSent = useCallback(() => {
    setIsOpen(false);
    resetFields();
    setIsSuccessOpen(true);
  }, [resetFields]);

  /** "Continue" on the success screen. */
  const continueAfterSuccess = useCallback(() => {
    setIsSuccessOpen(false);
    resetFields();
    executeEvent('sendQortFinished', { sent: true });
  }, [resetFields]);

  /** Logout and the like: Send and its success screen belong to the wallet. */
  const closeAll = useCallback(() => {
    setIsOpen(false);
    setIsSuccessOpen(false);
    resetFields();
  }, [resetFields]);

  /** Opens Send prefilled, from a link, a profile or a chat. */
  const openPayment = useCallback(
    (detail?: OpenPaymentDetail | null) => {
      if (!walletUnlockedRef.current) {
        // Not now: it waits as the pending request and opens after the unlock.
        if (getPendingPaymentRequest()) {
          pendingSeenAtRef.current = nowRef.current();
        }
        return;
      }
      // Delivered to the open wallet: never replay it on a later login.
      clearPendingPaymentRequest();
      setOriginRect(toRect(detail?.anchorRect));
      setTargetRect(toRect(detail?.targetRect));
      setPaymentTo(detail?.name || detail?.address || '');
      setPaymentAmount(toAmount(detail?.amount));
      setIsOpen(true);
    },
    [walletUnlockedRef]
  );

  useEffect(() => {
    const onOpenPayment = (event: Event) =>
      openPayment((event as CustomEvent<OpenPaymentDetail>).detail);
    subscribeToEvent('openPaymentInternal', onOpenPayment);
    return () => unsubscribeFromEvent('openPaymentInternal', onOpenPayment);
  }, [openPayment]);

  // Note when a waiting deep link was first seen (a cold launch delivers it
  // before this mounts), and forget a join-group link once it has reached the
  // open, unlocked wallet so it is not replayed later.
  useEffect(() => {
    if (getPendingPaymentRequest() || getPendingJoinGroupRequest()) {
      pendingSeenAtRef.current = nowRef.current();
    }
    const onJoinGroupDelivered = () => {
      if (walletUnlockedRef.current) {
        clearPendingJoinGroupRequest();
        return;
      }
      if (getPendingJoinGroupRequest()) {
        pendingSeenAtRef.current = nowRef.current();
      }
    };
    subscribeToEvent('globalActionJoinGroup', onJoinGroupDelivered);
    return () =>
      unsubscribeFromEvent('globalActionJoinGroup', onJoinGroupDelivered);
  }, [walletUnlockedRef]);

  // Replay a payment / join-group link that arrived before the wallet was
  // open and unlocked (cold launch from an external scanner, the login
  // screen, the lock screen), once it is, unless it has gone stale.
  useEffect(() => {
    if (!walletUnlocked || !address) return;
    const pending = getPendingPaymentRequest();
    const pendingJoinGroupId = getPendingJoinGroupRequest();
    if (!pending && !pendingJoinGroupId) return;
    const fresh = isPendingDeepLinkFresh(
      pendingSeenAtRef.current,
      nowRef.current()
    );
    pendingSeenAtRef.current = null;
    clearPendingPaymentRequest();
    clearPendingJoinGroupRequest();
    if (!fresh) return;
    if (pending?.recipient) {
      openPayment({ address: pending.recipient, amount: pending.amount });
    }
    if (pendingJoinGroupId) {
      executeEvent('globalActionJoinGroup', { groupId: pendingJoinGroupId });
    }
  }, [address, openPayment, walletUnlocked]);

  return {
    isOpen,
    isSuccessOpen,
    paymentTo,
    paymentAmount,
    originRect,
    targetRect,
    openManual,
    openPayment,
    close,
    markSent,
    continueAfterSuccess,
    closeAll,
  };
}
