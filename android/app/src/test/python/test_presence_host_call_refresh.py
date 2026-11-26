"""refresh_network(in_call=True): the hub redial while a call rings or runs.

Kotlin asks for it 0.5 s after a switch of network instead of 2 s, so the new
network may not be quite usable. Same RNS stand-ins as
test_presence_host_refresh.py, without Chaquopy or a network (one check
connects to a listening socket on localhost):

    python3 android/app/src/test/python/test_presence_host_call_refresh.py

It also works under pytest. The module is loaded once, so the checks run in
one ordered function.
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

calls = []
_fd_counter = [900]
# Where the stand-ins say a hub was reached: nobody listens there, so a dial to
# it is refused at once.
NOBODY = ("127.0.0.1", 1)


class FakeSock:
    family = socket.AF_INET

    def __init__(self, peer=NOBODY):
        _fd_counter[0] += 1
        self._fd = _fd_counter[0]
        self._peer = peer
        self.closed = False

    def fileno(self):
        return -1 if self.closed else self._fd

    def getpeername(self):
        return self._peer

    def close(self):
        self.closed = True


class BackboneInterface:
    spawned_interface_filenos = {}
    deregistered = []
    added = []

    @staticmethod
    def deregister_fileno(fileno):
        BackboneInterface.deregistered.append(fileno)

    @staticmethod
    def add_client_socket(sock, interface):
        assert interface.socket is sock, "the I/O loop reads interface.socket"
        # A frame sent before the loop knows the socket tears the hub down.
        assert not interface.online
        BackboneInterface.spawned_interface_filenos[sock.fileno()] = interface
        BackboneInterface.added.append(interface.name)


class Iface:
    RECONNECT_WAIT = 0.6

    def __init__(self, name):
        self.name = name
        self.initiator = True
        self.IN = True
        self.OUT = True
        self.online = False
        self.detached = False
        self.reconnecting = False
        self.socket = None
        self.frame_buffer = b""
        self.transmit_buffer = b""
        self.fail = 0  # this many dials fail at once
        self.drop = 0  # this many connections are gone again at once
        self.drop_late = 0  # this many are gone a moment after the dial
        self.gate = None  # the next dial waits for it
        self.next_gate = None  # and the one after that for this
        self.dials = []  # when each connect() ended
        self.begun = []
        self.peer = NOBODY
        self.rxb = 0
        self.silent = False  # nothing comes in over its connections
        self.max_reconnect_tries = None
        self.never_connected = False

    def detach(self):
        self.online = False
        self.detached = True
        if self.socket is not None:
            self.socket.close()
        self.socket = None

    def set_timeouts_linux(self):
        calls.append(("timeouts", self.name))

    def connect(self, initial=False):
        self.begun.append(time.monotonic())
        gate, self.gate, self.next_gate = self.gate, self.next_gate, None
        if gate is not None:
            gate.wait(5)
        self.dials.append(time.monotonic())
        if self.fail:
            self.fail -= 1
            if initial:
                return False
            raise OSError("connect failed")
        self.socket = FakeSock(self.peer)
        BackboneInterface.spawned_interface_filenos[self.socket.fileno()] = self
        self.online = True
        if self.drop:
            self.drop -= 1
            self.gone()
        elif self.drop_late:
            self.drop_late -= 1
            threading.Timer(0.03, self.gone).start()
        return True

    def gone(self):
        """As the I/O loop does it when the socket is closed under it."""
        if not self.silent:
            self.rxb += 100
        self.online = False
        BackboneInterface.spawned_interface_filenos.pop(self.socket.fileno())
        self.socket.close()
        threading.Thread(target=self.reconnect, daemon=True).start()

    def __str__(self):
        return self.name


class Destination:
    def __init__(self, name):
        self.hash = name


class Link:
    PENDING, HANDSHAKE, ACTIVE, STALE, CLOSED = range(5)
    INITIATOR_CLOSED = 2

    def __init__(self, n, interface, dest):
        self.n = n
        self.attached_interface = interface
        self.status = Link.ACTIVE
        self.initiator = True
        self.teardown_reason = None
        self.destination = Destination(dest)

    def _Link__teardown_packet(self):
        pass

    def link_closed(self):
        online = tuple(i.name for i in Transport.interfaces if i.online)
        calls.append(("closed", self.n, online, time.monotonic()))
        Transport.active_links.remove(self)


class Transport:
    ready = True
    interfaces = [Iface("a"), Iface("b")]
    active_links = []
    pending_links = []
    path_table = {}
    path_table_lock = threading.Lock()

    @staticmethod
    def next_hop_interface(destination_hash):
        return Transport.path_table.get(destination_hash)

    @staticmethod
    def synthesize_tunnel(interface):
        calls.append(("tunnel", interface.name))


def _install_stubs():
    rns = types.ModuleType("RNS")
    rns.Transport = Transport
    rns.Link = Link
    rns.log = lambda *a, **k: None
    rns.LOG_ERROR = rns.LOG_WARNING = rns.LOG_DEBUG = rns.LOG_INFO = 0
    interfaces_pkg = types.ModuleType("RNS.Interfaces")
    backbone_mod = types.ModuleType("RNS.Interfaces.BackboneInterface")
    backbone_mod.BackboneInterface = BackboneInterface
    backbone_mod.BackboneClientInterface = Iface
    rns.Interfaces = interfaces_pkg
    interfaces_pkg.BackboneInterface = backbone_mod
    sys.modules["RNS"] = rns
    sys.modules["RNS.Interfaces"] = interfaces_pkg
    sys.modules["RNS.Interfaces.BackboneInterface"] = backbone_mod

    pb = types.ModuleType("presence_bridge")
    pb._run_overlay_sync_maintenance = lambda reason="": calls.append(("maint", reason))
    pb._rns_announce_on_auth_session_end = lambda: None
    pb.maybe_emit_transport_state = lambda force=False: None
    pb._invalidate_reticulum_path_availability = lambda h: calls.append(("inval", h))
    pb._state_lock = threading.RLock()
    pb._audio_links_by_id = {}
    pb._overlay_links_by_id = {}
    pb._active_overlay_link_id_by_peer_hash = {}
    pb._inbound_overlay_neighbors = {}
    sys.modules["presence_bridge"] = pb
    return pb


def _closed():
    return sorted(call[1] for call in list(calls) if call[0] == "closed")


def _when(n):
    return next(call for call in list(calls) if call[:2] == ("closed", n))


def _drop(h, *interfaces):
    """What a lost network leaves: sockets taken down, hubs offline."""
    for interface in interfaces:
        interface.online = False
        h._forget_socket(interface, interface.socket)
        interface.socket = None
        interface.reconnecting = False
        interface._qortal_address = None
        del interface.dials[:]
        del interface.begun[:]
    del calls[:]


def _links(a, b):
    Transport.active_links = [Link(1, a, "to-a"), Link(2, b, "to-b")]
    Transport.path_table = {"to-a": a, "to-b": b}


def _all_online(*interfaces):
    """They are up, and the threads that dialled them are done with that."""
    return _wait_for(
        lambda: all(
            i.online and getattr(i, "_qortal_dialling", None) is None for i in interfaces
        )
    )


def _a_first_dial_that_fails(h, a, b):
    """Not usable yet (no route, DNS error): the dial fails at once."""
    h._CALL_RETRY_WAITS = (0.05, 0.1)
    _drop(h, a, b)
    a.fail = b.fail = 2
    start = time.monotonic()
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _all_online(a, b)
    assert time.monotonic() - start < 0.6, "both before the usual wait is over"
    assert len(a.dials) == 3 and len(b.dials) == 3
    assert 0.04 < a.dials[1] - a.dials[0] < 0.3
    assert 0.09 < a.dials[2] - a.dials[1] < 0.35

    # Once the short waits are used up the usual backoff begins at its start.
    _drop(h, a, b)
    a.fail = 4
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: a.online, 5)
    waits = [round(q - p, 2) for p, q in zip(a.dials, a.dials[1:])]
    assert len(waits) == 4
    assert waits[0] < 0.3 and waits[1] < 0.35
    assert 0.55 < waits[2] < 0.95 and 1.1 < waits[3] < 1.6, waits

    # Outside a call nothing of this: one dial, then the usual wait.
    _drop(h, a, b)
    a.fail = 1
    assert h.refresh_network("switch", 2.0) == 2
    assert _wait_for(lambda: b.online)
    time.sleep(0.3)
    assert len(a.dials) == 1 and not a.online
    assert _wait_for(lambda: a.online)
    assert 0.55 < a.dials[1] - a.dials[0] < 0.95


def _a_connection_that_is_gone_again(h, a, b):
    """The new network lets the dial through and drops it at once."""
    h._CALL_RETRY_WAITS = (0.05, 0.1)
    _drop(h, a, b)
    _links(a, b)
    a.drop = 1
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: len(a.dials) == 2 and a.online)
    assert 0.04 < a.dials[1] - a.dials[0] < 0.3
    # As a hub that cannot be reached: its links went to the other one, once.
    assert _wait_for(lambda: _closed() == [1, 2])
    assert _when(1)[2] == ("b",) and "to-a" not in Transport.path_table

    # Gone a moment later, when the call already has a new link over it: that
    # one ends with the next dial, and the path over this hub stays.
    _drop(h, a, b)
    _links(a, b)
    a.drop_late = 1
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: _closed() == [1, 2])
    Transport.active_links.append(Link(3, a, "to-a"))
    assert _wait_for(lambda: len(a.dials) == 2 and a.online)
    assert _wait_for(lambda: _closed() == [1, 2, 3])
    assert "a" in _when(3)[2] and "to-a" in Transport.path_table
    assert _wait_for(lambda: not a.reconnecting)

    # Gone a second time: the call does not wait for this hub any longer.
    _drop(h, a, b)
    _links(a, b)
    a.drop_late = 2
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: _closed() == [1, 2])
    Transport.active_links.append(Link(3, a, "to-a"))
    assert _wait_for(lambda: _closed() == [1, 2, 3])
    Transport.active_links.append(Link(4, a, "to-a"))
    assert _wait_for(lambda: _closed() == [1, 2, 3, 4])
    assert _when(4)[2] == ("b",) and "to-a" not in Transport.path_table
    assert _wait_for(lambda: len(a.dials) == 3 and a.online)

    # After the window, and outside a call, it is the usual wait.
    h._CALL_RETRY_WINDOW_SECONDS = 0.0
    for in_call in (True, False):
        _drop(h, a, b)
        a.drop = 1
        assert h.refresh_network("switch", 2.0, in_call) == 2
        assert _wait_for(lambda: len(a.dials) == 2 and a.online)
        assert 0.55 < a.dials[1] - a.dials[0] < 0.95
    # A redial outside a call ends the window of one before it.
    h._CALL_RETRY_WINDOW_SECONDS = 10.0
    _drop(h, a, b)
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _all_online(a, b)
    assert h._call_redial_is_recent(a)
    _drop(h, a, b)
    assert h.refresh_network("switch", 2.0) == 2
    assert _all_online(a, b)
    assert not h._call_redial_is_recent(a)


class Dropping(Iface):
    """Its connection is gone at the n-th look at ``online``, or (``after``)
    right after that look, which still saw it."""

    looks = 0
    after = False

    @property
    def online(self):
        seen = self._online
        if seen and self.looks:
            self.looks -= 1
            if not self.looks:
                self._online = False
                if self.socket is not None:
                    self.socket.close()
                # The I/O loop asks for a reconnect, on a thread of its own.
                asked = threading.Thread(target=self.reconnect, daemon=True)
                asked.start()
                asked.join(0.02)
                return seen if self.after else False
        return seen

    @online.setter
    def online(self, value):
        self._online = value


def _a_connection_that_is_gone_at_any_moment(h):
    """Whenever it drops, somebody dials the hub again (and only one)."""
    usual, Iface.RECONNECT_WAIT = Iface.RECONNECT_WAIT, 0.05
    # Every look of the loop, and of what follows.
    for looks, after in [(n, late) for n in range(1, 6) for late in (False, True)]:
        hub = Dropping("d")
        hub.looks, hub.after = looks, after
        at = (looks, after)
        threading.Thread(target=hub.reconnect, daemon=True).start()
        assert _wait_for(lambda: hub.looks == 0 and len(hub.dials) >= 2, 5), at
        assert _wait_for(lambda: hub.online and not hub.reconnecting), at
        time.sleep(0.15)
        assert hub.online and not hub.reconnecting, at
        assert len(hub.dials) == 2, (at, len(hub.dials))

    # The same when the loop wakes and finds the hub dialled by another thread.
    for looks, after in [(n, late) for n in (1, 2) for late in (False, True)]:
        hub = Dropping("d")
        hub.after = after
        at = (looks, after)
        threading.Thread(target=hub.reconnect, daemon=True).start()
        assert _wait_for(lambda: hub.reconnecting)
        hub.connect(initial=True)
        hub.looks = looks
        assert _wait_for(lambda: hub.looks == 0 and len(hub.dials) >= 2, 5), at
        assert _wait_for(lambda: hub.online and not hub.reconnecting), at
        assert len(hub.dials) == 2, (at, len(hub.dials))

    # connect() comes back with ``online`` on a connection that is closed.
    class Closed(Iface):
        def connect(self, initial=False):
            super().connect(initial)
            if len(self.dials) == 1:
                self.socket.close()
            return True

    # Or it fails on that connection, which leaves ``online`` as well.
    class Failing(Closed):
        def connect(self, initial=False):
            super().connect(initial)
            if len(self.dials) == 1:
                raise OSError(9, "Bad file descriptor")
            return True

    for kind in (Closed, Failing):
        hub = kind("e")
        Iface.initial_connect(hub)
        assert _wait_for(lambda: hub.online and len(hub.dials) == 2), kind
        assert not hub.socket.closed and not hub.reconnecting
        # The same for a dial of the reconnect loop.
        hub = kind("f")
        threading.Thread(target=hub.reconnect, daemon=True).start()
        assert _wait_for(lambda: hub.online and len(hub.dials) == 2), kind
        assert _wait_for(lambda: not hub.reconnecting)
    Iface.RECONNECT_WAIT = usual


def _a_second_switch_during_the_retries(h, a, b):
    """The loop of the first redial ends; one socket per hub is left."""
    h._CALL_RETRY_WAITS = (0.2, 0.2, 0.2)
    _drop(h, a, b)
    a.fail = b.fail = 1
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: len(a.dials) == 1 and len(b.dials) == 1)
    assert h.refresh_network("switch-2", 0.5, True) == 2
    assert _all_online(a, b)
    dials = len(a.dials), len(b.dials)
    assert dials == (2, 2)
    time.sleep(0.5)
    assert (len(a.dials), len(b.dials)) == dials
    for interface in (a, b):
        live = [
            fd
            for fd, owner in BackboneInterface.spawned_interface_filenos.items()
            if owner is interface and fd not in BackboneInterface.deregistered
        ]
        assert live == [interface.socket.fileno()]


def _a_dial_that_a_switch_overtook(h, a, b):
    """Begun on the old network, up after the switch: it is on the old one."""
    _drop(h, a, b)
    slow = threading.Event()
    a.gate = slow
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: b.online and len(a.begun) == 1)
    time.sleep(0.2)
    # The second switch comes now, while a's dial is still under way.
    switched = time.monotonic()
    time.sleep(0.05)
    slow.set()
    assert _wait_for(lambda: a.online)
    assert a._qortal_dialed_at < switched, "it counts when the dial began"
    b._qortal_dialed_at = time.monotonic()
    assert h.refresh_network("switch-2", time.monotonic() - switched, True) == 1
    assert _wait_for(lambda: len(a.dials) == 2 and a.online)
    assert len(b.dials) == 1


def _a_hub_that_is_slow_to_answer(h, a, b):
    """Its links do not wait for it: they close once another hub is up."""
    h._CALL_SLOW_DIAL_SECONDS = 0.15
    _drop(h, a, b)
    _links(a, b)
    slow = threading.Event()
    b.gate = slow
    start = time.monotonic()
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: _closed() == [1, 2])
    # a's with its own redial; b's after the wait, over a, with b still away.
    assert _when(1)[3] < _when(2)[3] and _when(2)[2] == ("a",)
    assert _when(2)[3] - start > 0.14
    assert "to-b" not in Transport.path_table, "else the next link asks b again"
    assert "to-a" in Transport.path_table
    assert _wait_for(lambda: calls.count(("maint", "network_resume")) >= 2)
    # Only b counts as a hub that cannot be reached.
    assert b._qortal_dial_failed is True and a._qortal_dial_failed is False
    # b answers after all: its dial went on, and nothing is closed twice.
    slow.set()
    assert _all_online(a, b)
    assert len(b.dials) == 1 and b._qortal_dial_failed is False
    time.sleep(0.05)
    assert _closed() == [1, 2]

    # With no other hub up, links wait for the first one that comes up.
    _drop(h, a, b)
    _links(a, b)
    slow_a, slow_b = threading.Event(), threading.Event()
    a.gate, b.gate = slow_a, slow_b
    assert h.refresh_network("switch", 0.5, True) == 2
    time.sleep(0.3)
    assert _closed() == []
    slow_a.set()
    assert _wait_for(lambda: _closed() == [1, 2])
    assert not b.online
    slow_b.set()
    assert _all_online(a, b)

    # Outside a call the links over the slow hub wait for it.
    _drop(h, a, b)
    _links(a, b)
    slow = threading.Event()
    b.gate = slow
    assert h.refresh_network("switch", 2.0) == 2
    assert _wait_for(lambda: _closed() == [1])
    time.sleep(0.3)
    assert _closed() == [1]
    slow.set()
    assert _wait_for(lambda: _closed() == [1, 2])

    # A newer refresh ends the wait of the one before: its own 0.15 s count.
    _drop(h, a, b)
    _links(a, b)
    slow = threading.Event()
    b.gate = slow
    start = time.monotonic()
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: _closed() == [1])
    time.sleep(0.1)
    again = time.monotonic()
    assert h.refresh_network("switch-2", 0.5, True) == 1  # b, still dialling
    assert _wait_for(lambda: _closed() == [1, 2])
    assert _when(2)[3] - again > 0.13 and _when(2)[3] - start > 0.22
    slow.set()
    assert _all_online(a, b)

    # And so does a pause: nothing is closed behind it.
    moved = []
    real = h._move_links_off
    h._move_links_off = lambda interface: moved.append(interface.name) or 0
    try:
        _drop(h, a, b)
        slow = threading.Event()
        b.gate = slow
        assert h.refresh_network("switch", 0.5, True) == 2
        assert _wait_for(lambda: a.online)
        assert h.pause_network() is True
        time.sleep(0.3)
        assert moved == []
    finally:
        h._move_links_off = real
    slow.set()
    assert h.resume_network() is True
    assert _all_online(a, b)


def _a_hub_that_is_up_a_moment_later(h, a, b):
    """No dial got through while the network was away. That says nothing about
    the new one: a's redial does not take b's links, whose path stays good."""
    h._CALL_SLOW_DIAL_SECONDS = 0.6
    _drop(h, a, b)
    _links(a, b)
    a._qortal_dial_failed = b._qortal_dial_failed = True
    slow = threading.Event()
    b.gate = slow
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: _closed() == [1])
    time.sleep(0.1)
    assert _closed() == [1] and "to-b" in Transport.path_table
    slow.set()
    assert _wait_for(lambda: _closed() == [1, 2])
    assert set(_when(2)[2]) == {"a", "b"} and "to-b" in Transport.path_table
    assert _all_online(a, b)

    # Its first dial on the new network failed as well; the next is under way.
    h._CALL_RETRY_WAITS = (0.05, 0.05, 0.05)
    _drop(h, a, b)
    _links(a, b)
    gate_a, gate_b = threading.Event(), threading.Event()
    a.gate, b.fail, b.next_gate = gate_a, 1, gate_b
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: len(b.begun) == 2)
    assert b._qortal_dial_failed is True
    gate_a.set()
    assert _wait_for(lambda: _closed() == [1])
    time.sleep(0.1)
    assert _closed() == [1] and "to-b" in Transport.path_table
    gate_b.set()
    assert _wait_for(lambda: _closed() == [1, 2])
    assert set(_when(2)[2]) == {"a", "b"} and "to-b" in Transport.path_table
    assert _all_online(a, b)

    # A dial that then hangs does not hold b's links for long, also when a
    # comes up only after the look of refresh_network itself.
    h._CALL_SLOW_DIAL_SECONDS = 0.4
    h._CALL_RETRY_WAITS = (0.5,)
    _drop(h, a, b)
    _links(a, b)
    gate_a, gate_b = threading.Event(), threading.Event()
    a.gate, b.fail, b.next_gate = gate_a, 1, gate_b
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: len(b.begun) == 2)
    time.sleep(0.1)
    assert b._qortal_dial_failed is True and _closed() == []
    gate_a.set()
    assert _wait_for(lambda: _closed() == [1])
    up = time.monotonic()
    time.sleep(0.2)
    assert _closed() == [1]
    assert _wait_for(lambda: _closed() == [1, 2])
    assert _when(2)[2] == ("a",) and "to-b" not in Transport.path_table
    assert 0.35 < time.monotonic() - up < 0.8
    gate_b.set()
    assert _all_online(a, b)

    # Already for long under way when a comes up: nobody waits for it.
    h._CALL_SLOW_DIAL_SECONDS = 0.2
    _drop(h, a, b)
    _links(a, b)
    gate_a, gate_b = threading.Event(), threading.Event()
    a.gate, b.gate = gate_a, gate_b
    assert h.refresh_network("switch", 0.5, True) == 2
    time.sleep(0.4)
    assert b._qortal_dial_failed is True
    gate_a.set()
    assert _wait_for(lambda: _closed() == [1, 2])
    assert _when(2)[2] == ("a",) and _when(2)[3] - _when(1)[3] < 0.1
    gate_b.set()
    assert _all_online(a, b)
    assert a._qortal_dialling is None and b._qortal_dialling is None
    assert 0.0 <= a._qortal_dial_seconds < 1.0

    # Outside a call as ever: the first hub that is up takes the links.
    _drop(h, a, b)
    _links(a, b)
    b._qortal_dial_failed = True
    gate_a, slow = threading.Event(), threading.Event()
    a.gate, b.gate = gate_a, slow
    assert h.refresh_network("switch", 2.0) == 2
    assert _wait_for(lambda: len(a.begun) == 1 and len(b.begun) == 1)
    assert h._being_dialled(b)
    gate_a.set()
    assert _wait_for(lambda: _closed() == [1, 2])
    assert _when(2)[2] == ("a",) and "to-b" not in Transport.path_table
    assert _when(2)[3] - _when(1)[3] < 0.1, "at once"
    slow.set()
    assert _all_online(a, b)

    # A dial of the network before that gives up says nothing either, nor one
    # before a pause.
    _links(a, b)
    del calls[:]
    b.online = False
    before = h._generation_of(b)
    h._begin_redial(b)
    h._after_failed_dial(b, before)
    before = h._generation_of(b)
    h._network_generation += 1
    h._after_failed_dial(b, before)
    assert _closed() == [] and b._qortal_dial_failed is False
    # The redial of another hub does not matter.
    before = h._generation_of(b)
    h._begin_redial(a)
    h._after_failed_dial(b, before)
    assert _closed() == [2] and b._qortal_dial_failed is True
    b.online = True
    b._qortal_dial_failed = False


def _a_hub_that_the_refresh_leaves_alone(h, a, b):
    """It was dialled after the switch. The refresh redials the others, and
    must not take it for one of them: nobody would dial it again."""
    real = h._connect_current
    for at_boot in (False, True):
        _drop(h, a, b)
        assert h.refresh_network("switch", 0.5, True) == 2
        assert _all_online(a, b) and _wait_for(lambda: not b.reconnecting)
        a._qortal_dialed_at = time.monotonic() - 10
        _links(a, b)
        del calls[:], a.dials[:], b.dials[:]
        switched = time.monotonic()
        refreshed = []

        def connect_current(interface, generation, **kwargs):
            sock = real(interface, generation, **kwargs)
            if interface is b and not refreshed:
                # b's dial is over; the thread that made it has yet to look.
                refreshed.append(
                    h.refresh_network("switch-2", time.monotonic() - switched, True)
                )
                assert _wait_for(lambda: len(a.dials) == 1 and a.online)
                time.sleep(0.05)
            return sock

        h._connect_current = connect_current
        try:
            if at_boot:
                # RNS builds it while the refresh runs, so that one cannot know.
                Transport.interfaces.remove(b)
                _drop(h, b)
                b.initial_connect()
                Transport.interfaces.append(b)
            else:
                b.gone()  # dialled again by its reconnect loop
            assert _wait_for(lambda: refreshed == [1], 3)
            assert _wait_for(lambda: b.online and not b.reconnecting)
        finally:
            h._connect_current = real
        time.sleep(0.2)
        assert a.online and b.online and not b.socket.closed
        # One that RNS had not built yet is dialled for the new network.
        assert len(a.dials) == 1 and len(b.dials) == (2 if at_boot else 1)
        live = [
            fd
            for fd, owner in BackboneInterface.spawned_interface_filenos.items()
            if owner is b
        ]
        assert live == [b.socket.fileno()]
        if not at_boot:
            assert ("tunnel", "b") in calls


def _two_dials_at_once(h, a, b):
    """A reconnect loop and a redial: the second finds the first one's work."""
    _drop(h, a, b)
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _all_online(a, b)
    sock = a.socket
    del a.dials[:]
    h._HUB_YOUNG_SECONDS = 0.3
    spare = FakeSock()
    assert h._connect_current(a, h._generation_of(a), ready=(spare, 1.0)) is sock
    assert a.socket is sock and a.dials == [] and not spare.closed
    assert _wait_for(lambda: spare.closed, 0.6), "it is kept only while it is young"
    h._HUB_YOUNG_SECONDS = 0.0
    # Closed, though the interface has yet to hear of it: dialled.
    sock.close()
    again = h._connect_current(a, h._generation_of(a))
    assert again is a.socket is not sock and len(a.dials) == 1


