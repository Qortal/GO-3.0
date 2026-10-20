/**
 * Short in-app hints for the GO call buttons (no outside links): a greyed
 * call button on a phone has no hover tooltip, so a tap explains why it is
 * off instead. Uses GO's global snackbar.
 */
import { getDefaultStore } from 'jotai';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
  p2pHealthAtom,
} from '../../../atoms/global';
import { mobileCallScreenOpenAtom } from './goCallUi';

export function showCallHint(message: string): void {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return;
  const store = getDefaultStore();
  store.set(infoSnackGlobalAtom, { type: 'info', message: text });
  store.set(openSnackGlobalAtom, true);
}

/** Brings GO's full call screen back (e.g. tapping the busy call button). */
export function openGoCallScreen(): void {
  getDefaultStore().set(mobileCallScreenOpenAtom, true);
}

/**
 * The Reticulum network is still warming up for calls: peers are receiving
 * but not yet for the 30 s the call gate wants (p2pHealth 'low'), or no
 * reading yet. With no receiving peers at all ('bad') this is false: the
 * Hub's own reason (connect more peers) is the right hint then.
 */
export function isCallNetworkWarmingUp(): boolean {
  const level = getDefaultStore().get(p2pHealthAtom);
  return level === 'low' || level === 'unknown';
}
