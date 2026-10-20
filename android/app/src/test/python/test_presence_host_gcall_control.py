"""WebRTC signalling over a slow mobile uplink (gcall control channel).

presence_bridge.py is left exactly as the upstream copy, so the slow-link
fixes live in qortal_presence_host.py as wrappers (window floor, one
deadline per bundle, feasibility before the first frame, latest wins,
bundle result events). These checks drive the REAL bridge functions
(handle_send_group_audio_link_control, the bundle task, the bundle send,
the per-frame channel send, _configure_group_audio_control_channel) over a
REAL vendored RNS Channel whose outlet is fake: proofs come back after the
link RTT on a fake clock, and an uplink stall holds them back.

    python3 -m pytest android/app/src/test/python/test_presence_host_gcall_control.py -q
    python3 android/app/src/test/python/test_presence_host_gcall_control.py
"""

import base64
import contextlib
import hashlib
import json
import os
import queue
import sys
import time as real_time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import presence_bridge as pb  # noqa: E402  (the real Android bridge)
import qortal_presence_host as h  # noqa: E402
from RNS.Channel import Channel, ChannelOutletBase, MessageState  # noqa: E402

ROOM = "dmv:0123456789abcdef01"
LINK = "a" * 32
OTHER_LINK = "b" * 32
PEER = "1" * 32
DEST = "2" * 32
SESSION = "dm-media-session"
SLOW_RTT = 1.64  # the vivo's call-3 link (handshake_ms=1637)
HOOKED_NAMES = (
    "handle_send_group_audio_link_control",
    "_send_group_audio_control_bundle_task",
    "_send_group_audio_control_bundle",
    "_send_group_audio_control_channel_message",
    "emit_audio_link_closed",
    "_configure_group_audio_control_channel",
)


@contextlib.contextmanager
def patched(target, **attrs):
    """Set attributes on ``target`` for one check and put them back after."""
    missing = object()
    saved = {name: getattr(target, name, missing) for name in attrs}
    for name, value in attrs.items():
        setattr(target, name, value)
    try:
        yield
    finally:
        for name, value in saved.items():
            if value is missing:
                delattr(target, name)
            else:
                setattr(target, name, value)


class FakeTime:
    """time for pb and the host: sleep() advances a fake clock."""

    def __init__(self, wall=1_760_000_000.0, mono=5_000.0):
        self.wall = wall
        self.mono = mono
        self.listeners = []

    def time(self):
        return self.wall

    def monotonic(self):
        return self.mono

    def monotonic_ns(self):
        return int(self.mono * 1_000_000_000)

    def sleep(self, seconds):
        self.advance(max(0.0, float(seconds)))

    def advance(self, seconds):
        self.wall += seconds
        self.mono += seconds
        for listener in list(self.listeners):
            listener(self.mono)

    def __getattr__(self, name):  # strftime, localtime, ...
        return getattr(real_time, name)


class FakePacket:
    def __init__(self, raw, pid, deliver_at):
        self.raw = raw
        self.pid = pid
        self.deliver_at = deliver_at
        self.delivered = False
        self.on_delivered = None


class FakeOutlet(ChannelOutletBase):
    """Link outlet for a real RNS Channel: each proof returns one RTT after
    the send, or one RTT after ``hold_until`` while the uplink is stalled."""

    def __init__(self, clock, rtt, mdu=431):
        self.clock = clock
        self._rtt = rtt
        self._mdu = mdu
        self.hold_until = 0.0
        self.sent = []  # [(mono, envelope raw)]
        self.in_flight = []
        self.on_send = None
        clock.listeners.append(self.tick)

    def send(self, raw):
        now = self.clock.mono
        packet = FakePacket(bytes(raw), len(self.sent), max(now, self.hold_until) + self._rtt)
        self.sent.append((now, bytes(raw)))
        self.in_flight.append(packet)
        if self.on_send is not None:
            self.on_send(len(self.sent))
        return packet

    def resend(self, packet):
        return packet

    @property
    def mdu(self):
        return self._mdu

    @property
    def rtt(self):
        return self._rtt

    @property
    def is_usable(self):
        return True

    def get_packet_state(self, packet):
        return MessageState.MSGSTATE_DELIVERED if packet.delivered else MessageState.MSGSTATE_SENT

    def timed_out(self):
        pass

    def __str__(self):
        return "FakeOutlet"

    def set_packet_timeout_callback(self, packet, callback, timeout=None):
        pass

    def set_packet_delivered_callback(self, packet, callback):
        packet.on_delivered = callback

    def get_packet_id(self, packet):
        return packet.pid

    def tick(self, now):
        for packet in [p for p in self.in_flight if p.deliver_at <= now]:
            self.in_flight.remove(packet)
            packet.delivered = True
            if packet.on_delivered is not None:
                packet.on_delivered(packet)


