/**
 * GO-28 / GO-29: rules for the Q-App approval dialog (QortalRequestExtension).
 *
 * - The dialog names the app that asks. The name and service come only from
 *   the `appInfo` GO attaches to the request (the tab the request came from),
 *   never from the permission payload, which carries Q-App supplied text.
 * - Accept answers exactly the request on screen: every request has its own
 *   id, and a decision for another id is ignored.
 * - Requests that must be ticked before Accept (`confirmCheckbox`) cannot be
 *   accepted without the tick of that same request.
 * - A request that waited behind another one gets only the time its requester
 *   still waits for (getUserPermission in qortal/get.ts gives up after 60 s).
 */

/** Accept stays disabled this long after a request appears or changes. */
export const APPROVAL_ACCEPT_DELAY_MS = 1000;

/** How long getUserPermission (qortal/get.ts) waits for an answer. */
export const APPROVAL_TIMEOUT_MS = 60_000;

/**
 * The countdown ends this much before the requester gives up, so an Accept
 * in the last moment still reaches it.
 */
export const APPROVAL_EXPIRY_MARGIN_MS = 1000;

export type RequestingApp = {
  name: string;
  /** QDN service such as APP or WEBSITE, or null when unknown. */
  service: string | null;
  /**
   * The request comes from GO itself (its own screens), not from a Q-App.
   * Only GO code sets it: Q-App requests get their appInfo from the tab.
   */
  internal?: boolean;
};

/** What the dialog sends back when the user taps Accept. */
/**
 * The `appInfo` GO's own screens pass to `window.sendMessage` for a request
 * that shows an approval (the user's own chat images, Quitter posts): the
 * dialog then names GO instead of warning about an unknown Q-App.
 */
export const GO_INTERNAL_APP_INFO: Readonly<RequestingApp> = Object.freeze({
  name: 'Qortal GO',
  service: null,
  internal: true,
});

export type ApprovalDecision = {
  /** The id of the request that was on screen. */
  requestId: number | null;
  /** The value of the request's own checkbox1, if it has one. */
  checkbox1?: boolean;
  /** Whether the "I have read this request" box was ticked. */
  confirmed: boolean;
};

export type ApprovalDialogMessage = Record<string, unknown> & {
  requestingApp: RequestingApp | null;
  expiresAt: number;
};

/** Fields only GO may set: dropped from the payload before display. */
const ATTRIBUTION_FIELDS = [
  'appName',
  'sourceKind',
  'sourceLabel',
  'requestingApp',
  'expiresAt',
];

// Control characters, zero-width characters, bidi controls, fillers and
// tags that draw nothing, which could hide, pad or reorder part of a name
// ("Q-Wallets" + a right-to-left override). Built from code points so this
// file holds no invisible characters itself.
const HIDDEN_CHARACTERS = new RegExp(
  '[' +
    [
      '\\u0000-\\u001f',
      '\\u007f-\\u009f',
      '\\u00ad',
      '\\u061c',
      // Hangul choseong / jungseong fillers.
      '\\u115f-\\u1160',
      // Mongolian vowel separator.
      '\\u180e',
      '\\u200b-\\u200f',
      '\\u2028-\\u202e',
      '\\u2060-\\u206f',
      // Braille blank.
      '\\u2800',
      // Hangul filler.
      '\\u3164',
      '\\ufeff',
      // Halfwidth Hangul filler.
      '\\uffa0',
      '\\ufff9-\\ufffb',
      // Musical symbol format characters.
      '\\u{1d173}-\\u{1d17a}',
      // Tag characters.
      '\\u{e0000}-\\u{e007f}',
    ].join('') +
    ']',
  'gu'
);

// Marks that draw nothing: the combining grapheme joiner, Khmer inherent
// vowels and variation selectors. Kept apart so the class holds only marks.
const HIDDEN_MARKS = new RegExp(
  '[' +
    [
      '\\u034f',
      '\\u17b4-\\u17b5',
      '\\u180b-\\u180d',
      '\\u180f',
      '\\ufe00-\\ufe0f',
      '\\u{e0100}-\\u{e01ef}',
    ].join('') +
    ']',
  'gu'
);