def _a_connection_that_lasts_only_a_moment(h, a, b):
    """A hub that is up for a moment does not take over: the links and paths
    over the others stay, for the case that it is gone again right away."""
    h._SETTLE_MIN_SECONDS = h._SETTLE_MAX_SECONDS = 0.3
    h._CALL_RETRY_WAITS = (0.05, 2.0)

    def begin(**how):
        _drop(h, a, b)
        _links(a, b)
        a._qortal_dial_failed = b._qortal_dial_failed = False
        for key, value in how.items():
            setattr(b, key, value)
        assert h.refresh_network("switch", 0.5, True) == 2

    def a_is_gone_after(seconds):
        assert _wait_for(lambda: a.online)
        time.sleep(seconds)
        a.online = False

    # b cannot be dialled, a lasts: it takes over then, not before.
    begin(fail=2)
    assert _wait_for(lambda: _closed() == [1])
    up = a._qortal_connected_at
    assert _wait_for(lambda: _closed() == [1, 2])
    assert 0.28 < _when(2)[3] - up < 0.5 and "to-b" not in Transport.path_table
    assert _wait_for(lambda: b.online, 5)
    # a is gone before that.
    begin(fail=2)
    a_is_gone_after(0.1)
    time.sleep(0.5)
    assert _closed() == [1] and Transport.path_table["to-b"] is b
    a.online = True
    assert _wait_for(lambda: b.online, 5)
    # The same when b's dial fails while a is up, but not for long.
    for lasts in (True, False):
        gate_b = threading.Event()
        begin(fail=1, gate=gate_b)
        h._CALL_SLOW_DIAL_SECONDS = 5.0
        assert _wait_for(lambda: a.online and _closed() == [1])
        time.sleep(0.1)
        gate_b.set()
        assert _wait_for(lambda: len(b.dials) == 1)
        assert b._qortal_dial_failed is True and _closed() == [1]
        if not lasts:
            a.online = False
        h._CALL_SLOW_DIAL_SECONDS = 1.5
        assert _wait_for(lambda: b.online, 5) and _wait_for(lambda: 2 in _closed())
        # b is back before anybody took over.
        assert "to-b" in Transport.path_table
        a.online = True
    for lasts in (True, False):
        gate_b, second = threading.Event(), threading.Event()
        begin(fail=2, gate=gate_b, next_gate=second)
        assert _wait_for(lambda: a.online and _closed() == [1])
        gate_b.set()
        assert _wait_for(lambda: len(b.dials) == 1)
        if not lasts:
            a.online = False
        time.sleep(0.6)
        assert (2 in _closed()) is lasts
        assert ("to-b" in Transport.path_table) is not lasts
        a.online = True
        second.set()
        assert _wait_for(lambda: b.online, 5)
    # Something has come in over a: that is enough.
    begin(fail=2)
    assert _wait_for(lambda: a.online)
    a.rxb += 100
    started = time.monotonic()
    assert h._is_settled(a) and h._another_is_up(b) and not h._another_is_up(a)
    assert _wait_for(lambda: b.online, 5)
    assert time.monotonic() - started < 4

    # How long: a round trip and a half, within limits.
    h._SETTLE_MIN_SECONDS, h._SETTLE_MAX_SECONDS = 0.1, 0.3
    hub = Iface("s")
    for dial, seconds in ((0.0, 0.1), (0.1, 0.15), (0.19, 0.285), (1.0, 0.3)):
        hub._qortal_dial_seconds = dial
        assert abs(h._settle_seconds(hub) - seconds) < 1e-9
        assert not h._is_settled(hub)
        hub.online = True
        hub._qortal_connected_at = time.monotonic() - seconds + 0.05
        assert not h._is_settled(hub)
        hub._qortal_connected_at -= 0.06
        assert h._is_settled(hub)
        hub.online = False
    # One whose beginning is not known is settled, unless it is being dialled.
    hub.online, hub._qortal_connected_at = True, None
    assert h._is_settled(hub)
    hub._qortal_dialling = time.monotonic()
    assert not h._is_settled(hub)
    h._SETTLE_MIN_SECONDS = h._SETTLE_MAX_SECONDS = 0.0


