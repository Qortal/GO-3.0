"""Hub connections that stall while a call runs (a dead spot, a hub that is gone).

What the kernel says about the connections is played here; the lab
tools/call-switch-lab/stall.py does it with real packet loss. Without Chaquopy
or a network:

    python3 android/app/src/test/python/test_presence_host_call_watch.py

It also works under pytest.
"""

import os
import socket
import sys
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

from _host_test_support import _wait_for  # noqa: E402

PEER = "ab" * 16


class Transport:
    interfaces = []


rns = types.ModuleType("RNS")
rns.Transport = Transport
sys.modules["RNS"] = rns
pb = types.ModuleType("presence_bridge")
pb._state_lock = threading.RLock()
pb._audio_links_by_id = {}
pb._audio_link_desired_by_peer_hash = {}
sys.modules["presence_bridge"] = pb

import qortal_presence_host as h  # noqa: E402

FINE = (0, 40, 20)


class Hub:
    def __init__(self, name):
        self.name = name
        self.initiator = True
        self.online = True
        self.socket = f"{name}-socket"
        self.state = FINE
        self.answers = False
        self.backlog = 0
        self._qortal_address = (socket.AF_INET, (name, 4444))

    def __str__(self):
        return self.name


class Play:
    """Three hubs, what is asked of them and what is replaced."""

    def __init__(self):
        self.hubs = [Hub("a"), Hub("b"), Hub("c")]
        self.asked, self.replaced, self.kept, self.poked = [], [], [], []
        self.during = None
        self.spares = {}
        Transport.interfaces = list(self.hubs)
        Transport.request_path = lambda peer, on_interface: self.poked.append(
            (peer, on_interface.name)
        )
        self.real = {
            name: getattr(h, name)
            for name in (
                "_connection_state",
                "_dial_beside",
                "_backlog",
                "_replace_connection",
                "_close_when_old",
            )
        }
        h._connection_state = self.state
        h._dial_beside = self.dial
        h._backlog = lambda hub, sock: hub.backlog
        h._replace_connection = lambda *args: self.replaced.append(args)
        h._close_when_old = lambda sock, since: sock and self.kept.append((sock, since))
        pb._audio_links_by_id["x"] = {"peerPresenceHash": PEER}

    def state(self, sock):
        """What the kernel says; data went out just now unless it says when."""
        hub = next((hub for hub in self.hubs if hub.socket == sock), None)
        if hub is None or hub.state is None:
            return None
        return tuple(hub.state) + (0,) * (4 - len(hub.state))

    def dial(self, hub):
        self.asked.append(hub.name)
        if self.during:
            self.during()
        return (f"{hub.name}-new", 1.0) if hub.answers else None

    def tried(self):
        return sorted(self.asked)

    def look(self, stalled):
        for seen in (self.asked, self.replaced, self.kept, self.poked):
            del seen[:]
        watch = types.SimpleNamespace(stalled=stalled, spares=self.spares)
        h._look_at_call_hubs(watch)
        assert _wait_for(
            lambda: not [t for t in threading.enumerate() if t.name == "presence-host-refresh"]
        )
        return sorted(args[0].name for args in self.replaced)

    def seen(self, *hubs, ago=20.0):
        """They were seen to stall a while ago: by default long enough for a
        dead spot (_DEAD_SPOT_SECONDS)."""
        return {hub: (hub.socket, time.monotonic() - ago) for hub in hubs}

    def just_seen(self, *hubs):
        return self.seen(*hubs, ago=h._DEAD_SPOT_SECONDS - 0.5)

    def over(self):
        pb._audio_links_by_id.clear()
        for name, value in self.real.items():
            setattr(h, name, value)
        Transport.interfaces = []


