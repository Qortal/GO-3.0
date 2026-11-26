"""Checks for the pre-signed presence heartbeats in qortal_presence_host.py.

``schedule_presence_heartbeats`` keeps a phone visible while its page is
frozen off screen: each envelope is published at its own timestamp through
the normal ``publish_presence`` command, unless the page still sends live
heartbeats. Runs against a small stand-in for presence_bridge:

    python3 android/app/src/test/python/test_presence_host_scheduled_heartbeats.py

It also works under pytest.
"""

import json
import os
import sys
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

ADDRESS = "QgRU2U8Qf1AF72qxf7rFMpp63VYjv89BrC"


def _fake_bridge():
    pb = types.ModuleType("presence_bridge_heartbeat_stub")
    pb.handled = []
    pb.responses = []

    def handle_command(message):
        pb.handled.append(message)

    def emit_resp(req_id, ok, payload=None, error=None):
        pb.responses.append((req_id, ok, payload, error))

    pb.handle_command = handle_command
    pb.emit_resp = emit_resp
    return pb


class _FakeStdin:
    def __init__(self):
        self.lines = []

    def feed(self, line):
        self.lines.append(json.loads(line))


def _env(ts_ms, address=ADDRESS, kind="PRESENCE_HEARTBEAT", signature="sig"):
    return {
        "id": f"e{int(ts_ms)}",
        "type": kind,
        "senderAddress": address,
        "timestamp": ts_ms,
        "payload": {
            "address": address,
            "publicKey": "pk",
            "sessionId": "s",
            "status": "idle",
        },
        "signature": signature,
    }


def _host():
    import qortal_presence_host as h

    # Fresh module state for each test.
    h._replace_scheduled_heartbeats([])
    h._last_live_presence_publish_at = 0.0
    h._network_paused = False
    for key in h._scheduled_heartbeat_stats:
        h._scheduled_heartbeat_stats[key] = 0
    return h


