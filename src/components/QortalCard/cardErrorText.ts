import type { TFunction } from 'i18next';
import { NodeError } from '../../qortalCard/cardNode';
import { CardError, formatSw } from '../../qortalCard/cardProtocol';
import { WalletKeyError } from '../../qortalCard/mainKey';

export const isCancelled = (error: unknown): boolean =>
  error instanceof CardError && error.code === 'CANCELLED';

/** One sentence for the screen about what went wrong. */
export function cardErrorText(t: TFunction, error: unknown): string {
  if (error instanceof WalletKeyError) {
    return t('core:qortal_card.error.wallet_locked');
  }
  if (error instanceof NodeError) {
    // Usually a top up the node has not counted yet (or a node a block behind).
    if (/NO_BALANCE/.test(error.message)) {
      return t('core:qortal_card.error.node_no_balance');
    }
    // A public node takes no uploads without its own API key.
    if (/X-API-KEY|API key/i.test(error.message)) {
      return t('core:qortal_card.error.node_no_upload');
    }
    return t('core:qortal_card.error.node', { message: error.message });
  }
  if (error instanceof CardError) {
    switch (error.code) {
      case 'NO_APPLET':
        return t('core:qortal_card.error.no_applet');
      case 'NO_KEY':
        return t('core:qortal_card.error.no_key');
      case 'HAS_KEY':
        return t('core:qortal_card.error.has_key');
      case 'NO_IMPORT':
        return t('core:qortal_card.error.no_import');
      case 'KEY_MISMATCH':
        return t('core:qortal_card.error.key_mismatch');
      case 'BAD_SIGNATURE':
        return t('core:qortal_card.error.bad_signature');
      case 'CARD_STATUS':
        return t('core:qortal_card.error.card_status', {
          code: formatSw(error.sw ?? 0),
        });
      case 'CARD_LOST':
        return t('core:qortal_card.error.card_lost');
      case 'NFC_OFF':
        return t('core:qortal_card.error.nfc_off');
      case 'NFC_UNSUPPORTED':
        return t('core:qortal_card.error.nfc_unsupported');
      case 'NO_REQUEST':
        return t('core:qortal_card.error.no_request');
      case 'REQUEST_NOT_READY':
        return t('core:qortal_card.error.request_not_ready');
      case 'BAD_REQUEST':
        return t('core:qortal_card.error.bad_request');
      default:
        return t('core:qortal_card.error.card_io');
    }
  }
  const message = (error as Error)?.message || String(error);
  return t('core:qortal_card.error.generic', { message });
}
