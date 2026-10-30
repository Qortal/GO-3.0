"""Provider auth window per type and the engine-stalled breaker.

Drives the real Android presence_bridge.py provider path (the Resource
response generator and the authorize/reject handlers) against the fake
Links of test_provider_dm_latency.py, without Chaquopy, RNS daemons or a
network. The timing runs on a scaled clock: every window, silence and probe
interval is multiplied by SCALE, so the 15 s / 30 s / 5 s behaviour takes a
few seconds. The breaker's own rules are also checked on a fake clock.

    python3 android/app/src/test/python/test_provider_auth_window.py

It also works under pytest. The module is loaded once and its globals are
shared, so the checks run in one ordered function.
"""

import contextlib
import inspect
import os
import re
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import test_provider_dm_latency as base  # noqa: E402

pb = base.pb
CHAT_RT = base.CHAT_RT
DM = base.DM
HISTORY = base.HISTORY
LIVE = base.LIVE
METADATA = base.METADATA
RANGE = base.RANGE
AUTHOR_RANGE = "reticulum_chat_author_range"
MANIFEST = "reticulum_chat_author_manifest"
OWN = "QOwnAccountAddressForTheBreakerTest"
OTHER = "QSomeoneElsesAddressForTheBreaker"

# 15 s -> 1.5 s, 30 s -> 3 s, 5 s probe -> 0.5 s, 60 s evidence -> 6 s.
SCALE = 0.1
_SCALED = (
    "_RESOURCE_SESSION_PROVIDER_AUTH_TIMEOUT_SECONDS",
    "_RESOURCE_SESSION_PROVIDER_LIVE_EVENT_AUTH_TIMEOUT_SECONDS",
    "_PROVIDER_ENGINE_BREAKER_SILENCE_SECONDS",
    "_PROVIDER_ENGINE_BREAKER_PROBE_SECONDS",
    "_PROVIDER_ENGINE_BREAKER_EVIDENCE_MAX_AGE_SECONDS",
)


@contextlib.contextmanager
def scaled_clock():
    saved = {name: getattr(pb, name) for name in _SCALED}
    for name, value in saved.items():
        setattr(pb, name, value * SCALE)
    try:
        yield
    finally:
        for name, value in saved.items():
            setattr(pb, name, value)


def start(peer, logical, rt=CHAT_RT, auth_extra=None):
    """base.start with extra authMessage fields (an author range's range)."""
    base._counter[0] += 1
    tid = f"w{base._counter[0]:05d}"
    link_id = f"link-{tid}"
    link = base.FakeLink()
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
    base.LINKS[link_id.encode()] = state
    request_id = f"req-{tid}".encode()
    req = base.Req(tid, link_id, state, request_id, logical, rt)
    auth = {"type": "TEST_AUTH", "transferId": tid}
    auth.update(auth_extra or {})
    request = {
        "version": 1,
        "transferId": tid,
        "authMessage": auth,
        "metadata": {"logicalResourceType": logical, "resourceType": rt},
        "resourceType": rt,
    }
    stamp = time.time() - 0.25

    def run():
        req.started_at = time.monotonic()
        req.out["r"] = pb._resource_session_response_generator(
            None, request, request_id, link_id.encode(), peer, stamp
        )
        req.finished_at = time.monotonic()

    req.thread = threading.Thread(target=run, daemon=True)
    req.thread.start()
    assert base._wait_for(lambda: "r" in req.out or base._auth_event(tid) is not None)
    return req


def author_range(peer, author):
    return start(
        peer,
        AUTHOR_RANGE,
        auth_extra={"range": {"a": author, "s": "0" * 32, "from": 1, "to": 9}},
    )


def busy_kind_count(key):
    with pb._scheduler_stats_lock:
        return int(pb._provider_refused_by_busy_kind.get(key) or 0)