def _a_connection_that_goes_in_the_middle_of_a_call(h, a, b, pb):
    """The hub restarts, or a router forgets the connection: no switch of
    network, but a call waits for it."""
    pb._audio_link_desired_by_peer_hash = {}
    pb._audio_links_by_id = {"1": {"peerPresenceHash": "ab" * 16, "link": None}}
    pb._has_viable_audio_link_for_peer = lambda peer: True
    h._CALL_RETRY_WAITS = (0.05, 0.1)
    h._CALL_REDIAL_SECONDS = 0.25
    _drop(h, a, b)
    assert h.refresh_network("switch", 2.0) == 2
    assert _all_online(a, b)
    assert not h._call_redial_is_recent(a)
    _links(a, b)
    del calls[:], a.dials[:]
    asked, known = [], []
    real = h._ask_for_call_links, h._dial_for_call
    h._ask_for_call_links = lambda hub: asked.append(hub.online) or real[0](hub)
    h._dial_for_call = lambda hub, overtaken: known.append(hub)
    a.fail = 4
    gone = time.monotonic()
    a.gone()
    assert _wait_for(lambda: a.online, 5)
    assert _wait_for(lambda: asked == [True]), "its links are asked for again"
    assert known == [a] * 5, "every dial is one a call waits for"
    h._ask_for_call_links, h._dial_for_call = real
    waits = [round(q - p, 2) for p, q in zip([gone] + a.dials, a.dials)]
    assert len(waits) == 5 and waits[0] < 0.15 and 0.09 < waits[1] < 0.25
    assert all(0.24 < wait < 0.45 for wait in waits[2:]), waits
    # Its links went to the other hub with the first dial that failed.
    assert _closed() == [1] and _when(1)[2] == ("b",)
    assert getattr(a, "_qortal_call_drops", 0) == 0, "counted after a switch only"

    # Not in a call: the usual waits, which grow.
    pb._audio_links_by_id = {}
    del a.dials[:]
    a.fail = 2
    gone = time.monotonic()
    a.gone()
    assert _wait_for(lambda: a.online, 8)
    waits = [round(q - p, 2) for p, q in zip([gone] + a.dials, a.dials)]
    assert 0.55 < waits[0] < 0.95 and 1.1 < waits[1] < 1.6 and 2.3 < waits[2] < 2.9, waits

    # A call that begins while a long wait is under way.
    del a.dials[:]
    a.fail = 2
    gone = time.monotonic()
    a.gone()
    assert _wait_for(lambda: len(a.dials) == 2, 5)
    pb._audio_links_by_id = {"1": {"peerPresenceHash": "ab" * 16}}
    h._start_call_watch()  # as its links do
    assert _wait_for(lambda: a.online)
    assert a.dials[2] - a.dials[1] < 0.6
    pb._audio_links_by_id = {}
    assert _wait_for(lambda: h._call_watch is None)


