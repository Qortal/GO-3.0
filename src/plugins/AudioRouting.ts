import { registerPlugin } from '@capacitor/core';

/**
 * Native in-call audio routing (android CallAudioRouter via AudioRoutingPlugin).
 *
 * While a call runs Android is in communication mode. The route follows the
 * phone-call rules: a wired / USB headset, then Bluetooth, then the user's
 * choice of earpiece or loudspeaker (default earpiece + proximity screen-off
 * for 1:1 calls, loudspeaker for group calls). Plugging in or pairing a
 * headset moves the call to it; a hand-picked route (setAudioRoute) wins
 * until then. No permission is involved: Android routes a Bluetooth headset
 * without BLUETOOTH_CONNECT, and GO never asks for it ("Nearby devices").
 *
 * Several owners may hold the call audio ('session' = the call session hook,
 * 'legacy' = callers that pass no owner, e.g. the DM media surface); the
 * phone goes back to normal audio when the last one calls endCall.
 */
import type { PluginListenerHandle } from '@capacitor/core';

export type AudioRoute = 'earpiece' | 'speaker' | 'wired' | 'bluetooth';

export type AudioRouteState = {
  ok: boolean;
  /** Some owner holds the call audio. */
  active?: boolean;
  /** The route in use (or the one a call would start on). */
  route?: AudioRoute;
  /** Same as route. */
  current?: AudioRoute;
  /** Routes the phone offers right now, in a stable order. */
  routes?: AudioRoute[];
  /** route === 'speaker' (old callers read this). */
  speaker: boolean;
  kind?: 'dm' | 'group';
  /** Hand-picked route, or absent when automatic. */
  explicitChoice?: AudioRoute;
  /** Earpiece / loudspeaker for when no headset is in use. */
  builtinChoice?: 'earpiece' | 'speaker';
  mode?: number;
  commDeviceType?: number;
  /** 'gain' | 'loss' | 'loss_transient' | 'duck' (a phone call took the audio). */
  focus?: string;
  /** Screen turns off at the ear (earpiece). */
  proximity?: boolean;
  owners?: number;
  /** Event only: why the route changed. */
  reason?: string;
};

export interface AudioRoutingPlugin {
  /**
   * Enter in-call mode. `owner` (default 'legacy') holds it until its
   * endCall; `kind` picks the default route; `route` is a hand pick;
   * `speaker` (old API) sets the earpiece / loudspeaker choice (a headset
   * still wins).
   */
  startCall(options?: {
    speaker?: boolean;
    owner?: string;
    kind?: 'dm' | 'group';
    route?: AudioRoute;
  }): Promise<AudioRouteState>;

  /** Loudspeaker (true) or earpiece (false) when no headset is in use. */
  setSpeaker(options: { speaker: boolean }): Promise<AudioRouteState>;

  /** The user picked a route (route sheet). Rejects for an unknown route. */
  setAudioRoute(options: { route: AudioRoute }): Promise<AudioRouteState>;

  /** Routes on offer and the one in use. */
  getAudioRoutes(): Promise<AudioRouteState>;

  /** Alias of getAudioRoutes. */
  listRoutes(): Promise<AudioRouteState>;

  /** Alias of setAudioRoute ({type} instead of {route}). */
  setRoute(options: { type: AudioRoute }): Promise<AudioRouteState>;

  /** Apply the current route again (after getUserMedia moved it). */
  reapply(): Promise<AudioRouteState>;

  /** This owner is done (default 'legacy'); `all` ends it for everyone. */
  endCall(options?: {
    owner?: string;
    all?: boolean;
  }): Promise<AudioRouteState>;

  addListener(
    eventName: 'audioRouteChanged',
    listenerFunc: (event: AudioRouteState) => void
  ): Promise<PluginListenerHandle>;

  /** Same event as 'audioRouteChanged'. */
  addListener(
    eventName: 'routeChanged',
    listenerFunc: (event: AudioRouteState) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'audioFocusChanged',
    listenerFunc: (event: { focus: string }) => void
  ): Promise<PluginListenerHandle>;
}

const AudioRouting = registerPlugin<AudioRoutingPlugin>('AudioRouting');

export { AudioRouting };
