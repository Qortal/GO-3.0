import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPrimaryNamesForAddresses } from '../components/Group/groupApi';
import { mergeReticulumPayloadWithVerifiedEnvelope } from '../utils/reticulumEventEnvelope';
import { describeSignerMismatch } from '../utils/reticulumSignerMismatch';
import { TIME_MONTHS_1_IN_MILLISECONDS } from '../constants/constants';

const RETICULUM_DIRECT_EVENT_BATCH_MS = 250;
const directHistoryCache = new Map<string, ReticulumDmEvent[]>();

export type ReticulumDmEvent = {
  eventId: string;
  conversationId: string;
  senderAddress: string;
  recipientAddress: string;
  senderPublicKey: string;
  senderStreamId?: string;
  senderSeq: number;
  timestamp: number;
  eventType: 'message' | 'edit' | 'delete' | 'reaction_add' | 'reaction_remove';
  targetEventId?: string;
  replyToEventId?: string;
  payload: string;
  payloadHash: string;
  signature: string;
  legacySignature?: string;
  authorPrimaryName?: string;
  senderName?: string;
  localDeliveryStatus?: 'pending' | 'sent' | 'received';
  localDeliveryUpdatedAt?: number;
  /**
   * True when this device authored the event, false for a stored copy (also
   * of the account's own message written on another device). Only authored
   * events have a delivery this device can know about.
   */
  localOwnEvent?: boolean;
  /** An own device (the home Hub) pulled this pending own event. */
  localOwnDeviceCopiedAt?: number;
  expiresAt?: number | null;
};

type ReticulumDmChatReference = {
  deleted?: boolean;
  edit?: ReturnType<typeof reticulumDmEventToChatMessage>;
  reactions?: Record<
    string,
    Array<ReturnType<typeof reticulumDmEventToChatMessage>>
  >;
};

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const conversationIdFor = async (addressA: string, addressB: string) => {
  const [a, b] = [addressA, addressB].sort();
  return sha256Hex(`rchat-dm-v1:${a}:${b}`);
};

export const isReticulumDmEventForConversation = (
  event: Pick<
    ReticulumDmEvent,
    'conversationId' | 'senderAddress' | 'recipientAddress'
  >,
  conversationId: string,
  myAddress: string,
  peerAddress: string
): boolean => {
  if (!conversationId || event.conversationId !== conversationId) return false;
  return (
    (event.senderAddress === myAddress &&
      event.recipientAddress === peerAddress) ||
    (event.senderAddress === peerAddress &&
      event.recipientAddress === myAddress)
  );
};

const parsePayload = (payload: string): any => {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { messageText: payload };
  }
};

const hasPayloadData = (value: unknown): value is Record<string, unknown> =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );

