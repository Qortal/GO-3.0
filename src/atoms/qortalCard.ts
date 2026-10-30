import { atom, getDefaultStore } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { CardAppletKind } from '../qortalCard/cardProtocol';
import { localJsonStorage } from '../utils/localJsonStorage';

/**
 * Qortal Card (testing): the settings switch, the window, and the cards
 * linked to each account. Nothing here is secret: cards hold their own keys,
 * and wallet card keys are rebuilt from the wallet when needed.
 */

/** Device-wide: off until turned on in Settings → System. */
export const qortalCardEnabledAtom = atomWithStorage<boolean>(
  'go_qortal_card_enabled',
  false,
  localJsonStorage<boolean>(),
  { getOnInit: true }
);

/** My card, take payment, send to another GO phone. */
export type QortalCardTab = 'card' | 'pay' | 'send';

export const qortalCardWindowAtom = atom<{ open: boolean; tab: QortalCardTab }>(
  { open: false, tab: 'card' }
);

export interface LinkedCard {
  address: string;
  /** Base58, RFC 8032 form. */
  publicKey: string;
  applet: CardAppletKind;
  /** Wallet card-key index, or null for a key made on the card. */
  walletKeyIndex: number | null;
  linkedAt: number;
  /** The owner's name for it; "Card 1", "Card 2"… when unset. */
  name?: string;
}

export const MAX_CARD_NAME_LENGTH = 32;

/** Linked cards per account address. */
export const linkedCardsAtom = atomWithStorage<Record<string, LinkedCard[]>>(
  'go_qortal_cards',
  {},
  localJsonStorage<Record<string, LinkedCard[]>>(),
  { getOnInit: true }
);

/**
 * Wallet card-key indexes ever handed out, per account. Only grows: a removed
 * or lost card keeps its key, so its index is never given to another card.
 */
export const cardKeyIndexesUsedAtom = atomWithStorage<Record<string, number[]>>(
  'go_qortal_card_key_indexes',
  {},
  localJsonStorage<Record<string, number[]>>(),
  { getOnInit: true }
);

const store = getDefaultStore();

/**
 * A top up from My card: the window closes for GO's Send QORT and comes back
 * when Send closes. `sent` turns true once Send went through; then My card
 * watches that card's balance. `address` is '' when there is none.
 */
export const pendingTopUpAtom = atom<{ address: string; sent: boolean }>({
  address: '',
  sent: false,
});

export const NO_TOP_UP = { address: '', sent: false };

export function startCardTopUp(address: string): void {
  store.set(pendingTopUpAtom, { address, sent: false });
  closeQortalCardWindow();
}

export function openQortalCardWindow(tab: QortalCardTab = 'card'): void {
  store.set(qortalCardWindowAtom, { open: true, tab });
}

export function closeQortalCardWindow(): void {
  store.set(qortalCardWindowAtom, (current) => ({ ...current, open: false }));
}