/** Qortal names are at most 40 characters; anything longer is cut. */
const MAX_APP_NAME_CHARACTERS = 48;

const SERVICE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

/** The app to show for a request, from GO's `appInfo` only. */
export function requestingAppFromAppInfo(
  appInfo: unknown
): RequestingApp | null {
  if (!appInfo || typeof appInfo !== 'object') return null;
  const { name, service, internal } = appInfo as {
    name?: unknown;
    service?: unknown;
    internal?: unknown;
  };
  // GO's own screens: the dialog names GO, not a Q-App.
  if (internal === true) return { name: '', service: null, internal: true };
  if (typeof name !== 'string') return null;
  const visible = name
    .replace(HIDDEN_CHARACTERS, '')
    .replace(HIDDEN_MARKS, '')
    .trim();
  if (!visible) return null;
  const characters = Array.from(visible);
  const cleanName =
    characters.length > MAX_APP_NAME_CHARACTERS
      ? `${characters.slice(0, MAX_APP_NAME_CHARACTERS).join('')}…`
      : visible;
  const serviceText =
    typeof service === 'string' ? service.trim().toUpperCase() : '';
  return {
    name: cleanName,
    service: SERVICE_PATTERN.test(serviceText) ? serviceText : null,
  };
}

/**
 * When the dialog must stop waiting: the requester's own deadline, never
 * later than a full timeout from now.
 */
export function approvalExpiry(expiresAt: unknown, now: number): number {
  const latest = now + APPROVAL_TIMEOUT_MS;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return latest;
  }
  return Math.min(expiresAt, latest);
}

/** Whole seconds the user still has to answer (0 when time is up). */
export function approvalSecondsLeft(expiresAt: number, now: number): number {
  const left = expiresAt - APPROVAL_EXPIRY_MARGIN_MS - now;
  return left > 0 ? Math.floor(left / 1000) : 0;
}

/**
 * The dialog message for a permission request: the payload without any
 * attribution it may carry, plus the requesting app and the deadline.
 */
export function buildApprovalDialogMessage(
  payload: unknown,
  appInfo: unknown,
  expiresAt: unknown,
  now: number
): ApprovalDialogMessage {
  const base: Record<string, unknown> =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : {};
  ATTRIBUTION_FIELDS.forEach((field) => {
    delete base[field];
  });
  return {
    ...base,
    requestingApp: requestingAppFromAppInfo(appInfo),
    expiresAt: approvalExpiry(expiresAt, now),
  };
}

/** Whether the request needs its "I have read this request" box ticked. */
export function approvalNeedsConfirm(message: unknown): boolean {
  return Boolean(
    message &&
    typeof message === 'object' &&
    (message as { confirmCheckbox?: unknown }).confirmCheckbox
  );
}

/** Whether the request shows its own checkbox (e.g. "always allow"). */
export function approvalHasCheckbox1(message: unknown): boolean {
  return Boolean(
    message &&
    typeof message === 'object' &&
    (message as { checkbox1?: unknown }).checkbox1
  );
}

/** The starting value of the request's own checkbox. */
export function approvalCheckbox1Default(message: unknown): boolean {
  if (!approvalHasCheckbox1(message)) return false;
  const checkbox1 = (message as { checkbox1?: { value?: unknown } }).checkbox1;
  return checkbox1?.value === true;
}

/**
 * Whether an Accept may answer the request on screen: it must be for that
 * request, and ticked when the request asks for it.
 */
export function isApprovalAcceptable(
  message: unknown,
  currentRequestId: number | null | undefined,
  decision: ApprovalDecision | null | undefined
): boolean {
  if (!decision || currentRequestId == null) return false;
  if (decision.requestId !== currentRequestId) return false;
  if (approvalNeedsConfirm(message) && decision.confirmed !== true) {
    return false;
  }
  return true;
}

/** The answer sent back to the requester for an accepted request. */
export function acceptedPermissionResult(
  message: unknown,
  decision: ApprovalDecision
): { accepted: true; checkbox1?: boolean } {
  if (!approvalHasCheckbox1(message)) return { accepted: true };
  return { accepted: true, checkbox1: decision.checkbox1 === true };
}