def test_what_counts_as_stalled():
    play = Play()
    a, b, c = play.hubs
    try:
        stalled = {}
        for state in (
            FINE,
            (1, 1999, 9000),  # answers come, late
            (0, 60000, 60000),  # nothing is owed
            None,  # the kernel does not say
        ):
            b.state = state
            for _ in range(2):
                assert play.look(stalled) == [] and not play.asked and not stalled, state
            assert not play.poked
        # Seen once: it may have been idle before, so its last answer is old.
        b.state = (1, 2000, 2000)
        before = time.monotonic()
        assert play.look(stalled) == [] and not play.asked and not play.poked
        assert list(stalled) == [b] and stalled[b][0] is b.socket
        since = stalled[b][1]
        assert before <= since <= time.monotonic()
        # Still so.
        b.state = (2, 2500, 2500)
        assert play.look(stalled) == [] and play.asked == ["b"]
        assert stalled[b][1] == since
        # Answers again, and has nothing old left to send.
        for state in ((0, 10, 10), (0, 3000, 10), None):
            stalled[b] = (b.socket, since)
            b.state = state
            assert play.look(stalled) == [] and not stalled and not play.asked, state
        # Answers again, but seconds of old voice are still to go: it stays.
        b.state = (0, 10, 10)
        for backlog, stays in ((h._STUCK_BYTES + 1, True), (h._STUCK_BYTES, False)):
            b.backlog = backlog
            stalled[b] = (b.socket, since)
            play.look(stalled)
            assert (b in stalled) is stays and stalled.get(b, (0, since))[1] == since
        # Nothing could even go out for a while (Android blocks GO's network):
        # the kernel counts no tries then.
        b.backlog = 0
        for sent_ms, backlog, seen in (
            (2000, 100, True),
            (1999, 100, False),  # it went out a moment ago
            (9000, 0, False),  # nothing is waiting
        ):
            b.state, b.backlog = (0, 5000, 5000, sent_ms), backlog
            stalled.clear()
            play.look(stalled)
            assert (b in stalled) is seen, (sent_ms, backlog)
        b.state, b.backlog = (0, 5000, 5000, 9000), 100
        stalled = {b: (b.socket, time.monotonic() - 1)}
        b.answers = True
        assert play.look(stalled) == ["b"], "and replaced once the network is back"
        b.answers = False
        b.state = (0, 10, 10)
        # Only what has stalled first: a slow network may hold that much.
        b.backlog = 10 * h._STUCK_BYTES
        stalled.clear()
        assert play.look(stalled) == [] and not stalled
        b.backlog = 0
        # Offline, or on a new connection: its own story.
        since = time.monotonic() - 3.0
        b.state = (2, 2700, 2700)
        stalled[b] = (b.socket, since)
        b.online = False
        assert play.look(stalled) == [] and not stalled
        b.online = True
        before, b.socket = b.socket, None
        stalled[b] = (before, since)
        assert play.look(stalled) == [] and not stalled
        b.socket = before
        before, b.socket = b.socket, "b-other"
        stalled[b] = (before, since)
        assert play.look(stalled) == [] and not play.asked
        assert stalled[b][0] == "b-other" and stalled[b][1] > since
        # It stays what it is while it is stuck.
        b.state = (1, 1800, 1800)
        play.look(stalled)
        assert list(stalled) == [b] and stalled[b][0] == "b-other"
    finally:
        play.over()


