/**
 * Park / restore Qortino when opening Q-Apps so the chat session is not remounted.
 */
import { getDefaultStore } from 'jotai';
import { qortinoAgentOpenAtom, qortinoAgentParkedAtom } from '../atoms/global';

/** Hide the sheet but keep the React tree / LLM session (caller must keepMounted). */
export function parkQortinoAgentSheet(): void {
  const store = getDefaultStore();
  if (!store.get(qortinoAgentOpenAtom)) return;
  store.set(qortinoAgentOpenAtom, false);
  store.set(qortinoAgentParkedAtom, true);
}

export function restoreQortinoAgentSheet(): boolean {
  const store = getDefaultStore();
  if (!store.get(qortinoAgentParkedAtom)) return false;
  store.set(qortinoAgentParkedAtom, false);
  store.set(qortinoAgentOpenAtom, true);
  return true;
}

/** Open the Qortino window (from a banner or notification about it). */
export function openQortinoAgentSheet(): void {
  const store = getDefaultStore();
  store.set(qortinoAgentParkedAtom, false);
  store.set(qortinoAgentOpenAtom, true);
}

export function closeQortinoAgentSheet(): void {
  const store = getDefaultStore();
  store.set(qortinoAgentOpenAtom, false);
  store.set(qortinoAgentParkedAtom, false);
}