def _wait_until(predicate, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


def test_validation():
    h = _host()
    now = 1_000_000.0
    ms = now * 1000
    items = h._validate_scheduled_heartbeats(
        [_env(ms + 50_000), _env(ms + 25_000), _env(ms - 60_000), _env(ms + 4 * 3600_000)],
        ADDRESS,
        now=now,
    )
    # Sorted; one too late and one too far ahead dropped.
    assert [round(t - now) for t, _ in items] == [25, 50], items
    for bad in (
        "nope",
        [_env(ms, kind="PRESENCE_ANNOUNCE")],
        [_env(ms, signature="")],
        [_env(ms), _env(ms + 1, address="QotherAddress")],
        [dict(_env(ms), timestamp="soon")],
        [_env(ms + i) for i in range(h._SCHEDULED_HEARTBEAT_MAX + 1)],
    ):
        try:
            h._validate_scheduled_heartbeats(bad, None, now=now)
        except ValueError:
            continue
        raise AssertionError(f"accepted bad input: {str(bad)[:80]}")
    try:
        h._validate_scheduled_heartbeats([_env(ms)], "QsomeoneElse", now=now)
    except ValueError:
        pass
    else:
        raise AssertionError("accepted another account's heartbeats")


def test_schedule_publish_and_cancel():
    h = _host()
    pb = _fake_bridge()
    stdin = _FakeStdin()
    h._stdin_shim = stdin
    h._install_scheduled_presence_heartbeats(pb)
    wrapped = pb.handle_command
    h._install_scheduled_presence_heartbeats(pb)
    assert pb.handle_command is wrapped, "installing twice must not double-wrap"

    now_ms = time.time() * 1000
    pb.handle_command(
        {
            "id": "s1",
            "action": "schedule_presence_heartbeats",
            "payload": {
                "address": ADDRESS,
                "envelopes": [_env(now_ms + 100), _env(now_ms + 60_000)],
            },
        }
    )
    assert pb.responses[-1][:2] == ("s1", True), pb.responses
    assert pb.responses[-1][2]["scheduled"] == 2
    # The first one is published at its time, as a normal publish_presence.
    assert _wait_until(lambda: len(stdin.lines) == 1), stdin.lines
    frame = stdin.lines[0]
    assert frame["action"] == "publish_presence"
    assert frame["id"].startswith(h._SCHEDULED_HEARTBEAT_ID_PREFIX)
    assert frame["payload"]["envelope"]["timestamp"] == now_ms + 100

    # The bridge answers our own publish: that answer is not for the page.
    pb.emit_resp(frame["id"], True, payload={"fanoutPeers": 3})
    assert all(r[0] != frame["id"] for r in pb.responses), pb.responses
    pb.emit_resp("page-1", True)
    assert pb.responses[-1][0] == "page-1"

    # Our own publish passes through to the bridge without counting as live.
    pb.handle_command(frame)
    assert pb.handled[-1] is frame
    assert h._last_live_presence_publish_at == 0.0

    pb.handle_command({"id": "c1", "action": "cancel_presence_heartbeats", "payload": {}})
    assert pb.responses[-1][:2] == ("c1", True)
    assert pb.responses[-1][2]["dropped"] == 1
    with h._scheduled_heartbeat_cond:
        assert h._scheduled_heartbeats == []


def test_live_heartbeats_win_and_offline_clears():
    h = _host()
    pb = _fake_bridge()
    stdin = _FakeStdin()
    h._stdin_shim = stdin
    h._install_scheduled_presence_heartbeats(pb)

    # The page is still alive and heartbeating: scheduled ones are skipped.
    pb.handle_command(
        {"id": "live", "action": "publish_presence", "payload": {"envelope": _env(time.time() * 1000)}}
    )
    assert h._last_live_presence_publish_at > 0
    now_ms = time.time() * 1000
    pb.handle_command(
        {
            "id": "s2",
            "action": "schedule_presence_heartbeats",
            "payload": {"address": ADDRESS, "envelopes": [_env(now_ms + 50)]},
        }
    )
    assert _wait_until(lambda: h._scheduled_heartbeat_stats["skippedLive"] == 1)
    assert stdin.lines == []

    # Sign-out (PRESENCE_OFFLINE) drops whatever is left.
    h._last_live_presence_publish_at = 0.0
    pb.handle_command(
        {
            "id": "s3",
            "action": "schedule_presence_heartbeats",
            "payload": {"address": ADDRESS, "envelopes": [_env(now_ms + 30_000)]},
        }
    )
    pb.handle_command(
        {
            "id": "off",
            "action": "publish_presence",
            "payload": {"envelope": _env(time.time() * 1000, kind="PRESENCE_OFFLINE")},
        }
    )
    with h._scheduled_heartbeat_cond:
        assert h._scheduled_heartbeats == []


def test_paused_network_skips():
    h = _host()
    pb = _fake_bridge()
    stdin = _FakeStdin()
    h._stdin_shim = stdin
    h._install_scheduled_presence_heartbeats(pb)
    h._network_paused = True
    try:
        now_ms = time.time() * 1000
        pb.handle_command(
            {
                "id": "s4",
                "action": "schedule_presence_heartbeats",
                "payload": {"address": ADDRESS, "envelopes": [_env(now_ms + 50)]},
            }
        )
        assert _wait_until(lambda: h._scheduled_heartbeat_stats["skippedPaused"] == 1)
        assert stdin.lines == []
    finally:
        h._network_paused = False


def test_cancel_without_id_is_silent():
    """Native code (page gone) sends the cancel with no id: no reply."""
    h = _host()
    pb = _fake_bridge()
    h._stdin_shim = _FakeStdin()
    h._install_scheduled_presence_heartbeats(pb)
    now_ms = time.time() * 1000
    h._replace_scheduled_heartbeats(
        h._validate_scheduled_heartbeats([_env(now_ms + 60_000)], ADDRESS)
    )
    before = len(pb.responses)
    pb.handle_command({"type": "cmd", "action": "cancel_presence_heartbeats", "payload": {}})
    assert len(pb.responses) == before, pb.responses
    with h._scheduled_heartbeat_cond:
        assert h._scheduled_heartbeats == []


def test_pause_network_drops_schedule():
    h = _host()
    now_ms = time.time() * 1000
    h._replace_scheduled_heartbeats(
        h._validate_scheduled_heartbeats([_env(now_ms + 60_000)], ADDRESS)
    )
    # pause_network() itself needs a running bridge; check the step it runs.
    started = h._started
    paused = h._network_paused
    try:
        h._started = True
        h._network_paused = False
        import types as _t

        fake_rns = _t.ModuleType("RNS")
        fake_rns.Transport = _t.SimpleNamespace(active_links=[], interfaces=[])
        fake_pb = _t.ModuleType("presence_bridge")
        fake_pb._rns_announce_on_auth_session_end = lambda: None
        saved = {k: sys.modules.get(k) for k in ("RNS", "presence_bridge")}
        sys.modules["RNS"] = fake_rns
        sys.modules["presence_bridge"] = fake_pb
        try:
            try:
                h.pause_network()
            except Exception:
                pass  # later steps need real RNS; the schedule step ran first
        finally:
            for k, v in saved.items():
                if v is None:
                    sys.modules.pop(k, None)
                else:
                    sys.modules[k] = v
        with h._scheduled_heartbeat_cond:
            assert h._scheduled_heartbeats == []
    finally:
        h._started = started
        h._network_paused = paused


def test_append_adds_only_new_envelopes():
    h = _host()
    pb = _fake_bridge()
    h._stdin_shim = _FakeStdin()
    h._install_scheduled_presence_heartbeats(pb)
    now_ms = time.time() * 1000
    first = [_env(now_ms + 60_000), _env(now_ms + 85_000)]
    pb.handle_command(
        {"id": "a1", "action": "schedule_presence_heartbeats", "payload": {"address": ADDRESS, "envelopes": first}}
    )
    more = [_env(now_ms + 85_000), _env(now_ms + 110_000)]
    pb.handle_command(
        {
            "id": "a2",
            "action": "schedule_presence_heartbeats",
            "payload": {"address": ADDRESS, "envelopes": more, "append": True},
        }
    )
    assert pb.responses[-1][:2] == ("a2", True), pb.responses
    assert pb.responses[-1][2]["scheduled"] == 3
    other = [_env(now_ms + 135_000, address="QsomeoneElseAddress")]
    pb.handle_command(
        {
            "id": "a3",
            "action": "schedule_presence_heartbeats",
            "payload": {"envelopes": other, "append": True},
        }
    )
    assert pb.responses[-1][:2] == ("a3", False), pb.responses
    with h._scheduled_heartbeat_cond:
        assert len(h._scheduled_heartbeats) == 3
    h._replace_scheduled_heartbeats([])


if __name__ == "__main__":
    test_validation()
    test_schedule_publish_and_cancel()
    test_live_heartbeats_win_and_offline_clears()
    test_paused_network_skips()
    test_cancel_without_id_is_silent()
    test_pause_network_drops_schedule()
    test_append_adds_only_new_envelopes()
    print("ok")