def test_a_dead_spot():
    play = Play()
    a, b, c = play.hubs
    try:
        stalled = {}
        a.state = b.state = (3, 5000, 5000)
        c.state = (0, 5000, 5000)  # nothing is owed, so nothing is known
        assert play.look(stalled) == [] and set(stalled) == {a, b}
        assert not play.asked and not play.poked
        # It is sent something, so that its kernel would have to answer. All
        # that stall are dialled at once.
        assert play.look(stalled) == [] and play.tried() == ["a", "b"]
        assert play.poked == [(bytes.fromhex(PEER), "c")]
        # Now it owes one as well. It is dialled only once that was seen twice.
        c.state = (3, 5000, 5000)
        stalled = play.seen(a)
        assert play.look(stalled) == [] and set(stalled) == {a, b, c}
        assert play.asked == ["a"] and not play.poked
        # No answer: the connections stay as they are, however long it takes.
        stalled = play.seen(a, b, c)
        for _ in range(3):
            assert play.look(stalled) == [] and not play.kept and not play.poked
            assert play.tried() == ["a", "b", "c"]
        # The network is back: all of them are replaced, each by the new
        # connection that it has.
        b.answers = True
        assert play.look(stalled) == ["a", "b", "c"] and play.tried() == ["a", "b", "c"]
        assert stalled == {} and not play.kept
        assert sorted(play.replaced, key=lambda args: args[0].name) == [
            (a, a.socket, None),
            (b, b.socket, ("b-new", 1.0)),
            (c, c.socket, None),
        ]
        for hub in play.hubs:
            hub.answers = True
        assert play.look(play.seen(a, c)) == ["a", "b", "c"]
        assert sorted(args[2][0] for args in play.replaced if args[2]) == ["a-new", "c-new"]
        for hub in play.hubs:
            hub.answers = False
        # After a dead spot, one that was seen only now goes as well, and so do
        # those that never stalled (nothing went out over them): the hubs' own
        # sides wait ever longer before they send again.
        b.answers = True
        stalled = play.seen(a, b)
        assert play.look(stalled) == ["a", "b", "c"] and not stalled
        c.state = FINE
        stalled = play.seen(a, b)
        assert play.look(stalled) == ["a", "b", "c"] and not stalled
        assert sorted(args[2] is None for args in play.replaced) == [False, True, True]
        # A short one: only what stalled, once it was seen twice.
        c.state = (3, 5000, 5000)
        stalled = play.just_seen(a, b)
        assert play.look(stalled) == ["a", "b"] and list(stalled) == [c]
        b.answers = False

        # Gets across again, or will in a moment: it stays, and its new
        # connection is kept for a while, in case it is needed after all.
        # Stuck for long, or with seconds of old voice: replaced.
        for hub in play.hubs:
            hub.answers = True
        for state, backlog, replaced in (
            ((0, 30, 30), 0, ["a", "c"]),
            ((1, 3900, 30), 0, ["a", "c"]),
            ((1, 4000, 30), 0, ["a", "b", "c"]),
            ((0, 30, 30), h._STUCK_BYTES + 1, ["a", "b", "c"]),
        ):
            play.spares.clear()
            for hub in play.hubs:
                hub.state, hub.backlog = (3, 5000, 5000), 0
            play.during = lambda: setattr(b, "state", state) or setattr(b, "backlog", backlog)
            stalled = play.just_seen(a, b, c)
            assert play.look(stalled) == replaced, (state, backlog)
            assert list(stalled) == ([] if "b" in replaced else [b])
            assert not play.kept
            assert list(play.spares) == ([] if "b" in replaced else [b])
        # The spare is used once it is needed, and no other is made meanwhile.
        play.spares.clear()
        b.backlog = 0
        a.state = c.state = FINE
        b.state = (1, 3900, 30)
        stalled = play.just_seen(b)
        play.during = None
        assert play.look(stalled) == [] and play.spares[b] == ("b-new", 1.0)
        spare_made = time.monotonic()
        play.spares[b] = ("b-new", spare_made)
        b.answers = False
        assert play.look(stalled) == [] and play.asked == [] and b in play.spares
        b.state = (1, 4100, 30)
        assert play.look(stalled) == ["b"] and play.asked == []
        assert play.replaced == [(b, b.socket, ("b-new", spare_made))] and not play.spares
        # One made long ago is no proof: closed, and asked again.
        a.state = c.state = (0, 9000, 9000)  # and nothing is heard from the others
        b.state = (1, 4100, 30)
        play.spares[b] = ("b-old", time.monotonic() - h._SPARE_SECONDS - 0.1)
        assert play.look(play.just_seen(b)) == [] and play.asked == ["b"]
        assert [sock for sock, _ in play.kept] == ["b-old"] and not play.spares
        # Got across after all: the spare is closed (once it is old).
        b.answers = True
        b.state = (1, 3000, 30)
        stalled = play.just_seen(b)
        play.look(stalled)
        assert b in play.spares and b in stalled
        b.state = FINE
        assert play.look(stalled) == [] and not stalled and not play.spares
        assert [sock for sock, _ in play.kept] == ["b-new"]
        b.answers = False
        b.backlog = 0
        # Closed meanwhile: the reconnect loop has it.
        for hub in play.hubs:
            hub.state, hub.answers = (3, 5000, 5000), True
        play.during = lambda: setattr(b, "state", None)
        assert play.look(play.just_seen(a, b, c)) == ["a", "c"]
        assert list(play.spares) == [b]
        play.look({})
        assert not play.spares and [sock for sock, _ in play.kept] == ["b-new"]
        # A pause.
        b.state = (3, 5000, 5000)
        play.during = None
        h._network_paused = True
        assert play.look(play.seen(a, b, c)) == [] and play.asked == []
    finally:
        h._network_paused = False
        play.over()


