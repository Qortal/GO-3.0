"""Calls on a slow phone: signalling first, live audio stays live.

On a Galaxy S8+ the bridge's queues filled up during a call on Reticulum
audio: hang-ups waited behind chat relays on control-send, link control
behind stale voice frames on audio-send-N, and inbound link control behind
up to 256 voice frames on rns-realtime-callback-N. qortal_presence_host.py
gives call signals their own lane, queues outbound audio per route (control
first, stale media dropped) and splits inbound call control from voice.
These checks run the hooks against the REAL Android presence_bridge.py and
its real scheduler workers:

    python3 -m pytest android/app/src/test/python/test_presence_host_call_priority.py -q
    python3 android/app/src/test/python/test_presence_host_call_priority.py
"""

import contextlib
import json
import os
import re
import sys
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

import presence_bridge as pb  # noqa: E402  (the real Android bridge)
import qortal_presence_host as h  # noqa: E402
from _host_test_support import _wait_for  # noqa: E402

ROOM = "dmv:0123456789abcdef01"
LINK = "f" * 32
OTHER_LINK = "e" * 32
PEER = "1" * 32
DEST = "2" * 32
CONTROL_MAGIC = b"QGCCTL1\x00"
HOOKED = (
    "_scheduler_lane_for_command",
    "_dispatch_bounded_rns_packet_callback",
    "_enqueue_scheduler_task",
    "_enqueue_audio_send_batch",
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


@contextlib.contextmanager
def installed(workers=False):
    """The hooks on the real bridge, optionally with scheduler workers."""
    saved = {name: getattr(pb, name) for name in HOOKED}
    saved_lanes = dict(pb._SCHEDULER_QUEUE_MAX_BY_LANE)
    saved_stats = dict(h._call_priority_stats)
    saved_stale = pb._audio_stale_drops
    saved_interval = sys.getswitchinterval()
    h._audio_send_routes.clear()
    h._call_reader_sampled_at = h._call_reader_behind_until = 0.0
    assert h._install_call_priority(pb) is True
    try:
        if workers:
            lanes = {
                name: pb._SCHEDULER_QUEUE_MAX_BY_LANE[name]
                for name in pb._SCHEDULER_QUEUE_MAX_BY_LANE
                if name.startswith(
                    (
                        "audio-send-",
                        "rns-realtime-callback-",
                        "rns-overlay-callback-",
                        "call-",
                        "control-send",
                    )
                )
            }
            with patched(
                pb,
                _SCHEDULER_QUEUE_MAX_BY_LANE=lanes,
                _scheduler_queues={},
                _scheduler_threads=[],
                _shutdown=threading.Event(),
                log=lambda *_a, **_k: None,
                _emit_audio_queue_state=lambda *a, **k: None,
            ):
                pb._start_scheduler_workers()
                try:
                    yield
                finally:
                    pb._shutdown.set()
                    pb._stop_scheduler_workers()
        else:
            yield
    finally:
        for name, value in saved.items():
            setattr(pb, name, value)
        pb._SCHEDULER_QUEUE_MAX_BY_LANE.clear()
        pb._SCHEDULER_QUEUE_MAX_BY_LANE.update(saved_lanes)
        h._call_priority_stats.update(saved_stats)
        pb._audio_stale_drops = saved_stale
        h._audio_send_routes.clear()
        h._call_reader_sampled_at = h._call_reader_behind_until = 0.0
        h._call_previous_switch_interval = None
        sys.setswitchinterval(saved_interval)


def media(tag, received_at_ms=None, link=LINK):
    received = int(time.time() * 1000) if received_at_ms is None else received_at_ms
    return (link, ROOM, PEER, DEST, received, b"media-" + str(tag).encode())


def control(tag, link=LINK):
    return (link, ROOM, PEER, DEST, 0, CONTROL_MAGIC + json.dumps({"t": str(tag)}).encode())


def route(link=LINK):
    return f"link:{link}"


def tags(frames):
    out = []
    for frame in frames:
        raw = frame[5]
        if raw.startswith(CONTROL_MAGIC):
            out.append("c:" + json.loads(raw[len(CONTROL_MAGIC) :])["t"])
        else:
            out.append(raw.decode().replace("media-", "m:"))
    return out


class ManualLane:
    """Collects lane tasks so a check can run them one by one."""

    def __init__(self):
        self.tasks = []
        self.full = False

    def enqueue(self, lane, name, fn, *args, drop_oldest=False, **kwargs):
        if self.full:
            return False
        self.tasks.append((lane, name, fn, args, kwargs, drop_oldest))
        return True

    def run_next(self):
        _lane, _name, fn, args, kwargs, _drop = self.tasks.pop(0)
        fn(*args, **kwargs)


def qgau_wire(payload, room=ROOM, sender=DEST):
    room_bytes, sender_bytes = room.encode(), bytes.fromhex(sender)
    return (
        pb._GROUP_AUDIO_BINARY_MAGIC
        + bytes((pb._GROUP_AUDIO_BINARY_VERSION, len(room_bytes), len(sender_bytes)))
        + len(payload).to_bytes(2, "big")
        + room_bytes
        + sender_bytes
        + payload
    )


# --- lanes -----------------------------------------------------------------


def test_call_signals_get_their_own_lane():
    with installed():
        lane = pb._scheduler_lane_for_command
        for action in ("send_call", "fanout_call", "send_group_call", "fanout_group_call"):
            # One lane for all of them: a hang-up cannot pass its own ring.
            assert lane(action, {"payload": {}}) == "call-signal", action
        assert lane("get_community_stun_endpoints", {}) == "call-signal"
        # Chat keeps the bridge's lanes, and so does everything else of a call.
        assert lane("send_reticulum_chat", {"payload": {}}) == "control-send"
        assert lane("fanout_reticulum_chat", {"payload": {}}) == "control-send"
        assert lane("publish_presence", {"payload": {}}) == "control-send"
        assert lane("open_group_audio_link", {}) == "audio-control"
        assert lane("send_group_audio_link_control", {"payload": {}}).startswith(
            "gcall-control-command-"
        )
        assert pb._SCHEDULER_QUEUE_MAX_BY_LANE["call-signal"] == 256
        assert pb._SCHEDULER_QUEUE_MAX_BY_LANE["call-rx-control"] == 256


def test_call_signals_handlers_exist_in_the_bridge():
    """A renamed action would silently go back to control-send."""
    consts = []

    def collect(code):
        for const in code.co_consts:
            if isinstance(const, types.CodeType):
                collect(const)
            elif isinstance(const, str):
                consts.append(const)

    handler = pb.handle_command
    while getattr(handler, "__wrapped__", None) is not None:
        handler = handler.__wrapped__
    collect(handler.__code__)
    for action in h._CALL_SIGNAL_ACTIONS:
        assert action in consts, action


def test_install_is_idempotent_and_keeps_the_heartbeat_lane():
    before = pb._scheduler_lane_for_command
    h._install_call_heartbeat_lane(pb)
    try:
        with installed():
            hooks = {name: getattr(pb, name) for name in HOOKED}
            assert h._install_call_priority(pb) is True
            assert {name: getattr(pb, name) for name in HOOKED} == hooks
            assert (
                pb._scheduler_lane_for_command("send_group_audio_link_heartbeat", {})
                == "audio-control"
            )
            # The heartbeat hook recognises its marker through this one.
            h._install_call_heartbeat_lane(pb)
            assert pb._scheduler_lane_for_command is hooks["_scheduler_lane_for_command"]
            assert h._run_call_priority_self_check(pb) is True
            assert h._call_priority_detail()["selfCheckOk"] is True
    finally:
        pb._scheduler_lane_for_command = before
        h._call_priority_self_check = None


def test_hangup_overtakes_a_full_chat_lane():
    """Real workers: 200 slow chat sends queued, then a hang-up."""
    order = []
    gate = threading.Event()

    def handle(message):
        if message["action"] == "send_reticulum_chat":
            gate.wait(5)
        order.append(message["action"])

    with installed(workers=True), patched(pb, handle_command=handle):
        for i in range(200):
            pb._handle_rns_command_message(
                {"id": f"c{i}", "action": "send_reticulum_chat", "payload": {}}
            )
        started = time.monotonic()
        pb._handle_rns_command_message({"id": "h", "action": "send_call", "payload": {}})
        assert _wait_for(lambda: "send_call" in order, timeout=2)
        assert time.monotonic() - started < 1
        assert order == ["send_call"], "nothing else was done before it"
        gate.set()


def test_call_signals_keep_their_order():
    order = []
    with installed(workers=True), patched(
        pb, handle_command=lambda m: (time.sleep(0.002), order.append(m["id"]))
    ):
        sent = []
        for i in range(60):
            action = ("send_call", "fanout_call", "send_group_call", "fanout_group_call")[i % 4]
            pb._handle_rns_command_message({"id": f"s{i}", "action": action, "payload": {}})
            sent.append(f"s{i}")
        assert _wait_for(lambda: len(order) == 60)
        assert order == sent


# --- outbound audio --------------------------------------------------------


def test_link_control_goes_before_queued_media():
    lane, sent = ManualLane(), []
    with installed(), patched(
        pb, _enqueue_scheduler_task=lane.enqueue, _process_audio_batch=sent.extend
    ):
        assert pb._enqueue_audio_send_batch(route(), [media(i) for i in range(10)]) is True
        assert pb._enqueue_audio_send_batch(route(), [control("join"), control("key")]) is True
        assert len(lane.tasks) == 1, "one lane task per waiting route"
        task_lane, name, *_rest = lane.tasks[0]
        assert task_lane == pb._audio_scheduler_lane_for_route(route())
        assert name == f"audio-send:{route()}"
        lane.run_next()
        assert tags(sent) == ["c:join", "c:key", "m:0", "m:1"]
        # Control that arrives between turns goes first again.
        pb._enqueue_audio_send_batch(route(), [control("hangup")])
        lane.run_next()
        assert tags(sent)[4:] == ["c:hangup", "m:2", "m:3"]
        while lane.tasks:
            lane.run_next()
        assert tags(sent)[7:] == ["m:4", "m:5", "m:6", "m:7", "m:8", "m:9"]
        assert h._audio_send_routes == {}, "an idle route leaves nothing behind"


def test_a_phone_that_keeps_up_drops_nothing():
    sent = []
    with installed(workers=True), patched(pb, _process_audio_batch=sent.extend):
        before = dict(h._call_priority_stats)
        for i in range(50):
            assert pb._enqueue_audio_send_batch(route(), [media(i)]) is True
            time.sleep(0.002)
        assert _wait_for(lambda: len(sent) == 50)
        assert tags(sent) == [f"m:{i}" for i in range(50)]
        assert h._call_priority_stats["txMediaDropped"] == before["txMediaDropped"]
        assert h._call_priority_stats["txMediaSent"] - before["txMediaSent"] == 50
        # A burst after a stall of the page is sent too: it waited in the
        # page, not here, and is still inside the live deadline.
        now = int(time.time() * 1000)
        burst = [media(f"b{i}", now - 200 + 10 * i) for i in range(20)]
        pb._enqueue_audio_send_batch(route(), burst)
        assert _wait_for(lambda: len(sent) == 70)
        assert h._call_priority_stats["txMediaDropped"] == before["txMediaDropped"]


def test_stale_media_is_dropped_unsent_and_the_newest_kept():
    lane, sent = ManualLane(), []
    clock = types.SimpleNamespace(now=100.0)
    with installed(), patched(
        pb, _enqueue_scheduler_task=lane.enqueue, _process_audio_batch=sent.extend
    ), patched(
        h,
        time=types.SimpleNamespace(monotonic=lambda: clock.now, time=time.time),
    ):
        before = pb._audio_stale_drops
        for i in range(30):
            pb._enqueue_audio_send_batch(route(), [media(i)])
        pb._enqueue_audio_send_batch(route(), [control("key")])
        clock.now += 1.0  # the lane was busy for a second
        for i in range(30, 40):
            pb._enqueue_audio_send_batch(route(), [media(i)])
        lane.run_next()
        # Control survived whatever it waited; media jumps to the newest.
        assert tags(sent) == ["c:key", "m:37", "m:38"]
        lane.run_next()
        assert tags(sent)[3:] == ["m:39"]
        assert pb._audio_stale_drops - before == 37
        assert h._call_priority_stats["txMediaDropped"] >= 37


def test_the_live_deadline_applies_again_when_a_frame_gets_its_turn():
    lane, sent = ManualLane(), []
    with installed(), patched(
        pb, _enqueue_scheduler_task=lane.enqueue, _process_audio_batch=sent.extend
    ):
        now = int(time.time() * 1000)
        late = now - int(pb._AUDIO_OUTBOUND_DEADLINE_SECONDS * 1000) - 50
        # Frames without a capture time (0) are never late by it.
        pb._enqueue_audio_send_batch(
            route(), [media("late", late), media("fresh", now), media("untimed", 0)]
        )
        while lane.tasks:
            lane.run_next()
        assert tags(sent) == ["m:fresh", "m:untimed"]


def test_media_never_evicts_control_and_memory_stays_bounded():
    lane, sent = ManualLane(), []
    with installed(), patched(
        pb, _enqueue_scheduler_task=lane.enqueue, _process_audio_batch=sent.extend
    ):
        pb._enqueue_audio_send_batch(route(), [control("key")])
        for i in range(500):
            assert pb._enqueue_audio_send_batch(route(), [media(i)]) is True
        waiting = h._audio_send_routes[route()]
        assert len(waiting.media) == h._AUDIO_SEND_MEDIA_MAX
        assert len(waiting.control) == 1
        # Control has its own bound; past it new frames are refused (the
        # sender learns), none already queued is lost.
        results = [
            pb._enqueue_audio_send_batch(route(), [control(i)])
            for i in range(h._AUDIO_SEND_CONTROL_MAX + 5)
        ]
        assert results.count(False) == 6, "one was already waiting"
        lane.run_next()
        assert tags(sent)[0] == "c:key"
        assert len([t for t in tags(sent) if t.startswith("c:")]) == h._AUDIO_SEND_CONTROL_MAX


def test_routes_share_a_lane_fairly():
    lane, sent = ManualLane(), []
    with installed(), patched(
        pb,
        _enqueue_scheduler_task=lane.enqueue,
        _process_audio_batch=sent.extend,
        _audio_scheduler_lane_for_route=lambda key: "audio-send-0",
    ):
        pb._enqueue_audio_send_batch(route(), [media(f"a{i}") for i in range(6)])
        pb._enqueue_audio_send_batch(
            route(OTHER_LINK), [media(f"b{i}", link=OTHER_LINK) for i in range(6)]
        )
        pb._enqueue_audio_send_batch(route(OTHER_LINK), [control("key", link=OTHER_LINK)])
        while lane.tasks:
            lane.run_next()
        assert tags(sent) == [
            "m:a0", "m:a1", "c:key", "m:b0", "m:b1", "m:a2", "m:a3",
            "m:b2", "m:b3", "m:a4", "m:a5", "m:b4", "m:b5",
        ]  # fmt: skip


def test_a_failed_turn_neither_stalls_nor_loses_the_route():
    lane, sent = ManualLane(), []

    def fail(_frames):
        raise RuntimeError("send failed")

    with installed(), patched(pb, _enqueue_scheduler_task=lane.enqueue):
        with patched(pb, _process_audio_batch=fail):
            pb._enqueue_audio_send_batch(route(), [media(i) for i in range(4)])
            try:
                lane.run_next()
            except RuntimeError:
                pass
            else:
                raise AssertionError("the scheduler reports task failures")
        with patched(pb, _process_audio_batch=sent.extend):
            lane.run_next()
            assert tags(sent) == ["m:2", "m:3"]
            assert h._audio_send_routes == {}
            # A lane that has no room now is asked again by the next frame.
            lane.full = True
            assert pb._enqueue_audio_send_batch(route(), [control("key")]) is False
            assert h._audio_send_routes[route()].scheduled is False
            lane.full = False
            assert pb._enqueue_audio_send_batch(route(), [media(9)]) is True
            lane.run_next()
            assert tags(sent)[2:] == ["c:key", "m:9"]


def test_overload_keeps_control_prompt_and_audio_fresh():
    """Real workers, 30 ms a send for 20 ms frames: as on the S8+."""
    sent = []

    def slow_send(frames):
        for frame in frames:
            time.sleep(0.03)
            sent.append((time.monotonic(), frame))

    with installed(workers=True), patched(pb, _process_audio_batch=slow_send):
        started = time.monotonic()
        control_at = {}
        i = 0
        while time.monotonic() - started < 1.5:
            pb._enqueue_audio_send_batch(route(), [media(i)])
            if i in (20, 40, 60):
                control_at[str(i)] = time.monotonic()
                pb._enqueue_audio_send_batch(route(), [control(i)])
            i += 1
            time.sleep(0.02)
        produced = i
        assert _wait_for(lambda: h._audio_send_routes == {}, timeout=3)
        time.sleep(0.1)
        waits = {}
        for at, frame in sent:
            if frame[5].startswith(CONTROL_MAGIC):
                tag = json.loads(frame[5][len(CONTROL_MAGIC) :])["t"]
                waits[tag] = at - control_at[tag]
        assert set(waits) == {"20", "40", "60"}, waits
        assert max(waits.values()) < 0.25, waits
        assert len(sent) < produced, "an overloaded phone sheds audio"
        # What was sent last is what was produced last, not a backlog.
        last = [int(f[5][6:]) for _at, f in sent if not f[5].startswith(CONTROL_MAGIC)][-1]
        assert produced - last <= 3, (produced, last)


def test_executor_pass_uses_the_per_route_queue():
    """The bridge's own call site resolves the hook at call time."""
    lane, sent = ManualLane(), []
    while not pb._audio_decoded_queue.empty():
        pb._audio_decoded_queue.get_nowait()
    with installed(), patched(
        pb,
        _enqueue_scheduler_task=lane.enqueue,
        _process_audio_batch=sent.extend,
        _emit_audio_queue_state=lambda *a, **k: None,
    ):
        pb._process_audio_input_frames([media(1), control("key")], time.monotonic())
        pb._drain_audio_executor_pass(10)
        assert len(lane.tasks) == 1
        lane.run_next()
        assert tags(sent) == ["c:key", "m:1"]


# --- inbound audio links ---------------------------------------------------


def test_inbound_call_control_is_told_from_voice():
    with installed():
        voice = qgau_wire(b"opus ciphertext")
        assert h._is_inbound_call_control(pb, voice) is False
        assert h._is_inbound_call_control(pb, qgau_wire(CONTROL_MAGIC + b'{"t":"GJ"}')) is True
        for wire in (
            {"t": pb._GROUP_AUDIO_HEARTBEAT_WIRE_TYPE, "c": "PING"},
            {"t": pb._GROUP_AUDIO_RTT_WIRE_TYPE, "c": pb._GROUP_AUDIO_RTT_PROBE_COMMAND},
            {
                "t": pb._GROUP_AUDIO_CONTROL_CAPABILITY_WIRE_TYPE,
                "c": pb._GROUP_AUDIO_CONTROL_CAPABILITY_HELLO,
            },
        ):
            assert h._is_inbound_call_control(pb, json.dumps(wire).encode()) is True
        assert h._is_inbound_call_control(pb, b"") is True


def test_inbound_call_control_overtakes_queued_voice():
    """Real workers: 200 voice frames at 30 ms each, then link control."""
    handled = []
    control_wire = qgau_wire(CONTROL_MAGIC + b'{"t":"GK"}')

    def callback(message, _packet):
        if message == control_wire:
            handled.append(("control", time.monotonic()))
            return
        time.sleep(0.03)
        handled.append(("voice", time.monotonic()))

    packet = types.SimpleNamespace(link=types.SimpleNamespace(link_id="x"))
    with installed(workers=True):
        for i in range(200):
            pb._dispatch_bounded_rns_packet_callback(
                "audio", LINK, callback, qgau_wire(b"voice %d" % i), packet
            )
        started = time.monotonic()
        pb._dispatch_bounded_rns_packet_callback("audio", LINK, callback, control_wire, packet)
        assert _wait_for(lambda: any(kind == "control" for kind, _at in handled))
        at = next(at for kind, at in handled if kind == "control")
        assert at - started < 0.2
        # The voice backlog is dropped as late instead of being played late.
        assert _wait_for(
            lambda: all(
                pb._scheduler_queues[lane].empty()
                for lane in pb._scheduler_queues
                if lane.startswith("rns-realtime-callback-")
            ),
            timeout=2,
        )
        voices = [at for kind, at in handled if kind == "voice"]
        assert 1 <= len(voices) <= 15, len(voices)
        assert h._call_priority_stats["rxMediaDropped"] >= 180


def test_inbound_voice_in_time_is_delivered_in_order():
    handled = []
    packet = types.SimpleNamespace(link=types.SimpleNamespace(link_id="x"))
    with installed(workers=True):
        before = h._call_priority_stats["rxMediaDropped"]
        wires = [qgau_wire(b"voice %d" % i) for i in range(40)]
        for wire in wires:
            pb._dispatch_bounded_rns_packet_callback(
                "audio", LINK, lambda m, _p: handled.append(m), wire, packet
            )
            time.sleep(0.002)
        assert _wait_for(lambda: len(handled) == 40)
        assert handled == wires
        assert h._call_priority_stats["rxMediaDropped"] == before


def test_dropped_voice_leaves_no_receive_probe_behind():
    packet = types.SimpleNamespace(link=None)
    called = []
    pb._audio_link_receive_probe_by_packet_id[id(packet)] = {"linkId": LINK}
    with installed():
        h._run_inbound_media(
            pb, time.monotonic() - 5, lambda *_a: called.append(1), b"", packet
        )
        assert called == []
        assert id(packet) not in pb._audio_link_receive_probe_by_packet_id


def test_other_packet_kinds_and_a_full_control_lane_use_the_bridge():
    calls = []
    packet = types.SimpleNamespace(link=types.SimpleNamespace(link_id="x"))
    original = pb._dispatch_bounded_rns_packet_callback
    with installed():
        with patched(
            pb,
            _enqueue_scheduler_task=lambda lane, *a, **k: calls.append(lane) or lane != "call-rx-control",
        ):
            for kind in ("overlay", "resource", "classify", "land-call"):
                pb._dispatch_bounded_rns_packet_callback(
                    kind, LINK, lambda *_a: None, b'{"x":1}', packet
                )
            assert not any(lane.startswith(("call-", "rns-realtime-")) for lane in calls), calls
            calls.clear()
            # No room on the control lane: the bridge's own lane takes it.
            pb._dispatch_bounded_rns_packet_callback(
                "audio", LINK, lambda *_a: None, b'{"t":"HB"}', packet
            )
            assert calls[0] == "call-rx-control"
            assert calls[1].startswith("rns-realtime-callback-")
    assert pb._dispatch_bounded_rns_packet_callback is original


def test_audio_link_handler_runs_from_the_control_lane():
    """The real _handle_audio_link_packet behind both lanes."""
    state = {
        "peerPresenceHash": PEER,
        "peerDestinationHash": DEST,
        "incoming": True,
        "generation": 1,
        "established": True,
    }
    chunks = []
    packet = types.SimpleNamespace(link=object(), packet_hash=b"\x01" * 32)
    with installed(workers=True), patched(
        pb,
        get_audio_link_id=lambda link: LINK,
        get_audio_link_state=lambda link_id: state,
        _link_manager_generation_current=lambda *a, **k: True,
        _resolve_sender_peer_destination_hash=lambda sender: PEER,
        _register_active_audio_for_peer=lambda *a, **k: None,
        _canonical_audio_link_id_for_peer=lambda peer: LINK,
        _emit_binary_audio=lambda chunk: chunks.append(chunk) or True,
    ):
        for payload in (b"voice", CONTROL_MAGIC + b'{"t":"GK"}'):
            pb._dispatch_bounded_rns_packet_callback(
                "audio", LINK, pb.on_audio_link_packet, qgau_wire(payload), packet
            )
        assert _wait_for(lambda: len(chunks) == 2)
        frames = [h._audio_chunk_frames(pb, chunk)[0][5] for chunk in chunks]
        assert sorted(frames) == sorted([b"voice", CONTROL_MAGIC + b'{"t":"GK"}'])


# --- inbound overlay links -------------------------------------------------


def test_call_signal_wires_are_recognised():
    with installed():
        for wire_type in sorted(h._CALL_WIRE_TYPES | pb._GROUP_CALL_WIRE_TYPES):
            # As the Hub encodes them (_call_wire_json_bytes), any key order.
            for wire in (
                {"t": wire_type, "i": "x", "r": DEST},
                {"X": "abc", "L": 3, "t": wire_type},
            ):
                assert h._is_call_signal_wire(pb, pb._call_wire_json_bytes(wire)) is True, wire
        for message in (
            pb._call_wire_json_bytes({"t": "RCHAT", "k": "group_sub", "x": '"t":"CR"'}),
            pb._call_wire_json_bytes({"t": "PRESENCE_HEARTBEAT", "r": DEST}),
            pb._call_wire_json_bytes({"type": "RESOURCE_SESSION_HELLO"}),
            pb._call_wire_json_bytes({"t": "CRX"}),
            b'{"t":"CR',
            b"{",
            b"",
            qgau_wire(b'{"t":"CR"}'),
        ):
            assert h._is_call_signal_wire(pb, message) is False, message


def test_call_wire_types_match_call_ts():
    """call.ts is the Hub's file: a new CALL_WIRE_* must be added here too."""
    path = os.path.join(HERE, *[".."] * 5, "electron", "src", "call.ts")
    with open(path, encoding="utf-8") as fh:
        source = fh.read()
    found = set(re.findall(r"^const CALL_WIRE_[A-Z_]+ = '([A-Z0-9]+)';", source, re.M))
    assert found and found == set(h._CALL_WIRE_TYPES), found


def test_inbound_ring_overtakes_overlay_gossip():
    """Real workers: 100 gossip packets at 30 ms each, then a ring."""
    handled = []
    ring = pb._call_wire_json_bytes({"t": "CR", "i": "call"})

    def callback(message, _packet):
        if message == ring:
            handled.append(("ring", time.monotonic()))
            return
        time.sleep(0.03)
        handled.append(("gossip", time.monotonic()))

    packet = types.SimpleNamespace(link=types.SimpleNamespace(link_id="x"))
    admitted = {"overlay_transport_admitted": True}
    with installed(workers=True), patched(pb, _overlay_links_by_id={LINK: admitted}):
        for i in range(100):
            pb._dispatch_bounded_rns_packet_callback(
                "overlay",
                LINK,
                callback,
                pb._call_wire_json_bytes({"t": "RCHAT", "k": "group_sub", "n": i}),
                packet,
            )
        started = time.monotonic()
        pb._dispatch_bounded_rns_packet_callback("overlay", LINK, callback, ring, packet)
        assert _wait_for(lambda: any(kind == "ring" for kind, _at in handled))
        at = next(at for kind, at in handled if kind == "ring")
        assert at - started < 0.3
        assert len(handled) < 20
        pb._rns_overlay_callback_pending_keys.clear()


def test_call_signals_before_admission_stay_in_order_with_the_handshake():
    lanes = []
    packet = types.SimpleNamespace(link=types.SimpleNamespace(link_id="x"))
    ring = pb._call_wire_json_bytes({"t": "CR"})
    for links in ({}, {LINK: {}}, {LINK: {"overlay_transport_admitted": False}}):
        with installed(), patched(
            pb,
            _overlay_links_by_id=links,
            _enqueue_scheduler_task=lambda lane, *a, **k: lanes.append(lane) or True,
        ):
            pb._dispatch_bounded_rns_packet_callback(
                "overlay", LINK, lambda *_a: None, ring, packet
            )
            pb._rns_overlay_callback_pending_keys.clear()
    assert len(lanes) == 3
    assert all(lane.startswith("rns-overlay-callback-") for lane in lanes), lanes


# --- background lanes while the hub reader is behind -----------------------


def test_background_lanes_take_turns_only_in_a_call_that_is_behind():
    """Real workers: how many background tasks run at once."""
    lock = threading.Lock()
    running, worst = [0], [0]

    def task():
        with lock:
            running[0] += 1
            worst[0] = max(worst[0], running[0])
        time.sleep(0.02)
        with lock:
            running[0] -= 1

    def burst():
        worst[0] = 0
        done = []
        for shard in range(4):
            for _ in range(4):
                pb._enqueue_scheduler_task(
                    f"rns-overlay-callback-{shard}", "t", lambda: (task(), done.append(1))
                )
        assert _wait_for(lambda: len(done) == 16, timeout=5)
        return worst[0]

    with installed(workers=True):
        with patched(pb, _audio_links_by_id={}), patched(
            h, _hub_reader_backlog_bytes=lambda: 500_000
        ):
            assert burst() >= 3, "no call: nothing changes"
        with patched(pb, _audio_links_by_id={LINK: {}}):
            with patched(h, _hub_reader_backlog_bytes=lambda: 2_000):
                assert burst() >= 3, "a reader that keeps up: nothing changes"
            h._call_reader_sampled_at = 0.0
            before = h._call_priority_stats["backgroundTurns"]
            with patched(h, _hub_reader_backlog_bytes=lambda: 500_000):
                assert burst() == 1, "behind: one background task at a time"
            assert h._call_priority_stats["backgroundTurns"] - before == 16
            assert h._call_priority_stats["readerBehindMaxBytes"] == 500_000


def test_call_lanes_never_wait_for_a_turn():
    with installed(workers=True), patched(pb, _audio_links_by_id={LINK: {}}), patched(
        h, _hub_reader_backlog_bytes=lambda: 500_000
    ):
        release = threading.Event()
        pb._enqueue_scheduler_task("control-send", "slow", release.wait, 5)
        time.sleep(0.05)
        done = []
        for lane in ("call-signal", "call-rx-control", "audio-send-0", "rns-realtime-callback-0"):
            pb._enqueue_scheduler_task(lane, "t", done.append, lane)
        assert _wait_for(lambda: len(done) == 4, timeout=0.2), done
        release.set()


def test_a_blocked_background_task_cannot_stop_the_others():
    """Also when it waits for one of them, which would be a deadlock."""
    with installed(workers=True), patched(pb, _audio_links_by_id={LINK: {}}), patched(
        h, _hub_reader_backlog_bytes=lambda: 500_000
    ):
        inner = threading.Event()
        outer = []

        def waits_for_the_other_lane():
            pb._enqueue_scheduler_task("rns-overlay-callback-1", "inner", inner.set)
            outer.append(inner.wait(5))

        started = time.monotonic()
        pb._enqueue_scheduler_task("control-send", "outer", waits_for_the_other_lane)
        assert _wait_for(lambda: outer == [True], timeout=3)
        assert time.monotonic() - started < 1
        # A task that raises gives its turn back.
        with patched(pb, emit_event=lambda *a, **k: None):
            for _ in range(3):
                pb._enqueue_scheduler_task("control-send", "bad", lambda: 1 / 0)
            assert _wait_for(lambda: pb._scheduler_queues["control-send"].empty())
        assert _wait_for(lambda: not h._call_background_turn.locked())


def test_background_tasks_keep_order_arguments_and_queue_bounds():
    order = []
    with installed(workers=True), patched(pb, _audio_links_by_id={LINK: {}}), patched(
        h, _hub_reader_backlog_bytes=lambda: 500_000
    ):
        for i in range(20):
            assert pb._enqueue_scheduler_task(
                "control-send", "t", lambda a, b=0: order.append((a, b)), i, b=i + 1
            )
        assert _wait_for(lambda: len(order) == 20, timeout=5)
        assert order == [(i, i + 1) for i in range(20)]
        release = threading.Event()
        pb._enqueue_scheduler_task("control-send", "slow", release.wait, 5)
        results = [
            pb._enqueue_scheduler_task("control-send", "t", order.append, i) for i in range(300)
        ]
        assert results.count(False) >= 43, "the lane still refuses past its bound"
        assert pb._enqueue_scheduler_task(
            "control-send", "t", order.append, "newest", drop_oldest=True
        )
        release.set()
        assert _wait_for(lambda: "newest" in order, timeout=8)


def test_threads_switch_sooner_only_while_the_reader_is_behind():
    backlog = [0]

    def ask():
        h._call_reader_sampled_at = 0.0
        h._run_background_task(pb, lambda: None)
        return sys.getswitchinterval()

    with installed():
        sys.setswitchinterval(0.002)
        links = {}
        with patched(pb, _audio_links_by_id=links), patched(
            h, _hub_reader_backlog_bytes=lambda: backlog[0], _CALL_READER_HOLD_SECONDS=0.02
        ):
            backlog[0] = 500_000
            assert abs(ask() - 0.002) < 1e-5, "no call"
            links[LINK] = {}
            backlog[0] = 0
            assert abs(ask() - 0.002) < 1e-5, "a reader that keeps up"
            backlog[0] = 500_000
            for _ in range(3):
                assert abs(ask() - 0.0005) < 1e-5
            backlog[0] = 0
            time.sleep(0.03)
            assert abs(ask() - 0.002) < 1e-5, "caught up"
            backlog[0] = 500_000
            assert abs(ask() - 0.0005) < 1e-5
            links.clear()
            assert abs(ask() - 0.002) < 1e-5, "the call is over"
            # Never slower than what the bridge chose.
            sys.setswitchinterval(0.0002)
            links[LINK] = {}
            assert abs(ask() - 0.0002) < 1e-5


def test_reader_backlog_is_the_worst_hub_socket():
    import socket

    left, right = socket.socketpair()
    gone = socket.socket()
    gone.close()
    interfaces = [
        types.SimpleNamespace(),
        types.SimpleNamespace(socket=None),
        types.SimpleNamespace(socket=gone),
        types.SimpleNamespace(socket=right),
    ]
    try:
        with patched(pb.RNS.Transport, interfaces=interfaces):
            assert h._hub_reader_backlog_bytes() == 0
            left.send(b"x" * 9000)
            assert h._hub_reader_backlog_bytes() == 9000
            right.recv(4000)
            assert h._hub_reader_backlog_bytes() == 5000
        with patched(pb.RNS.Transport, interfaces=None):
            assert h._hub_reader_backlog_bytes() == 0
    finally:
        left.close()
        right.close()


# --- safety ----------------------------------------------------------------


def test_hooks_stay_off_when_the_bridge_changed():
    changed = types.ModuleType("presence_bridge_changed")
    for name in h._CALL_PRIORITY_REQUIRED_ATTRS:
        setattr(changed, name, getattr(pb, name))
    assert h._call_priority_problems(changed) == []
    originals = {name: getattr(changed, name) for name in HOOKED}

    changed._enqueue_audio_send_batch = lambda route_key, batch, priority: True
    assert h._install_call_priority(changed) is False
    assert any(
        "_enqueue_audio_send_batch signature changed" in p
        for p in h._call_priority_problems(changed)
    )
    changed._enqueue_audio_send_batch = originals["_enqueue_audio_send_batch"]

    changed._filter_outbound_audio_deadline = lambda frames: (frames, 0)
    assert any("stale audio" in p for p in h._call_priority_problems(changed))
    changed._filter_outbound_audio_deadline = pb._filter_outbound_audio_deadline

    del changed._run_bounded_rns_packet_callback
    assert h._install_call_priority(changed) is False
    assert {name: getattr(changed, name) for name in HOOKED} == originals
    saved = h._call_priority_self_check
    try:
        assert h._run_call_priority_self_check(changed) is False
        assert h._call_priority_detail()["selfCheckOk"] is False
    finally:
        h._call_priority_self_check = saved


def test_bridge_detail_reports_call_priority():
    saved = sys.modules.get("presence_bridge")
    sys.modules["presence_bridge"] = pb
    try:
        detail = h._bridge_detail()
    finally:
        if saved is None:
            sys.modules.pop("presence_bridge", None)
        else:
            sys.modules["presence_bridge"] = saved
    assert {"txMediaSent", "txMediaDropped", "rxMediaDropped", "rxControl"} <= set(
        detail["callPriority"]
    )


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
