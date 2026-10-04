import { useRef, useState, useCallback, useMemo } from 'react';

type ModalEntry = {
  id: number;
  data: any;
  dedupeKey: string | null;
  groupKey: string | null;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
};

export type ModalShowOptions = {
  /**
   * Requests with the same key are one request: a `show()` while a request
   * with this key is open or queued is declined at once. `null` never
   * coalesces. Left out, the data itself is the key when the modal
   * coalesces duplicates (the default).
   */
  dedupeKey?: string | null;
  /** Requests from one source (such as one Q-App) share a group. */
  groupKey?: string | null;
  /**
   * Declines a request at once when this many requests of its group are
   * already open or queued.
   */
  maxPerGroup?: number;
};

export type ModalOptions = {
  /**
   * Declines a `show()` whose data equals a request that is open or queued
   * (default true). A double tap on Send then cannot queue the same payment
   * twice; the second caller gets the same answer as a Decline.
   */
  coalesceDuplicates?: boolean;
};

/** What a `cancelWhere` predicate sees of each request. */
export type ModalRequestInfo = {
  id: number;
  data: any;
  groupKey: string | null;
};

const EMPTY_MESSAGE = Object.freeze({ publishFee: '', message: '' });

/** The reason a declined request rejects with (a new object each time). */
const canceled = () => ({ isCanceled: true });

/** The data as a comparable key, or null when it cannot be serialised. */
function dataKey(data: unknown): string | null {
  try {
    const key = JSON.stringify(data);
    return typeof key === 'string' ? key : null;
  } catch {
    return null;
  }
}

/**
 * A promise-based modal. `show(data)` resolves on `onOk(payload)` and rejects
 * with `{ isCanceled: true }` on `onCancel()`.
 *
 * Requests queue (GO-28): a `show()` while another request is open waits its
 * turn instead of replacing what is on screen, so a tap meant for one request
 * never answers another. Every request gets its own `requestId`; dialogs key
 * their per-request state on it, and `okRequest` / `cancelRequest` only
 * answer the request with that id.
 *
 * A request equal to one already open or queued is declined at once instead
 * of queueing (see `ModalOptions.coalesceDuplicates`), and a group of
 * requests can be capped (`ModalShowOptions.maxPerGroup`).
 */
