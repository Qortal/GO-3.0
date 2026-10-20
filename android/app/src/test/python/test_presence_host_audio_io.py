"""Call audio-link I/O between GO's WebView and the presence bridge.

The desktop moves call audio-link frames (media and link control: link-auth
GC_JOIN, room keys, GO0/GO1 WebRTC fragments) through the FD3/FD4 pipes.
Embedded CPython has none, so qortal_presence_host.py carries them as JSON:
``group_audio_packet`` events out and ``send_group_audio`` commands in. GO
lost that path once when an upstream merge replaced presence_bridge.py; these
checks run the host against the REAL Android presence_bridge.py so the next
merge that renames a hooked function fails here:

    python3 -m pytest android/app/src/test/python/test_presence_host_audio_io.py -q
    python3 android/app/src/test/python/test_presence_host_audio_io.py
"""

import base64
import contextlib
import json
import os
import queue
import sys
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import presence_bridge as pb  # noqa: E402  (the real Android bridge)
import qortal_presence_host as h  # noqa: E402

ROOM = "dmv:0123456789abcdef01"
LINK = "f" * 32
PEER = "1" * 32
DEST = "2" * 32
MEDIA = bytes(range(24)) + b"opus-frame-ciphertext"
CONTROL = b"QGCCTL1\x00" + json.dumps({"t": "GK", "R": ROOM}).encode("utf-8")
PAYLOAD_KEYS = [
    "linkId",
    "roomId",
    "peerPresenceHash",
    "peerDestinationHash",
    "receivedAtWallMs",
    "data",
]


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
def real_bridge_module():
    """Other host tests park stubs in sys.modules; feed() must see the real one."""
    saved = sys.modules.get("presence_bridge")
    sys.modules["presence_bridge"] = pb
    try:
        yield
    finally:
        if saved is None:
            sys.modules.pop("presence_bridge", None)
        else:
            sys.modules["presence_bridge"] = saved


def _drain(q):
    out = []
    while True:
        try:
            out.append(q.get_nowait())
        except queue.Empty:
            return out


def _audio_events():
    frames = _drain(pb._json_priority_event_queue) + _drain(pb._json_event_queue)
    return [
        f
        for f in frames
        if isinstance(f, dict) and f.get("event") == "group_audio_packet"
    ]


def _qgau_wire(room_id, sender_hex, payload):
    room = room_id.encode("utf-8")
    sender = bytes.fromhex(sender_hex)
    return (
        pb._GROUP_AUDIO_BINARY_MAGIC
        + bytes((pb._GROUP_AUDIO_BINARY_VERSION, len(room), len(sender)))
        + len(payload).to_bytes(2, "big")
        + room
        + sender
        + payload
    )


def _command_line(action, payload, req_id="2f7c3a8e-3a2d-4a43-9d55-7b8c0d2e1f00"):
    # Same shape as ReticulumPlugin.presenceCommand (org.json, any key order).
    return json.dumps(
        {"payload": payload, "action": action, "type": "cmd", "id": req_id}
    )


def _send_payload(data, received_at=0, **extra):
    payload = {
        "linkId": LINK,
        "roomId": ROOM,
        "peerPresenceHash": PEER,
        "peerDestinationHash": DEST,
        "receivedAtWallMs": received_at,
        "data": base64.b64encode(data).decode("ascii"),
    }
    payload.update(extra)
    return payload


def test_qaud_batch_round_trip():
    frames = [
        (LINK, ROOM, PEER, DEST, 1_700_000_000_123, MEDIA),
        ("", ROOM, "", DEST, 0, CONTROL),
    ]
    chunk = pb._encode_audio_batch_binary(frames)
    assert chunk[:4] == pb.AUDIO_MAGIC
    assert h._audio_chunk_frames(pb, chunk) == frames
    for bad in (b"", b"QAUD", b"XXXX" + chunk[4:], chunk[:-1], chunk + b"\x00"):
        try:
            h._audio_chunk_frames(pb, bad)
        except ValueError:
            continue
        raise AssertionError(f"malformed batch accepted: {bad[:12]!r}")