# ── 1. window per type, and the deadline in the auth ─────────────────────
def check_window_per_type():
    # Unscaled: 30 s for live events only.
    assert pb._resource_session_provider_auth_window_seconds(LIVE) == 30.0
    assert pb._resource_session_provider_auth_window_seconds(" Reticulum_Chat_Live_Event ") == 30.0
    for logical in (DM, HISTORY, METADATA, AUTHOR_RANGE, MANIFEST, RANGE, ""):
        assert pb._resource_session_provider_auth_window_seconds(logical) == 15.0, logical
    # The engine cuts a stated deadline to its own cap; holding a live event
    # past that cap would only keep the Hub's fast session busy for nothing.
    engine_src = os.path.join(HERE, "..", "..", "..", "..", "..", "electron", "src", "reticulum-chat.ts")
    with open(engine_src, encoding="utf-8") as fh:
        match = re.search(
            r"^const RETICULUM_CHAT_PROVIDER_AUTH_MAX_WINDOW_MS = ([0-9_]+);",
            fh.read(),
            re.M,
        )
    assert match, "engine cap RETICULUM_CHAT_PROVIDER_AUTH_MAX_WINDOW_MS not found"
    engine_cap_ms = int(match.group(1).replace("_", ""))
    assert pb._RESOURCE_SESSION_PROVIDER_LIVE_EVENT_AUTH_TIMEOUT_SECONDS * 1000 <= engine_cap_ms

    pb._provider_engine_breaker_reset()
    with scaled_clock():
        reqs = {
            "live": start(base._peer(301), LIVE),
            "history": start(base._peer(302), HISTORY),
            "dm": start(base._peer(303), DM),
            "manifest": start(base._peer(304), MANIFEST),
        }
        windows_ms = {"live": 3000, "history": 1500, "dm": 1500, "manifest": 1500}
        for name, req in reqs.items():
            auth = base._auth_event(req.tid)
            assert isinstance(auth.get("authDeadlineAtMs"), int), (name, auth)
            assert auth["authDeadlineAtMs"] - auth["authStartedAtMs"] == windows_ms[name], (
                name,
                auth,
            )
            waiter = next(
                w
                for w in pb._resource_session_provider_waiters.values()
                if w["transferId"] == req.tid
            )
            assert waiter["authDeadlineAtMs"] == auth["authDeadlineAtMs"]
        # The 15 s types end at their window; the live event is still held.
        for name in ("history", "dm", "manifest"):
            reqs[name].thread.join(3.0)
            assert not reqs[name].thread.is_alive(), name
        assert reqs["live"].thread.is_alive()
        reqs["live"].thread.join(4.0)
        assert not reqs["live"].thread.is_alive()
    for name, req in reqs.items():
        # The wire answer is the same as before, only later for live events.
        assert req.result == {"ok": False, "reason": "resource_authorization_timeout"}, (
            name,
            req.result,
        )
        took = req.finished_at - req.started_at
        low = windows_ms[name] / 1000.0 - 0.05
        assert low <= took <= low + 0.9, (name, took)
        ended = base._events_for(req.tid, "auth_ended")
        assert [p["reason"] for p in ended] == ["resource_authorization_timeout"], (name, ended)
    assert reqs["live"].finished_at > max(
        reqs[n].finished_at for n in ("history", "dm", "manifest")
    )
    # Four waiters ran out with no answer; the breaker counted each one.
    assert pb._provider_engine_breaker_snapshot()["timeoutStreak"] == 4
    pb._provider_engine_breaker_reset()
    base.assert_counters_zero("window per type")
    base.reset_links()