def test_a_hub_that_is_gone():
    play = Play()
    a, b, c = play.hubs
    try:
        # Another one answers: given up 2 s after it was first seen.
        b.state = (2, 4600, 4600)
        for other, gone in (
            ((0, 900, 5000), True),  # it took what it was sent
            ((0, 5000, 900), True),  # something came from it
            ((0, 1000, 1000), False),  # that was before
        ):
            a.state, c.state = (0, 9000, 9000), other
            stalled = {b: (b.socket, time.monotonic() - 2.0)}
            assert play.look(stalled) == (["b"] if gone else []), other
            assert play.asked == ["b"] and bool(stalled) is not gone
            assert [name for _, name in play.poked] == ["a", "c"]
            if gone:
                assert play.replaced == [(b, b.socket, None)]
        c.state = FINE
        stalled = {b: (b.socket, time.monotonic() - 1.9)}
        assert play.look(stalled) == [] and list(stalled) == [b]
        # As long as the dial took, at least a second.
        c.state = (0, 1400, 1400)
        for took, gone in ((0.0, False), (1.5, True)):
            play.during = lambda: setattr(clock, "shift", clock.shift + took)
            stalled = {b: (b.socket, time.monotonic() - 2.0)}
            with Clock() as clock:
                assert play.look(stalled) == (["b"] if gone else []), took
        play.during = None
        # It answers itself: replaced, however short it has been.
        b.answers = True
        stalled = {b: (b.socket, time.monotonic() - 0.01)}
        assert play.look(stalled) == ["b"] and play.replaced[0][2] == ("b-new", 1.0)
        b.answers = False
        # One that is stalled does not count.
        b.state = (2, 4600, 4600)
        a.state, c.state = (4, 6000, 100), (0, 9000, 9000)
        stalled = play.seen(b)
        assert play.look(stalled) == [] and set(stalled) == {a, b}
        assert [name for _, name in play.poked] == ["c"]
        # Of two, only the one that has been so for long.
        c.state = FINE
        stalled = play.seen(b)
        stalled[a] = (a.socket, time.monotonic() - 0.5)
        assert play.look(stalled) == ["b"] and list(stalled) == [a]
        assert play.tried() == ["a", "b"]
        # One that goes offline while the other is dialled.
        a.state = (0, 9000, 9000)
        play.during = lambda: setattr(c, "socket", None)
        assert play.look(play.seen(b)) == []
        play.during = None
        # Nobody to ask about, and errors, cost the dial nothing.
        c.socket = "c-socket"
        pb._audio_links_by_id.clear()
        assert play.look(play.seen(b)) == ["b"] and not play.poked
        pb._audio_links_by_id["x"] = {"peerPresenceHash": "nonsense"}
        assert play.look(play.seen(b)) == ["b"] and play.asked == ["b"]
    finally:
        play.over()


class Clock:
    """time.monotonic() of the module, a little ahead."""

    def __enter__(self):
        self.shift = 0.0
        self.real = h.time
        h.time = types.SimpleNamespace(
            monotonic=lambda: time.monotonic() + self.shift, time=time.time, sleep=time.sleep
        )
        return self

    def __exit__(self, *_exc):
        h.time = self.real


