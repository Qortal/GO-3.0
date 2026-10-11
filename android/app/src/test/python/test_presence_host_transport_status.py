"""Checks for transport_status(detail) in qortal_presence_host.py.

Copy diagnostics asks for the bridge's lane and queue counters through the
same direct Chaquopy call the status badge polls (no lane command). This runs
it against small stand-ins for presence_bridge and RNS:

    python3 android/app/src/test/python/test_presence_host_transport_status.py

It also works under pytest.
"""

import json
import os
import queue
import sys
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

_MISSING = object()


def _fake_rns():
    rns = types.ModuleType("RNS")
    rns.Transport = types.SimpleNamespace(
        interfaces=[], path_table={}, start_time=1_700_000_000.0
    )
    return rns


def _fake_bridge(scheduler_diagnostics=None):
    pb = types.ModuleType("presence_bridge")
    started = time.monotonic() - 4.1

    def default_diagnostics():
        return [
            {
                "lane": "control-send",
                "queueDepth": 12,
                "queueDepthHighWater": 256,
                "queueMax": 256,
                "dwellMsMax": 31000.0,
                "busyMsMax": 1200.0,
                "droppedTasks": 0,
                "slowTaskCount": 3,
                "completedTasks": 900,
                "enqueuedTasks": 912,
                "lastTask": "cmd:publish_presence",
                "logicalLane": "control-send",
                "currentTask": "cmd:send_reticulum_chat",
                "currentTaskStartedAt": started,
            },
            {
                "lane": "overlay-control",
                "queueDepth": 0,
                "queueDepthHighWater": 3,
                "queueMax": 128,
                "dwellMsMax": 12.5,
                "busyMsMax": 40.0,
                "droppedTasks": 0,
                "slowTaskCount": 0,
                "completedTasks": 50,
                "currentTask": "",
                "currentTaskStartedAt": 0.0,
            },
        ]

    pb._scheduler_diagnostics = scheduler_diagnostics or default_diagnostics
    pb._cmd_queue_bounded = queue.Queue()
    pb._cmd_queue_bounded.put({"action": "a"})
    pb._cmd_queue_bounded.put({"action": "b"})
    pb._CMD_QUEUE_MAX = 256
    pb._json_event_queue = queue.Queue()
    pb._json_priority_event_queue = queue.Queue()
    pb._json_priority_event_queue.put({"event": "x"})
    pb._json_resp_queue = queue.Queue()
    pb._rns_executor_last_loop_at = time.monotonic() - 0.5
    pb._gil_probe_lag_ms_max = 75.0
    pb._resource_session_provider_waiters = {"a": 1}
    pb._provider_refused_counts = {"dm": 0, "history": 12, "other": 0}
    pb._audio_drops_json_out = 4
    return pb


class _Modules:
    """Swap sys.modules entries for one check and put them back after."""

    def __init__(self, **entries):
        self.entries = entries
        self.saved = {}

    def __enter__(self):
        for name, module in self.entries.items():
            self.saved[name] = sys.modules.get(name, _MISSING)
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
        return self

    def __exit__(self, *exc):
        for name, module in self.saved.items():
            if module is _MISSING:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
        return False


def _host():
    import qortal_presence_host as h

    return h


def _with_started(h, fn):
    was = h._started
    h._started = True
    try:
        return fn()
    finally:
        h._started = was