def _a_hub_that_has_had_enough(h, a, b, pb):
    """RNS hubs take no more from an address after six connections that ended
    within 20 s, for 12 hours. GO ends none of its own that young, and is in no
    hurry with a hub whose connections keep ending young while another is up."""
    h._HUB_YOUNG_SECONDS = 0.4
    h._CALL_RETRY_WAITS = (0.05, 0.1)
    h._CALL_REDIAL_SECONDS = 0.1
    pb._audio_links_by_id = {"1": {"peerPresenceHash": "ab" * 16, "link": None}}

    def fresh():
        _drop(h, a, b)
        for interface in (a, b):
            interface._qortal_young_ends = interface._qortal_refused = 0
            interface._qortal_connected_at = None
        assert h.refresh_network("switch", 0.5, True) == 2
        assert _all_online(a, b)
        del a.dials[:], b.dials[:]

    # Replaced while young: closed once it is old enough, not before; used no
    # longer. An old one is closed at once.
    fresh()
    young = a.socket
    time.sleep(0.1)
    assert h.refresh_network("switch-2", 0.0, True) == 2
    assert _wait_for(lambda: a.online and a.socket is not young) and _all_online(a, b)
    assert not young.closed and young.fileno() in BackboneInterface.deregistered
    time.sleep(0.2)
    assert not young.closed
    assert _wait_for(lambda: young.closed, 0.4)
    old = a.socket
    time.sleep(0.45)
    assert h.refresh_network("switch-3", 0.0, True) == 2
    assert _wait_for(lambda: a.online and a.socket is not old) and _all_online(a, b)
    assert _wait_for(lambda: old.closed, 0.15)
    # Signed out: at once.
    h._close_when_old(None, 1.0)
    late = FakeSock()
    h._network_paused = True
    h._close_when_old(late, time.monotonic())
    h._network_paused = False
    assert late.closed
    # Not known when it came up: nothing to wait for.
    late = FakeSock()
    h._close_when_old(late, None)
    assert late.closed

    # A dial that a switch overtook has a young connection as well.
    _drop(h, a, b)
    gate = threading.Event()
    a.gate = gate
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: len(a.begun) == 1 and b.online)
    made = []
    real = h._drop_stale_socket
    h._drop_stale_socket = lambda hub, sock: made.append(sock) or real(hub, sock)
    h._begin_redial(a)
    gate.set()
    assert _wait_for(lambda: len(made) == 1), (made, a.begun, a.dials, b.online)
    h._drop_stale_socket = real
    assert not made[0].closed and _wait_for(lambda: made[0].closed, 0.6)

    # Gone young once: dialled again soon. Again and again: less and less.
    fresh()
    gone = time.monotonic()
    # At least the usual wait, though a call runs.
    for expected in (0.05, 0.6, 0.8, 1.6):
        a.gone()
        assert _all_online(a)
        waited = a.dials[-1] - gone
        assert expected <= waited < expected + 0.2, (expected, waited)
        gone = time.monotonic()
    assert len(a.dials) == 4
    # Its links do not wait for that: they are over another hub at once.
    _links(a, b)
    del calls[:]
    a._qortal_young_ends = 2
    a._qortal_call_redial_until = 0.0  # also long after a switch
    gone = time.monotonic()
    a.gone()
    assert _wait_for(lambda: _closed() == [1], 0.3) and not a.online
    assert _when(1)[2] == ("b",) and "to-a" not in Transport.path_table
    assert _all_online(a) and a.dials[-1] - gone >= 0.8
    a._qortal_young_ends = 4
    # Not longer than the usual longest wait.
    h._RECONNECT_BACKOFF_MAX_SECONDS, longest = 0.7, h._RECONNECT_BACKOFF_MAX_SECONDS
    gone = time.monotonic()
    a.gone()
    assert _all_online(a)
    assert 0.7 <= a.dials[-1] - gone < 0.95
    h._RECONNECT_BACKOFF_MAX_SECONDS = longest
    # One wait of that length; a dial that fails after it is an ordinary one.
    a._qortal_young_ends = 1
    a.fail = 1
    gone = time.monotonic()
    a.gone()
    assert _all_online(a)
    assert a.dials[-2] - gone >= 0.6
    assert 0.09 < a.dials[-1] - a.dials[-2] < 0.3
    # One that lasted ends the count.
    time.sleep(0.45)
    gone = time.monotonic()
    a.gone()
    assert _all_online(a)
    assert a.dials[-1] - gone < 0.25 and a._qortal_young_ends == 0
    # With no other hub up it is the network, and GO would be deaf: soon, but
    # not for ever at that pace.
    h._CALL_RETRY_WAITS = (0.05, 0.3)
    h._CALL_REDIAL_SECONDS = 0.6
    h._HUB_YOUNG_SECONDS = 2.0
    fresh()
    b.online = False
    for expected in (0.05, 0.3, 0.6, 0.6):
        gone = time.monotonic()
        a.gone()
        assert _all_online(a)
        assert expected <= a.dials[-1] - gone < expected + 0.24, expected
    assert a._qortal_young_ends == 4
    h._HUB_YOUNG_SECONDS = 0.4
    # Also when the other one goes only later.
    h._PATIENCE_STEP_SECONDS = 0.05
    b.online = True
    gone = time.monotonic()
    a.gone()
    time.sleep(0.5)
    assert not a.online
    b.online = False
    assert _wait_for(lambda: a.online, 0.3) and a.dials[-1] - gone > 0.5
    b.online = True
    # A redial does not wait for it, and the count ends with the network.
    a._qortal_young_ends = 5
    a.gone()
    time.sleep(0.1)
    assert not a.online and a.reconnecting
    del a.dials[:]
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _all_online(a, b)
    assert a._qortal_young_ends == 0
    time.sleep(0.3)
    assert a.online and len(a.dials) == 1
    # Nor does anybody else: its thread is gone.
    a._qortal_young_ends = 5
    a.online = False
    waiting = threading.Thread(target=a.reconnect, daemon=True)
    waiting.start()
    time.sleep(0.1)
    assert waiting.is_alive()
    h._begin_redial(a)
    waiting.join(0.3)
    assert not waiting.is_alive()
    # Dialled by another thread: that is one, not two.
    fresh()
    a._qortal_young_ends = 5
    a.gone()
    time.sleep(0.1)
    assert a.connect(initial=True) and len(a.dials) == 1
    assert _wait_for(lambda: not a.reconnecting)
    time.sleep(0.1)
    assert len(a.dials) == 1 and a.online
    h._PATIENCE_STEP_SECONDS = 2.0
    h._CALL_RETRY_WAITS = (0.05, 0.1)
    h._CALL_REDIAL_SECONDS = 0.1
    fresh()

    # Dials that fail are no connections.
    a.gone()
    assert _all_online(a)
    a.fail = 2
    gone = time.monotonic()
    time.sleep(0.45)
    a.gone()
    assert _all_online(a)
    assert a.dials[-1] - gone < 1.2

    # A hub that says nothing and closes: the other hubs come first.
    h._CALL_REFUSED_SECONDS = 0.5
    fresh()
    a.silent = True
    a.gone()
    assert _all_online(a) and a._qortal_refused == 1
    a.gone()
    assert _all_online(a) and a._qortal_refused == 2
    known = (socket.AF_INET, NOBODY)
    for refused, other, address, late in (
        (2, 0, known, True),
        (2, 1, known, True),
        (1, 0, known, False),
        (2, 2, known, False),  # so does the other one
        (2, 0, None, False),  # or it has never been reached
    ):
        _drop(h, a, b)
        a._qortal_refused, b._qortal_refused = refused, other
        a._qortal_connected_at = b._qortal_connected_at = None
        b._qortal_address = address
        start = time.monotonic()
        assert h.refresh_network("switch", 0.5, True) == 2
        assert _all_online(a, b)
        assert (a.dials[0] - start > 0.45) is late, (refused, other, address)
        assert b.dials[0] - start < 0.3
    b._qortal_refused = 0
    # Outside a call there is no order.
    a._qortal_refused = 2
    _drop(h, a, b)
    a._qortal_connected_at = None
    b._qortal_address = known
    start = time.monotonic()
    assert h.refresh_network("switch", 2.0) == 2
    assert _all_online(a, b) and a.dials[0] - start < 0.3
    # Nor for a connection that is up already.
    a._qortal_refused = 2
    assert h._refuses(a) and not h._refuses(b)
    start = time.monotonic()
    ready = FakeSock()
    h._replace_connection(a, a.socket, (ready, start))
    assert a.socket is ready and time.monotonic() - start < 0.3
    a._qortal_refused = 2
    # Once something comes in it is not refusing any more.
    a.silent = False
    a.gone()
    assert _all_online(a) and a._qortal_refused == 0

    # GO's own replacing says nothing about the hub.
    a._qortal_young_ends = a._qortal_refused = 1
    assert h._note_connection_end(a, replaced=True) == 0
    assert (a._qortal_young_ends, a._qortal_refused) == (1, 1)
    assert h._note_connection_end(a) == 0, "none has come up since"
    assert (a._qortal_young_ends, a._qortal_refused) == (1, 1)
    pb._audio_links_by_id = {}
    h._HUB_YOUNG_SECONDS = 0.0
    h._CALL_REDIAL_SECONDS = 0.25


