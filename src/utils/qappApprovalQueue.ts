/**
 * GO-28: how Q-App permission requests reach the approval dialog.
 *
 * The approval modal (hooks/useModal.tsx) queues requests. On top of that:
 *
 * - Requests are grouped by the asking app (from GO's appInfo), and one app
 *   cannot queue more than `MAX_REQUESTS_PER_APP` at once, so a Q-App that
 *   loops requests cannot grow the queue without end.
 * - A value-moving request (one that needs the "I have read this request"
 *   tick) that equals one already open or queued from the same app is
 *   declined at once: a double tap on a Q-App's own Pay button cannot queue
 *   the same payment twice. Other requests (sign in, wallet reads) still
 *   queue, so an app that asks for two of them at once gets both answers.
 * - "Decline all" declines every request from the app on screen and keeps
 *   declining that app's new requests for `DECLINE_ALL_MUTE_MS`, so the user
 *   can reach the app's tab and close it.
 */
import {
  ApprovalDialogMessage,
  approvalNeedsConfirm,
  buildApprovalDialogMessage,
} from './qappApproval';

/** At most this many requests of one app are open or queued at once. */
export const MAX_REQUESTS_PER_APP = 20;

/** After "Decline all", new requests from that app are declined this long. */
export const DECLINE_ALL_MUTE_MS = 15_000;

/** Decline is ignored this long after a request appears (double taps). */
export const DECLINE_GUARD_MS = 300;

/** The group of requests whose app GO could not tell. */
export const UNKNOWN_APP_GROUP = 'unknown';

/** The group of requests from GO itself. */
export const INTERNAL_APP_GROUP = 'internal';

/** The app group a dialog message belongs to. */
export function approvalGroupKey(message: unknown): string {
  const app =
    message && typeof message === 'object'
      ? (message as Partial<ApprovalDialogMessage>).requestingApp
      : null;
  if (!app) return UNKNOWN_APP_GROUP;
  if (app.internal) return INTERNAL_APP_GROUP;
  return `app:${app.service ?? ''}:${app.name}`;
}

/**
 * The key under which equal value-moving requests coalesce, or null for a
 * request that may queue next to an equal one. The deadline is left out:
 * two requests sent a moment apart are still the same request.
 */
export function approvalDedupeKey(message: unknown): string | null {
  if (!approvalNeedsConfirm(message)) return null;
  const rest = { ...(message as Record<string, unknown>) };
  delete rest.expiresAt;
  try {
    const key = JSON.stringify(rest);
    return typeof key === 'string' ? key : null;
  } catch {
    return null;
  }
}

export type ApprovalMuteList = {
  /** Declines new requests of this group until `until`. */
  mute: (groupKey: string, until: number) => void;
  isMuted: (groupKey: string, now: number) => boolean;
};

export function createApprovalMuteList(): ApprovalMuteList {
  const mutedUntil = new Map<string, number>();
  return {
    mute: (groupKey, until) => {
      mutedUntil.set(groupKey, Math.max(mutedUntil.get(groupKey) ?? 0, until));
    },
    isMuted: (groupKey, now) => {
      const until = mutedUntil.get(groupKey);
      if (until === undefined) return false;
      if (until > now) return true;
      mutedUntil.delete(groupKey);
      return false;
    },
  };
}

export type PermissionResult = { accepted: boolean; checkbox1?: boolean };

export type ApprovalShow = (
  data: ApprovalDialogMessage,
  options: { dedupeKey: string | null; groupKey: string; maxPerGroup: number }
) => Promise<unknown>;

/**
 * Shows one QORTAL_REQUEST_PERMISSION message in the approval dialog and
 * answers it once: with the result of the request that was on screen, or
 * `{ accepted: false }` when it was declined, timed out, coalesced, over the
 * per-app limit or muted.
 */
export async function requestQappApproval({
  message,
  show,
  respond,
  now,
  muteList,
}: {
  message: {
    payload?: unknown;
    appInfo?: unknown;
    expiresAt?: unknown;
  } | null;
  show: ApprovalShow;
  respond: (result: PermissionResult) => void;
  now: number;
  muteList?: ApprovalMuteList | null;
}): Promise<void> {
  let result: PermissionResult = { accepted: false };
  try {
    // The dialog names the app from the request's appInfo only (never the
    // payload), and a request that arrives while another one is open waits
    // its turn.
    const dialogMessage = buildApprovalDialogMessage(
      message?.payload,
      message?.appInfo,
      message?.expiresAt,
      now
    );
    const groupKey = approvalGroupKey(dialogMessage);
    if (!muteList?.isMuted(groupKey, now)) {
      const answer = (await show(dialogMessage, {
        dedupeKey: approvalDedupeKey(dialogMessage),
        groupKey,
        maxPerGroup: MAX_REQUESTS_PER_APP,
      })) as PermissionResult | null | undefined;
      if (answer?.accepted === true) result = answer;
    }
  } catch {
    result = { accepted: false };
  }
  respond(result);
}