def test_inbound_batch_becomes_group_audio_packet_events():
    h._install_json_audio_io(pb)
    hooked = pb._emit_binary_audio
    h._install_json_audio_io(pb)
    assert pb._emit_binary_audio is hooked, "installing twice must not double-wrap"
    _drain(pb._json_priority_event_queue)
    _drain(pb._json_event_queue)
    before = dict(h._json_audio_stats)

    chunk = pb._encode_audio_batch_binary(
        [(LINK, ROOM, PEER, DEST, 1_700_000_000_123, MEDIA)]
    )
    assert pb._emit_binary_audio(chunk) is True
    chunk = pb._encode_audio_batch_binary([(LINK, ROOM, PEER, DEST, 77, CONTROL)])
    assert pb._emit_binary_audio(chunk) is True
    assert pb._emit_binary_audio(b"not a batch") is False

    events = _audio_events()
    assert len(events) == 2, events
    for event in events:
        # Kotlin reads the event name off this exact prefix without parsing.
        line = json.dumps(event, separators=(",", ":"))
        assert line.startswith('{"type":"event","event":"group_audio_packet"'), line
        assert list(event["payload"]) == PAYLOAD_KEYS, event["payload"]
    media, control = (e["payload"] for e in events)
    assert media == {
        "linkId": LINK,
        "roomId": ROOM,
        "peerPresenceHash": PEER,
        "peerDestinationHash": DEST,
        "receivedAtWallMs": 1_700_000_000_123,
        "data": base64.b64encode(MEDIA).decode("ascii"),
    }
    assert base64.b64decode(control["data"]) == CONTROL
    assert control["receivedAtWallMs"] == 77
    stats = h._json_audio_stats
    assert stats["rxFrames"] - before["rxFrames"] == 2
    assert stats["rxControl"] - before["rxControl"] == 1
    assert stats["rxBadBatch"] - before["rxBadBatch"] == 1


def test_full_priority_queue_drops_media_but_keeps_control():
    h._install_json_audio_io(pb)
    full = queue.Queue(maxsize=1)
    full.put_nowait({"event": "filler"})
    spill = queue.Queue(maxsize=8)
    with patched(pb, _json_priority_event_queue=full, _json_event_queue=spill):
        media = pb._encode_audio_batch_binary([(LINK, ROOM, PEER, DEST, 1, MEDIA)])
        control = pb._encode_audio_batch_binary([(LINK, ROOM, PEER, DEST, 0, CONTROL)])
        assert pb._emit_binary_audio(media) is False
        assert pb._emit_binary_audio(control) is True
        spilled = _drain(spill)
    assert [base64.b64decode(f["payload"]["data"]) for f in spilled] == [CONTROL]


def test_media_flood_leaves_room_for_link_lifecycle_events():
    """A reader backlog during a call must not cost link established/closed."""
    h._install_json_audio_io(pb)
    priority = queue.Queue(maxsize=16)  # the bridge's is 512
    ordinary = queue.Queue(maxsize=64)
    before = dict(h._json_audio_stats)
    with patched(pb, _json_priority_event_queue=priority, _json_event_queue=ordinary):
        media = pb._encode_audio_batch_binary([(LINK, ROOM, PEER, DEST, 1, MEDIA)])
        control = pb._encode_audio_batch_binary([(LINK, ROOM, PEER, DEST, 0, CONTROL)])
        results = [pb._emit_binary_audio(media) for _ in range(30)]
        assert results.count(True) == 8, results  # half of the queue
        assert all(pb._emit_binary_audio(control) for _ in range(8))
        # The bridge's own non-coalescible lifecycle events still fit.
        pb.emit_event("group_audio_link_closed", {"linkId": LINK, "reason": "x"})
        pb.emit_event("group_audio_link_established", {"linkId": "e" * 32})
        queued = _drain(priority)
        spilled = _drain(ordinary)
    names = [f.get("event") for f in queued]
    assert names[-2:] == ["group_audio_link_closed", "group_audio_link_established"], names
    assert names.count("group_audio_packet") == 14, names  # 8 media + 6 control
    # Control past its share went to the ordinary queue, never dropped.
    assert [base64.b64decode(f["payload"]["data"]) for f in spilled] == [CONTROL] * 2
    stats = h._json_audio_stats
    assert stats["rxMediaShed"] - before["rxMediaShed"] == 22


