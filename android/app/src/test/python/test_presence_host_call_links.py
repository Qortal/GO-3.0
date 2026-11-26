"""The links of a call, right after a switch of network.

Over which hub a link is asked for, how soon it is asked for again, and that
the overlay link to the call's peer comes before the others. Runs the real
Android presence_bridge with the hooks of qortal_presence_host.py; nothing is
sent:

    python3 android/app/src/test/python/test_presence_host_call_links.py

It also works under pytest.
"""

import os
import sys
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import RNS  # noqa: E402  (the vendored one)
import presence_bridge as pb  # noqa: E402  (the real Android bridge)
import qortal_presence_host as h  # noqa: E402
from _host_test_support import _wait_for  # noqa: E402

PEER = "ab" * 16
PEER_BYTES = bytes.fromhex(PEER)
NEIGHBOUR = "cd" * 16
Transport = RNS.Transport
PATH_HUB = sys.modules["RNS.Transport"].IDX_PT_RVCD_IF


class Hub:
    def __init__(self, name, online=True, initiator=True):
        self.name = name
        self.online = online
        self.initiator = initiator

    def __str__(self):
        return self.name


class Link:
    PENDING, HANDSHAKE, ACTIVE, STALE, CLOSED = range(5)
    INITIATOR_CLOSED = 2
    made = []

    def __init__(self, destination=None, established_callback=None, closed_callback=None):
        self.over = Transport.next_hop_interface(PEER_BYTES)
        self.initiator = True
        self.expected_hops = 2
        self.at = time.monotonic()
        self.status = Link.PENDING
        self.torn = 0
        Link.made.append(self)

    def set_link_closed_callback(self, callback):
        pass

    def teardown(self):
        self.torn += 1
        self.status = Link.CLOSED

    def link_closed(self):
        self.closed = True


requested = []
ran = []
tasks = []
answer_over = []
_hooked = []


def _path_over(hub):
    entry = [time.time(), b"\x00" * 16, 2, time.time() + 1000, [], None, None]
    entry[PATH_HUB] = hub
    Transport.path_table[PEER_BYTES] = entry


def _path():
    return Transport.next_hop_interface(PEER_BYTES)


def _request_path(destination_hash, *args, **kwargs):
    requested.append(time.monotonic())
    known = Transport.path_table.get(PEER_BYTES)
    # None, or one the bridge has marked as expired.
    if answer_over and (known is None or known[0] == 0):
        threading.Timer(0.1, lambda: _path_over(answer_over[0])).start()


def _run_task(lane, name, function, *args, **kwargs):
    ran.append((lane, name))
    tasks.append(threading.Thread(target=function, args=args, kwargs=kwargs, daemon=True))
    tasks[-1].start()
    return True


def _setup():
    Transport.request_path = _request_path
    RNS.Link = Link
    pb._destination = object()
    pb._get_group_audio_peer_identity = lambda peer: object()
    pb.build_outbound_destination = lambda identity: types.SimpleNamespace(hash=PEER_BYTES)
    pb.emit_event = lambda *args, **kwargs: None
    pb._enqueue_scheduler_task = _run_task
    # The waits for a lost request are short here, so is this.
    pb._PACKET_PATH_ACTIVE_REQUEST_COOLDOWN_SECONDS = 0.05
    if _hooked:
        return
    _hooked.extend((pb._ensure_call_media_path, pb._schedule_audio_link_establish_timeout))
    h._install_call_link_opening(pb)
    hooks = [pb._ensure_call_media_path, pb._schedule_audio_link_establish_timeout]
    assert all(new is not old for new, old in zip(hooks, _hooked))
    h._install_call_link_opening(pb)
    assert hooks == [
        pb._ensure_call_media_path,
        pb._schedule_audio_link_establish_timeout,
    ], "installed once"


def _clean(*hubs):
    Transport.interfaces = list(hubs)
    Transport.path_table.clear()
    # Until nothing of the check before asks for a link any more.
    while True:
        with pb._state_lock:
            for desired in pb._audio_link_desired_by_peer_hash.values():
                desired["desired"] = False
        time.sleep(0.02)
        if not any(task.is_alive() for task in tasks):
            break
    del tasks[:]
    pb._audio_links_by_id.clear()
    pb._audio_link_ids_by_object.clear()
    pb._active_audio_link_id_by_peer_hash.clear()
    pb._outgoing_audio_link_id_by_peer_hash.clear()
    pb._audio_link_desired_by_peer_hash.clear()
    pb._call_media_path_state.clear()
    pb._peer_lifecycle.clear()
    del Link.made[:], requested[:], ran[:], answer_over[:]


