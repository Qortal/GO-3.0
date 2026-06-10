import { registerPlugin } from '@capacitor/core';

/**
 * Native in-call audio routing.
 *
 * During a voice call the WebView captures the mic with echo-cancellation,
 * which forces Android into communication mode and routes playback to the
 * earpiece at low volume. This plugin switches to MODE_IN_COMMUNICATION and
 * lets the call UI route to the loudspeaker (default) or the earpiece.
 */
export interface AudioRoutingPlugin {
  /** Enter in-call mode. `speaker` defaults to true (loudspeaker). */
  startCall(options?: { speaker?: boolean }): Promise<{
    ok: boolean;
    speaker: boolean;
  }>;

  /** Toggle loudspeaker (true) vs earpiece (false) mid-call. */
  setSpeaker(options: { speaker: boolean }): Promise<{
    ok: boolean;
    speaker: boolean;
  }>;

  /** Restore the pre-call audio mode/route. */
  endCall(): Promise<{ ok: boolean }>;
}

const AudioRouting = registerPlugin<AudioRoutingPlugin>('AudioRouting');

export { AudioRouting };