# ── 2. breaker rules on a fake clock ──────────────────────────────────────
def check_breaker_rules():
    pb._provider_engine_breaker_reset()
    pb._provider_note_local_account_address(OWN)
    refuses = pb._provider_engine_breaker_refuses
    other_range = {"range": {"a": OTHER}}
    own_range = {"range": {"a": OWN}}

    # The engine answered at t=1000; three waiters then ran out.
    pb._provider_engine_breaker_note_answer(now=1000.0)
    pb._provider_engine_breaker_note_timeout(now=1010.0)
    pb._provider_engine_breaker_note_timeout(now=1011.0)
    assert not refuses(HISTORY, {}, now=1016.0), "2 timeouts are not enough"
    pb._provider_engine_breaker_note_timeout(now=1012.0)
    # 3 timeouts but the last answer is only 14 s old.
    assert not refuses(HISTORY, {}, now=1014.0)
    assert pb._provider_engine_breaker_snapshot()["open"] is False
    # 15 s of silence: open, and this first one is refused.
    base.logs.clear()
    assert refuses(HISTORY, {}, now=1015.0)
    snap = pb._provider_engine_breaker_snapshot()
    assert snap["open"] is True and snap["refusedSinceOpen"] == 1, snap
    opened = [l for l in base.logs if "provider_engine_breaker opened" in l]
    assert len(opened) == 1 and "timeouts=3" in opened[0] and "silence_ms=15000" in opened[0], base.logs

    # History-class types are refused; everything else always passes.
    assert refuses(MANIFEST, {}, now=1015.5)
    assert refuses(AUTHOR_RANGE, other_range, now=1015.6)
    assert refuses("reticulum_chat_event_page", {}, now=1015.7)
    for logical, auth in (
        (LIVE, {}),
        (DM, {}),
        (METADATA, {}),
        ("reticulum_chat_calendar", {}),
        (RANGE, {}),
        ("", {}),
        (AUTHOR_RANGE, own_range),
    ):
        assert not refuses(logical, auth, now=1016.0), logical
    # A live event is never refused, however long the engine is silent.
    for k in range(20):
        pb._provider_engine_breaker_note_timeout(now=1016.0 + k * 0.01)
    assert not refuses(LIVE, {}, now=1019.0)

    # One probe per 5 s goes through while open.
    assert refuses(HISTORY, {}, now=1019.9)
    assert not refuses(HISTORY, {}, now=1020.0), "probe 5 s after opening"
    assert refuses(HISTORY, {}, now=1020.1)
    assert refuses(HISTORY, {}, now=1024.9)
    assert not refuses(HISTORY, {}, now=1025.0), "next probe"
    snap = pb._provider_engine_breaker_snapshot()
    assert snap["open"] is True and snap["refusedSinceOpen"] == 7, snap

    # Any engine answer closes it at once.
    base.logs.clear()
    pb._provider_engine_breaker_note_answer(now=1026.0)
    snap = pb._provider_engine_breaker_snapshot()
    assert snap == {"open": False, "opens": snap["opens"], "timeoutStreak": 0, "refusedSinceOpen": 0}, snap
    assert any("provider_engine_breaker closed reason=engine_answered refused=7" in l for l in base.logs), base.logs
    assert not refuses(HISTORY, {}, now=1026.1)

    # Old timeouts are no evidence: after a quiet minute the next request
    # goes to the engine and an open breaker closes.
    pb._provider_engine_breaker_reset()
    for k in range(3):
        pb._provider_engine_breaker_note_timeout(now=2000.0 + k)
    assert refuses(HISTORY, {}, now=2003.0), "no answer ever: silence holds"
    base.logs.clear()
    assert not refuses(HISTORY, {}, now=2002.0 + 60.5)
    snap = pb._provider_engine_breaker_snapshot()
    assert snap["open"] is False and snap["timeoutStreak"] == 0, snap
    assert any("provider_engine_breaker closed reason=stale" in l for l in base.logs), base.logs

    # Our own author data only while we know who we are.
    pb._provider_engine_breaker_reset()
    for k in range(3):
        pb._provider_engine_breaker_note_timeout(now=3000.0 + k)
    assert refuses(HISTORY, {}, now=3003.0)
    assert not refuses(AUTHOR_RANGE, own_range, now=3003.1)
    assert not refuses(AUTHOR_RANGE, {"range": {"a": "  " + OWN + " "}}, now=3003.2)
    assert refuses(AUTHOR_RANGE, {"range": {"a": OWN.lower()}}, now=3003.3)
    assert refuses(AUTHOR_RANGE, {"range": OWN}, now=3003.4)
    assert refuses(AUTHOR_RANGE, None, now=3003.5)
    # The own-address rule is for author ranges only.
    assert refuses(HISTORY, own_range, now=3003.6)
    # Our own other device pulling (the request's authorAddress): author
    # ranges and author manifests pass, as in the engine's
    # isOwnHistoryServeRequest; whole-channel pages still cannot tell.
    own_device = {"authorAddress": " " + OWN, "range": {"a": OTHER}}
    assert not refuses(AUTHOR_RANGE, own_device, now=3003.61)
    assert not refuses(MANIFEST, {"authorAddress": OWN}, now=3003.62)
    assert refuses(MANIFEST, {"authorAddress": OTHER}, now=3003.63)
    assert refuses(MANIFEST, own_range, now=3003.64)
    assert refuses(HISTORY, {"authorAddress": OWN}, now=3003.65)
    assert refuses("reticulum_chat_event_page", {"authorAddress": OWN}, now=3003.66)
    assert refuses(AUTHOR_RANGE, {"authorAddress": OTHER, "range": {"a": OTHER}}, now=3003.67)
    pb._provider_note_local_account_address("")
    assert pb._provider_local_account_address == OWN
    pb._provider_note_local_account_address(None)
    assert pb._provider_local_account_address == OWN
    # "Appear offline" publishes OFFLINE and stops heartbeats: the address
    # stays (from the envelope), so our own data still passes.
    pb._provider_note_local_account_address(OWN)
    assert pb._provider_local_account_address == OWN
    pb._provider_note_local_account_address("")
    assert pb._provider_local_account_address == OWN
    assert not refuses(AUTHOR_RANGE, own_range, now=3003.7)
    # Only a bridge stop forgets it.
    pb._provider_forget_local_account_address()
    assert pb._provider_local_account_address == ""
    assert refuses(AUTHOR_RANGE, own_range, now=3004.0)

    # Bridge stop resets the breaker and forgets the account; the publish
    # handler records the address it announces.
    stop_src = inspect.getsource(pb.handle_stop)
    assert "_provider_engine_breaker_reset()" in stop_src
    assert "_provider_forget_local_account_address()" in stop_src
    publish_src = inspect.getsource(pb.handle_publish_presence)
    assert "_provider_note_local_account_address(env_addr)" in publish_src
    pb._provider_engine_breaker_reset()
    assert pb._provider_engine_breaker_snapshot()["open"] is False