def _open(reason="closed:2"):
    began = time.monotonic()
    ok, payload, error = pb._open_group_audio_link_for_peer(PEER, retry_reason=reason)
    assert ok, (payload, error)
    assert len(Link.made) == 1
    return time.monotonic() - began


def test_a_path_over_a_hub_that_is_offline():
    _setup()
    h._PATH_HUB_WAIT_SECONDS = 0.4
    a, b = Hub("a"), Hub("b")

    # Up: asked at once, over it.
    _clean(a, b)
    _path_over(b)
    assert _open() < 0.1 and Link.made[0].over is b

    # Being dialled: the request waits for it, and goes over it.
    b.online = False
    _clean(a, b)
    _path_over(b)
    b._qortal_dialling = time.monotonic()

    def up():
        b.online = True
        time.sleep(0.05)  # the dial is over a moment after that
        b._qortal_dialling = None

    threading.Timer(0.15, up).start()
    took = _open()
    assert 0.19 < took < 0.33, took
    assert Link.made[0].over is b and b._qortal_dialling is None

    # Up, and its dial takes longer than the request waits: its path stays.
    b.online = False
    _clean(a, b)
    _path_over(b)
    b._qortal_dialling = time.monotonic()
    threading.Timer(0.15, lambda: setattr(b, "online", True)).start()
    took = _open()
    assert 0.38 < took < 0.6, took
    assert Link.made[0].over is b and _path() is b

    # It does not come up in time: another hub is asked for a path.
    b.online = False
    _clean(a, b)
    _path_over(b)
    b._qortal_dialling = time.monotonic()
    answer_over.append(a)
    took = _open()
    assert 0.48 < took < 0.8, took
    assert Link.made[0].over is a and requested

    # Its dial has ended without success, or takes too long already: at once.
    for dialling in (None, time.monotonic() - h._CALL_SLOW_DIAL_SECONDS):
        _clean(a, b)
        _path_over(b)
        b._qortal_dialling = dialling
        answer_over.append(a)
        took = _open()
        assert 0.09 < took < 0.3, took
        assert Link.made[0].over is a and requested

    # The other one has only just come up: it may be gone again in a moment.
    a._qortal_dial_seconds = 0.1
    for stays in (True, False):
        _clean(a, b)
        _path_over(b)
        answer_over.append(a)
        a._qortal_connected_at = time.monotonic()
        if not stays:
            threading.Timer(0.05, lambda: setattr(a, "online", False)).start()
        took = _open()
        if stays:
            assert 0.24 < took < 0.45, took
            assert Link.made[0].over is a
        else:
            assert 0.04 < took < 0.2, took
            assert Link.made[0].over is b and _path() is b
    a.online = True
    del a._qortal_connected_at, a._qortal_dial_seconds

    # No hub is up: nothing better than the path there is.
    a.online = False
    _clean(a, b)
    _path_over(b)
    b._qortal_dialling = None
    assert _open() < 0.1 and Link.made[0].over is b and _path() is b

    # No path at all, or one that is not over a hub.
    a.online = True
    _clean(a, b)
    answer_over.append(a)
    assert _open() < 0.3 and Link.made[0].over is a
    lan = Hub("lan", online=False, initiator=False)
    _clean(a, lan)
    _path_over(lan)
    assert _open() < 0.1 and Link.made[0].over is lan

    # Audio that goes without a link never waits.
    _clean(a, b)
    _path_over(b)
    b._qortal_dialling = time.monotonic()
    began = time.monotonic()
    pb._ensure_call_media_path(PEER, PEER_BYTES, allow_wait=False, reason="audio_send")
    assert time.monotonic() - began < 0.1 and _path() is b
    b._qortal_dialling = None
    b.online = True

    # The check never fails the open.
    real, h._hub_interfaces = h._hub_interfaces, lambda: 1 / 0
    b.online = False
    try:
        _clean(a, b)
        _path_over(b)
        assert _open() < 0.1 and Link.made[0].over is b
    finally:
        h._hub_interfaces = real
    b.online = True


