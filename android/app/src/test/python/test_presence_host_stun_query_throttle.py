"""Community-STUN query throttle in qortal_presence_host.py.

Each ``get_community_stun_endpoints`` command makes the bridge send a query
announce, and RNS hubs drop a destination's announces after about 6 an hour.
The host lets one query out per 10 min (and only while a hub interface is
online); every other command gets the same pruned endpoint list without the
announce. These checks run the host against the REAL Android
presence_bridge.py, so a merge that renames the hooked names fails here:

    python3 android/app/src/test/python/test_presence_host_stun_query_throttle.py
    python3 -m pytest android/app/src/test/python/test_presence_host_stun_query_throttle.py -q
"""

import contextlib
import inspect
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import presence_bridge as pb  # noqa: E402  (the real Android bridge)
import qortal_presence_host as h  # noqa: E402
import RNS  # noqa: E402  (the vendored RNS the bridge imported)

LIVE = "1.2.3.4:47321"
EXPIRED = "5.6.7.8:47321"


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


class FakeDestination:
    def __init__(self):
        self.announces = []

    def announce(self, app_data=None):
        self.announces.append(app_data)


def _endpoints():
    now_ms = int(time.time() * 1000)
    live = {"host": "1.2.3.4", "port": 47321, "expiresAt": now_ms + 60_000}
    return live, {
        LIVE: dict(live),
        EXPIRED: {"host": "5.6.7.8", "port": 47321, "expiresAt": now_ms - 1},
    }


@contextlib.contextmanager
def bridge_fixture(reachable=True):
    """The real handler, with a fake destination and a recorded emit_resp."""
    live, recent = _endpoints()
    seen = {LIVE: 1.0, EXPIRED: 1.0}
    destination = FakeDestination()
    responses = []
    state = {"reachable": reachable, "clock": 50_000.0}

    def emit_resp(req_id, ok, payload=None, error=None):
        responses.append((req_id, ok, payload))

    with patched(
        pb,
        handle_get_community_stun_endpoints=pb.handle_get_community_stun_endpoints,
        _community_stun_destination=destination,
        _ensure_community_stun_discovery=lambda config_dir: None,
        _community_stun_recent_endpoints=recent,
        _community_stun_seen_endpoints=seen,
        emit_resp=emit_resp,
    ), patched(
        h,
        _community_stun_last_query_at=None,
        _community_stun_clock=lambda: state["clock"],
        _community_stun_query_reachable=lambda: state["reachable"],
        _community_stun_query_stats={"sent": 0, "throttled": 0, "offline": 0},
    ):
        yield {
            "live": live,
            "seen": seen,
            "destination": destination,
            "responses": responses,
            "state": state,
        }


def _command(req_id):
    # Through the bridge's own dispatcher: it must reach the wrapper.
    pb.handle_command(
        {"id": req_id, "action": "get_community_stun_endpoints", "payload": {}}
    )


def test_the_bridge_still_has_the_hooked_names():
    for name in (
        "handle_get_community_stun_endpoints",
        "_state_lock",
        "_community_stun_recent_endpoints",
        "_community_stun_seen_endpoints",
        "emit_resp",
        "handle_command",
    ):
        assert hasattr(pb, name), name
    assert not getattr(
        pb.handle_get_community_stun_endpoints, "_qortal_query_throttle", False
    ), "a test left the throttle installed"


def test_one_query_announce_per_ten_minutes():
    with bridge_fixture() as f:
        original = pb.handle_get_community_stun_endpoints
        h._install_community_stun_query_throttle(pb)
        hooked = pb.handle_get_community_stun_endpoints
        h._install_community_stun_query_throttle(pb)  # idempotent
        assert pb.handle_get_community_stun_endpoints is hooked
        assert hooked.__wrapped__ is original

        for req_id in ("a", "b", "c"):
            _command(req_id)
        assert len(f["destination"].announces) == 1
        assert b'"q":true' in f["destination"].announces[0]
        # Every command is answered with the same pruned live list.
        assert f["responses"] == [
            (req_id, True, {"endpoints": [f["live"]]}) for req_id in ("a", "b", "c")
        ]
        assert EXPIRED not in f["seen"]
        assert h._community_stun_query_stats == {
            "sent": 1,
            "throttled": 2,
            "offline": 0,
        }

        # 10 min later (on the throttle's own clock) the next command sends
        # the query again, not a second earlier.
        f["state"]["clock"] += h._COMMUNITY_STUN_QUERY_MIN_INTERVAL_SECONDS - 1
        _command("d")
        assert len(f["destination"].announces) == 1
        f["state"]["clock"] += 1
        _command("e")
        assert len(f["destination"].announces) == 2
        assert f["responses"][-1] == ("e", True, {"endpoints": [f["live"]]})