class FakeLink:
    def __init__(self, outlet):
        self.rtt = outlet.rtt
        self._channel = None
        self._outlet = outlet

    def get_channel(self):
        if self._channel is None:
            self._channel = Channel(self._outlet)
        return self._channel


class FakeDestination:
    hash = bytes.fromhex(DEST)


@contextlib.contextmanager
def hooked_bridge():
    """Install the slow-link hooks on the real bridge; restore it after."""
    saved = {name: getattr(pb, name) for name in HOOKED_NAMES}
    try:
        assert h._install_gcall_control_window_floor(pb)
        assert h._install_gcall_control_bundles(pb)
        yield
    finally:
        for name, value in saved.items():
            setattr(pb, name, value)


def reset_gcall_state():
    with h._gcall_lock:
        h._gcall_records.clear()
        h._gcall_latest.clear()
        h._gcall_attempted.clear()
    for key in h._gcall_stats:
        h._gcall_stats[key] = 0


@contextlib.contextmanager
def call_link(rtt=SLOW_RTT, link_id=LINK, lane_queue=False):
    """A real audio-link state with a real control Channel over FakeOutlet."""
    clock = FakeTime()
    outlet = FakeOutlet(clock, rtt)
    link = FakeLink(outlet)
    state = {
        "link": link,
        "peerPresenceHash": PEER,
        "peerDestinationHash": DEST,
        "incoming": False,
        "established": True,
        "closing": False,
        "control_channel_supported": True,
    }
    pb._ensure_audio_link_lifecycle_fields(state)
    responses = []
    events = []
    priority = queue.Queue(maxsize=512)
    queues = {}
    if lane_queue:
        queues[pb._gcall_control_scheduler_lane(link_id)] = queue.Queue()
    reset_gcall_state()
    with hooked_bridge(), patched(pb, time=clock), patched(h, time=clock), patched(
        pb,
        _destination=FakeDestination(),
        _audio_links_by_id={link_id: state},
        _audio_link_ids_by_object={id(link): link_id},
        _scheduler_queues=queues,
        _json_priority_event_queue=priority,
        emit_resp=lambda req_id, ok, payload=None, error=None: responses.append(
            (req_id, ok, payload, error)
        ),
        emit_event=lambda event, payload=None: events.append((event, payload)),
        _group_audio_control_pending_dedupe=set(),
    ):
        pb._configure_group_audio_control_channel(link, link_id)
        yield {
            "clock": clock,
            "outlet": outlet,
            "link": link,
            "state": state,
            "channel": state["control_channel"],
            "responses": responses,
            "events": events,
            "priority": priority,
            "lane": queues.get(pb._gcall_control_scheduler_lane(link_id)),
        }
    reset_gcall_state()


PEER_ADDRESS = "QpeerAddress000000000000000000000"
# The inner signal kind useVoiceCall.ts / the group engine put in `payload`.
INNER_KIND = {
    "offer": "description",
    "answer": "description",
    "capability": "capability",
    "ack": "capability-ack",
    "reconnect": "ice-refresh-request",
    "candidates": "ice-candidates",
    "candidate": "ice",
}