def test_a_link_request_that_gets_lost():
    _setup()
    h._CALL_LINK_SECONDS = 0.2
    h._CALL_LINK_DIALS = 8.0
    a, b = Hub("a"), Hub("b")
    for hub in (a, b):
        hub._qortal_call_redial_until = time.monotonic() + 30
        hub._qortal_dial_seconds = 0.005

    # Not answered: given up after 0.2 s, and asked again at once. Later ones
    # may take longer, and go another way.
    forgotten = []
    real_forget = h._forget_path_over
    h._forget_path_over = lambda hub, peer: forgotten.append((hub, peer)) or real_forget(hub, peer)
    _clean(a, b)
    _path_over(b)
    answer_over.append(b)
    _open()
    first = Link.made[0]
    assert _wait_for(lambda: first.torn == 1)
    assert 0.18 < time.monotonic() - first.at < 0.35
    assert ("audio-control", "audio-link-establish-timeout") in ran
    assert forgotten == [(b, PEER_BYTES)], "its path may be why"
    assert _wait_for(lambda: len(Link.made) == 2), "asked again"
    second = Link.made[1]
    # 0.1 s of it is the stand-in's answer to the request for a path.
    assert second.at - first.at < 0.6, "not after the bridge's wait of 1 s"
    assert second.over is b and requested
    answer_over[0] = a
    assert _wait_for(lambda: second.torn == 1)
    assert 0.38 < time.monotonic() - second.at < 0.55
    assert forgotten == [(b, PEER_BYTES)] * 2
    assert _wait_for(lambda: len(Link.made) == 3)
    assert Link.made[2].over is a and Link.made[2].at - second.at < 0.8
    h._forget_path_over = real_forget
    # However many hops the answer comes over: the path may be out of date.
    assert _wait_for(
        lambda: all(link.expected_hops == Transport.PATHFINDER_M for link in Link.made)
    )

    # Answered in time: it stays.
    _clean(a, b)
    _path_over(b)
    _open()
    for state in pb._audio_links_by_id.values():
        state["established"] = True
    time.sleep(0.35)
    assert Link.made[0].torn == 0 and not ran

    # Answered, and the bridge has yet to hear of it: it stays.
    for status in (Link.HANDSHAKE, Link.ACTIVE, Link.CLOSED):
        _clean(a, b)
        _path_over(b)
        _open()
        Link.made[0].status = status
        time.sleep(0.35)
        assert Link.made[0].torn == 0 and not ran and len(Link.made) == 1, status
    # Also when the answer comes after the look and before its turn.
    _clean(a, b)
    _path_over(b)
    late = []
    pb._enqueue_scheduler_task = lambda lane, name, function, *args: late.append(function)
    _open()
    assert _wait_for(lambda: len(late) == 1)
    Link.made[0].status = Link.HANDSHAKE
    late[0]()
    assert Link.made[0].torn == 0 and _path() is b and len(Link.made) == 1
    pb._enqueue_scheduler_task = _run_task

    # Closed meanwhile: the new one is not touched.
    _clean(a, b)
    _path_over(b)
    _open()
    pb._audio_links_by_id.clear()
    pb._outgoing_audio_link_id_by_peer_hash.clear()
    time.sleep(0.35)
    assert Link.made[0].torn == 0 and not ran

    # A hub that takes long to answer: so may the peer.
    b._qortal_dial_seconds = 0.05
    _clean(a, b)
    _path_over(b)
    _open()
    time.sleep(0.3)
    assert Link.made[0].torn == 0
    assert _wait_for(lambda: Link.made[0].torn == 1)
    assert 0.38 < time.monotonic() - Link.made[0].at < 0.6

    # No earlier than the bridge's own time-out, not without a switch in a
    # call, and not for a link that came in: the 12 s as ever.
    timers = []
    real = threading.Timer

    class Timer(real):
        def __init__(self, interval, function, *args, **kwargs):
            timers.append(interval)
            super().__init__(interval, function, *args, **kwargs)

    threading.Timer = Timer
    try:
        for dial, until, expected in (
            (0.0, 30, [12.0, 0.2]),
            (0.1, 30, [12.0, 0.8]),
            (1.5, 30, [12.0]),
            (0.0, -1, [12.0]),
        ):
            b._qortal_dial_seconds = dial
            a._qortal_call_redial_until = b._qortal_call_redial_until = (
                time.monotonic() + until
            )
            _clean(a, b)
            _path_over(b)
            del timers[:]
            _open()
            assert [round(t, 3) for t in timers] == expected, (dial, until, timers)
        # Which try it is counts.
        b._qortal_dial_seconds = 0.0
        b._qortal_call_redial_until = time.monotonic() + 30
        for attempts, expected in ((0, 0.2), (1, 0.4), (2, 0.6), (3, 0.8)):
            _clean(a, b)
            _path_over(b)
            pb._set_audio_link_desired(PEER, True)["attempts"] = attempts
            del timers[:]
            _open()
            assert [round(t, 3) for t in timers] == [12.0, expected], (attempts, timers)
        # A link that came in, and one that is gone.
        for state in ({"incoming": True, "peerPresenceHash": PEER}, None):
            _clean(a, b)
            _path_over(b)
            if state:
                pb._audio_links_by_id["x"] = state
            del timers[:]
            h._ask_again_soon(pb, "x")
            assert timers == []
        # A path over another hub than the one redialled: that one may still
        # be stuck from before.
        b._qortal_dial_seconds, b._qortal_call_redial_until = 0.0, 0.0
        a._qortal_call_redial_until = time.monotonic() + 30
        _clean(a, b)
        _path_over(b)
        del timers[:]
        _open()
        assert [round(t, 3) for t in timers] == [12.0, 0.2], timers
        a._qortal_call_redial_until = 0.0
        # The hub before the first dial, no path, or a peer that is not known.
        fresh = Hub("c")
        fresh._qortal_call_redial_until = time.monotonic() + 30
        for peer, over, expected in (
            (PEER, fresh, [0.2]),
            (PEER, None, []),
            ("", fresh, []),
        ):
            _clean(a, b)
            if over:
                _path_over(over)
            pb._audio_links_by_id["x"] = {"peerPresenceHash": peer}
            del timers[:]
            h._ask_again_soon(pb, "x")
            assert timers == expected, (peer, over)
    finally:
        threading.Timer = real

    # Never instead of the bridge's own time-out, whatever goes wrong here.
    _clean(a, b)
    _path_over(b)
    real_ask, h._ask_again_soon = h._ask_again_soon, lambda pb, link_id: 1 / 0
    try:
        _open()
    finally:
        h._ask_again_soon = real_ask
    _clean(a, b)