def test_detail_reads_lanes_queues_and_transport_start():
    h = _host()
    with _Modules(presence_bridge=_fake_bridge(), RNS=_fake_rns()):
        status = json.loads(_with_started(h, lambda: h.transport_status(True)))
    bridge = status["bridge"]
    assert bridge["transportStartedAtMs"] == 1_700_000_000_000, bridge
    lane = bridge["lanes"][0]
    assert lane["lane"] == "control-send"
    assert lane["queueDepth"] == 12 and lane["queueDepthHighWater"] == 256
    assert lane["queueMax"] == 256 and lane["dwellMsMax"] == 31000.0
    assert lane["busyMsMax"] == 1200.0 and lane["slowTaskCount"] == 3
    assert lane["droppedTasks"] == 0 and lane["completedTasks"] == 900
    assert lane["currentTask"] == "cmd:send_reticulum_chat", lane
    assert 4000 <= lane["runningMs"] <= 5500, lane
    # Only the listed counters; internal fields stay behind.
    assert "lastTask" not in lane and "enqueuedTasks" not in lane
    assert "currentTaskStartedAt" not in lane and "logicalLane" not in lane
    quiet = bridge["lanes"][1]
    assert "currentTask" not in quiet and "runningMs" not in quiet, quiet
    assert bridge["cmdQueue"] == 2 and bridge["cmdQueueMax"] == 256
    assert bridge["eventQueue"] == 0 and bridge["priorityEventQueue"] == 1
    assert bridge["respQueue"] == 0
    assert 400 <= bridge["executorIdleMs"] <= 2000, bridge
    assert bridge["gilLagMsMax"] == 75.0
    assert bridge["providerPendingAuth"] == 1
    assert bridge["providerRefused"] == {"dm": 0, "history": 12, "other": 0}
    assert bridge["jsonOutDrops"] == 4
    # The badge fields are still there.
    assert status["started"] is True and status["interfaces"] == 0
    assert "error" not in status, status


def test_without_detail_the_badge_snapshot_is_unchanged():
    h = _host()
    with _Modules(presence_bridge=_fake_bridge(), RNS=_fake_rns()):
        plain = json.loads(_with_started(h, h.transport_status))
        explicit = json.loads(_with_started(h, lambda: h.transport_status(False)))
    assert "bridge" not in plain, plain
    assert "bridge" not in explicit, explicit
    assert set(plain) == set(explicit)


def test_scheduler_failure_reports_an_error_only():
    h = _host()

    def boom():
        raise RuntimeError("scheduler stats unavailable " + "x" * 400)

    with _Modules(presence_bridge=_fake_bridge(boom), RNS=_fake_rns()):
        status = json.loads(_with_started(h, lambda: h.transport_status(True)))
    assert set(status["bridge"]) == {"error"}, status["bridge"]
    assert status["bridge"]["error"].startswith("scheduler stats unavailable")
    assert len(status["bridge"]["error"]) <= 160


def test_bridge_not_imported_gives_transport_start_only():
    h = _host()
    with _Modules(presence_bridge=None, RNS=_fake_rns()):
        status = json.loads(_with_started(h, lambda: h.transport_status(True)))
    assert status["bridge"] == {"transportStartedAtMs": 1_700_000_000_000}


def test_not_started_returns_early_without_bridge():
    h = _host()
    was = h._started
    h._started = False
    try:
        with _Modules(presence_bridge=_fake_bridge(), RNS=_fake_rns()):
            status = json.loads(h.transport_status(True))
    finally:
        h._started = was
    assert status["started"] is False
    assert "bridge" not in status


def test_task_labels_drop_ids():
    h = _host()
    assert h._task_label("cmd:send_reticulum_chat") == "cmd:send_reticulum_chat"
    assert h._task_label("overlay-open:announce:1a2b3c4d") == "overlay-open:announce"
    assert h._task_label("rns-packet:data:0f1e2d3c4b5a6978") == "rns-packet:data"
    assert h._task_label("presence:4f3a2b1c9d8e:deadbeef") == "presence"
    assert h._task_label("audio-send:9a8b7c6d5e4f") == "audio-send"
    assert h._task_label("presence_announce_replay:unknown:abcdef12") == (
        "presence_announce_replay:unknown"
    )
    # A pure-letter hex id is still an id.
    assert h._task_label("overlay-dedup-close:deadbeef") == "overlay-dedup-close"
    assert h._task_label("land-state-forward-3") == "land-state-forward-3"
    assert h._task_label("periodic-announce") == "periodic-announce"
    # A kind that is not a plain name is not shown.
    assert h._task_label("1a2b3c4d5e6f") == "task"
    assert h._task_label("1a2b3c4d5e6f:cmd") == "task:cmd"
    assert h._task_label("") == "task"
    assert len(h._task_label("cmd:" + "a" * 60)) <= 48


if __name__ == "__main__":
    test_detail_reads_lanes_queues_and_transport_start()
    test_without_detail_the_badge_snapshot_is_unchanged()
    test_scheduler_failure_reports_an_error_only()
    test_bridge_not_imported_gives_transport_start_only()
    test_not_started_returns_early_without_bridge()
    test_task_labels_drop_ids()
    print("ok")
