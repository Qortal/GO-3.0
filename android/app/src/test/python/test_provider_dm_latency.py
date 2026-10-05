"""Provider DM page latency: admission, capacity, stamps and diagnostics.

Drives the real Android presence_bridge.py provider path (the Resource
response generator, the authorize/reject handlers and the response watcher)
against fake Links and Resources, without Chaquopy, RNS daemons or a
network:

    python3 android/app/src/test/python/test_provider_dm_latency.py

It also works under pytest. The module is loaded once and its globals are
shared, so the checks run in one ordered function.
"""

import contextlib
import inspect
import io
import os
import queue
import socket
import sys
import tempfile
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import presence_bridge as pb  # noqa: E402
import RNS  # noqa: E402

CHAT_RT = pb._RETICULUM_CHAT_RESOURCE_TYPE
DM = "reticulum_chat_dm_page"
HISTORY = "reticulum_chat_history_page"
LIVE = "reticulum_chat_live_event"
METADATA = "reticulum_chat_metadata_snapshot"
RANGE = "reticulum_resource_range"

events = []
responses = []
logs = []
LINKS = {}
_counter = [0]
_tempfiles = []


def _peer(n):
    return f"{n:032x}"


class FakeLink:
    def __init__(self):
        self.outgoing_resources = []
        self.rtt = 0.123
        self.teardown_reason = None


class FakeResource:
    def __init__(self, request_id):
        self.request_id = request_id
        self.status = None
        self.progress = 0.0
        self.segment_index = 1
        self.total_segments = 1
        self.cancelled = False

    def get_progress(self):
        return self.progress

    def cancel(self):
        self.cancelled = True


class Req:
    def __init__(self, tid, link_id, state, request_id, logical, rt):
        self.tid = tid
        self.link_id = link_id
        self.state = state
        self.request_id = request_id
        self.logical = logical
        self.rt = rt
        self.out = {}
        self.thread = None

    @property
    def result(self):
        return self.out.get("r")


def _install():
    pb.emit_resp = lambda req_id, ok, payload=None, error=None: responses.append(
        (req_id, ok, payload, error)
    )
    pb._qchat_file_emit = lambda status, payload: events.append(
        (status, dict(payload))
    )
    pb.log = lambda message: logs.append(message)
    pb._resource_session_trace_log = lambda *a, **k: None
    pb._resource_session_schedule_idle_close = lambda *a, **k: None
    pb._resource_session_cancel_timer = lambda *a, **k: None
    pb._resource_session_fail_state = lambda *a, **k: None
    pb._destination_hash_for_identity = lambda identity: identity
    pb._resource_session_state_for_rns_link_id = lambda rid: LINKS.get(rid)


