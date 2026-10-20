import { describe, expect, it, vi } from 'vitest';

// The "Calls" section of Copy diagnostics (GO): Python call audio counters,
// Android's call session, the audio route, the audio surface's counters and
// the WebRTC privacy guard. Off Android by default, as jsdom is.
const probe = vi.hoisted(() => ({
  platform: 'web',
  getStatus: vi.fn(async (_options?: unknown): Promise<unknown> => ({})),
}));
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: Object.create(actual.Capacitor, {
      isNativePlatform: { value: () => probe.platform !== 'web' },
      getPlatform: { value: () => probe.platform },
    }),
  };
});
vi.mock('../../plugins/Reticulum', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../plugins/Reticulum')>();
  return {
    ...actual,
    Reticulum: {
      getStatus: (options?: unknown) => probe.getStatus(options),
    },
  };
});
vi.mock('../../reticulumChat/mobile', () => ({
  getMobileReticulumChatDiagnostics: async () => null,
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));

import type { MobileCallAudioDiagnostics } from '../../bridge/mobileAudioSurface';
import {
  buildReticulumDiagnosticsReport,
  formatCallLines,
  formatCallRecord,
  probeCallDiagnostics,
  probeNativeBridge,
  type CallDiagnostics,
  type ReticulumDiagnosticsInput,
} from './reticulumDiagnostics';

// What mobileAudioSurface.getMobileCallAudioDiagnostics() returns during a
// GO -> Hub 1:1 call carried by Reticulum (WebRTC tried and failed).
const DM_SURFACE: MobileCallAudioDiagnostics = {
  at: 1_760_823_000_000,
  installed: true,
  route: {
    kind: 'direct',
    speaker: false,
    native: {
      route: 'earpiece',
      routes: ['earpiece', 'speaker'],
      speaker: false,
      active: true,
      owners: 2,
      kind: 'dm',
      focus: 'gain',
      proximity: true,
      mode: 3,
      reason: 'route-changed',
      at: 1_760_822_990_000,
    },
    lastError: null,
  },
  transportPreference: 'webrtc',
  privacy: {
    suppressedCandidates: 4,
    rewrittenCandidates: 1,
    sanitizedDescriptions: 2,
    droppedRemoteCandidates: 0,
    sanitizedRemoteDescriptions: 1,
    peerConnections: 1,
  },
  mic: { open: true, holders: 1, trackState: 'live' },
  direct: {
    active: true,
    owner: true,
    room: 'dmv:secret',
    peer: 'QSecret',
    carriedBy: 'reticulum',
    mediaReady: true,
    rtc: {
      state: 'failed',
      transportState: 'closed',
      remoteAudioPlaying: false,
      ageMs: 5200,
      playingAfterMs: null,
    },
    reticulum: {
      capturing: true,
      muted: false,
      hearCall: true,
      audioContext: 'running',
      tx: {
        capturedFrames: 520,
        encodedChunks: 519,
        sentPackets: 498,
        sendFailures: 0,
        lastSendError: null,
        encoderErrors: 0,
        encoderRebuilds: 0,
        skippedForWebRtc: 0,
      },
      rx: {
        sources: 1,
        events: 410,
        decryptedPackets: 400,
        decodedFrames: 399,
        decoderErrors: 0,
        decoderRebuilds: 0,
        skippedForWebRtc: 0,
        playbackQueue: 2,
        playbackPeakQueue: 6,
        latencyMs: 80,
      },
    },
  },
  group: null,
};

// The same snapshot during a 3-person group call where GO forwards audio.
const GROUP_SURFACE: MobileCallAudioDiagnostics = {
  ...DM_SURFACE,
  route: { ...DM_SURFACE.route, kind: 'group', speaker: true },
  direct: null,
  group: {
    active: true,
    runtimeLoaded: true,
    room: 'gcall-qortal-secret',
    roomState: 'connected',
    myRole: 'root',
    participants: 3,
    speaking: 1,
    transport: 'Reticulum',
    joinError: null,
    packetsReceived: 100,
    packetsDecoded: 99,
    packetsForwarded: 50,
    packetsDropped: 1,
    // Keyed by short peer ids: never printed, only the states counted.
    rtcEdges: {
      'QSecA1…xy': 'open',
      'QSecB2…zz': 'open',
      'QSecC3…aa': 'connecting',
    },
    rtcPolicy: 'applied',
  },
};

const DM_SURFACE_LINES = [
  'Audio surface: installed=yes, route.kind=direct, route.speaker=no, route.lastError=none, mic.open=yes, mic.holders=1, mic.trackState=live',
  'Audio surface 1:1: active=yes, carriedBy=reticulum, mediaReady=yes, rtc.state=failed, rtc.transportState=closed, rtc.remoteAudioPlaying=no, rtc.ageMs=5200, rtc.playingAfterMs=none',
  'Audio surface 1:1 Reticulum: capturing=yes, muted=no, hearCall=yes, audioContext=running, tx.capturedFrames=520, tx.encodedChunks=519, tx.sentPackets=498, tx.sendFailures=0, tx.lastSendError=none, tx.encoderErrors=0, tx.encoderRebuilds=0, tx.skippedForWebRtc=0, rx.sources=1, rx.events=410, rx.decryptedPackets=400, rx.decodedFrames=399, rx.decoderErrors=0, rx.decoderRebuilds=0, rx.skippedForWebRtc=0, rx.playbackQueue=2, rx.playbackPeakQueue=6, rx.latencyMs=80',
  'Audio surface group: none',
];

const CALLS: CallDiagnostics = {
  transportPreference: 'webrtc',
  native: {
    ringing: false,
    callActive: true,
    callKind: 'dm',
    callPhase: 'connected',
    micForeground: true,
    foregroundTypeFlags: 0x280,
    ringAddresses: 1,
    showWhenLocked: false,
    keyguardLocked: false,
    interactive: true,
    wifiLock: true,
    knownStringKeys: ['call_incoming_title'],
  },
  route: {
    ok: true,
    active: true,
    route: 'earpiece',
    routes: ['earpiece', 'speaker'],
    owners: 2,
    kind: 'dm',
    explicitChoice: null,
    focus: 'gain',
    proximity: true,
    mode: 3,
  },
  surface: DM_SURFACE,
  webrtcPrivacy: { suppressedCandidates: 4, rewrittenCandidates: 1 },
};

const IO = {
  rxFrames: 2501,
  rxControl: 12,
  rxDropped: 3,
  rxMediaShed: 1,
  rxBadBatch: 0,
  txFrames: 2440,
  txControl: 10,
  txNotQueued: 0,
  txRejected: 0,
  selfCheckOk: true,
};

describe('Calls diagnostics', () => {
  it('formats the call plumbing in one line each', () => {
    expect(formatCallLines(CALLS, IO)).toEqual([
      'Setting: Direct (WebRTC first, Reticulum fallback)',
      'Android call session: not ringing; call active (dm, connected); mic service yes (types 0x280); ring addresses 1; over lock no; keyguard no; screen on yes; Wi-Fi lock yes',
      'Audio route: earpiece of [earpiece, speaker]; in call yes (owners 2, kind dm); hand pick none; focus gain; proximity yes; mode 3',
      'Python call audio: rx 2501 frames (control 12), dropped 3 (shed 1), bad batches 0; tx 2440 frames (control 10), not queued 0, rejected 0; self-check ok',
      ...DM_SURFACE_LINES,
      'WebRTC privacy guard: suppressedCandidates=4, rewrittenCandidates=1',
    ]);
  });

  it('never reports a Bluetooth permission (GO never asks for one)', () => {
    // An older GO build still sent its BLUETOOTH_CONNECT state.
    const lines = formatCallLines(
      {
        ...CALLS,
        route: {
          ...CALLS.route,
          route: 'bluetooth',
          routes: ['earpiece', 'speaker', 'bluetooth'],
          bluetoothPermission: 'missing',
        },
      },
      IO
    );
    expect(lines.find((l) => l.startsWith('Audio route: '))).toBe(
      'Audio route: bluetooth of [earpiece, speaker, bluetooth]; in call yes (owners 2, kind dm); hand pick none; focus gain; proximity yes; mode 3'
    );
    expect(lines.join('\n')).not.toMatch(/permission/i);
  });

  it('prints the group runtime, its WebRTC edges counted by state', () => {
    const lines = formatCallLines({ ...CALLS, surface: GROUP_SURFACE }, IO);
    expect(lines.filter((l) => l.startsWith('Audio surface'))).toEqual([
      'Audio surface: installed=yes, route.kind=group, route.speaker=yes, route.lastError=none, mic.open=yes, mic.holders=1, mic.trackState=live',
      'Audio surface 1:1: none',
      'Audio surface group: active=yes, runtimeLoaded=yes, roomState=connected, myRole=root, participants=3, speaking=1, transport=Reticulum, joinError=none, packetsReceived=100, packetsDecoded=99, packetsForwarded=50, packetsDropped=1, rtcEdges=open:2/connecting:1, rtcPolicy=applied',
    ]);
    expect(lines.join('\n')).not.toMatch(/QSec|gcall-qortal-secret/);
  });

  it("keeps the surface's own route read when Android's read failed", () => {
    const line = formatCallLines({ ...CALLS, route: null }, IO).find((l) =>
      l.startsWith('Audio surface: ')
    );
    expect(line).toBe(
      'Audio surface: installed=yes, route.kind=direct, route.speaker=no, route.native.route=earpiece, route.native.routes=[2], route.native.speaker=no, route.native.active=yes, route.native.owners=2, route.native.kind=dm, route.native.focus=gain, route.native.proximity=yes, route.native.mode=3, route.native.reason=route-changed, route.native.at=1760822990000, route.lastError=none, mic.open=yes, mic.holders=1, mic.trackState=live'
    );
  });

  it('prints the WebRTC leg RTP counters on their own line, small levels kept', () => {
    const surface: MobileCallAudioDiagnostics = {
      ...DM_SURFACE,
      mic: {
        ...DM_SURFACE.mic!,
        generation: 2,
        restarts: 1,
        restartFailures: 0,
        restarting: false,
        lastRestart: {
          reason: 'route:devices-removed',
          ok: true,
          moved: 2,
          ms: 312,
          error: null,
          ageMs: 4000,
        },
      },
      direct: {
        ...DM_SURFACE.direct!,
        carriedBy: 'webrtc',
        rtcStats: {
          source: {
            audioLevel: 0.000412,
            totalAudioEnergy: 1.23456,
            totalSamplesDuration: 61.2,
          },
          outbound: { packetsSent: 5012, bytesSent: 401234 },
          remoteInbound: {
            packetsLost: 0,
            fractionLost: 0,
            roundTripTime: 0.0456,
            jitter: 0.00312,
          },
          inbound: null,
          ageMs: 1200,
          polls: 12,
        },
        reticulum: {
          ...DM_SURFACE.direct!.reticulum!,
          tx: {
            ...DM_SURFACE.direct!.reticulum!.tx,
            peakDbfs: -120,
            zeroRunMs: 5400,
            longestZeroRunMs: 5400,
            zeroFrames: 270,
            silenceReports: 1,
            micSwaps: 1,
          },
        },
      },
    };
    const lines = formatCallLines({ ...CALLS, surface }, IO);
    expect(lines.find((l) => l.startsWith('Audio surface: '))).toBe(
      'Audio surface: installed=yes, route.kind=direct, route.speaker=no, route.lastError=none, mic.open=yes, mic.holders=1, mic.trackState=live, mic.generation=2, mic.restarts=1, mic.restartFailures=0, mic.restarting=no, mic.lastRestart.reason=route:devices-removed, mic.lastRestart.ok=yes, mic.lastRestart.moved=2, mic.lastRestart.ms=312, mic.lastRestart.error=none, mic.lastRestart.ageMs=4000'
    );
    expect(lines.find((l) => l.startsWith('Audio surface 1:1: '))).toBe(
      'Audio surface 1:1: active=yes, carriedBy=webrtc, mediaReady=yes, rtc.state=failed, rtc.transportState=closed, rtc.remoteAudioPlaying=no, rtc.ageMs=5200, rtc.playingAfterMs=none'
    );
    expect(
      lines.find((l) => l.startsWith('Audio surface 1:1 WebRTC stats: '))
    ).toBe(
      'Audio surface 1:1 WebRTC stats: source.audioLevel=0.000412, source.totalAudioEnergy=1.235, source.totalSamplesDuration=61.2, outbound.packetsSent=5012, outbound.bytesSent=401234, remoteInbound.packetsLost=0, remoteInbound.fractionLost=0, remoteInbound.roundTripTime=0.0456, remoteInbound.jitter=0.00312, inbound=none, ageMs=1200, polls=12'
    );
    expect(
      lines.find((l) => l.startsWith('Audio surface 1:1 Reticulum: '))
    ).toContain(
      'tx.peakDbfs=-120, tx.zeroRunMs=5400, tx.longestZeroRunMs=5400, tx.zeroFrames=270, tx.silenceReports=1, tx.micSwaps=1'
    );
    // No line for a leg without counters (the fixture without rtcStats).
    expect(
      formatCallLines(CALLS, IO).some((l) => l.includes('WebRTC stats'))
    ).toBe(false);
  });

  it('masks an address inside an error text', () => {
    expect(
      formatCallRecord({
        lastSendError: 'no path to QdSnUjYQ3H4rWkRo2vSnqBjMv5L1T4ZaXy',
      })
    ).toBe('lastSendError=no_path_to_id');
  });

  it('never prints ids, addresses or room names from the surface', () => {
    const line = formatCallRecord({
      callId: 'abc',
      ownerId: 'owner-1',
      peerAddress: 'QAddr',
      roomId: 'dmv:x',
      chatId: 'direct:QA:QB',
      sourceKey: 'k',
      rx: { packets: 4, fromAddress: 'QAddr2' },
      frames: 9,
    });
    expect(line).toBe('rx.packets=4, frames=9');
  });

  it('says what is missing (older app, no counters, ringing)', () => {
    const lines = formatCallLines(
      {
        transportPreference: 'reticulum',
        native: {
          ringing: true,
          ringSource: 'native',
          ringPosted: true,
          ringConfirmed: false,
          ringSilenced: false,
          callActive: false,
        },
        route: null,
        surface: null,
        webrtcPrivacy: null,
      },
      { selfCheckOk: false, selfCheckProblems: ['emit hook missing'] }
    );
    expect(lines[0]).toBe('Setting: Private calls (Reticulum only)');
    expect(lines[1]).toContain(
      'ringing (source native, posted yes, confirmed no, silenced no); no call'
    );
    expect(lines[2]).toBe('Audio route: not reported');
    expect(lines[3]).toContain('self-check FAILED (emit hook missing)');
    expect(lines[4]).toBe(
      'Audio surface: not reported (no call audio counters in this build)'
    );
    expect(formatCallLines(null, null)).toEqual([
      'Setting: unknown',
      'Android call session: not reported',
      'Audio route: not reported',
      'Python call audio: not reported (older app or bridge not started)',
      'Audio surface: not reported (no call audio counters in this build)',
      'WebRTC privacy guard: not reported',
    ]);
  });

  const input = (
    over: Partial<ReticulumDiagnosticsInput> = {}
  ): ReticulumDiagnosticsInput => ({
    now: 401_000,
    version: '0.0.18',
    state: {
      phase: 'online',
      status: null,
      error: null,
      bridgeError: null,
      bridgeWarning: null,
      chatEngineState: 'idle',
      chatEngineSince: 0,
      chatEngineBootMs: null,
    } as unknown as ReticulumDiagnosticsInput['state'],
    onlineCount: 1,
    deviceOnline: true,
    webView: {
      userAgent: 'test',
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      webAssembly: true,
      opfs: true,
      crossOriginIsolated: false,
      jsLoopMs: 30,
    },
    engine: null,
    coreApi: null,
    sendFailures: [],
    ...over,
  });

  it('adds a Calls section after the Python bridge on GO only', () => {
    const withCalls = buildReticulumDiagnosticsReport(
      input({
        calls: CALLS,
        nativeBridge: {
          bridge: {},
          processStartedAtMs: null,
          socket: null,
          callAudioIo: IO,
        },
      })
    );
    const headings = withCalls
      .split('\n')
      .filter((line) => line.startsWith('--- '));
    expect(headings.indexOf('--- Calls ---')).toBe(
      headings.indexOf('--- Python bridge ---') + 1
    );
    expect(withCalls).toContain('Python call audio: rx 2501 frames');
    // No ids got through (the report's pseudonyms would hide them anyway).
    expect(withCalls).not.toContain('QSecret');
    expect(withCalls).not.toContain('dmv:secret');

    // Desktop / older callers: no section at all.
    const without = buildReticulumDiagnosticsReport(input());
    expect(without).not.toContain('--- Calls ---');
    // GO but nothing readable: the section says so.
    expect(buildReticulumDiagnosticsReport(input({ calls: null }))).toContain(
      '--- Calls ---\nSetting: unknown'
    );
  });

  it('reads Python call audio counters from the bridge detail', async () => {
    probe.platform = 'android';
    try {
      probe.getStatus.mockResolvedValueOnce({
        bridge: {
          cmdQueue: 0,
          callAudioIo: {
            ...IO,
            rxFrames: 'lots',
            lastError: 'send_group_audio: bad base64',
          },
        },
        native: { processStartedAtMs: 1_700_000_000_000 },
      });
      const result = await probeNativeBridge();
      expect(result?.callAudioIo).toEqual({
        ...IO,
        rxFrames: undefined,
        lastError: 'send_group_audio: bad base64',
      });
      expect(result?.callAudioIo && 'rxFrames' in result.callAudioIo).toBe(
        false
      );
    } finally {
      probe.platform = 'web';
    }
  });

  it('off GO the call probe reports nothing (no section)', async () => {
    await expect(probeCallDiagnostics()).resolves.toBeUndefined();
  });
});