/** Drop composer-only fields so a short DM can fit a 383-byte Reticulum packet. */
const compactOtherData = (
  value: unknown
): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'specialId') continue;
    if (entry == null || entry === '') continue;
    out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const randomDirectEventId = () => {
  const bytes = new Uint8Array(8);
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.getRandomValues === 'function') {
    browserCrypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

export const reticulumDmEventToChatMessage = (event: ReticulumDmEvent) => {
  const payload = parsePayload(event.payload);
  const otherData =
    payload.otherData && typeof payload.otherData === 'object'
      ? payload.otherData
      : {};
  const senderName =
    event.senderName?.trim() ||
    event.authorPrimaryName?.trim() ||
    event.senderAddress;
  return mergeReticulumPayloadWithVerifiedEnvelope(otherData, {
    id: event.eventId,
    eventId: event.eventId,
    signature: event.eventId,
    conversationId: event.conversationId,
    eventType: event.eventType,
    chatReference: event.targetEventId || payload.chatReference,
    repliedTo: event.replyToEventId || otherData.repliedTo,
    targetEventId: event.targetEventId,
    replyToEventId: event.replyToEventId,
    timestamp: event.timestamp,
    sender: event.senderAddress,
    senderAddress: event.senderAddress,
    senderName,
    authorPrimaryName: event.authorPrimaryName,
    recipientAddress: event.recipientAddress,
    senderPublicKey: event.senderPublicKey,
    senderStreamId: event.senderStreamId,
    senderSeq: event.senderSeq,
    text: payload.messageText || '',
    message: payload.messageText || '',
    messageText: payload.messageText || '',
    unread: false,
    reticulumChat: true,
    reticulumDirect: true,
    // A copy of our own message written on another device has no delivery
    // this device knows about. Older builds marked such copies 'sent' when
    // serving them, which showed a delivered tick here; show nothing.
    reticulumDeliveryStatus:
      event.localOwnEvent === false && event.localDeliveryStatus === 'sent'
        ? 'received'
        : event.localDeliveryStatus,
    reticulumDeliveryUpdatedAt: event.localDeliveryUpdatedAt,
    reticulumOwnDeviceCopiedAt: event.localOwnDeviceCopiedAt,
    expiresAt:
      event.expiresAt == null || !Number.isFinite(Number(event.expiresAt))
        ? null
        : Number(event.expiresAt),
  });
};

export const projectReticulumDmEvents = (events: ReticulumDmEvent[]) => {
  const ordered = [...events].sort(
    (a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
  );
  const originalMessages = new Map(
    ordered
      .filter((event) => event.eventType === 'message')
      .map((event) => [event.eventId, event])
  );
  const chatReferences: Record<string, ReticulumDmChatReference> = {};

  for (const event of ordered) {
    if (event.eventType === 'message' || !event.targetEventId) continue;
    const target = originalMessages.get(event.targetEventId);
    if (!target || target.conversationId !== event.conversationId) continue;
    const reference = (chatReferences[event.targetEventId] ||= {});

    if (event.eventType === 'edit' || event.eventType === 'delete') {
      if (target.senderAddress !== event.senderAddress) continue;
      if (event.eventType === 'delete') {
        reference.deleted = true;
        continue;
      }
      reference.edit = reticulumDmEventToChatMessage(event);
      continue;
    }

    if (
      event.eventType !== 'reaction_add' &&
      event.eventType !== 'reaction_remove'
    ) {
      continue;
    }
    const reactionEvent = reticulumDmEventToChatMessage(event);
    const reaction = String(reactionEvent?.content || '').trim();
    if (!reaction) continue;
    const reactions = (reference.reactions ||= {});
    const current = reactions[reaction] || [];
    const withoutSender = current.filter(
      (item) => item.sender !== event.senderAddress
    );
    if (event.eventType === 'reaction_add') {
      withoutSender.push(reactionEvent);
    }
    if (withoutSender.length > 0) reactions[reaction] = withoutSender;
    else delete reactions[reaction];
  }

  // Each message shows its own stored delivery state. A later 'sent' event
  // says nothing about an earlier pending one: the engine marks every event
  // a delivered page carried, so one left pending was not on that page (it
  // was older than the window a page re-serves, or past the page's cap), or
  // only the newer one was proven (the recipient's notify names its newest).
  const messages: Array<ReturnType<typeof reticulumDmEventToChatMessage>> = [];
  ordered.forEach((event) => {
    if (
      event.eventType !== 'message' ||
      chatReferences[event.eventId]?.deleted === true
    ) {
      return;
    }
    messages.push(reticulumDmEventToChatMessage(event));
  });
  return { messages, chatReferences };
};

const addPrimaryNamesToDirectEvents = async (
  events: ReticulumDmEvent[],
  primaryNameCache: Map<string, string>
): Promise<ReticulumDmEvent[]> => {
  const addresses = Array.from(
    new Set(
      events
        .map((event) => event.senderAddress)
        .filter(
          (address): address is string =>
            typeof address === 'string' && !!address
        )
    )
  );
  if (addresses.length === 0) return events;

  const missingAddresses = addresses.filter(
    (address) => !primaryNameCache.has(address)
  );

  if (missingAddresses.length > 0) {
    try {
      const primaryNames = await getPrimaryNamesForAddresses(missingAddresses);
      for (const address of missingAddresses) {
        primaryNameCache.set(address, primaryNames[address]?.trim() || '');
      }
    } catch (error) {
      console.error(
        '[useReticulumDirectChat] Failed to resolve primary names:',
        error
      );
    }
  }

  return events.map((event) => {
    const primaryName = primaryNameCache.get(event.senderAddress)?.trim() || '';
    if (!primaryName) return event;
    return {
      ...event,
      authorPrimaryName: primaryName,
      senderName: event.senderName?.trim() || primaryName,
    };
  });
};

/**
 * Delivery only moves forward (pending -> sent, then an own-device copy
 * stays recorded). A stale copy of an event (an older emit, a cached history
 * page, the optimistic row) must not walk the UI state back.
 */
const keepDeliveryProgress = (
  existing: ReticulumDmEvent | undefined,
  incoming: ReticulumDmEvent
): ReticulumDmEvent => {
  if (!existing) return incoming;
  let next = incoming;
  if (
    existing.localDeliveryStatus === 'sent' &&
    incoming.localDeliveryStatus === 'pending'
  ) {
    next = {
      ...next,
      localDeliveryStatus: 'sent',
      localDeliveryUpdatedAt: existing.localDeliveryUpdatedAt,
    };
  }
  if (existing.localOwnDeviceCopiedAt && !incoming.localOwnDeviceCopiedAt) {
    next = { ...next, localOwnDeviceCopiedAt: existing.localOwnDeviceCopiedAt };
  }
  if (
    existing.localOwnEvent !== undefined &&
    incoming.localOwnEvent === undefined
  ) {
    next = { ...next, localOwnEvent: existing.localOwnEvent };
  }
  return next;
};

export const mergeEvents = (
  prev: ReticulumDmEvent[],
  incoming: ReticulumDmEvent[]
) => {
  const byId = new Map(prev.map((event) => [event.eventId, event]));
  for (const event of incoming) {
    byId.set(
      event.eventId,
      keepDeliveryProgress(byId.get(event.eventId), event)
    );
  }
  return [...byId.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
  );
};

export function useReticulumDirectChat(
  myAddress?: string,
  peerAddress?: string
) {
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<ReticulumDmEvent[]>([]);
  const [loadedInitialHistoryKey, setLoadedInitialHistoryKey] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const pendingRef = useRef<ReticulumDmEvent[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSenderSeqRef = useRef(0);
  const senderStreamIdRef = useRef('');
  const primaryNameCacheRef = useRef<Map<string, string>>(new Map());
  const activeConversationGenerationRef = useRef(0);
  const visibilityRevisionRef = useRef(0);

  const valid = Boolean(myAddress && peerAddress);
  const activeHistoryKey = valid ? `${myAddress}:${peerAddress}` : '';
  const projection = useMemo(() => projectReticulumDmEvents(events), [events]);
  const messages = projection.messages;

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = [];
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    if (pending.length === 0) return;
    const generation = activeConversationGenerationRef.current;
    const visibilityRevision = visibilityRevisionRef.current;
    void addPrimaryNamesToDirectEvents(
      pending,
      primaryNameCacheRef.current
    ).then((enriched) => {
      if (
        activeConversationGenerationRef.current !== generation ||
        visibilityRevisionRef.current !== visibilityRevision
      ) {
        return;
      }
      setEvents((prev) => mergeEvents(prev, enriched));
    });
  }, []);

  const enqueue = useCallback(
    (event: ReticulumDmEvent) => {
      pendingRef.current.push(event);
      if (batchTimerRef.current) return;
      batchTimerRef.current = setTimeout(
        flushPending,
        RETICULUM_DIRECT_EVENT_BATCH_MS
      );
    },
    [flushPending]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const value = await window.reticulumChat?.isEnabled?.();
      if (cancelled) return;
      const nextEnabled = value === true;
      setEnabled(nextEnabled);
      if (nextEnabled && myAddress) {
        void window.reticulumChat?.setLocalDmAddresses?.([myAddress]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myAddress]);

  useEffect(() => {
    if (!enabled || !valid || !myAddress || !peerAddress) {
      if (!valid) {
        activeConversationGenerationRef.current += 1;
        setEvents([]);
        setLoadedInitialHistoryKey('');
        setTypingUsers(new Set());
      }
      return;
    }
    const cacheKey = `${myAddress}:${peerAddress}`;
    const cached = directHistoryCache.get(cacheKey);
    if (cached?.length) {
      setEvents(cached);
      setLoadedInitialHistoryKey(cacheKey);
    }
    const generation = activeConversationGenerationRef.current + 1;
    activeConversationGenerationRef.current = generation;
    let cancelled = false;
    let currentConversationId = '';
    const currentConversationIdPromise = conversationIdFor(
      myAddress,
      peerAddress
    ).then((conversationId) => {
      if (!cancelled) currentConversationId = conversationId;
      return conversationId;
    });
    const refreshHistory = (reconcileExpiry = false, attempt = 0) => {
      const expectedVisibilityRevision = visibilityRevisionRef.current;
      return window.reticulumChat
        ?.getDirectHistory?.(myAddress, peerAddress, 200)
        ?.then((history) => {
          if (cancelled || !Array.isArray(history)) return;
          void addPrimaryNamesToDirectEvents(
            history as ReticulumDmEvent[],
            primaryNameCacheRef.current
          ).then((enriched) => {
            if (
              !cancelled &&
              activeConversationGenerationRef.current === generation &&
              visibilityRevisionRef.current === expectedVisibilityRevision
            ) {
              const ownStream = enriched.find(
                (event) =>
                  event.senderAddress === myAddress && event.senderStreamId
              )?.senderStreamId;
              if (ownStream) senderStreamIdRef.current = ownStream;
              if (reconcileExpiry) {
                const now = Date.now();
                setEvents((previous) =>
                  mergeEvents(
                    enriched,
                    previous.filter(
                      (event) =>
                        event.expiresAt == null || event.expiresAt > now
                    )
                  )
                );
              } else {
                setEvents((previous) => mergeEvents(previous, enriched));
              }
              directHistoryCache.set(`${myAddress}:${peerAddress}`, enriched);
              setLoadedInitialHistoryKey(`${myAddress}:${peerAddress}`);
            }
          });
        })
        .catch((error) => {
          const timedOut = String(error?.message || error).includes(
            'timed out'
          );
          if (
            timedOut &&
            attempt < 2 &&
            !cancelled &&
            activeConversationGenerationRef.current === generation &&
            visibilityRevisionRef.current === expectedVisibilityRevision
          ) {
            return refreshHistory(reconcileExpiry, attempt + 1);
          }
          if (
            !cancelled &&
            !timedOut &&
            activeConversationGenerationRef.current === generation &&
            visibilityRevisionRef.current === expectedVisibilityRevision
          ) {
            setLoadedInitialHistoryKey('');
          }
        });
    };
    void refreshHistory();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      void refreshHistory(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    const off = window.reticulumChat?.onDirectEvent?.(({ event }) => {
      const candidate = event as ReticulumDmEvent;
      if (!candidate) return;
      const applyEvent = (conversationId: string) => {
        if (
          cancelled ||
          activeConversationGenerationRef.current !== generation ||
          !isReticulumDmEventForConversation(
            candidate,
            conversationId,
            myAddress,
            peerAddress
          )
        ) {
          return;
        }
        enqueue(candidate);
      };
      if (currentConversationId) {
        applyEvent(currentConversationId);
        return;
      }
      void currentConversationIdPromise.then(applyEvent);
    });
    const offTyping = window.reticulumChat?.onDirectTyping?.((payload) => {
      if (!payload || typeof payload !== 'object') return;
      const applyTyping = (conversationId: string) => {
        if (cancelled) return;
        if (payload.conversationId !== conversationId) return;
        if (payload.authorAddress === myAddress) return;
        if (payload.authorAddress !== peerAddress) return;
        setTypingUsers((prev) => {
          const next = new Set(prev);
          if (payload.active) next.add(payload.authorAddress);
          else next.delete(payload.authorAddress);
          return next;
        });
      };
      if (currentConversationId) {
        applyTyping(currentConversationId);
        return;
      }
      void currentConversationIdPromise.then((conversationId) => {
        applyTyping(conversationId);
      });
    });
    const offSilence = window.reticulumChat?.onSilenceChanged?.((payload) => {
      if (
        payload.scopeType !== 'dm' ||
        payload.ownerAddress !== myAddress ||
        payload.targetAddress !== peerAddress
      ) {
        return;
      }
      const silenceVisibilityRevision = visibilityRevisionRef.current + 1;
      visibilityRevisionRef.current = silenceVisibilityRevision;
      if (payload.active) {
        pendingRef.current = pendingRef.current.filter(
          (event) => event.senderAddress !== peerAddress
        );
        setEvents((previous) =>
          previous.filter((event) => event.senderAddress !== peerAddress)
        );
        setTypingUsers((prev) => {
          if (!prev.has(peerAddress)) return prev;
          const next = new Set(prev);
          next.delete(peerAddress);
          return next;
        });
      }
      void window.reticulumChat
        ?.getDirectHistory?.(myAddress, peerAddress, 200)
        ?.then((history) => {
          if (
            cancelled ||
            activeConversationGenerationRef.current !== generation ||
            visibilityRevisionRef.current !== silenceVisibilityRevision ||
            !Array.isArray(history)
          ) {
            return;
          }
          void addPrimaryNamesToDirectEvents(
            history as ReticulumDmEvent[],
            primaryNameCacheRef.current
          ).then((enriched) => {
            if (
              !cancelled &&
              activeConversationGenerationRef.current === generation &&
              visibilityRevisionRef.current === silenceVisibilityRevision
            ) {
              setEvents((previous) => mergeEvents(previous, enriched));
            }
          });
        })
        .catch((error) => {
          console.warn(
            '[useReticulumDirectChat] Failed to refresh after silence change:',
            error
          );
        });
    });
    const offSummary = window.reticulumChat?.onDirectSummaryChanged?.(
      (payload) => {
        if (payload.reason !== 'expiry') return;
        const applyExpiry = (conversationId: string) => {
          if (!cancelled && payload.conversationId === conversationId) {
            void refreshHistory(true);
          }
        };
        if (currentConversationId) applyExpiry(currentConversationId);
        else void currentConversationIdPromise.then(applyExpiry);
      }
    );
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      activeConversationGenerationRef.current += 1;
      off?.();
      offTyping?.();
      offSilence?.();
      offSummary?.();
      setTypingUsers(new Set());
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      pendingRef.current = [];
      primaryNameCacheRef.current.clear();
    };
  }, [enabled, enqueue, myAddress, peerAddress, valid]);

  const publish = useCallback(
    async ({
      chatReference,
      messageText,
      otherData,
      peerAddressOverride,
      expiryDurationMs,
    }: {
      chatReference?: string;
      messageText: string;
      otherData?: Record<string, unknown>;
      peerAddressOverride?: string;
      expiryDurationMs?: number | null;
    }) => {
      const actualPeerAddress = String(
        peerAddressOverride || peerAddress || ''
      ).trim();
      if (!enabled || !myAddress || !actualPeerAddress) {
        return { success: false, error: 'Reticulum chat is disabled' };
      }
      const conversationId = await conversationIdFor(
        myAddress,
        actualPeerAddress
      );
      const timestamp = Date.now();
      const eventId = randomDirectEventId();
      const type = String(otherData?.type || '');
      const eventType =
        type === 'edit'
          ? 'edit'
          : type === 'reaction' && otherData?.contentState === false
            ? 'reaction_remove'
            : type === 'reaction'
              ? 'reaction_add'
              : type === 'delete'
                ? 'delete'
                : 'message';
      const compactOther = compactOtherData(otherData);
      const hasOtherData = hasPayloadData(compactOther);
      const effectiveExpiryDurationMs =
        eventType === 'message'
          ? expiryDurationMs === null
            ? null
            : (expiryDurationMs ?? TIME_MONTHS_1_IN_MILLISECONDS)
          : undefined;
      const hasExpiry = eventType === 'message';
      const payload =
        !chatReference && !hasOtherData && !hasExpiry
          ? messageText
          : JSON.stringify({
              ...(chatReference ? { chatReference } : {}),
              messageText,
              ...(hasOtherData ? { otherData: compactOther } : {}),
              ...(hasExpiry
                ? { expiryDurationMs: effectiveExpiryDurationMs ?? 0 }
                : {}),
            });
      const payloadHash = await sha256Hex(payload);
      let senderStreamId = senderStreamIdRef.current;
      if (!senderStreamId) {
        senderStreamId =
          (await window.reticulumChat?.getDirectAuthorStreamId?.(myAddress)) ||
          '';
      }
      if (!senderStreamId) {
        throw new Error('DM author stream is unavailable');
      }
      senderStreamIdRef.current = senderStreamId;
      const existingSeqs = events
        .filter((event) => event.senderAddress === myAddress)
        .map((event) => Number(event.senderSeq || 0));
      const senderSeq = Math.max(
        lastSenderSeqRef.current + 1,
        timestamp * 1000,
        ...existingSeqs.map((seq) => seq + 1)
      );
      lastSenderSeqRef.current = senderSeq;
      const baseFields = {
        conversationId,
        eventId,
        eventType,
        payload,
        payloadHash,
        recipientAddress: actualPeerAddress,
        replyToEventId: (otherData?.repliedTo as string) || null,
        senderStreamId,
        senderSeq,
        targetEventId: chatReference || null,
        timestamp,
      };
      const signed = await window.sendMessage(
        'signReticulumChatEvent',
        baseFields
      );
      if (signed?.error) throw new Error(signed.error);
      if (signed?.authorAddress !== myAddress) {
        throw new Error(describeSignerMismatch(signed, myAddress, 'DM'));
      }
      const { senderStreamId: _senderStreamId, ...legacyBaseFields } =
        baseFields;
      const legacySigned = await window.sendMessage(
        'signReticulumChatEvent',
        legacyBaseFields
      );
      if (
        legacySigned?.error ||
        legacySigned?.authorAddress !== myAddress ||
        legacySigned?.authorPublicKey !== signed.authorPublicKey ||
        typeof legacySigned?.signature !== 'string'
      ) {
        throw new Error(
          legacySigned?.error || 'Legacy DM compatibility signature failed'
        );
      }
      const event: ReticulumDmEvent = {
        ...baseFields,
        replyToEventId: baseFields.replyToEventId || undefined,
        targetEventId: baseFields.targetEventId || undefined,
        senderAddress: signed.authorAddress,
        senderPublicKey: signed.authorPublicKey,
        signature: signed.signature,
        legacySignature: legacySigned.signature,
        localDeliveryStatus:
          actualPeerAddress === myAddress ? 'sent' : 'pending',
        localDeliveryUpdatedAt: Date.now(),
      };
      void window.reticulumChat?.setLocalDmAddresses?.([myAddress]);

      const optimisticEvent: ReticulumDmEvent = {
        ...event,
        localOwnEvent: true,
        expiresAt:
          eventType === 'message' && effectiveExpiryDurationMs != null
            ? timestamp + effectiveExpiryDurationMs
            : null,
      };
      // Show the message before the publish round-trip: fanning it out over
      // Reticulum can take a while, and the sender should not be left watching
      // their own text disappear into nothing. Merging is keyed on eventId, so
      // the confirmed copy replaces this one rather than duplicating it.
      let optimisticApplied = true;
      setEvents((prev) => {
        const next = mergeEvents(prev, [optimisticEvent]);
        if (myAddress && actualPeerAddress) {
          directHistoryCache.set(`${myAddress}:${actualPeerAddress}`, next);
        }
        return next;
      });
      const rollbackOptimistic = () => {
        optimisticApplied = false;
        setEvents((prev) =>
          prev.filter((existing) => existing.eventId !== eventId)
        );
      };
      void addPrimaryNamesToDirectEvents(
        [optimisticEvent],
        primaryNameCacheRef.current
      )
        .then((enriched) => {
          if (!optimisticApplied) return;
          setEvents((prev) => mergeEvents(prev, enriched));
        })
        .catch(() => {});

      let result;
      try {
        result = await window.reticulumChat?.publishDirectEvent?.(event);
      } catch (error) {
        rollbackOptimistic();
        throw error;
      }
      if (!result?.success) rollbackOptimistic();
      return result?.success ? { ...result, eventId } : result;
    },
    [enabled, events, myAddress, peerAddress]
  );

  const markRead = useCallback(
    async (upToTimestamp: number) => {
      if (!enabled || !myAddress || !peerAddress) return;
      await window.reticulumChat?.markDirectRead?.(
        myAddress,
        peerAddress,
        upToTimestamp
      );
    },
    [enabled, myAddress, peerAddress]
  );

  const sendTyping = useCallback(
    async (active: boolean) => {
      if (!enabled || !myAddress || !peerAddress) {
        return { success: false, error: 'Reticulum chat is disabled' };
      }
      if (myAddress === peerAddress) return { success: true };
      return (
        window.reticulumChat?.sendDirectTyping?.(
          myAddress,
          peerAddress,
          active
        ) ?? { success: false, error: 'Reticulum chat is unavailable' }
      );
    },
    [enabled, myAddress, peerAddress]
  );

  return {
    enabled,
    events,
    initialHistoryReady:
      activeHistoryKey !== '' && loadedInitialHistoryKey === activeHistoryKey,
    messages,
    chatReferences: projection.chatReferences,
    typingUsers,
    publish,
    markRead,
    sendTyping,
  };
}