def test_no_query_while_no_hub_is_online():
    with bridge_fixture(reachable=False) as f:
        h._install_community_stun_query_throttle(pb)
        _command("a")
        assert f["destination"].announces == []
        assert f["responses"] == [("a", True, {"endpoints": [f["live"]]})]
        # The window was not used up: the first command online sends it.
        assert h._community_stun_last_query_at is None
        f["state"]["reachable"] = True
        _command("b")
        assert len(f["destination"].announces) == 1
        assert h._community_stun_query_stats["offline"] == 1


def test_network_pause_counts_as_offline():
    with patched(h, _network_paused=True):
        assert h._community_stun_query_reachable() is False


class FakeInterface:
    def __init__(self, online, IN=False, OUT=False):  # noqa: N803 (RNS names)
        self.online = online
        self.IN = IN
        self.OUT = OUT


class Unreadable:
    def __iter__(self):
        raise RuntimeError("interfaces changed during iteration")


def test_reachable_reads_the_rns_interfaces():
    cases = [
        ([], False),
        ([FakeInterface(online=False, IN=True, OUT=True)], False),
        ([FakeInterface(online=True)], False),
        ([FakeInterface(online=True, OUT=True)], True),
        ([FakeInterface(online=True, IN=True)], True),
        (
            [
                FakeInterface(online=False, OUT=True),
                FakeInterface(online=True, IN=True, OUT=True),
            ],
            True,
        ),
        # An interface without the attribute counts as offline.
        ([object()], False),
        # Unreadable: let the bridge send it.
        (Unreadable(), True),
    ]
    with patched(h, _network_paused=False):
        for interfaces, expected in cases:
            with patched(RNS.Transport, interfaces=interfaces):
                assert h._community_stun_query_reachable() is expected, interfaces


def test_rns_still_has_the_names_reachable_reads():
    from RNS.Interfaces.Interface import Interface

    assert hasattr(RNS.Transport, "interfaces")
    assert hasattr(Interface, "IN") and hasattr(Interface, "OUT")
    assert "self.online" in inspect.getsource(Interface.__init__)


def test_throttle_clock_counts_suspend():
    clock_id = getattr(time, "CLOCK_BOOTTIME", None)
    if clock_id is not None:
        # Linux and Android: CLOCK_BOOTTIME, which runs on in suspend.
        before = time.clock_gettime(clock_id)
        now = h._community_stun_clock()
        assert before <= now <= time.clock_gettime(clock_id)
        assert h._community_stun_clock is not time.monotonic

        def broken(_clock_id):
            raise OSError("not supported")

        with patched(time, clock_gettime=broken):
            assert h._pick_community_stun_clock() is time.monotonic
        del time.CLOCK_BOOTTIME
        try:
            assert h._pick_community_stun_clock() is time.monotonic
        finally:
            time.CLOCK_BOOTTIME = clock_id
    else:
        assert h._pick_community_stun_clock() is time.monotonic
    # The wrapper reads the clock at call time (the fixture relies on it).
    source = inspect.getsource(h._install_community_stun_query_throttle)
    assert "now = _community_stun_clock()" in source
    assert "time.monotonic()" not in source


def test_skips_a_bridge_without_the_names():
    class Bridge:
        def handle_get_community_stun_endpoints(self, req_id):
            return None

    bridge = Bridge()
    before = bridge.handle_get_community_stun_endpoints
    h._install_community_stun_query_throttle(bridge)
    assert bridge.handle_get_community_stun_endpoints == before


def test_start_installs_the_throttle():
    with open(h.__file__, encoding="utf-8") as source:
        text = source.read()
    start = text.index("def start(config_dir):")
    body = text[start : text.index("\ndef ", start + 1)]
    gates = body.index("_install_network_pause_gates(pb)")
    throttle = body.index("_install_community_stun_query_throttle(pb)")
    assert gates < throttle < body.index("def _run():")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