def test_any_number_of_hops():
    _setup()
    mine, theirs = Link(), Link()
    theirs.initiator = False  # it came in: nothing to wait for
    h._take_any_hops({"link": mine})
    h._take_any_hops({"link": theirs})
    assert (mine.expected_hops, theirs.expected_hops) == (Transport.PATHFINDER_M, 2)
    for nothing in (None, {}, {"link": None}):
        h._take_any_hops(nothing)
    # The check this is about, and the value it lets pass.
    with open(sys.modules["RNS.Transport"].__file__, encoding="utf-8") as fh:
        source = fh.read()
    assert (
        "if packet.hops == link.expected_hops or "
        "link.expected_hops == RNS.Transport.PATHFINDER_M:"
    ) in source
    del Link.made[:]


def test_the_overlay_link_of_a_call_comes_first():
    _setup()
    a, b = Hub("a"), Hub("b")
    _clean(a, b)
    opened = []
    known = []
    real = pb._ensure_overlay_link, pb.ensure_known_peer_from_recall

    def ensure(peer, await_path, open_reason):
        assert threading.current_thread().name == "presence-host-call-overlay"
        assert await_path is True and open_reason == "call_signal_prepare"
        opened.append((peer, _path()))
        if peer == PEER and fail:
            raise RuntimeError("no path")
        return {"link": Link()} if len(opened) == 1 else None

    pb._ensure_overlay_link = ensure
    pb.ensure_known_peer_from_recall = lambda peer, source: known.append(peer)
    fail = []

    def links(incoming):
        mine, theirs, other = Link(), Link(), Link()
        for link in (mine, theirs, other):
            link.status = Link.ACTIVE
        pb._overlay_links_by_id.clear()
        pb._overlay_links_by_id.update(
            {
                "1": {"link": mine, "peerPresenceHash": PEER.upper(), "incoming": incoming},
                "2": {"link": theirs, "peerPresenceHash": NEIGHBOUR, "incoming": False},
                "3": {"link": Link(), "peerPresenceHash": "ef" * 16, "incoming": False},
            }
        )
        return [mine, theirs, other]

    try:
        wanted = {"desired": True, "last_open_attempt_at": time.time()}
        pb._audio_link_desired_by_peer_hash.update(
            {PEER: wanted, NEIGHBOUR: dict(wanted, desired=False), "ef" * 16: wanted}
        )
        # Whichever phone had opened it.
        for incoming in (True, False):
            del opened[:], known[:]
            _path_over(b)
            assert h._close_dead_links(links(incoming)) == 3
            assert _wait_for(lambda: opened == [(PEER, b)])
            assert known == [PEER]
            assert _wait_for(lambda: Link.made[-1].expected_hops == Transport.PATHFINDER_M)
            assert Link.made[-2].expected_hops == 2, "only the one just asked for"
        # Its path must not go over a hub that is offline.
        del opened[:]
        b.online = False
        assert h._close_dead_links(links(False)) == 3
        assert _wait_for(lambda: opened == [(PEER, None)])
        b.online = True
        # An error there ends nothing.
        fail.append(True)
        del opened[:]
        assert h._close_dead_links(links(True)) == 3
        assert _wait_for(lambda: len(opened) == 1)
        # The other phone had opened the call's link: the page wants none here.
        del opened[:]
        pb._audio_link_desired_by_peer_hash.pop(PEER)
        pb._audio_links_by_id["1"] = {"peerPresenceHash": PEER.upper(), "incoming": True}
        assert h._close_dead_links(links(True)) == 3
        assert _wait_for(lambda: len(opened) == 1)
        # No call (any more), signed out or swiped away, or no overlay link
        # among them.
        del opened[:]
        pb._audio_links_by_id["1"]["closing"] = True
        assert h._close_dead_links(links(True)) == 3
        pb._audio_links_by_id.clear()
        assert h._close_dead_links(links(True)) == 3
        pb._audio_link_desired_by_peer_hash[PEER] = dict(wanted, desired=False)
        assert h._close_dead_links(links(True)) == 3
        pb._audio_link_desired_by_peer_hash[PEER] = dict(
            wanted, last_open_attempt_at=time.time() - h._CALL_WANTED_SECONDS - 1
        )
        assert h._close_dead_links(links(True)) == 3
        pb._audio_link_desired_by_peer_hash[PEER] = wanted
        h._network_paused = True
        assert h._close_dead_links(links(True)) == 3
        assert _wait_for(
            lambda: not [t for t in threading.enumerate() if "call-overlay" in t.name]
        )
        h._network_paused = False
        lost = links(True)
        pb._overlay_links_by_id.clear()
        assert h._close_dead_links(lost) == 3
        time.sleep(0.1)
        assert opened == []
    finally:
        h._network_paused = False
        pb._ensure_overlay_link, pb.ensure_known_peer_from_recall = real
        pb._overlay_links_by_id.clear()
        _clean(a, b)