export const useModal = (options?: ModalOptions) => {
  const coalesceDuplicates = options?.coalesceDuplicates !== false;
  const [current, setCurrent] = useState<{
    id: number;
    data: any;
    groupKey: string | null;
  } | null>(null);
  const [queueState, setQueueState] = useState<{
    pendingCount: number;
    groupKeys: (string | null)[];
  }>({ pendingCount: 0, groupKeys: [] });
  const currentRef = useRef<ModalEntry | null>(null);
  const queueRef = useRef<ModalEntry[]>([]);
  const nextIdRef = useRef(0);

  const syncQueue = useCallback(() => {
    setQueueState({
      pendingCount: queueRef.current.length,
      groupKeys: queueRef.current.map((entry) => entry.groupKey),
    });
  }, []);

  const present = useCallback(
    (entry: ModalEntry | null) => {
      currentRef.current = entry;
      setCurrent(
        entry
          ? { id: entry.id, data: entry.data, groupKey: entry.groupKey }
          : null
      );
      syncQueue();
    },
    [syncQueue]
  );

  const show = useCallback(
    (data, showOptions?: ModalShowOptions) =>
      new Promise<any>((resolve, reject) => {
        const dedupeKey =
          showOptions?.dedupeKey !== undefined
            ? showOptions.dedupeKey
            : coalesceDuplicates
              ? dataKey(data)
              : null;
        const groupKey = showOptions?.groupKey ?? null;
        const open = [
          ...(currentRef.current ? [currentRef.current] : []),
          ...queueRef.current,
        ];
        if (
          dedupeKey !== null &&
          open.some((entry) => entry.dedupeKey === dedupeKey)
        ) {
          reject(canceled());
          return;
        }
        const maxPerGroup = showOptions?.maxPerGroup;
        if (
          groupKey !== null &&
          typeof maxPerGroup === 'number' &&
          open.filter((entry) => entry.groupKey === groupKey).length >=
            maxPerGroup
        ) {
          reject(canceled());
          return;
        }
        nextIdRef.current += 1;
        const entry: ModalEntry = {
          id: nextIdRef.current,
          data,
          dedupeKey,
          groupKey,
          resolve,
          reject,
        };
        if (currentRef.current) {
          queueRef.current.push(entry);
          syncQueue();
          return;
        }
        present(entry);
      }),
    [coalesceDuplicates, present, syncQueue]
  );

  /** Takes the open request off screen and shows the next one, if any. */
  const takeCurrent = useCallback(
    (requestId?: number) => {
      const entry = currentRef.current;
      if (!entry) return null;
      if (requestId !== undefined && requestId !== entry.id) return null;
      present(queueRef.current.shift() ?? null);
      return entry;
    },
    [present]
  );

  const onOk = useCallback(
    (payload?: any) => {
      takeCurrent()?.resolve(payload);
    },
    [takeCurrent]
  );

  // Ignores its argument: it is often passed straight to onClick handlers.
  const onCancel = useCallback(
    (_ignored?: unknown) => {
      takeCurrent()?.reject(canceled());
    },
    [takeCurrent]
  );

  /** Accepts only if the request with this id is the one open. */
  const okRequest = useCallback(
    (requestId: number, payload?: any) => {
      takeCurrent(requestId)?.resolve(payload);
    },
    [takeCurrent]
  );

  /** Declines only if the request with this id is the one open. */
  const cancelRequest = useCallback(
    (requestId: number) => {
      takeCurrent(requestId)?.reject(canceled());
    },
    [takeCurrent]
  );

  /**
   * Declines every request, open or queued, that the predicate picks. The
   * next request left in the queue, if any, takes the screen.
   */
  const cancelWhere = useCallback(
    (predicate: (request: ModalRequestInfo) => boolean) => {
      const picks = (entry: ModalEntry) => {
        try {
          return predicate({
            id: entry.id,
            data: entry.data,
            groupKey: entry.groupKey,
          });
        } catch {
          return false;
        }
      };
      const declined: ModalEntry[] = [];
      queueRef.current = queueRef.current.filter((entry) => {
        if (!picks(entry)) return true;
        declined.push(entry);
        return false;
      });
      const open = currentRef.current;
      if (open && picks(open)) {
        declined.unshift(open);
        present(queueRef.current.shift() ?? null);
      } else {
        syncQueue();
      }
      declined.forEach((entry) => entry.reject(canceled()));
      return declined.length;
    },
    [present, syncQueue]
  );

  /** Declines the open request and every queued one. */
  const cancelAll = useCallback(() => {
    cancelWhere(() => true);
  }, [cancelWhere]);

  const currentGroupKey = current ? current.groupKey : null;
  // Queued requests from the same group as the one on screen.
  const sameGroupPendingCount =
    currentGroupKey === null
      ? 0
      : queueState.groupKeys.filter((key) => key === currentGroupKey).length;

  return useMemo(
    () => ({
      show,
      onOk,
      onCancel,
      okRequest,
      cancelRequest,
      cancelWhere,
      cancelAll,
      isShow: current !== null,
      message: (current && current.data) ?? EMPTY_MESSAGE,
      requestId: current ? current.id : null,
      groupKey: currentGroupKey,
      pendingCount: queueState.pendingCount,
      sameGroupPendingCount,
    }),
    [
      show,
      onOk,
      onCancel,
      okRequest,
      cancelRequest,
      cancelWhere,
      cancelAll,
      current,
      currentGroupKey,
      queueState.pendingCount,
      sameGroupPendingCount,
    ]
  );
};