# ── 3. breaker through the provider path (scaled clock) ──────────────────
def check_breaker_end_to_end():
    pb._provider_engine_breaker_reset()
    pb._provider_note_local_account_address(OWN)
    stalled_history = busy_kind_count("history:engine_stalled")
    stalled_other = busy_kind_count("other:engine_stalled")
    with scaled_clock():
        # The engine is frozen: three requests run out their window.
        first = [start(base._peer(400 + n), HISTORY) for n in range(3)]
        for req in first:
            req.thread.join(3.0)
            assert req.result == {"ok": False, "reason": "resource_authorization_timeout"}
        assert pb._provider_engine_breaker_snapshot()["timeoutStreak"] == 3

        # New history-class requests are refused at once with the existing
        # busy reason, before any Link slot or engine work.
        refused = [
            start(base._peer(410), HISTORY),
            start(base._peer(411), MANIFEST),
            author_range(base._peer(412), OTHER),
        ]
        for req in refused:
            req.thread.join(1.0)
            assert req.result == {"ok": False, "reason": "resource_provider_busy"}, req.result
            assert req.finished_at - req.started_at < 0.25
            assert base._auth_event(req.tid) is None, "the engine never sees it"
            assert req.state.get("provider_active", 0) == 0
        assert pb._provider_engine_breaker_snapshot()["open"] is True
        # Counted like the other refusals: author ranges use the history
        # budget, manifests do not.
        assert busy_kind_count("history:engine_stalled") == stalled_history + 2
        assert busy_kind_count("other:engine_stalled") == stalled_other + 1

        # Live events, DM pages, other types and our own author ranges still
        # reach the engine. (Not answered yet: an answer closes the breaker.)
        exempt = [
            start(base._peer(420), LIVE),
            start(base._peer(421), DM),
            start(base._peer(422), METADATA),
            author_range(base._peer(423), OWN),
        ]
        assert all(base.pending(r) for r in exempt)

        # One probe after the scaled 5 s; the next one is refused again.
        time.sleep(pb._PROVIDER_ENGINE_BREAKER_PROBE_SECONDS + 0.05)
        probe = start(base._peer(430), HISTORY)
        assert base.pending(probe)
        after_probe = start(base._peer(431), HISTORY)
        after_probe.thread.join(1.0)
        assert after_probe.result == {"ok": False, "reason": "resource_provider_busy"}

        # The engine answers the probe: the breaker closes and history flows.
        base.logs.clear()
        base.reject(probe)
        assert probe.result == {"ok": False, "reason": "test_reject"}
        snap = pb._provider_engine_breaker_snapshot()
        assert snap["open"] is False and snap["timeoutStreak"] == 0, snap
        assert any("provider_engine_breaker closed reason=engine_answered" in l for l in base.logs)
        again = start(base._peer(432), HISTORY)
        assert base.pending(again)
        for req in exempt[1:] + [again]:
            base.reject(req)

        # An authorize counts as an answer too (the live event, still held
        # in its 30 s window, is served).
        pb._provider_engine_breaker_note_timeout()
        assert pb._provider_engine_breaker_snapshot()["timeoutStreak"] == 1
        live = exempt[0]
        assert not base._events_for(live.tid, "auth_ended")
        resource = base.FakeResource(live.request_id)
        resource.status = base.RNS.Resource.COMPLETE
        link = live.state["link"]
        handle = base._serve(
            live, resource, [(0.05, lambda: link.outgoing_resources.append(resource))]
        )
        assert pb._provider_engine_breaker_snapshot()["timeoutStreak"] == 0
        assert base._wait_for(lambda: base._events_for(live.tid, "sent"))
        handle.close()
    pb._provider_engine_breaker_reset()
    pb._provider_forget_local_account_address()
    base.assert_counters_zero("breaker end to end")
    base.reset_links()


def test_provider_auth_window():
    base._install()
    try:
        check_window_per_type()
        check_breaker_rules()
        check_breaker_end_to_end()
    finally:
        pb._provider_engine_breaker_reset()
        pb._provider_forget_local_account_address()
        for path in base._tempfiles:
            try:
                os.unlink(path)
            except OSError:
                pass


if __name__ == "__main__":
    test_provider_auth_window()
    print("ALL OK")