def test_a_hub_that_is_back_after_a_longer_outage():
    """Tries made without a hub do not count, and their waits are over."""
    _setup()
    a, b = Hub("a"), Hub("b")

    def tried(attempts, delay=20.0, **extra):
        _clean(a, b)
        _path_over(b)
        desired = pb._set_audio_link_desired(PEER, True)
        desired.update(
            attempts=attempts,
            retry_delay=delay,
            max_attempts_emitted=attempts >= 4,
            last_open_attempt_at=time.time() - 30,
            **extra,
        )
        return desired

    # Given up: without the hook the bridge refuses for 10 s and more.
    desired = tried(4)
    assert pb._open_group_audio_link_for_peer(PEER)[0] is False
    h._ask_for_call_links(b)
    assert _wait_for(lambda: len(Link.made) == 1, 0.5), "asked for at once"
    assert desired["retry_delay"] == pb._AUDIO_LINK_RETRY_MIN_SECONDS
    assert desired["attempts"] == 1 and not desired["max_attempts_emitted"]

    # Waiting for its next try.
    desired = tried(2)
    pb._schedule_audio_link_retry(PEER, "no_route:stale")
    waiting = desired["retry_timer"]
    assert waiting is not None and not Link.made
    h._ask_for_call_links(b)
    assert _wait_for(lambda: len(Link.made) == 1)
    assert waiting.finished.is_set() or not waiting.is_alive(), "cancelled"

    # One that is up, or under way, is enough.
    for state in ({"established": True}, {"established": False}):
        desired = tried(4)
        pb._audio_links_by_id["x"] = dict(
            state, peerPresenceHash=PEER, link=Link(), created_at=time.time()
        )
        del Link.made[:]
        h._ask_for_call_links(b)
        time.sleep(0.1)
        assert not Link.made and desired["attempts"] == 0
        assert desired["retry_delay"] == pb._AUDIO_LINK_RETRY_MIN_SECONDS

    # Its path is asked for when there is none, on the hub that is back: a
    # request made before that got lost.
    paths = []
    Transport.request_path = lambda peer, on_interface=None: paths.append((peer, on_interface))
    real = pb._schedule_audio_link_retry
    pb._schedule_audio_link_retry = lambda *args, **kwargs: None
    try:
        tried(2)
        h._ask_for_call_links(b)
        assert paths == []
        desired = tried(2)
        Transport.path_table.clear()
        pb._audio_links_by_id["x"] = {"peerPresenceHash": NEIGHBOUR, "incoming": True}
        h._ask_for_call_links(b)
        assert dict(paths) == {PEER_BYTES: b, bytes.fromhex(NEIGHBOUR): b}
        assert len(paths) == 2
        # An error there does not keep it from asking for the link.
        Transport.request_path = lambda peer, on_interface=None: 1 / 0
        desired["attempts"] = 2
        h._ask_for_call_links(b)
        assert desired["attempts"] == 0
    finally:
        Transport.request_path = _request_path
        pb._schedule_audio_link_retry = real

    # An error there costs the redial nothing.
    desired = tried(4)
    real = pb._schedule_audio_link_retry
    pb._schedule_audio_link_retry = lambda *args, **kwargs: 1 / 0
    try:
        h._ask_for_call_links(b)
    finally:
        pb._schedule_audio_link_retry = real
    assert desired["attempts"] == 0

    # Not wanted, or no call.
    desired = tried(4)
    desired["desired"] = False
    h._ask_for_call_links(b)
    desired = tried(4)
    desired["last_open_attempt_at"] = time.time() - h._CALL_WANTED_SECONDS - 1
    h._ask_for_call_links(b)
    _clean(a, b)
    pb._audio_links_by_id["x"] = {"peerPresenceHash": NEIGHBOUR, "incoming": True}
    h._ask_for_call_links(b)
    time.sleep(0.1)
    assert not Link.made
    _clean(a, b)


