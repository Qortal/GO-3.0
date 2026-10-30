import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { isAndroidApp } from '../utils/androidApp';
import { isGoApp } from '../utils/platform';
import { CardError, type ApduTransport } from './cardProtocol';

/**
 * GO's NFC bridge (android QortalNfcPlugin): raw APDUs to a contactless card,
 * only while a session is open. Android only.
 */
interface QortalNfcPlugin {
  status(): Promise<{ supported: boolean; enabled: boolean; hce?: boolean }>;
  openSettings(): Promise<void>;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  transceive(options: { apdu: string }): Promise<{ response: string }>;
  armRequest(options: { payload: string; ttlMs: number }): Promise<void>;
  disarmRequest(): Promise<void>;
  addListener(
    eventName: 'cardPresent',
    listener: (info: {
      maxTransceiveLength: number;
      extendedLength: boolean;
    }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'unsupportedTag' | 'requestRead',
    listener: () => void
  ): Promise<PluginListenerHandle>;
}

const QortalNfc = registerPlugin<QortalNfcPlugin>('QortalNfc');

type NfcState = 'unsupported' | 'off' | 'on';

const canUseNfc = (): boolean => isGoApp() && isAndroidApp();

export interface NfcCapabilities {
  state: NfcState;
  /** This phone can put out a payment request for another GO phone. */
  canRequest: boolean;
}

export async function readNfcCapabilities(): Promise<NfcCapabilities> {
  if (!canUseNfc()) return { state: 'unsupported', canRequest: false };
  try {
    const { supported, enabled, hce } = await QortalNfc.status();
    if (!supported) return { state: 'unsupported', canRequest: false };
    return { state: enabled ? 'on' : 'off', canRequest: hce === true };
  } catch {
    // An older GO without the plugin.
    return { state: 'unsupported', canRequest: false };
  }
}

export function openNfcSettings(): void {
  void QortalNfc.openSettings().catch(() => undefined);
}

function toCardError(error: unknown): CardError {
  if (error instanceof CardError) return error;
  switch ((error as { code?: string })?.code) {
    case 'CARD_LOST':
    case 'NO_CARD':
      return new CardError('CARD_LOST');
    case 'NFC_DISABLED':
      return new CardError('NFC_OFF');
    case 'NFC_UNSUPPORTED':
    case 'UNIMPLEMENTED':
      return new CardError('NFC_UNSUPPORTED');
    default:
      return new CardError('CARD_IO');
  }
}

/** A card in the field. `close` ends the reading session. */
export interface CardLink extends ApduTransport {
  close(): Promise<void>;
}

const link: CardLink = {
  async transceive(apdu: Uint8Array): Promise<Uint8Array> {
    try {
      const { response } = await QortalNfc.transceive({
        apdu: bytesToHex(apdu),
      });
      return hexToBytes(response);
    } catch (error) {
      throw toCardError(error);
    }
  },
  async close(): Promise<void> {
    await QortalNfc.stopSession().catch(() => undefined);
  },
};

/**
 * Turns reading on and waits for a card. Resolves with the card; rejects with
 * CardError CANCELLED when `signal` aborts, or NFC_OFF / NFC_UNSUPPORTED.
 * `onOtherTag` hears about tags that are not smart cards (stickers, transit
 * passes), so the screen can say so.
 */
export function waitForCard(
  signal: AbortSignal,
  onOtherTag?: () => void
): Promise<CardLink> {
  return new Promise<CardLink>((resolve, reject) => {
    const handles: PluginListenerHandle[] = [];
    let settled = false;
    const removeListeners = () => {
      for (const handle of handles.splice(0)) void handle.remove();
    };
    const fail = (error: CardError) => {
      if (settled) return;
      settled = true;
      removeListeners();
      void link.close();
      reject(error);
    };
    signal.addEventListener('abort', () => fail(new CardError('CANCELLED')), {
      once: true,
    });

    void (async () => {
      try {
        // Listen first, so a card already lying on the phone is not missed.
        handles.push(
          await QortalNfc.addListener('cardPresent', () => {
            if (settled) return;
            settled = true;
            removeListeners();
            resolve(link);
          }),
          await QortalNfc.addListener('unsupportedTag', () => onOtherTag?.())
        );
        if (signal.aborted) {
          fail(new CardError('CANCELLED'));
          return;
        }
        await QortalNfc.startSession();
      } catch (error) {
        fail(toCardError(error));
      }
    })();
  });
}

/**
 * Puts this phone's payment request out for another GO phone to read by
 * tapping, for `ttlMs` at most. `onRead` hears each read. Returns the stop
 * function; the request also ends when the page reloads.
 */
export async function putOutTapRequest(
  payload: Uint8Array,
  ttlMs: number,
  onRead: () => void
): Promise<() => void> {
  const handle = await QortalNfc.addListener('requestRead', onRead);
  try {
    await QortalNfc.armRequest({ payload: bytesToHex(payload), ttlMs });
  } catch (error) {
    void handle.remove();
    throw toCardError(error);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    void handle.remove();
    void QortalNfc.disarmRequest().catch(() => undefined);
  };
}