def deflated_signal(
    signed_at_wall,
    signal_type="offer",
    size=2000,
    extra=None,
    kind=None,
    to_address=PEER_ADDRESS,
    inner=None,
):
    """A GroupCallManager-style deflateRawSync(JSON.stringify(signal)).

    ``payload`` is the inner JSON.stringify(DirectVoiceRtcSignal) with its
    ``kind`` ('description', 'screen-description', ...); ``inner`` replaces
    it with any string."""
    if inner is None:
        inner = json.dumps(
            {
                "kind": kind or INNER_KIND.get(signal_type, signal_type),
                "generation": "gen-1",
                # incompressible, so a bundle has several GO1 frames
                "pad": os.urandom(size // 2).hex(),
            }
        )
    doc = {
        "roomId": ROOM,
        "callSessionId": SESSION,
        "toAddress": to_address,
        "signalType": signal_type,
        "timestamp": int(signed_at_wall * 1000),
        "payload": inner,
    }
    if extra:
        doc.update(extra)
    deflater = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    return deflater.compress(json.dumps(doc).encode("utf-8")) + deflater.flush()


def request(raw, signal_type, signal_id, link_id=LINK):
    return {
        "roomId": ROOM,
        "payload": base64.b64encode(raw).decode("ascii"),
        "signalType": signal_type,
        "signalId": signal_id,
        "callSessionId": SESSION,
        "linkId": link_id,
        "peerPresenceHash": PEER,
    }


def sent_frames(outlet):
    """GO0/GO1 frames as the Hub would read them off the channel."""
    frames = []
    for _at, envelope in outlet.sent:
        message = envelope[6:]  # Envelope header: msgtype, sequence, length
        assert message[0] == pb._GROUP_AUDIO_CONTROL_CHANNEL_VERSION
        decoded = pb._decode_group_audio_wire(message[2:])
        assert decoded is not None
        room, _sender, raw = decoded
        assert room == ROOM
        assert raw.startswith(pb._GC_LINK_CONTROL_MAGIC)
        frames.append(json.loads(raw[len(pb._GC_LINK_CONTROL_MAGIC):]))
    return frames


def reassembled(frames):
    """Payloads of every complete bundle, in send order (Hub reassembly)."""
    out = []
    i = 0
    while i < len(frames):
        start = frames[i]
        assert start["t"] == "GO0", start
        parts = frames[i + 1 : i + 1 + start["n"]]
        if len(parts) < start["n"]:
            break
        assert [p["x"] for p in parts] == list(range(start["n"]))
        assert all(p["z"] == start["z"] for p in parts)
        encoded = "".join(p["p"] for p in parts)
        raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        assert hashlib.sha256(raw).hexdigest() == start["z"]
        out.append(raw)
        i += 1 + start["n"]
    return out


def results(env):
    out = []
    while True:
        try:
            frame = env["priority"].get_nowait()
        except queue.Empty:
            break
        if frame.get("event") == h._GCALL_BUNDLE_RESULT_EVENT:
            out.append(frame)
    out += [
        {"type": "event", "event": e, "payload": p}
        for e, p in env["events"]
        if e == h._GCALL_BUNDLE_RESULT_EVENT
    ]
    return out


def run_lane(env):
    """Run every queued gcall-control task, as the lane worker would."""
    ran = 0
    while True:
        try:
            _queued_at, _name, fn, args, kwargs = env["lane"].get_nowait()
        except queue.Empty:
            return ran
        fn(*args, **kwargs)
        ran += 1


# --------------------------------------------------------------------------


def test_signed_at_reads_the_deflated_timestamp():
    now = 1_760_000_100.0
    raw = deflated_signal(now - 12.5)
    assert h._gcall_signed_at(raw, now) == now - 12.5
    # call-control JSON carries the same field
    raw = deflated_signal(now - 3, "call-control", 10, {"kind": "hangup"})
    assert h._gcall_signed_at(raw, now) == now - 3
    # unreadable, missing, odd or future timestamps count as "signed now"
    assert h._gcall_signed_at(b"not deflate at all", now) == now
    deflater = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    no_ts = deflater.compress(b'{"signalType":"offer"}') + deflater.flush()
    assert h._gcall_signed_at(no_ts, now) == now
    deflater = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    bool_ts = deflater.compress(b'{"timestamp":true}') + deflater.flush()
    assert h._gcall_signed_at(bool_ts, now) == now
    assert h._gcall_signed_at(deflated_signal(now + 30), now) == now
    # bounded inflation like the Hub's maxOutputLength (no zip bomb)
    deflater = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    bomb = deflater.compress(
        b'{"timestamp":1,"p":"' + b"A" * (200 * 1024) + b'"}'
    ) + deflater.flush()
    assert h._gcall_signed_at(bomb, now) == now


def test_deadline_margin_follows_the_link_rtt():
    signed = 1000.0
    # 20 s Hub TTL - (max(2 s, rtt) + 1 s skew)
    assert h._gcall_bundle_deadline("offer", signed, 1.64) == signed + 17.0
    assert h._gcall_bundle_deadline("offer", signed, None) == signed + 17.0
    assert h._gcall_bundle_deadline("ack", signed, 4.0) == signed + 15.0
    # DM call-control: the Hub keeps 30 s
    assert h._gcall_bundle_deadline("call-control", signed, 1.0) == signed + 27.0
    assert h._gcall_link_rtt_seconds({"rtt_median_ms": 900.0, "link": None}) == 0.9
    assert h._gcall_link_rtt_seconds({"rtt_handshake_ms": 1637.0}) == 1.637


def test_window_floor_raises_a_window_one_channel():
    with call_link(rtt=SLOW_RTT) as env:
        channel = env["channel"]
        # RNS gives rtt > RTT_SLOW a window of 1 for life; the floor lifts it.
        assert isinstance(channel, Channel)
        assert (channel.window, channel.window_min) == (2, 2)
        assert channel.window_max == Channel.WINDOW_MAX_SLOW
        assert channel.window_flexibility == 3
        assert h._gcall_stats["windowFloorApplied"] == 1
        # Two frames may be in flight now.
        msg = pb.GroupAudioControlChannelMessage(1, b"x")
        channel.send(msg)
        assert channel.is_ready_to_send()
        channel.send(pb.GroupAudioControlChannelMessage(1, b"y"))
        assert not channel.is_ready_to_send()
        # RNS's own shrink rule cannot take it below the floor.
        for _ in range(4):
            if channel.window > channel.window_min:
                channel.window -= 1
                if channel.window_max > channel.window_min + channel.window_flexibility:
                    channel.window_max -= 1
        assert channel.window_max == Channel.WINDOW_MAX_SLOW and channel.window == 2
    with call_link(rtt=0.4) as env:
        channel = env["channel"]
        # A normal link keeps what RNS chose.
        assert (channel.window, channel.window_max, channel.window_flexibility) == (
            Channel.WINDOW,
            Channel.WINDOW_MAX_SLOW,
            Channel.WINDOW_FLEXIBILITY,
        )
        assert h._gcall_stats["windowFloorApplied"] == 0


def test_offer_survives_an_uplink_stall_longer_than_six_seconds():
    with call_link() as env:
        clock, outlet = env["clock"], env["outlet"]
        raw = deflated_signal(clock.wall)
        outlet.hold_until = clock.mono + 8.0  # no proofs for 8 s
        pb.handle_send_group_audio_link_control("req-1", request(raw, "offer", "offer-1"))
        frames = sent_frames(outlet)
        assert reassembled(frames) == [raw], "the whole offer reached the channel"
        assert len(frames) >= 4
        assert frames[-1]["x"] == frames[0]["n"] - 1
        assert env["responses"][0][1] is True
        [result] = results(env)
        assert result["payload"]["ok"] is True
        assert result["payload"]["reason"] == "sent"
        assert result["payload"]["signalId"] == "offer-1"
        assert result["payload"]["signalType"] == "offer"
        assert result["payload"]["roomId"] == ROOM
        assert result["payload"]["sent"] == result["payload"]["total"] == len(frames)
        # Every frame left well inside the Hub's 20 s.
        assert outlet.sent[-1][0] - outlet.sent[0][0] < 17.0


def test_the_bridge_alone_drops_the_same_offer_half_way():
    """Regression baseline: the unwrapped bridge (6 s per frame) loses it."""
    with call_link() as env:
        clock, outlet = env["clock"], env["outlet"]
        raw = deflated_signal(clock.wall)
        outlet.hold_until = clock.mono + 8.0
        original_bundle = pb._send_group_audio_control_bundle.__wrapped__
        original_bundle(LINK, ROOM, raw, "offer", "offer-baseline")
        frames = sent_frames(outlet)
        assert len(frames) == 2, "two frames in the window, then the 6 s wait ran out"
        assert reassembled(frames) == []


def test_stale_signal_is_not_started():
    with call_link() as env:
        clock, outlet = env["clock"], env["outlet"]
        # Signed 17.5 s ago: past signed + 20 - (2 + 1).
        raw = deflated_signal(clock.wall - 17.5, "ack", 200)
        pb.handle_send_group_audio_link_control("req-1", request(raw, "ack", "ack-1"))
        assert outlet.sent == []
        [result] = results(env)
        assert result["payload"]["ok"] is False
        assert result["payload"]["reason"] == "expired"
        assert result["payload"]["sent"] == 0
        assert h._gcall_stats["expired"] == 1


def test_bundle_that_cannot_finish_in_time_is_not_started():
    with call_link() as env:
        clock, outlet = env["clock"], env["outlet"]
        # 12 s old: 5 s left, an offer needs ceil(frames / 2) x 1.64 s.
        raw = deflated_signal(clock.wall - 12.0, "offer", 3000)
        pb.handle_send_group_audio_link_control("req-1", request(raw, "offer", "offer-late"))
        assert outlet.sent == [], "no half bundle left in the window"
        [result] = results(env)
        assert result["payload"]["ok"] is False
        assert result["payload"]["reason"] == "infeasible"
        assert result["payload"]["total"] >= 5
        assert h._gcall_stats["infeasible"] == 1
        # The same signal fresh is fine.
        fresh = deflated_signal(clock.wall, "offer", 3000)
        pb.handle_send_group_audio_link_control("req-2", request(fresh, "offer", "offer-fresh"))
        assert reassembled(sent_frames(outlet)) == [fresh]


def test_frames_in_flight_count_against_feasibility():
    with call_link() as env:
        clock, outlet, channel = env["clock"], env["outlet"], env["channel"]
        outlet.hold_until = float("inf")
        channel.send(pb.GroupAudioControlChannelMessage(1, b"earlier"))
        channel.send(pb.GroupAudioControlChannelMessage(1, b"earlier"))
        # 8 s left, window 2, two earlier frames still unproven: 4 frames
        # need ceil((2 + 4) / 2) = 3 rounds (4.9 s), 8 frames need 5 (8.2 s).
        bundle = h._GcallBundle(
            LINK, ROOM, "capability", "c", clock.wall - 9.0, SLOW_RTT, clock.mono + 8.0, False
        )
        bundle.total = 4
        assert h._gcall_bundle_feasible(pb, bundle)
        assert abs(bundle.needed - 3 * SLOW_RTT) < 1e-9
        bundle.total = 8
        assert not h._gcall_bundle_feasible(pb, bundle)
        assert abs(bundle.needed - 5 * SLOW_RTT) < 1e-9


def test_bundle_gives_up_at_its_deadline_not_per_frame():
    with call_link() as env:
        clock, outlet = env["clock"], env["outlet"]
        signed = clock.wall
        raw = deflated_signal(signed)
        outlet.hold_until = float("inf")  # proofs never come back
        start = clock.mono
        pb.handle_send_group_audio_link_control("req-1", request(raw, "offer", "offer-stuck"))
        assert len(outlet.sent) == 2
        waited = clock.mono - start
        assert 16.9 <= waited <= 17.1, waited
        [result] = results(env)
        assert result["payload"]["ok"] is False
        assert result["payload"]["reason"] == "expired"
        assert result["payload"]["sent"] == 2
        assert 16_900 <= result["payload"]["ageMs"] <= 17_100


def test_call_control_is_never_skipped():
    with call_link() as env:
        clock, outlet = env["clock"], env["outlet"]
        # A hang-up signed 40 s ago is still sent (the bridge did the same).
        raw = deflated_signal(clock.wall - 40.0, "call-control", 600, {"kind": "hangup"})
        pb.handle_send_group_audio_link_control(
            "req-1", request(raw, "call-control", "hangup-1")
        )
        assert reassembled(sent_frames(outlet)) == [raw]
        [result] = results(env)
        assert result["payload"]["ok"] is True
        assert result["payload"]["signalType"] == "call-control"


def test_call_control_waits_at_least_the_bridge_frame_wait():
    with call_link() as env:
        clock, outlet = env["clock"], env["outlet"]
        raw = deflated_signal(clock.wall - 40.0, "call-control", 600, {"kind": "hangup"})
        # Proofs back after 4 s + RTT: within the bridge's 6 s per frame,
        # although the hang-up is long past its own 30 s.
        outlet.hold_until = clock.mono + 4.0
        pb.handle_send_group_audio_link_control(
            "req-1", request(raw, "call-control", "hangup-2")
        )
        assert reassembled(sent_frames(outlet)) == [raw]


def test_newer_offer_replaces_a_queued_one_in_place():
    with call_link(lane_queue=True) as env:
        clock, outlet = env["clock"], env["outlet"]
        first = deflated_signal(clock.wall, "offer", 1200)
        pb.handle_send_group_audio_link_control("req-1", request(first, "offer", "offer-g1"))
        clock.advance(2.0)
        second = deflated_signal(clock.wall, "offer", 1200)
        pb.handle_send_group_audio_link_control("req-2", request(second, "offer", "offer-g2"))
        assert env["lane"].qsize() == 2
        assert outlet.sent == []
        assert run_lane(env) == 2
        # The first queued task sent the newest offer; the second had
        # nothing newer left to send.
        assert reassembled(sent_frames(outlet)) == [second]
        [result] = results(env)
        assert result["payload"]["signalId"] == "offer-g2"
        assert result["payload"]["ok"] is True
        assert h._gcall_stats["coalesced"] == 1
        assert h._gcall_stats["superseded"] == 1


def test_capability_latest_wins_even_where_the_bridge_coalesced_it():
    with call_link(lane_queue=True) as env:
        clock, outlet = env["clock"], env["outlet"]
        older = deflated_signal(clock.wall, "capability", 200)
        pb.handle_send_group_audio_link_control("req-1", request(older, "capability", "cap-1"))
        clock.advance(5.0)
        newer = deflated_signal(clock.wall, "capability", 200)
        pb.handle_send_group_audio_link_control("req-2", request(newer, "capability", "cap-2"))
        # The bridge's own dedupe answered "coalesced" and queued nothing...
        assert env["responses"][1][2].get("coalesced") is True
        assert env["lane"].qsize() == 1
        run_lane(env)
        # ...but the one queued task sends the NEWER capability (the bridge
        # alone sent the older one, which the Hub then found too old).
        assert reassembled(sent_frames(outlet)) == [newer]
        [result] = results(env)
        assert result["payload"]["signalId"] == "cap-2"


def test_request_during_a_slow_send_gets_its_own_task():
    with call_link(lane_queue=True) as env:
        clock, outlet = env["clock"], env["outlet"]
        first = deflated_signal(clock.wall, "capability", 200)
        second = deflated_signal(clock.wall + 1, "capability", 200)
        pb.handle_send_group_audio_link_control("req-1", request(first, "capability", "cap-a"))
        outlet.hold_until = clock.mono + 3.0

        def mid_send(count):
            if count == 1:
                outlet.on_send = None
                pb.handle_send_group_audio_link_control(
                    "req-2", request(second, "capability", "cap-b")
                )

        outlet.on_send = mid_send
        assert run_lane(env) == 2
        # The bridge freed its dedupe slot only after the send, so "cap-b"
        # used to be coalesced into a finished task and lost.
        assert env["responses"][1][2].get("coalesced") is not True
        assert reassembled(sent_frames(outlet)) == [first, second]
        assert [r["payload"]["signalId"] for r in results(env)] == ["cap-a", "cap-b"]


def test_signal_variant_reads_the_inner_kind():
    now = 1_760_000_100.0

    def variant(raw):
        return h._gcall_signal_variant(h._gcall_inflate_signal(raw))

    assert variant(deflated_signal(now, "answer", 50)) == (
        "description",
        "description:" + PEER_ADDRESS,
    )
    assert variant(deflated_signal(now, "answer", 50, kind="screen-description"))[1] == (
        "screen-description:" + PEER_ADDRESS
    )
    assert variant(deflated_signal(now, "reconnect", 50, kind="screen-stop"))[0] == "screen-stop"
    # Group engine signals name it `type`.
    group = deflated_signal(now, "offer", inner=json.dumps({"type": "offer", "description": {}}))
    assert variant(group) == ("offer", "offer:" + PEER_ADDRESS)
    # Another account behind the same link is another key.
    assert variant(deflated_signal(now, "offer", 50, to_address="Qother"))[1] == "description:Qother"
    # Unreadable inner payload: no variant, so never coalesced.
    assert variant(deflated_signal(now, "offer", inner="not json")) == (None, None)
    assert variant(deflated_signal(now, "offer", inner=json.dumps(["x"]))) == (None, None)
    assert variant(b"not deflate at all") == (None, None)


def test_voice_and_screen_answers_are_both_sent_behind_a_busy_lane():
    """A DM's voice and screen-share answers share room, session and
    signalType 'answer'; latest wins must not merge them."""
    with call_link(lane_queue=True) as env:
        clock, outlet = env["clock"], env["outlet"]
        voice_1 = deflated_signal(clock.wall, "answer", 600)
        screen = deflated_signal(clock.wall, "answer", 600, kind="screen-description")
        pb.handle_send_group_audio_link_control("req-1", request(voice_1, "answer", "ans-voice-1"))
        pb.handle_send_group_audio_link_control("req-2", request(screen, "answer", "ans-screen"))
        clock.advance(1.0)
        voice_2 = deflated_signal(clock.wall, "answer", 600)
        pb.handle_send_group_audio_link_control("req-3", request(voice_2, "answer", "ans-voice-2"))
        assert env["lane"].qsize() == 3
        assert run_lane(env) == 3
        # The newer voice answer still replaced the queued one; the screen
        # answer kept its own slot.
        assert reassembled(sent_frames(outlet)) == [voice_2, screen]
        sent = [(r["payload"]["signalId"], r["payload"]["signalKind"], r["payload"]["ok"]) for r in results(env)]
        assert sent == [
            ("ans-voice-2", "description", True),
            ("ans-screen", "screen-description", True),
        ]
        assert h._gcall_stats["coalesced"] == 1
        assert h._gcall_stats["superseded"] == 1


def test_offers_with_an_unreadable_inner_signal_are_not_coalesced():
    with call_link(lane_queue=True) as env:
        clock, outlet = env["clock"], env["outlet"]
        one = deflated_signal(clock.wall, "offer", inner="opaque-1")
        two = deflated_signal(clock.wall, "offer", inner="opaque-2")
        pb.handle_send_group_audio_link_control("req-1", request(one, "offer", "offer-o1"))
        pb.handle_send_group_audio_link_control("req-2", request(two, "offer", "offer-o2"))
        run_lane(env)
        assert reassembled(sent_frames(outlet)) == [one, two]
        assert [r["payload"]["signalKind"] for r in results(env)] == ["", ""]
        assert h._gcall_stats["coalesced"] == 0


def test_candidates_are_never_coalesced():
    with call_link(lane_queue=True) as env:
        clock, outlet = env["clock"], env["outlet"]
        one = deflated_signal(clock.wall, "candidates", 300)
        two = deflated_signal(clock.wall, "candidates", 300)
        pb.handle_send_group_audio_link_control("req-1", request(one, "candidates", "cand-1"))
        pb.handle_send_group_audio_link_control("req-2", request(two, "candidates", "cand-2"))
        run_lane(env)
        assert reassembled(sent_frames(outlet)) == [one, two]


def test_link_close_forgets_latest_wins_state():
    with call_link(lane_queue=True) as env:
        clock = env["clock"]
        raw = deflated_signal(clock.wall, "answer", 300)
        pb.handle_send_group_audio_link_control("req-1", request(raw, "answer", "ans-1"))
        other = deflated_signal(clock.wall, "answer", 300)
        h._gcall_register_request(request(other, "answer", "ans-other", OTHER_LINK))
        assert any(r["route"] == LINK for r in h._gcall_records.values())
        pb.emit_audio_link_closed(LINK, "test")
        assert not any(r["route"] == LINK for r in h._gcall_records.values())
        assert not any(r["route"] == LINK for r in h._gcall_latest.values())
        assert not any(key[0] == LINK for key in h._gcall_attempted)
        # Other links keep theirs.
        assert "ans-other" in h._gcall_records
        assert pb.get_audio_link_state(LINK) is None
        assert env["events"][0][0] == "group_audio_link_closed"
        # The queued task now finds no link and says so.
        run_lane(env)
        [result] = results(env)
        assert result["payload"]["ok"] is False
        assert result["payload"]["reason"] == "link"


def test_hooks_are_idempotent_and_self_checked():
    with hooked_bridge():
        hooked = {name: getattr(pb, name) for name in HOOKED_NAMES}
        assert h._install_gcall_control_bundles(pb)
        assert h._install_gcall_control_window_floor(pb)
        assert {name: getattr(pb, name) for name in HOOKED_NAMES} == hooked, "no double wrap"
        assert h._run_gcall_control_self_check(pb)
        assert h._gcall_self_check == {"ok": True, "problems": []}
        assert h._gcall_control_detail()["selfCheckOk"] is True
    # Back to the bare bridge: the self-check says what is missing.
    assert not h._run_gcall_control_self_check(pb)
    assert "_send_group_audio_control_bundle not hooked" in h._gcall_self_check["problems"]


def test_hooks_stay_off_when_the_bridge_changed():
    class ChangedBridge:
        pass

    changed = ChangedBridge()
    for name in h._GCALL_CONTROL_REQUIRED_ATTRS:
        setattr(changed, name, getattr(pb, name))

    def task_that_does_more(link_id, room_id, payload, signal_type, signal_id, dedupe_key):
        _send_group_audio_control_bundle(link_id, room_id, payload, signal_type, signal_id)  # noqa: F821
        emit_event("something", {})  # noqa: F821

    changed._send_group_audio_control_bundle_task = task_that_does_more
    before = changed._send_group_audio_control_bundle
    assert not h._install_gcall_control_bundles(changed)
    assert changed._send_group_audio_control_bundle is before
    assert any("does more" in p for p in h._gcall_control_problems(changed))

    def bundle_new_signature(link_id, room_id, payload, signal_type, signal_id, deadline):
        return None

    changed._send_group_audio_control_bundle_task = pb._send_group_audio_control_bundle_task
    changed._send_group_audio_control_bundle = bundle_new_signature
    assert any("signature" in p for p in h._gcall_control_problems(changed))
    del changed._decode_group_audio_wire
    assert "presence_bridge._decode_group_audio_wire missing" in h._gcall_control_problems(changed)


def test_bridge_detail_reports_gcall_control():
    saved = sys.modules.get("presence_bridge")
    sys.modules["presence_bridge"] = pb
    try:
        detail = h._bridge_detail()
    finally:
        if saved is None:
            sys.modules.pop("presence_bridge", None)
        else:
            sys.modules["presence_bridge"] = saved
    assert "gcallControl" in detail
    assert {"bundlesSent", "infeasible", "expired", "superseded", "windowFloorApplied"} <= set(
        detail["gcallControl"]
    )


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