def _a_connection_that_is_ready(h, a, b):
    """The stall watch hands over a connection that is up already."""
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(5)
    h._HUB_YOUNG_SECONDS = 0.4
    began = time.monotonic() - 0.7

    def connected():
        sock = socket.create_connection(server.getsockname())
        server.accept()[0].close()
        return sock

    _drop(h, a, b)
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _all_online(a, b)
    del BackboneInterface.added[:], a.dials[:], calls[:]
    _links(a, b)
    before, ready = a.socket, connected()
    others = h._generation_of(b)
    h._replace_connection(a, before, (ready, began))
    assert a.online and a.socket is ready and a.dials == []
    assert BackboneInterface.added == ["a"] and ("tunnel", "a") in calls
    assert ("timeouts", "a") in calls and a._qortal_connected_at is not None
    assert a._qortal_address == (socket.AF_INET, server.getsockname())
    assert ready.gettimeout() == 0.0, "a send must not stop the I/O loop"
    # It is as old as its dial: that counts when the network switches.
    assert a._qortal_dialed_at == began and 0.7 <= a._qortal_dial_seconds < 1.5
    assert _closed() == [1] and h._generation_of(b) == others
    assert not before.closed and _wait_for(lambda: before.closed, 0.6)
    # Also for a hub whose address is not known.
    a._qortal_address = None
    before, ready = a.socket, connected()
    h._replace_connection(a, before, (ready, began))
    assert a.online and a.socket is ready and a.dials == []
    # Not needed any more: kept until it is old, then closed.
    ready = connected()
    h._replace_connection(a, object(), (ready, began))
    assert a.online and a.socket is not ready and ready.fileno() >= 0
    assert _wait_for(lambda: ready.fileno() < 0, 0.7)
    # A switch that comes while the old connection is taken out.
    ready = connected()
    real = h._reattach_interface

    def overtaken(*args, **kwargs):
        h._begin_redial(a)
        return real(*args, **kwargs)

    h._reattach_interface = overtaken
    h._replace_connection(a, a.socket, (ready, began))
    h._reattach_interface = real
    assert a.socket is None and ready.fileno() >= 0
    assert _wait_for(lambda: ready.fileno() < 0, 0.7)
    # One that is gone when it is needed: dialled after all.
    _drop(h, a, b)
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _all_online(a, b)
    del a.dials[:]
    ready = connected()
    ready.close()
    h._replace_connection(a, a.socket, (ready, began))
    assert a.online and not a.socket.closed and len(a.dials) == 1
    # What cannot be handed over leaves nothing behind.
    ready = connected()
    usual = BackboneInterface.add_client_socket
    BackboneInterface.add_client_socket = staticmethod(lambda sock, interface: 1 / 0)
    del a.dials[:]
    try:
        h._replace_connection(a, a.socket, (ready, began))
    finally:
        BackboneInterface.add_client_socket = staticmethod(usual)
    assert ready.fileno() < 0 and a.online and len(a.dials) == 1
    a._qortal_address = None
    h._HUB_YOUNG_SECONDS = 0.0
    server.close()


