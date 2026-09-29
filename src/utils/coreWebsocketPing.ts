/**
 * Core node WebSocket keepalive. 20 s while the app is on screen keeps the
 * public-node sockets from idling out. Hidden, 45 s still sits under a
 * typical 60 s server idle close and cuts radio wakes by more than half.
 */
export function coreWebsocketPingMs(): number {
  return typeof document !== 'undefined' && document.hidden ? 45_000 : 20_000;
}
