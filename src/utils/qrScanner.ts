import { isCapacitor } from '../bridge/capacitorBridge';

/**
 * Whether an in-app QR scanner should be offered. We use a fully offline,
 * in-WebView camera scanner (getUserMedia + jsQR) — no Google Play Services /
 * ML Kit — so this is available on the native mobile build (where the camera
 * and the CAMERA permission grant are wired up).
 */
export const isQrScannerAvailable = (): boolean => isCapacitor();