def test_waits_between_dials():
    _setup()
    a = Hub("a")
    _clean(a)
    h._CALL_REDIAL_SECONDS = 0.1
    assert _wait_for(lambda: h._call_watch is None), "of the checks before"
    assert not h._call_began.is_set()
    h._STALL_WATCH_SECONDS = 0.02
    looks = []
    real = h._look_at_call_hubs, h._in_call
    h._look_at_call_hubs = lambda watch: None
    h._in_call = lambda: looks.append(time.monotonic()) or real[1]()
    try:
        began = time.monotonic()
        assert h._wait_for_next_dial(0.35) is False
        assert 0.34 < time.monotonic() - began < 0.5, "the whole wait without a call"
        assert len(looks) == 1, "and nothing wakes up for it meanwhile"
        pb._audio_links_by_id["x"] = {"peerPresenceHash": "", "incoming": True}
        began = time.monotonic()
        assert h._wait_for_next_dial(5.0) is True
        assert 0.09 < time.monotonic() - began < 0.2, "a short one in a call"
        began = time.monotonic()
        assert h._wait_for_next_dial(0.05) is True
        assert 0.04 < time.monotonic() - began < 0.09

        # One that begins meanwhile ends the wait.
        pb._audio_links_by_id.clear()

        def begins():
            pb._audio_links_by_id["x"] = {"peerPresenceHash": PEER}
            h._start_call_watch()

        threading.Timer(0.25, begins).start()
        began = time.monotonic()
        assert h._wait_for_next_dial(5.0) is True
        assert 0.24 < time.monotonic() - began < 0.45
        # Once it is over they are long again.
        assert h._call_began.is_set()
        pb._audio_links_by_id.clear()
        assert _wait_for(lambda: not h._call_began.is_set())
        began = time.monotonic()
        assert h._wait_for_next_dial(0.3) is False
        assert time.monotonic() - began > 0.29
        # Between the two it is not asked again and again.
        h._call_began.set()
        began = time.monotonic()
        assert h._wait_for_next_dial(5.0) is False
        assert 0.09 < time.monotonic() - began < 0.2
        h._call_began.clear()
    finally:
        h._look_at_call_hubs, h._in_call = real
        h._STALL_WATCH_SECONDS = 0.5
    _clean(a)