def test_what_the_kernel_says():
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(5)
    client = socket.create_connection(server.getsockname())
    other = server.accept()[0]
    client.sendall(b"hello")
    other.sendall(b"hello")
    assert client.recv(10) and other.recv(10)
    time.sleep(0.3)
    tries, answer_ms, data_ms, sent_ms = h._connection_state(client)
    assert tries == 0 and 290 <= answer_ms < 600 and 290 <= data_ms < 600
    assert 290 <= sent_ms < 600
    other.sendall(b"again")
    assert client.recv(10)
    tries, answer_ms, data_ms, sent_ms = h._connection_state(client)
    assert data_ms < 100
    client.close()
    assert h._connection_state(client) is None

    # struct tcp_info: tries without an answer count only while data is owed.
    def told(tries, unanswered, data_ms, answer_ms, sent_ms=3333):
        import struct

        values = [0] * 21
        values[2], values[12], values[17] = tries, unanswered, sent_ms
        values[19], values[20] = data_ms, answer_ms
        raw = struct.pack("8B13I", *values) + bytes(44)
        return h._connection_state(
            types.SimpleNamespace(getsockopt=lambda level, option, size: raw[:size])
        )

    assert told(5, 3, 1111, 2222) == (5, 2222, 1111, 3333)
    assert told(5, 0, 1111, 2222) == (0, 2222, 1111, 3333)

    # What is still to go: in the kernel, and what the hub has not taken yet.
    hub = types.SimpleNamespace(transmit_buffer=b"x" * 7)
    stuck = socket.create_connection(server.getsockname())
    peer = server.accept()[0]
    assert h._backlog(hub, stuck) == 7
    peer.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    stuck.setblocking(False)
    sent = 0
    try:
        while sent < 4 * 1024 * 1024:
            sent += stuck.send(b"y" * 65536)
    except BlockingIOError:
        pass
    time.sleep(0.2)
    assert h._backlog(hub, stuck) > h._STUCK_BYTES
    assert h._is_stuck(hub, stuck) is True
    received = 0
    while received < sent:
        received += len(peer.recv(1 << 20))
    assert _wait_for(lambda: h._backlog(hub, stuck) == 7, 2)
    assert h._is_stuck(hub, stuck) is False
    stuck.close()
    peer.close()
    assert h._backlog(hub, stuck) == 7 and h._is_stuck(hub, stuck) is False

    # Dialling a hub beside the connection it has.
    hub = Hub("a")
    hub._qortal_address = (socket.AF_INET, server.getsockname())
    before = time.monotonic()
    sock, began = h._dial_beside(hub)
    assert before <= began <= time.monotonic()
    assert sock.getpeername() == server.getsockname() and sock.gettimeout() == 0.0
    probe = server.accept()[0]
    probe.settimeout(0.2)
    try:
        assert not probe.recv(10), "nothing is sent over it yet"
        assert False, "it stays open: a hub counts those that do not"
    except socket.timeout:
        pass
    probe.close()
    sock.close()
    server.close()
    assert h._dial_beside(hub) is None
    hub._qortal_address = None
    assert h._dial_beside(hub) is None
    # Asked for more often than in a redial, and not longer than 2 s.
    asked = []
    real = h._connect_asking_again
    h._connect_asking_again = lambda *args, **kwargs: asked.append((args, kwargs)) or 1 / 0
    hub._qortal_address = (socket.AF_INET, ("192.0.2.1", 1))
    assert h._dial_beside(hub) is None
    h._connect_asking_again = real
    assert asked == [
        (
            (socket.AF_INET, ("192.0.2.1", 1)),
            {"starts": h._STALL_PROBE_STARTS, "seconds": h._STALL_PROBE_SECONDS},
        )
    ]


def test_all_are_dialled_at_once():
    hubs = [Hub(name) for name in "abc"]
    started, real = [], h._dial_beside

    def dial(hub):
        started.append(time.monotonic())
        time.sleep(0.3)
        return ("new", 1.0) if hub.name != "b" else None

    h._dial_beside = dial
    try:
        began = time.monotonic()
        found = h._dial_beside_all(hubs)
        assert time.monotonic() - began < 0.5, "not one after the other"
        assert max(started) - min(started) < 0.1
        assert found == {hubs[0]: ("new", 1.0), hubs[2]: ("new", 1.0)}
        assert h._dial_beside_all([hubs[1]]) == {}
        assert h._dial_beside_all([]) == {}
    finally:
        h._dial_beside = real