def _wait_for(condition, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if condition():
            return True
        time.sleep(0.01)
    return condition()


def _auth_event(tid):
    for status, payload in events:
        if status == "auth" and payload.get("transferId") == tid:
            return payload
    return None


def _events_for(tid, status):
    return [p for s, p in events if s == status and p.get("transferId") == tid]


def start(peer, logical, rt=CHAT_RT, requested_at="now"):
    _counter[0] += 1
    tid = f"t{_counter[0]:05d}"
    link_id = f"link-{tid}"
    link = FakeLink()
    state = {
        "linkId": link_id,
        "incoming": True,
        "closing": False,
        "provider_ready_sent": True,
        "manager_kind": "resource_session",
        "peerPresenceHash": peer,
        "link": link,
        "sessionLane": pb._resource_session_lane(rt, logical),
    }
    pb._qchat_file_links_by_id[link_id] = state
    pb._qchat_file_link_ids_by_object[id(link)] = link_id
    LINKS[link_id.encode()] = state
    request_id = f"req-{tid}".encode()
    req = Req(tid, link_id, state, request_id, logical, rt)
    request = {
        "version": 1,
        "transferId": tid,
        "authMessage": {"type": "TEST_AUTH", "transferId": tid},
        "metadata": {"logicalResourceType": logical, "resourceType": rt},
        "resourceType": rt,
    }
    stamp = time.time() - 0.25 if requested_at == "now" else requested_at

    def run():
        req.out["r"] = pb._resource_session_response_generator(
            None, request, request_id, link_id.encode(), peer, stamp
        )

    req.thread = threading.Thread(target=run, daemon=True)
    req.thread.start()
    assert _wait_for(lambda: "r" in req.out or _auth_event(tid) is not None)
    return req


def pending(req):
    return "r" not in req.out and _auth_event(req.tid) is not None


def refused(req, reason="resource_provider_busy"):
    req.thread.join(2)
    return isinstance(req.result, dict) and req.result.get("reason") == reason


def reject(req):
    pb.handle_reject_qchat_file_resource(
        "rj-" + req.tid,
        {"linkId": req.link_id, "transferId": req.tid, "reason": "test_reject"},
    )
    req.thread.join(2)
    assert not req.thread.is_alive()


def register(req):
    f = tempfile.NamedTemporaryFile(delete=False, suffix=".page.json")
    f.write(b'{"v":1}')
    f.close()
    _tempfiles.append(f.name)
    pb.handle_send_qchat_file_resource(
        "reg-" + req.tid,
        {
            "transferId": req.tid,
            "allowedRecipientAddress": req.state["peerPresenceHash"],
            "filePath": f.name,
            "resourceType": req.rt,
            "metadata": {"logicalResourceType": req.logical},
            "expiresAt": (time.time() + 600) * 1000,
        },
    )


def authorize(req):
    pb.handle_authorize_qchat_file_resource(
        "az-" + req.tid, {"linkId": req.link_id, "transferId": req.tid}
    )
    req.thread.join(3)
    assert not req.thread.is_alive()


def counters_zero():
    return (
        not pb._resource_session_provider_waiters
        and not pb._resource_session_provider_pending_auth_by_peer
        and pb._resource_session_provider_pending_auth_dm_total == 0
        and not pb._resource_session_provider_pending_auth_dm_by_peer
        and pb._resource_session_provider_history_pending_total == 0
        and not pb._resource_session_provider_history_pending_by_peer
        and pb._resource_session_provider_history_active == 0
        and all(v == 0 for v in pb._resource_session_provider_active_by_class.values())
        and not pb._resource_session_provider_active_by_peer
        and not pb._resource_session_provider_active_attachments_by_peer
        and not pb._resource_session_provider_capacity_queue
        and all(v == 0 for v in pb._resource_session_provider_capacity_waiters.values())
        and not pb._resource_session_provider_capacity_waiters_by_peer
        and not pb._resource_session_provider_inflight_transfers
    )


def assert_counters_zero(label):
    assert _wait_for(counters_zero), (
        label,
        dict(
            waiters=len(pb._resource_session_provider_waiters),
            by_peer=dict(pb._resource_session_provider_pending_auth_by_peer),
            dm=pb._resource_session_provider_pending_auth_dm_total,
            dm_by_peer=dict(pb._resource_session_provider_pending_auth_dm_by_peer),
            hist=pb._resource_session_provider_history_pending_total,
            hist_by_peer=dict(pb._resource_session_provider_history_pending_by_peer),
            hist_active=pb._resource_session_provider_history_active,
            active=dict(pb._resource_session_provider_active_by_class),
            active_by_peer=dict(pb._resource_session_provider_active_by_peer),
            queue=len(pb._resource_session_provider_capacity_queue),
            inflight=set(pb._resource_session_provider_inflight_transfers),
        ),
    )


def reset_links():
    pb._qchat_file_links_by_id.clear()
    pb._qchat_file_link_ids_by_object.clear()
    pb._qchat_file_pending_sends_by_transfer.clear()
    pb._resource_session_provider_recent_cancellations.clear()
    LINKS.clear()


# ── 1. auth payload stamps ────────────────────────────────────────────────
def check_auth_stamps():
    peer = _peer(1)
    req = start(peer, DM)
    assert pending(req)
    auth = _auth_event(req.tid)
    for key in (
        "arrivedAtMs",
        "requestedAtMs",
        "linkRttMs",
        "slotWaitMs",
        "pendingAuthTotal",
        "pendingAuthPeer",
        "authStartedAtMs",
    ):
        assert isinstance(auth.get(key), int), (key, auth)
    assert auth["linkRttMs"] == 123
    assert auth["pendingAuthTotal"] == 1 and auth["pendingAuthPeer"] == 1
    assert auth["arrivedAtMs"] <= auth["authStartedAtMs"]
    # The requester's stamp is 250 ms before arrival here.
    assert 200 <= auth["arrivedAtMs"] - auth["requestedAtMs"] <= 2000
    waiter = next(iter(pb._resource_session_provider_waiters.values()))
    assert waiter["arrivedAtMs"] == auth["arrivedAtMs"]
    assert waiter["requestedAtMs"] == auth["requestedAtMs"]
    assert waiter["authStartedAtMs"] == auth["authStartedAtMs"]
    # The wire-visible fields are unchanged.
    assert auth["metadata"]["logicalResourceType"] == DM
    reject(req)

    for bad in (None, "soon", float("nan"), float("inf"), True, time.time() + 2 * 86400):
        req = start(peer, HISTORY, requested_at=bad)
        assert pending(req), bad
        auth = _auth_event(req.tid)
        assert "requestedAtMs" not in auth, (bad, auth)
        assert isinstance(auth["arrivedAtMs"], int)
        reject(req)
    req = start(peer, HISTORY)
    req.state["link"].rtt = None
    reject(req)
    assert_counters_zero("auth stamps")


# ── 2. pending-auth reservation for DM pages ─────────────────────────────
def check_reservation():
    peer = _peer(2)
    non_dm = [start(peer, METADATA) for _ in range(3)] + [
        start(peer, LIVE) for _ in range(3)
    ]
    assert all(pending(r) for r in non_dm)
    stderr = io.StringIO()
    with contextlib.redirect_stderr(stderr):
        seventh_history = start(peer, HISTORY)
        seventh_live = start(peer, LIVE)
        dm_a = start(peer, DM)
        dm_b = start(peer, DM)
        dm_c = start(peer, DM)
    assert refused(seventh_history) and refused(seventh_live)
    assert pending(dm_a) and pending(dm_b)
    assert pb._resource_session_provider_pending_auth_dm_total == 2
    assert pb._resource_session_provider_pending_auth_dm_by_peer[peer] == 2
    # The absolute 8-per-peer cap still holds for DM pages.
    assert refused(dm_c)
    lines = [l for l in stderr.getvalue().splitlines() if "resource_dm_page_provider_refused" in l]
    assert len(lines) == 1, stderr.getvalue()
    assert f"transfer={dm_c.tid}" in lines[0]
    assert "reason=resource_provider_busy busy_kind=pending_peer" in lines[0]
    assert "pending_total=8 pending_peer=8" in lines[0]
    assert "req_lag_ms=" in lines[0] and "slot_ms=" in lines[0]
    assert pb._provider_refused_counts["dm"] >= 1
    assert pb._provider_refused_counts["history"] >= 1
    assert pb._provider_refused_counts["other"] >= 1
    for r in non_dm + [dm_a, dm_b]:
        reject(r)
    assert_counters_zero("reservation per peer")
    reset_links()

    # 32 non-DM pending globally (at most 5 per peer): non-DM stops, DM
    # pages still get the 8 reserved slots, and the absolute 40 holds.
    non_dm = []
    for n in range(7):
        for _ in range(5 if n < 6 else 2):
            non_dm.append(start(_peer(100 + n), METADATA))
    assert len(non_dm) == 32 and all(pending(r) for r in non_dm)
    with contextlib.redirect_stderr(io.StringIO()):
        extra = start(_peer(200), LIVE)
        assert refused(extra)
        dms = [start(_peer(201 + i % 2), DM) for i in range(8)]
        assert all(pending(r) for r in dms)
        assert len(pb._resource_session_provider_waiters) == 40
        stderr = io.StringIO()
    with contextlib.redirect_stderr(stderr):
        over = start(_peer(203), DM)
        assert refused(over)
    assert "busy_kind=pending_total" in stderr.getvalue()
    for r in non_dm + dms:
        reject(r)
    assert_counters_zero("reservation global")
    reset_links()

    # Link hand-off admission: a non-DM successor stops at the non-DM caps,
    # a DM page successor may wait for the Link.
    peer = _peer(3)
    held = [start(peer, METADATA) for _ in range(6)]
    busy_state = {
        "linkId": "link-busy",
        "incoming": True,
        "closing": False,
        "provider_ready_sent": True,
        "manager_kind": "resource_session",
        "peerPresenceHash": peer,
        "provider_active": 1,
    }
    pb._qchat_file_links_by_id["link-busy"] = busy_state
    detail = {}
    assert (
        pb._resource_session_provider_acquire_link_slot(
            busy_state, "handoff-1", peer, dm_page=False, detail=detail
        )
        == "resource_provider_busy"
    )
    assert detail["busyKind"] == "pending_peer"
    out = {}
    th = threading.Thread(
        target=lambda: out.__setitem__(
            "r",
            pb._resource_session_provider_acquire_link_slot(
                busy_state, "handoff-dm", peer, dm_page=True
            ),
        ),
        daemon=True,
    )
    th.start()
    assert _wait_for(
        lambda: busy_state.get("provider_link_waiter_transfer") == "handoff-dm"
    )
    assert busy_state.get("provider_link_waiter_dm_page") is True
    with pb._resource_session_provider_capacity_condition:
        busy_state["provider_active"] = 0
        pb._resource_session_provider_capacity_condition.notify_all()
    th.join(2)
    assert out.get("r") == "" and busy_state["provider_active"] == 1
    pb._qchat_file_links_by_id.pop("link-busy", None)
    for r in held:
        reject(r)
    assert_counters_zero("handoff")
    reset_links()


# ── 3. history budget ─────────────────────────────────────────────────────
def check_history_budget():
    peer = _peer(4)
    first = [start(peer, HISTORY) for _ in range(2)]
    assert all(pending(r) for r in first)
    third = start(peer, HISTORY)
    assert refused(third)
    # Other classes from the same peer are unaffected.
    others = [start(peer, METADATA), start(peer, LIVE), start(peer, RANGE, rt=pb._RETICULUM_RESOURCE_TYPE)]
    assert all(pending(r) for r in others)
    more = [start(_peer(40 + n), HISTORY) for n in range(3) for _ in range(2)]
    assert all(pending(r) for r in more)
    assert pb._resource_session_provider_history_pending_total == 8
    ninth = start(_peer(50), HISTORY)
    assert refused(ninth)
    # A non-chat history-class request (class fallback) is not budgeted.
    fallback = start(_peer(50), "", rt=pb._RETICULUM_RESOURCE_TYPE)
    assert pending(fallback)
    for r in first + others + more + [fallback]:
        reject(r)
    assert_counters_zero("history pending budget")

    # Active history counts towards the budget.
    peers = [_peer(60 + n) for n in range(7)]
    state = lambda p: {"peerPresenceHash": p, "closing": False}  # noqa: E731
    for p in peers[:6]:
        assert pb._resource_session_provider_acquire_capacity(
            "history", "a-" + p, {}, state(p), history_budget=True
        )
    assert pb._resource_session_provider_history_active == 6
    r1 = start(_peer(70), HISTORY)
    r2 = start(_peer(71), HISTORY)
    r3 = start(_peer(72), HISTORY)
    assert pending(r1) and pending(r2) and refused(r3)
    # A 7th active history Resource waits for capacity...
    out = {}
    seventh = threading.Thread(
        target=lambda: out.__setitem__(
            "r",
            pb._resource_session_provider_acquire_capacity(
                "history", "a-7", {}, state(peers[6]), history_budget=True
            ),
        ),
        daemon=True,
    )
    seventh.start()
    time.sleep(0.3)
    assert "r" not in out
    # ...while attachments, metadata, live events and unbudgeted history start.
    assert pb._resource_session_provider_acquire_capacity("attachment", "x1", {}, state(_peer(80)))
    assert pb._resource_session_provider_acquire_capacity("metadata", "x2", {}, state(_peer(81)))
    assert pb._resource_session_provider_acquire_capacity("live", "x3", {}, state(_peer(82)))
    assert pb._resource_session_provider_acquire_capacity("history", "x4", {}, state(_peer(83)))
    assert "r" not in out
    pb._resource_session_provider_release_capacity("history", peers[0], True)
    seventh.join(2)
    assert out.get("r") is True
    assert pb._resource_session_provider_history_active == 6
    for p in peers[1:]:
        pb._resource_session_provider_release_capacity("history", p, True)
    pb._resource_session_provider_release_capacity("attachment", _peer(80))
    pb._resource_session_provider_release_capacity("metadata", _peer(81))
    pb._resource_session_provider_release_capacity("live", _peer(82))
    pb._resource_session_provider_release_capacity("history", _peer(83))
    reject(r1)
    reject(r2)
    assert_counters_zero("history active budget")
    reset_links()

    # A history Resource that got capacity and then ended before the watcher
    # took it over (requester cancelled, link closing) gives its history
    # budget back, or six of them would stop all history serving.
    acquire = pb._resource_session_provider_acquire_capacity
    for label, end, reason in (
        (
            "cancelled",
            lambda job, st: job.__setitem__("cancelled", True),
            "resource_requester_cancelled",
        ),
        (
            "closing",
            lambda job, st: st.__setitem__("closing", True),
            "resource_session_unavailable",
        ),
    ):
        def acquire_then_end(provider_class, transfer_id, job, st, _end=end, **kw):
            ok = acquire(provider_class, transfer_id, job, st, **kw)
            assert pb._resource_session_provider_history_active == 1, label
            _end(job, st)
            return ok

        pb._resource_session_provider_acquire_capacity = acquire_then_end
        try:
            req = start(_peer(90), HISTORY)
            assert pending(req), label
            register(req)
            authorize(req)
        finally:
            pb._resource_session_provider_acquire_capacity = acquire
        assert isinstance(req.result, dict), (label, req.result)
        assert req.result.get("reason") == reason, (label, req.result)
        assert_counters_zero(f"history budget released after {label}")
        reset_links()


# ── 4. DM pages skip post-authorize capacity limits ──────────────────────
def check_capacity_bypass():
    state = lambda p: {"peerPresenceHash": p, "closing": False}  # noqa: E731
    held = []
    for n in range(12):
        p = _peer(300 + n)
        # Non-live work stops at 11, so the 12th is a live event.
        cls = "attachment" if n < 10 else ("metadata" if n == 10 else "live")
        assert pb._resource_session_provider_acquire_capacity(cls, f"f{n}", {}, state(p))
        held.append((cls, p))
    assert sum(pb._resource_session_provider_active_by_class.values()) == 12
    # A live event waits; a DM page starts at once.
    live_pending = {}
    out = {}
    live = threading.Thread(
        target=lambda: out.__setitem__(
            "live",
            pb._resource_session_provider_acquire_capacity(
                "live", "live-1", live_pending, state(_peer(330))
            ),
        ),
        daemon=True,
    )
    live.start()
    started = time.monotonic()
    assert pb._resource_session_provider_acquire_capacity(
        "live", "dm-1", {}, state(_peer(331)), dm_page=True
    )
    assert time.monotonic() - started < 0.2
    time.sleep(0.3)
    assert "live" not in out
    # The per-peer active cap does not apply to DM pages either.
    for n in range(3):
        assert pb._resource_session_provider_acquire_capacity(
            "live", f"dm-{n + 2}", {}, state(_peer(331)), dm_page=True
        )
    assert sum(pb._resource_session_provider_active_by_class.values()) == 16
    # At 16 active the DM page waits too, even with a full capacity queue,
    # where anything else is refused at once.
    dummies = [
        {"providerClass": "attachment", "peerPresenceHash": _peer(340 + n), "transferId": f"q{n}"}
        for n in range(pb._RESOURCE_SESSION_PROVIDER_CAPACITY_QUEUE_MAX)
    ]
    with pb._resource_session_provider_capacity_condition:
        pb._resource_session_provider_capacity_queue.extend(dummies)
    assert pb._resource_session_provider_acquire_capacity(
        "live", "live-2", {}, state(_peer(333))
    ) is False
    dm_out = {}
    dm_wait = threading.Thread(
        target=lambda: dm_out.__setitem__(
            "r",
            pb._resource_session_provider_acquire_capacity(
                "live", "dm-5", {}, state(_peer(332)), dm_page=True
            ),
        ),
        daemon=True,
    )
    dm_wait.start()
    time.sleep(0.3)
    assert "r" not in dm_out
    with pb._resource_session_provider_capacity_condition:
        for dummy in dummies:
            pb._resource_session_provider_capacity_queue.remove(dummy)
    cls, p = held.pop()
    pb._resource_session_provider_release_capacity(cls, p)
    dm_wait.join(2)
    assert dm_out.get("r") is True
    assert "live" not in out
    live_pending["cancelled"] = True
    live.join(2)
    assert out.get("live") is False
    for cls, p in held:
        pb._resource_session_provider_release_capacity(cls, p)
    for _ in range(4):
        pb._resource_session_provider_release_capacity("live", _peer(331))
    pb._resource_session_provider_release_capacity("live", _peer(332))
    assert_counters_zero("capacity bypass")


# ── 5. auth_ended ─────────────────────────────────────────────────────────
def check_auth_ended():
    # Link close.
    req = start(_peer(5), DM)
    assert pending(req)
    pb.on_qchat_file_link_closed(req.state["link"])
    req.thread.join(2)
    assert req.result == {"ok": False, "reason": "resource_session_link_closed"}
    ended = _events_for(req.tid, "auth_ended")
    assert len(ended) == 1, ended
    payload = ended[0]
    assert payload["reason"] == "resource_session_link_closed"
    assert payload["linkId"] == req.link_id
    assert payload["peerPresenceHash"] == _peer(5)
    assert payload["resourceType"] == CHAT_RT
    assert payload["metadata"] == {"logicalResourceType": DM}
    assert payload["arrivedAtMs"] <= payload["authStartedAtMs"]

    # Requester cancel.
    req = start(_peer(5), HISTORY)
    assert pending(req)
    pb._resource_session_cancel_provider_transfer(req.state, req.tid)
    req.thread.join(2)
    ended = _events_for(req.tid, "auth_ended")
    assert [p["reason"] for p in ended] == ["resource_requester_cancelled"]

    # Waiter timeout.
    saved = pb._RESOURCE_SESSION_PROVIDER_AUTH_TIMEOUT_SECONDS
    pb._RESOURCE_SESSION_PROVIDER_AUTH_TIMEOUT_SECONDS = 0.3
    try:
        req = start(_peer(5), LIVE)
        req.thread.join(2)
        assert req.result == {"ok": False, "reason": "resource_authorization_timeout"}
        ended = _events_for(req.tid, "auth_ended")
        assert [p["reason"] for p in ended] == ["resource_authorization_timeout"]
        assert ended[0]["metadata"] == {"logicalResourceType": LIVE}
    finally:
        pb._RESOURCE_SESSION_PROVIDER_AUTH_TIMEOUT_SECONDS = saved

    # Engine reject: nothing.
    req = start(_peer(5), DM)
    reject(req)
    assert req.result == {"ok": False, "reason": "test_reject"}
    assert _events_for(req.tid, "auth_ended") == []

    # A late link close after the engine answered: still nothing.
    req = start(_peer(5), DM)
    waiter = next(
        w for w in pb._resource_session_provider_waiters.values() if w["transferId"] == req.tid
    )
    waiter["engineAnswered"] = True
    pb.on_qchat_file_link_closed(req.state["link"])
    req.thread.join(2)
    assert _events_for(req.tid, "auth_ended") == []
    assert_counters_zero("auth_ended")
    reset_links()


# ── 6. providerTiming on DM page terminal events ─────────────────────────
def _serve(req, resource, steps):
    """Authorize, then drive the fake Resource through (delay, mutate) steps."""
    register(req)
    authorize(req)
    result = req.result
    assert isinstance(result, tuple), result
    file_handle = result[0]
    for delay, mutate in steps:
        time.sleep(delay)
        mutate()
    return file_handle


def check_provider_timing():
    saved = (
        pb._RESOURCE_SESSION_PROVIDER_RESPONSE_START_GRACE_SECONDS,
        pb._RESOURCE_SESSION_RESPONSE_INITIAL_PROGRESS_TIMEOUT_SECONDS,
    )
    pb._RESOURCE_SESSION_PROVIDER_RESPONSE_START_GRACE_SECONDS = 0.2
    pb._RESOURCE_SESSION_RESPONSE_INITIAL_PROGRESS_TIMEOUT_SECONDS = 0.6
    try:
        # Delivered DM page.
        req = start(_peer(6), DM)
        resource = FakeResource(req.request_id)
        link = req.state["link"]
        marks = {}

        def set_progress():
            marks["progress"] = int(time.time() * 1000)
            resource.progress = 0.5

        def complete():
            marks["complete"] = int(time.time() * 1000)
            resource.status = RNS.Resource.COMPLETE
            resource.progress = 1.0

        handle = _serve(
            req,
            resource,
            [
                (0.15, lambda: link.outgoing_resources.append(resource)),
                (0.25, set_progress),
                (0.25, complete),
            ],
        )
        assert _wait_for(lambda: _events_for(req.tid, "sent"))
        handle.close()
        timing = _events_for(req.tid, "sent")[0]["providerTiming"]
        order = [
            "requestedAtMs",
            "arrivedAtMs",
            "authStartedAtMs",
            "authorizedAtMs",
            "capAcquiredAtMs",
            "resourceFoundAtMs",
            "firstProgressAtMs",
            "endedAtMs",
        ]
        assert all(isinstance(timing.get(k), int) for k in order), timing
        values = [timing[k] for k in order]
        assert values == sorted(values), timing
        assert timing["firstProgressAtMs"] - timing["resourceFoundAtMs"] >= 150, timing
        # Stamped when progress first moved, not when the Resource completed.
        assert marks["progress"] <= timing["firstProgressAtMs"] < marks["complete"], (marks, timing)

        # COMPLETE seen before any progress: firstProgressAtMs still set.
        req = start(_peer(6), DM)
        resource = FakeResource(req.request_id)
        resource.status = RNS.Resource.COMPLETE
        link = req.state["link"]
        handle = _serve(req, resource, [(0.05, lambda: link.outgoing_resources.append(resource))])
        assert _wait_for(lambda: _events_for(req.tid, "sent"))
        handle.close()
        timing = _events_for(req.tid, "sent")[0]["providerTiming"]
        assert isinstance(timing.get("firstProgressAtMs"), int), timing

        # Failed DM page: advertised, never progressed.
        req = start(_peer(6), DM)
        resource = FakeResource(req.request_id)
        link = req.state["link"]
        _serve(req, resource, [(0.05, lambda: link.outgoing_resources.append(resource))])
        assert _wait_for(lambda: _events_for(req.tid, "failed"))
        failed = _events_for(req.tid, "failed")[0]
        assert failed["reason"] == "resource_response_not_started"
        timing = failed["providerTiming"]
        assert isinstance(timing.get("resourceFoundAtMs"), int)
        assert "firstProgressAtMs" not in timing and isinstance(timing.get("endedAtMs"), int)
        assert resource.cancelled

        # History page: no providerTiming.
        req = start(_peer(6), HISTORY)
        resource = FakeResource(req.request_id)
        resource.status = RNS.Resource.COMPLETE
        link = req.state["link"]
        handle = _serve(req, resource, [(0.05, lambda: link.outgoing_resources.append(resource))])
        assert _wait_for(lambda: _events_for(req.tid, "sent"))
        handle.close()
        assert "providerTiming" not in _events_for(req.tid, "sent")[0]
        assert _events_for(req.tid, "auth_ended") == []
    finally:
        (
            pb._RESOURCE_SESSION_PROVIDER_RESPONSE_START_GRACE_SECONDS,
            pb._RESOURCE_SESSION_RESPONSE_INITIAL_PROGRESS_TIMEOUT_SECONDS,
        ) = saved
    assert_counters_zero("provider timing")
    reset_links()


# ── 8. bridge_pressure fields, switch interval and the GIL probe ─────────
def check_bridge_pressure():
    reset_links()
    pb._take_provider_ingress_window()
    pb._note_provider_request_lag(900, False)
    pb._note_provider_request_lag(100, True)
    pb._note_provider_request_lag(300, True)

    host = types.ModuleType("qortal_presence_host")
    host._out_queue = queue.Queue()
    for i in range(3):
        host._out_queue.put(str(i))
    a, b = socket.socketpair()
    iface = types.SimpleNamespace(name="Test Iface", socket=b)
    saved_interfaces = list(RNS.Transport.interfaces)
    sys.modules["qortal_presence_host"] = host
    RNS.Transport.interfaces.append(iface)
    try:
        a.sendall(b"x" * 100)
        time.sleep(0.05)
        logs.clear()
        pb._maybe_log_bridge_pressure(force=True)
        line = next(l for l in logs if "bridge_pressure" in l)
        assert "req_lag_ms=all:300/900,dm:100/300,n=3 " in line, line
        for field in (
            "gil_lag_ms_max=",
            "state_lock_wait_ms_max=",
            "host_out_q=3 ",
            "rns_rx_backlog_bytes=",
            "Test_Iface:100",
            "provider_refused=dm:",
            ",history:",
            ",other:",
            "provider_history=pending:0,active:0",
        ):
            assert field in line, (field, line)
        # The window resets after each line.
        logs.clear()
        pb._maybe_log_bridge_pressure(force=True)
        line = next(l for l in logs if "bridge_pressure" in l)
        assert "req_lag_ms=all:n/a,dm:n/a,n=0 " in line, line
    finally:
        RNS.Transport.interfaces[:] = saved_interfaces
        sys.modules.pop("qortal_presence_host", None)
        a.close()
        b.close()

    # GIL lag alone counts as pressure.
    logs.clear()
    pb._maybe_log_bridge_pressure(now=time.monotonic() + 1000)
    quiet = [l for l in logs if "bridge_pressure" in l]
    with pb._scheduler_stats_lock:
        pb._gil_probe_lag_ms_max = 600.0
    pb._maybe_log_bridge_pressure(now=time.monotonic() + 2000)
    loud = [l for l in logs if "bridge_pressure" in l]
    assert not quiet and len(loud) == 1 and "gil_lag_ms_max=600" in loud[0], logs

    # Switch interval, and main() applies it before the workers start.
    saved = sys.getswitchinterval()
    try:
        pb._apply_gil_switch_interval()
        assert abs(sys.getswitchinterval() - 0.002) < 1e-6
        assert any("gil_switch_interval" in l for l in logs)
    finally:
        sys.setswitchinterval(saved)
    main_src = inspect.getsource(pb.main)
    assert (
        main_src.index("_apply_gil_switch_interval()")
        < main_src.index("_start_gil_probe()")
        < main_src.index("_start_packet_send_dispatchers()")
    )

    # The probe measures a held _state_lock.
    saved_lock_interval = pb._GIL_PROBE_STATE_LOCK_INTERVAL_SECONDS
    pb._GIL_PROBE_STATE_LOCK_INTERVAL_SECONDS = 0.05
    pb._take_provider_ingress_window()
    try:
        pb._start_gil_probe()
        with pb._state_lock:
            time.sleep(0.3)
        assert _wait_for(lambda: pb._gil_probe_state_lock_wait_ms_max >= 100)
    finally:
        pb._gil_probe_generation += 1  # stops the probe
        pb._GIL_PROBE_STATE_LOCK_INTERVAL_SECONDS = saved_lock_interval
    time.sleep(1.1)
    assert not any(t.name == "reticulum-gil-probe" and t.is_alive() for t in threading.enumerate())

    # Sample period: 50 ms only while the provider has work. Open links
    # alone (they idle for minutes after use) keep the 1 s idle period.
    class OnePass:
        def __init__(self):
            self.intervals = []

        def wait(self, interval):
            self.intervals.append(interval)
            pb._gil_probe_generation += 1  # one pass, then the loop exits
            return False

    def probe_interval():
        recorder = OnePass()
        saved_shutdown = pb._shutdown
        pb._shutdown = recorder
        try:
            pb._gil_probe_loop(pb._gil_probe_generation)
        finally:
            pb._shutdown = saved_shutdown
        assert len(recorder.intervals) == 1, recorder.intervals
        return recorder.intervals[0]

    idle = pb._GIL_PROBE_STATE_LOCK_INTERVAL_SECONDS
    fast = pb._GIL_PROBE_INTERVAL_SECONDS
    reset_links()
    assert_counters_zero("probe idle")
    assert probe_interval() == idle
    for n in range(40):
        pb._qchat_file_links_by_id[f"idle-link-{n}"] = {"linkId": f"idle-link-{n}"}
    try:
        assert probe_interval() == idle
        pb._resource_session_provider_waiters["probe-waiter"] = {}
        assert probe_interval() == fast
        pb._resource_session_provider_waiters.pop("probe-waiter", None)
        pb._resource_session_provider_inflight_transfers.add("probe-transfer")
        assert probe_interval() == fast
        pb._resource_session_provider_inflight_transfers.discard("probe-transfer")
        pb._resource_session_provider_active_by_class["history"] = 1
        assert probe_interval() == fast
        pb._resource_session_provider_active_by_class["history"] = 0
        assert probe_interval() == idle
    finally:
        pb._resource_session_provider_waiters.pop("probe-waiter", None)
        pb._resource_session_provider_inflight_transfers.discard("probe-transfer")
        pb._resource_session_provider_active_by_class["history"] = 0
        reset_links()


# ── 9. the RNS reader path never waits for _state_lock ───────────────────
def check_reader_path_lock_free():
    lane = pb._rns_callback_lane("overlay", "reader-link")
    pb._scheduler_queues[lane] = queue.Queue(maxsize=1)
    holder_ready = threading.Event()
    release = threading.Event()

    def hold():
        with pb._state_lock:
            holder_ready.set()
            release.wait(5)

    holder = threading.Thread(target=hold, daemon=True)
    holder.start()
    assert holder_ready.wait(2)
    packet = types.SimpleNamespace(link=None)
    done = threading.Event()

    def reader():
        cb = lambda message, pkt: None  # noqa: E731
        pb._dispatch_bounded_rns_packet_callback("overlay", "reader-link", cb, b"one", packet)
        # Same bytes on the same Link while queued: coalesced.
        pb._dispatch_bounded_rns_packet_callback("overlay", "reader-link", cb, b"one", packet)
        # Lane full: dropped, and its pending key released.
        pb._dispatch_bounded_rns_packet_callback("overlay", "reader-link", cb, b"two", packet)
        done.set()

    try:
        threading.Thread(target=reader, daemon=True).start()
        assert done.wait(2), "reader path blocked on _state_lock"
        assert pb._scheduler_queues[lane].qsize() == 1
        with pb._scheduler_stats_lock:
            stats = dict(pb._scheduler_stats[lane])
            keys = len(pb._rns_overlay_callback_pending_keys)
        assert stats["enqueuedTasks"] == 1 and stats["droppedTasks"] == 1, stats
        assert keys == 1
    finally:
        release.set()
        holder.join(2)
    # Running the queued task clears its pending key.
    item = pb._scheduler_queues[lane].get_nowait()
    item[2](*item[3], **item[4])
    assert not pb._rns_overlay_callback_pending_keys
    pb._scheduler_queues.pop(lane, None)
    with pb._scheduler_stats_lock:
        pb._scheduler_stats.pop(lane, None)


def test_provider_dm_latency():
    _install()
    try:
        check_auth_stamps()
        check_reservation()
        check_history_budget()
        check_capacity_bypass()
        check_auth_ended()
        check_provider_timing()
        assert_counters_zero("end")
        check_bridge_pressure()
        check_reader_path_lock_free()
    finally:
        for path in _tempfiles:
            try:
                os.unlink(path)
            except OSError:
                pass


if __name__ == "__main__":
    test_provider_dm_latency()
    print("ALL OK")