def test_a_packet_that_cannot_be_handled():
    """It costs the hub nothing: RNS redials a hub whose packet raises."""
    real = Transport.inbound
    seen, logged = [], []
    real_log, h._log_host = h._log_host, logged.append
    a = Hub("a")

    def inbound(raw, interface=None):
        seen.append((raw, interface))
        if raw == b"bad":
            raise KeyError(b"path")
        return "result"

    try:
        Transport.inbound = staticmethod(inbound)
        h._install_inbound_guard()
        guarded = Transport.inbound
        assert guarded is not inbound
        h._install_inbound_guard()
        assert Transport.inbound is guarded, "installed once"
        assert Transport.inbound(b"good", a) == "result"
        assert Transport.inbound(b"good") == "result"
        assert Transport.inbound(b"bad", a) is None
        assert seen == [(b"good", a), (b"good", None), (b"bad", a)]
        assert len(logged) == 1 and "KeyError" in logged[0]
        # It is not logged for ever.
        for _ in range(1500):
            Transport.inbound(b"bad", a)
        assert len(logged) == 21
        assert Transport.inbound(b"good", a) == "result"
    finally:
        Transport.inbound = staticmethod(real)
        h._log_host = real_log


def test_everything_is_installed_at_the_start():
    import inspect

    source = inspect.getsource(h.start)
    for call in (
        "_install_inbound_guard()",
        "_install_call_end_resend(pb)",
        "_install_audio_link_choice(pb)",
        "_install_call_link_opening(pb)",
    ):
        assert f"        {call}\n" in source, call


def test_names_in_the_bridge():
    """What the hooks rely on."""
    with open(
        os.path.join(HERE, "..", "..", "main", "python", "presence_bridge.py"),
        encoding="utf-8",
    ) as fh:
        source = fh.read()
    for needle in (
        "    allow_wait: bool = True,\n",
        "def _schedule_audio_link_establish_timeout(link_id: str) -> None:",
        "def _handle_audio_link_establish_timeout(link_id: str) -> None:",
        "_AUDIO_LINK_ESTABLISH_TIMEOUT_SECONDS = 12.0",
        '"open_attempt": desired["attempts"],',
        "_audio_link_desired_by_peer_hash: Dict[",
        'desired["last_open_attempt_at"] = time.time()',
        "def _cancel_audio_link_retry_timer(peer_key: str) -> None:",
        "def _schedule_audio_link_retry(peer_key: str, reason: str, immediate: bool = False) -> None:",
        "    delay = 0.0 if immediate else float(\n",
        '            "audio-control",\n            "audio-link-establish-timeout",\n',
        "def configure_audio_link(link, link_id: str) -> None:",
        "def _overlay_clear_no_path(peer_key: str) -> None:",
        "        _schedule_audio_link_establish_timeout(link_id)\n",
        "        path_state, path_ready = _ensure_call_media_path(\n",
    ):
        assert needle in source, needle


if __name__ == "__main__":
    test_a_path_over_a_hub_that_is_offline()
    test_a_link_request_that_gets_lost()
    test_any_number_of_hops()
    test_the_overlay_link_of_a_call_comes_first()
    test_a_hub_that_is_back_after_a_longer_outage()
    test_waits_between_dials()
    test_a_packet_that_cannot_be_handled()
    test_everything_is_installed_at_the_start()
    test_names_in_the_bridge()
    print("ALL OK")
    # The bridge's own 12 s timers are still waiting.
    sys.stdout.flush()
    os._exit(0)