def test_the_watch_runs_while_a_call_does():
    looks = []
    real = h._look_at_call_hubs, h._STALL_WATCH_SECONDS

    def look(watch):
        looks.append(watch)
        watch.spares["x"] = ("spare", 1.0)
        if len(looks) == 2:
            raise RuntimeError("once")

    h._look_at_call_hubs, h._STALL_WATCH_SECONDS = look, 0.02

    def watching():
        return [t for t in threading.enumerate() if t.name == "presence-host-call-watch"]

    try:
        # Without a call it ends at once.
        h._start_call_watch()
        assert _wait_for(lambda: not watching()) and not looks
        # A link that just came in: who it is from is not known yet.
        pb._audio_links_by_id["x"] = {"peerPresenceHash": "", "incoming": True}
        for _ in range(3):
            h._start_call_watch()
        assert len(watching()) == 1, "one is enough"
        assert _wait_for(lambda: len(looks) >= 5), "an error does not end it"
        assert all(watch is looks[0] for watch in looks), "it remembers"
        closed = []
        real_close = h._close_ready
        h._close_ready = closed.append
        pb._audio_links_by_id["x"]["closing"] = True
        assert _wait_for(lambda: not watching())
        h._close_ready = real_close
        assert closed == [("spare", 1.0)], "what it kept is closed when it ends"
        # One that the page wants and the bridge is asking for.
        wanted = {"desired": True, "last_open_attempt_at": time.time()}
        pb._audio_link_desired_by_peer_hash[PEER] = wanted
        del looks[:]
        h._start_call_watch()
        assert _wait_for(lambda: len(looks) >= 3)
        pb._audio_link_desired_by_peer_hash.clear()
        pb._audio_links_by_id.clear()
        assert _wait_for(lambda: not watching())
        # And again for the next call; not while signed out.
        del looks[:]
        pb._audio_links_by_id["x"] = {"peerPresenceHash": PEER}
        h._start_call_watch()
        assert _wait_for(lambda: len(looks) >= 3)
        h._network_paused = True
        assert _wait_for(lambda: not watching())
        assert h._call_watch is None and not h._call_began.is_set()
        h._network_paused = False

        # A call that begins just when the watch of the one before ends.
        pb._audio_links_by_id.clear()
        real_in_call = h._in_call
        began = []

        def in_call():
            running = real_in_call()
            if not running and not began and threading.current_thread() in watching():
                pb._audio_links_by_id["y"] = {"peerPresenceHash": PEER}
                other = threading.Thread(target=h._start_call_watch)
                other.start()
                other.join()
                began.append(len(looks))
            return running

        pb._audio_links_by_id["x"] = {"peerPresenceHash": PEER}
        del looks[:]
        h._start_call_watch()
        assert _wait_for(lambda: len(looks) >= 3)
        h._in_call = in_call
        try:
            pb._audio_links_by_id.pop("x")
            assert _wait_for(lambda: began and len(looks) > began[0] + 2)
            assert len(watching()) == 1 and h._call_began.is_set()
            pb._audio_links_by_id.clear()
            assert _wait_for(lambda: not watching())
            assert h._call_watch is None and not h._call_began.is_set()
        finally:
            h._in_call = real_in_call
    finally:
        h._network_paused = False
        pb._audio_links_by_id.clear()
        h._look_at_call_hubs, h._STALL_WATCH_SECONDS = real


def test_the_links_of_a_call_start_it():
    started = []
    real = h._start_call_watch
    h._start_call_watch = lambda: started.append(True)
    bridge = types.SimpleNamespace(
        configure_audio_link=lambda link, link_id: ("configured", link, link_id),
        _schedule_audio_link_establish_timeout=lambda link_id: None,
        get_audio_link_state=lambda link_id: None,
    )
    try:
        h._install_call_link_opening(bridge)
        hooked = bridge.configure_audio_link
        h._install_call_link_opening(bridge)
        assert bridge.configure_audio_link is hooked, "installed once"
        assert bridge.configure_audio_link("l", "id") == ("configured", "l", "id")
        assert started == [True]
        bridge._schedule_audio_link_establish_timeout("id")
        assert started == [True, True]
        # A link never fails because of it.
        h._start_call_watch = lambda: started.append(1 / 0)
        assert bridge.configure_audio_link("l", "id") == ("configured", "l", "id")
        bridge._schedule_audio_link_establish_timeout("id")
        assert started == [True, True]
    finally:
        h._start_call_watch = real