def _nothing_waits_in_a_send(h, a, b):
    """One thread serves the sockets of all hubs, so none of them may block."""

    class Sock(FakeSock):
        blocking = True

        def setblocking(self, flag):
            self.blocking = flag

    class Made(Iface):
        def connect(self, initial=False):
            super().connect(initial)
            self.socket = Sock()
            BackboneInterface.spawned_interface_filenos[self.socket.fileno()] = self
            return True

    for dial in ("initial_connect", "reconnect"):
        usual, Iface.RECONNECT_WAIT = Iface.RECONNECT_WAIT, 0.05
        hub = Made("g")
        threading.Thread(target=getattr(hub, dial), daemon=True).start()
        assert _wait_for(lambda: hub.online and hub.socket.blocking is False), dial
        Iface.RECONNECT_WAIT = usual
    h._never_block(object())  # one that is gone


def _a_lost_first_packet(h):
    """The dial is asked for again before TCP repeats it (after 1 s)."""
    made = []
    real = socket.socket

    class Counted(real):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            made.append(self)

    def ask(address):
        del made[:]
        began = time.monotonic()
        socket.socket = Counted
        try:
            return h._connect_asking_again(socket.AF_INET, address), None
        except OSError as exc:
            return None, exc
        finally:
            socket.socket = real
            took.append(time.monotonic() - began)

    def full():
        """Callers the system already holds for the server; it drops others,
        whose own system repeats the request after 1 s."""
        waiting = [real() for _ in range(3)]
        for entry in waiting:
            entry.setblocking(False)
            entry.connect_ex(here)
        time.sleep(0.05)
        return waiting

    took = []
    server = real()
    server.bind(("127.0.0.1", 0))
    server.listen(0)
    here = server.getsockname()

    # Answered from 0.2 s on: the second try gets through.
    callers = full()
    accepted = []
    timer = threading.Timer(
        0.2, lambda: accepted.extend(server.accept()[0] for _ in range(2))
    )
    timer.start()
    sock, error = ask(here)
    timer.join()
    assert sock is not None, error
    assert 0.3 < took[-1] < 0.7, took
    assert sock.getpeername() == here and sock.gettimeout() == 0.0
    assert sock.getsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY)
    asked = [entry for entry in made if entry not in accepted]
    assert [entry.fileno() >= 0 for entry in asked] == [False, True]
    for entry in callers + accepted + [sock]:
        entry.close()

    # Not at all: no longer than a plain dial, and every try is closed again.
    h._KNOWN_ADDRESS_TIMEOUT_SECONDS = 1.1
    callers = full()
    sock, error = ask(here)
    assert sock is None and isinstance(error, socket.timeout)
    assert 1.05 < took[-1] < 1.3, took
    assert len(made) == 3 and all(s.fileno() < 0 for s in made)
    # And the next try is not waited for past that.
    sock, error = None, None
    began = time.monotonic()
    try:
        h._connect_asking_again(socket.AF_INET, here, starts=(0.0, 5.0), seconds=0.3)
        assert False, "no answer"
    except socket.timeout:
        pass
    assert 0.28 < time.monotonic() - began < 0.5
    h._KNOWN_ADDRESS_TIMEOUT_SECONDS = 2.0

    # A newer dial takes over: at once, and nothing is left open.
    newer = threading.Event()
    threading.Timer(0.45, newer.set).start()  # between two tries
    for until in (0.45, 0.0):
        del made[:]
        socket.socket = Counted
        began = time.monotonic()
        try:
            h._connect_asking_again(socket.AF_INET, here, seconds=5.0, overtaken=newer.is_set)
            assert False, "overtaken"
        except InterruptedError:
            pass
        finally:
            socket.socket = real
        assert until <= time.monotonic() - began < until + 0.15
        assert len(made) == (2 if until else 0)
        assert all(entry.fileno() < 0 for entry in made)
    for entry in callers:
        entry.close()
    server.close()

    # Refused, or no way there: known at once, and nothing is left open.
    for address in (here, ("255.255.255.255", 9)):
        sock, error = ask(address)
        assert sock is None and not isinstance(error, socket.timeout)
        assert took[-1] < 0.2 and len(made) == 1 and made[0].fileno() < 0

    # Answered at once: asked once.
    server = real()
    server.bind(("127.0.0.1", 0))
    server.listen(5)
    sock, error = ask(server.getsockname())
    assert made == [sock] and took[-1] < 0.2
    sock.close()
    server.close()

    # One that is refused while another is still under way changes nothing.
    import select

    events = [[], [0], [1]]
    waits = []

    class Scripted:
        def __init__(self, *args):
            self.number = len(made)
            self.open = True
            made.append(self)

        def fileno(self):
            return 5000 + self.number

        def connect(self, address):
            raise BlockingIOError()

        def getsockopt(self, level, option):
            return 111 if self.number == 0 else 0

        def setsockopt(self, *args):
            pass

        def setblocking(self, flag):
            self.blocking = flag

        def close(self):
            self.open = False

    class Poller:
        def __init__(self):
            self.known = set()

        def register(self, entry, mask):
            assert mask == select.POLLOUT
            self.known.add(entry.fileno())

        def unregister(self, fileno):
            self.known.remove(fileno)

        def poll(self, timeout):
            waits.append(timeout)
            if len(waits) == 1:
                time.sleep(timeout / 1000.0)  # nothing until the second try
            return [(made[n].fileno(), 0) for n in events[len(waits) - 1]]

    del made[:]
    real_poll, select.poll, socket.socket = select.poll, Poller, Scripted
    try:
        sock = h._connect_asking_again(socket.AF_INET, here)
    finally:
        select.poll, socket.socket = real_poll, real
    assert sock is made[1] and sock.open and sock.blocking is False
    assert not made[0].open and len(made) == 2
    assert 300 < waits[0] <= 350 and 500 < waits[1] <= 550, waits

    # Two answered at once: the spare one has been up, so it is kept while it
    # is young. One that is still being asked for no hub has seen.
    later = []
    real_later, real_connected = h._close_when_old, h._is_connected
    h._close_when_old = lambda entry, since: later.append((entry, since))
    for up in (True, False):
        del made[:], waits[:], later[:]
        events[:] = [[], [1]]
        h._is_connected = lambda entry: up
        select.poll, socket.socket = Poller, Scripted
        try:
            sock = h._connect_asking_again(socket.AF_INET, here)
        finally:
            select.poll, socket.socket = real_poll, real
        assert sock is made[1] and len(made) == 2
        assert made[0].open is up
        assert [entry for entry, _ in later] == ([made[0]] if up else [])
        assert all(time.monotonic() - since < 1 for _, since in later)
    h._close_when_old, h._is_connected = real_later, real_connected
    assert h._is_connected(real()) is False and h._is_connected(object()) is False
    server = real()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    sock = real()
    sock.connect(server.getsockname())
    assert h._is_connected(sock) is True
    sock.close()
    assert h._is_connected(sock) is False
    server.close()