def test_hub_packet_path_reaches_the_webview():
    """The bridge's own inbound call site resolves the hook at call time."""
    h._install_json_audio_io(pb)
    _drain(pb._json_priority_event_queue)
    _drain(pb._json_event_queue)
    pb._handle_hub_packet_received(_qgau_wire(ROOM, DEST, CONTROL), None)
    events = _audio_events()
    assert len(events) == 1, events
    payload = events[0]["payload"]
    assert payload["roomId"] == ROOM
    assert payload["linkId"] == ""
    assert payload["peerDestinationHash"] == DEST
    assert base64.b64decode(payload["data"]) == CONTROL


def test_audio_link_path_reaches_the_webview():
    """Link-delivered frames (the DM call path) take the same hook."""
    h._install_json_audio_io(pb)
    _drain(pb._json_priority_event_queue)
    _drain(pb._json_event_queue)
    state = {
        "peerPresenceHash": PEER,
        "peerDestinationHash": DEST,
        "incoming": True,
        "generation": 1,
        "established": True,
    }
    packet = types.SimpleNamespace(link=object(), packet_hash=b"\x01" * 32)
    with patched(
        pb,
        get_audio_link_id=lambda link: LINK,
        get_audio_link_state=lambda link_id: state,
        _link_manager_generation_current=lambda *a, **k: True,
        _resolve_sender_peer_destination_hash=lambda sender: PEER,
        _register_active_audio_for_peer=lambda *a, **k: None,
        _canonical_audio_link_id_for_peer=lambda peer: LINK,
    ):
        pb._handle_audio_link_packet(_qgau_wire(ROOM, DEST, MEDIA), packet)
    events = _audio_events()
    assert len(events) == 1, events
    payload = events[0]["payload"]
    assert payload["linkId"] == LINK
    assert payload["roomId"] == ROOM
    assert payload["peerPresenceHash"] == PEER
    assert payload["peerDestinationHash"] == DEST
    assert base64.b64decode(payload["data"]) == MEDIA


def test_send_group_audio_skips_the_stdin_queue():
    calls = []
    responses = []
    shim = h._StdinShim()

    def record(frames, queued_at):
        calls.append((list(frames), queued_at))
        return True

    with real_bridge_module(), patched(h, _stdin_shim=shim), patched(
        pb,
        _process_audio_input_frames=record,
        emit_resp=lambda *a, **k: responses.append((a, k)),
    ):
        h.feed(_command_line("send_group_audio", _send_payload(CONTROL)))
        assert len(calls) == 1, calls
        frames, queued_at = calls[0]
        assert frames == [(LINK, ROOM, PEER, DEST, 0, CONTROL)]
        assert abs(queued_at - time.monotonic()) < 5
        assert shim._q.qsize() == 0, "send_group_audio must not queue behind chat"
        assert responses == [], "Kotlin's own ids get no resp per voice frame"

        # A caller that waits for the answer (presenceCommandWithResult) gets one.
        h.feed(_command_line("send_group_audio", _send_payload(MEDIA, 5), "cmd-x1"))
        assert calls[-1][0] == [(LINK, ROOM, PEER, DEST, 5, MEDIA)]
        assert responses[-1][0][:2] == ("cmd-x1", True), responses

        # Look-alike actions still reach the bridge's dispatcher.
        for action in (
            "send_group_audio_link_control",
            "send_group_audio_link_heartbeat",
            "open_group_audio_link",
        ):
            h.feed(_command_line(action, {"roomId": ROOM}))
        # A chat message whose text names the action is not a command.
        h.feed(
            _command_line(
                "send_reticulum_chat",
                {"text": 'try "send_group_audio" here'},
            )
        )
        assert shim._q.qsize() == 4
        assert len(calls) == 2