def test_only_the_connection_that_stalled_is_replaced():
    hub, other = Hub("a"), Hub("b")
    reattached, slow, kept = [], [], []
    real = h._reattach_interface, h._watch_slow_hubs, h._close_when_old
    h._reattach_interface = lambda interface, generation, **kwargs: reattached.append(
        (interface, generation, kwargs)
    )
    h._watch_slow_hubs = lambda hubs: slow.append((hubs, h._generation_of(hub)))
    h._close_when_old = lambda *args: kept.append(args)
    ready = (object(), 1.0)
    sock = hub.socket
    try:
        # On another connection already, or signed out.
        before = h._generation_of(hub)
        h._replace_connection(hub, object(), ready)
        assert [args[0] for args in kept] == [ready[0]]
        h._replace_connection(hub, object())
        h._network_paused = True
        h._replace_connection(hub, sock, ready)
        h._network_paused = False
        assert [args[0] for args in kept] == [ready[0]] * 2
        assert hub.online and hub.socket is sock and not reattached and not slow
        assert h._generation_of(hub) == before
        # A dial that is under way comes first.
        lock = h._interface_lock(hub)
        lock.acquire()
        worker = threading.Thread(
            target=h._replace_connection, args=(hub, sock, ready), daemon=True
        )
        worker.start()
        time.sleep(0.1)
        assert not reattached and h._generation_of(hub) == before
        hub.reconnecting = True
        others = h._generation_of(other)
        lock.release()
        worker.join(2)
        assert not hub.online and hub.socket is None and hub.reconnecting is False
        assert h._call_redial_is_recent(hub)
        [(interface, generation, kwargs)] = reattached
        assert interface is hub and generation == h._generation_of(hub) != before
        assert kwargs["urgent"] is True and kwargs["ready"] is ready
        assert slow == [([hub], generation)], "and it is waited for that long"
        assert h._generation_of(other) == others, "the others go on"
        # What it had not sent is dropped.
        del kept[:]
        kwargs["after_first_dial"]()
        assert kept == [(sock, None, True)]
        # A switch came first.
        hub.online, hub.socket = True, sock
        generation = h._generation_of(hub)
        h._begin_redial(hub)
        del kept[:]
        h._refresh_interface(hub, generation, urgent=True, ready=ready)
        assert hub.online and len(reattached) == 1
        assert [args[0] for args in kept] == [ready[0]]
    finally:
        h._network_paused = False
        h._reattach_interface, h._watch_slow_hubs, h._close_when_old = real


def test_old_voice_is_not_sent_any_more():
    """A connection that the watch replaces is dropped, any other is closed."""
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(5)
    for drop in (True, False):
        sock = socket.create_connection(server.getsockname())
        peer = server.accept()[0]
        # Young: later.
        h._close_when_old(sock, time.monotonic() - h._HUB_YOUNG_SECONDS + 0.2, drop)
        assert sock.fileno() >= 0
        assert _wait_for(lambda: sock.fileno() < 0, 1)
        try:
            assert peer.recv(10) == b"" and not drop
        except ConnectionResetError:
            assert drop
        peer.close()
        # Old: at once.
        sock = socket.create_connection(server.getsockname())
        peer = server.accept()[0]
        h._close_when_old(sock, None, drop)
        assert sock.fileno() < 0
        try:
            assert peer.recv(10) == b"" and not drop
        except ConnectionResetError:
            assert drop
        peer.close()
    server.close()
    h._drop_quietly(object())  # one that cannot be dropped
    gone = socket.socket()
    gone.close()
    h._drop_quietly(gone)


if __name__ == "__main__":
    test_what_counts_as_stalled()
    test_a_dead_spot()
    test_a_hub_that_is_gone()
    test_what_the_kernel_says()
    test_all_are_dialled_at_once()
    test_the_watch_runs_while_a_call_does()
    test_the_links_of_a_call_start_it()
    test_only_the_connection_that_stalled_is_replaced()
    test_old_voice_is_not_sent_any_more()
    print("ALL OK")
