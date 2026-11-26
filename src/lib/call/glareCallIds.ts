/**
 * GO: calls the other side cancelled because of call glare (both called each
 * other at once and they answered ours instead). Their cancelled request is
 * recorded as a missed call here, but the two people are talking: no
 * missed-call alert for it. Kept a few minutes.
 */
const GLARE_CALL_ID_TTL_MS = 3 * 60 * 1_000;
const MAX_GLARE_CALL_IDS = 32;
const glareCallIds = new Map<string, number>();

export function rememberGlareCallId(callId: string, now = Date.now()): void {
  if (!callId) return;
  glareCallIds.set(callId, now);
  for (const [id, at] of glareCallIds) {
    if (
      now - at > GLARE_CALL_ID_TTL_MS ||
      glareCallIds.size > MAX_GLARE_CALL_IDS
    ) {
      glareCallIds.delete(id);
    }
  }
}

export function isGlareCallId(callId: string, now = Date.now()): boolean {
  const at = glareCallIds.get(callId);
  return typeof at === 'number' && now - at <= GLARE_CALL_ID_TTL_MS;
}

/** Tests only. */
export function clearGlareCallIdsForTests(): void {
  glareCallIds.clear();
}