def test_send_group_audio_rejects_bad_frames():
    calls = []
    responses = []
    shim = h._StdinShim()
    with real_bridge_module(), patched(h, _stdin_shim=shim), patched(
        pb,
        _process_audio_input_frames=lambda frames, at: calls.append(frames) or True,
        emit_resp=lambda *a, **k: responses.append((a, k)),
    ):
        bad = [
            {"roomId": ROOM, "linkId": LINK},  # no data
            _send_payload(MEDIA, roomId=""),
            _send_payload(MEDIA, linkId="", peerPresenceHash="", peerDestinationHash=""),
            _send_payload(MEDIA, linkId="x" * (pb.AUDIO_MAX_LINK_ID_LEN + 1)),
            _send_payload(b"\x00" * (pb.AUDIO_MAX_PAYLOAD + 1)),
            dict(_send_payload(MEDIA), data="%%% not base64 %%%"),
        ]
        for i, payload in enumerate(bad):
            h.feed(_command_line("send_group_audio", payload, f"cmd-bad{i}"))
        assert calls == []
        assert shim._q.qsize() == 0
        assert len(responses) == len(bad)
        assert all(r[0][1] is False for r in responses), responses


def test_received_at_zero_bypasses_the_live_deadline():
    """Real _process_audio_input_frames: control frames carry receivedAtWallMs 0."""
    _drain(pb._audio_decoded_queue)
    now_ms = int(time.time() * 1000)
    stale = (LINK, ROOM, PEER, DEST, now_ms - 5_000, MEDIA)
    fresh = (LINK, ROOM, PEER, DEST, now_ms, MEDIA)
    control = (LINK, ROOM, PEER, DEST, 0, CONTROL)
    try:
        assert pb._process_audio_input_frames([stale], time.monotonic()) is False
        assert pb._audio_decoded_queue.qsize() == 0
        assert pb._process_audio_input_frames([control], time.monotonic()) is True
        assert pb._process_audio_input_frames([fresh], time.monotonic()) is True
        queued = [batch for _at, batch in _drain(pb._audio_decoded_queue)]
        assert queued == [[control], [fresh]], queued
        # The RNS executor filters again when it drains; 0 still passes there.
        kept, dropped = pb._filter_outbound_audio_deadline(
            [control, stale], now_ms + 60_000
        )
        assert kept == [control] and dropped == 1
    finally:
        _drain(pb._audio_decoded_queue)


def test_self_check_reports_a_bridge_that_lost_the_hooks():
    h._install_json_audio_io(pb)
    assert h._json_audio_io_problems(pb) == []
    assert h._run_json_audio_self_check(pb) is True
    assert h._json_audio_detail()["selfCheckOk"] is True

    unhooked = getattr(pb._emit_binary_audio, "__wrapped__", None)
    with patched(pb, _emit_binary_audio=unhooked):
        problems = h._json_audio_io_problems(pb)
    assert any("_emit_binary_audio" in p for p in problems), problems

    renamed = types.ModuleType("presence_bridge_renamed")
    for name in h._JSON_AUDIO_REQUIRED_ATTRS:
        if name != "_process_audio_input_frames":
            setattr(renamed, name, getattr(pb, name))
    h._install_json_audio_io(renamed)
    problems = h._json_audio_io_problems(renamed)
    assert problems == ["presence_bridge._process_audio_input_frames missing"], problems
    # Restore the module-level verdict for anything that runs after this.
    h._run_json_audio_self_check(pb)


def test_heartbeat_pongs_skip_the_chat_lane():
    before = pb._scheduler_lane_for_command
    h._install_call_heartbeat_lane(pb)
    hooked = pb._scheduler_lane_for_command
    h._install_call_heartbeat_lane(pb)
    assert pb._scheduler_lane_for_command is hooked, "must not double-wrap"
    try:
        assert hooked("send_group_audio_link_heartbeat", {}) == "audio-control"
        assert "audio-control" in pb._SCHEDULER_QUEUE_MAX_BY_LANE
        # Everything else keeps the bridge's own lane.
        assert hooked("send_reticulum_chat", {"payload": {}}) == "control-send"
        assert hooked("open_group_audio_link", {}) == "audio-control"
        assert hooked("send_group_audio_link_control", {"payload": {}}).startswith(
            "gcall-control-command-"
        )
    finally:
        pb._scheduler_lane_for_command = getattr(hooked, "__wrapped__", before)


def test_feed_without_a_loaded_bridge_leaves_the_line_alone():
    shim = h._StdinShim()
    saved = sys.modules.pop("presence_bridge", None)
    try:
        with patched(h, _stdin_shim=shim):
            h.feed(_command_line("send_group_audio", _send_payload(MEDIA)))
        assert shim._q.qsize() == 1
    finally:
        if saved is not None:
            sys.modules["presence_bridge"] = saved


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