def _the_known_address(h, a, b):
    """No DNS for the redial in a call, when the hub's address is known."""
    _drop(h, a, b)
    a._qortal_address = b._qortal_address = None
    for interface in (a, b):
        interface.peer = ("192.0.2.7", 4444)
        interface.detached = False
    assert h.refresh_network("switch", 2.0) == 2
    assert _all_online(a, b)
    assert a._qortal_address == (socket.AF_INET, ("192.0.2.7", 4444))

    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(5)
    closed_port = socket.socket()
    closed_port.bind(("127.0.0.1", 0))
    here = server.getsockname()

    _drop(h, a, b)
    del BackboneInterface.added[:]
    a._qortal_address = (socket.AF_INET, here)
    b._qortal_address = (socket.AF_INET, closed_port.getsockname())  # refused
    a.never_connected = True
    before = time.monotonic()
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _all_online(a, b)
    # a: connected as connect() does it, without asking DNS.
    assert a.dials == [] and BackboneInterface.added == ["a"]
    assert a.socket.getpeername() == here and a.socket.gettimeout() == 0.0
    assert a.socket.getsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY)
    assert ("timeouts", "a") in calls and not a.never_connected
    assert before <= a._qortal_dialed_at <= time.monotonic()
    assert _wait_for(lambda: ("tunnel", "a") in calls and ("tunnel", "b") in calls)
    # b: that address did not answer, so DNS after all.
    assert len(b.dials) == 1 and b._qortal_address == (socket.AF_INET, b.peer)

    # Outside a call every dial asks DNS: hubs may move.
    _drop(h, a, b)
    a._qortal_address = b._qortal_address = (socket.AF_INET, here)
    assert h.refresh_network("switch", 2.0) == 2
    assert _all_online(a, b)
    assert len(a.dials) == 1 and len(b.dials) == 1

    # Failed retries try both again: the network may have come up meanwhile.
    h._CALL_RETRY_WAITS = (0.1,)
    _drop(h, a, b)
    del BackboneInterface.added[:]
    a.fail = 1
    a._qortal_address = (socket.AF_INET, closed_port.getsockname())
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: len(a.dials) == 1)
    a._qortal_address = (socket.AF_INET, here)
    assert _all_online(a, b)
    assert len(a.dials) == 1 and "a" in BackboneInterface.added

    # A lookup that is not answered does not hold the dial for long, nor one
    # that fails: the next try comes after the short wait. What DNS says is
    # connected to as the known address is.
    b.peer = NOBODY
    h._CALL_RETRY_WAITS = (0.1, 0.1, 0.1, 0.1)
    h._CALL_DNS_SECONDS = 0.4
    answers = threading.Event()
    asked = []
    real_lookup = socket.getaddrinfo
    v4 = (socket.AF_INET, socket.SOCK_STREAM, 6, "", here)
    v6 = (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", 1, 0, 0))
    said = [v4]

    def lookup(host, port, *args, **kwargs):
        if host != "hub.invalid":
            return real_lookup(host, port, *args, **kwargs)
        assert port == 4444 and kwargs == {"proto": socket.IPPROTO_TCP}
        asked.append(time.monotonic())
        if len(asked) == 1:
            answers.wait(5)
        if len(asked) == 2:
            raise socket.gaierror(7, "No address associated with hostname")
        return list(said)

    socket.getaddrinfo = lookup
    a.target_ip, a.target_port = "hub.invalid", 4444
    try:
        _drop(h, a, b)
        assert h.refresh_network("switch", 0.5, True) == 2
        assert _all_online(a, b)
        assert len(asked) == 3 and a.dials == []
        assert 0.48 < asked[1] - asked[0] < 0.8 and asked[2] - asked[1] < 0.4
        assert a.socket.getpeername() == here and a._qortal_address == (socket.AF_INET, here)
        # The kind of address that connect() takes, or the first there is.
        for entries, prefer, expected in (
            ([v6, v4], False, (socket.AF_INET, here)),
            ([v4, v6], True, (socket.AF_INET6, v6[4])),
            ([v6], False, (socket.AF_INET6, v6[4])),
            ([v4], True, (socket.AF_INET, here)),
        ):
            said[:], a.prefer_ipv6 = list(entries), prefer
            tried = []
            real_dial = h._dial_address
            h._dial_address = lambda hub, *args: tried.append(args) and False
            a._qortal_address = None
            assert h._dial_for_call(a, lambda: False) is False
            h._dial_address = real_dial
            assert [args[:3] for args in tried] == [expected + (h._CALL_CONNECT_SECONDS,)]
        said[:] = [v4]
        del a.prefer_ipv6
        # The known one is not asked for long, what DNS says a little longer.
        tried = []
        h._dial_address = lambda hub, *args: tried.append(args[2]) and False
        a._qortal_address = (socket.AF_INET, here)
        assert h._dial_for_call(a, lambda: False) is False
        h._dial_address = real_dial
        assert tried == [h._KNOWN_ADDRESS_TIMEOUT_SECONDS, h._CALL_CONNECT_SECONDS]

        # A newer redial does not wait for the lookup of the one before...
        h._CALL_DNS_SECONDS = 5.0
        answers.clear()
        del asked[:]
        _drop(h, a, b)
        assert h.refresh_network("switch", 0.5, True) == 2
        assert _wait_for(lambda: len(asked) == 1)
        time.sleep(0.1)
        again = time.monotonic()
        a._qortal_address = (socket.AF_INET, here)
        assert h.refresh_network("switch-2", 0.0, True) == 2
        assert _all_online(a, b)
        assert time.monotonic() - again < 0.3 and len(asked) == 1
        # ... nor does a pause.
        answers.clear()
        del asked[:]
        _drop(h, a, b)
        assert h.refresh_network("switch", 0.5, True) == 2
        assert _wait_for(lambda: len(asked) == 1)
        assert h.pause_network() is True
        assert _wait_for(lambda: a._qortal_dialling is None, 0.3)
        time.sleep(0.2)
        assert not a.online and a.socket is None and a.dials == []
        a.target_ip = None
        assert h.resume_network() is True
        assert _all_online(a, b)
        a.target_ip = "hub.invalid"
        answers.set()

        # Outside a call connect() asks by itself, however long that takes.
        del asked[:]
        _drop(h, a, b)
        assert h.refresh_network("switch", 2.0) == 2
        assert _all_online(a, b)
        assert asked == []
    finally:
        answers.set()
        socket.getaddrinfo = real_lookup
        del a.target_ip, a.target_port

    # The known address does not answer (any more): the same there.
    full = socket.socket()
    full.bind(("127.0.0.1", 0))
    full.listen(0)
    callers = [socket.socket() for _ in range(3)]
    for entry in callers:
        entry.setblocking(False)
        entry.connect_ex(full.getsockname())
    time.sleep(0.05)
    _drop(h, a, b)
    a._qortal_address = (socket.AF_INET, full.getsockname())
    assert h.refresh_network("switch", 0.5, True) == 2
    assert _wait_for(lambda: b.online)
    time.sleep(0.2)
    assert not a.online and a.dials == []
    again = time.monotonic()
    a._qortal_address = (socket.AF_INET, here)
    assert h.refresh_network("switch-2", 0.0, True) == 2
    assert _all_online(a, b)
    assert time.monotonic() - again < 0.3 and a.dials == []
    assert a.socket.getpeername() == here
    for entry in callers:
        entry.close()
    full.close()

    # One that fails is no dial: when it began says nothing.
    _drop(h, a, b)
    dialed_at = a._qortal_dialed_at
    real = h._dial_for_call
    h._dial_for_call = lambda interface, overtaken: False
    assert h._connect_current(a, h._generation_of(a), urgent=True) is None
    h._dial_for_call = real
    assert a._qortal_dialed_at == dialed_at and a.dials == [] and not a.online
    # Signed out: whatever it belongs to.
    assert not h._is_stale(a, h._generation_of(a))
    h._network_paused = True
    assert h._is_stale(a, h._generation_of(a))
    h._network_paused = False

    # A pause during the attempt: no dial with DNS follows, no socket is left.
    _drop(h, a, b)
    real = h._dial_for_call

    def paused_meanwhile(interface, overtaken):
        if interface is a:
            h.pause_network()
            return None
        return real(interface, overtaken)

    h._dial_for_call = paused_meanwhile
    try:
        h.refresh_network("switch", 0.5, True)
        assert _wait_for(lambda: h._network_paused)
        time.sleep(0.2)
    finally:
        h._dial_for_call = real
    assert a.dials == [] and not a.online
    assert h.resume_network() is True
    assert _all_online(a, b)
    server.close()
    closed_port.close()


def test_refresh_in_a_call():
    pb = _install_stubs()
    import qortal_presence_host as h

    h._install_network_pause_gates(pb)
    h._install_reconnect_backoff(Iface)
    h._started = True
    # Connections count as old and settled at once (that has its own checks).
    h._HUB_YOUNG_SECONDS = h._SETTLE_MIN_SECONDS = h._SETTLE_MAX_SECONDS = 0.0
    a, b = Transport.interfaces
    for interface in (a, b):
        assert interface.connect(initial=True)

    _a_first_dial_that_fails(h, a, b)
    _a_connection_that_is_gone_again(h, a, b)
    _a_connection_that_is_gone_at_any_moment(h)
    _a_second_switch_during_the_retries(h, a, b)
    _a_dial_that_a_switch_overtook(h, a, b)
    _a_hub_that_is_slow_to_answer(h, a, b)
    _a_hub_that_is_up_a_moment_later(h, a, b)
    _a_hub_that_the_refresh_leaves_alone(h, a, b)
    _two_dials_at_once(h, a, b)
    _a_connection_that_lasts_only_a_moment(h, a, b)
    _a_connection_that_goes_in_the_middle_of_a_call(h, a, b, pb)
    _a_hub_that_has_had_enough(h, a, b, pb)
    _a_connection_that_is_ready(h, a, b)
    _nothing_waits_in_a_send(h, a, b)
    _a_lost_first_packet(h)
    _the_known_address(h, a, b)


if __name__ == "__main__":
    test_refresh_in_a_call()
    print("ALL OK")
