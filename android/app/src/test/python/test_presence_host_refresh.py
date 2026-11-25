"""Stub harness for refresh_network() in qortal_presence_host.py.

refresh_network() redials the hub sockets after the phone switched networks
(Wi-Fi <-> mobile data). Same RNS stand-ins as test_presence_host_pause.py,
without Chaquopy or a network:

    python3 android/app/src/test/python/test_presence_host_refresh.py

It also works under pytest. The module is loaded once, so the checks run in
one ordered function.
"""

import os
import sys
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

from _host_test_support import _wait_for  # noqa: E402

calls = []
_fd_counter = [500]


class FakeSock:
    def __init__(self):
        _fd_counter[0] += 1
        self._fd = _fd_counter[0]
        self.closed = False

    def fileno(self):
        return -1 if self.closed else self._fd

    def close(self):
        self.closed = True


class BackboneInterface:
    spawned_interface_filenos = {}
    deregistered = []

    @staticmethod
    def deregister_fileno(fileno):
        BackboneInterface.deregistered.append(fileno)


class Iface:
    RECONNECT_WAIT = 0.05

    def __init__(self, name):
        self.name = name
        self.initiator = True
        self.IN = True
        self.OUT = True
        self.online = False
        self.detached = False
        self.reconnecting = False
        self.socket = None
        self.frame_buffer = b"x"
        self.transmit_buffer = b"y"
        self.fail = False
        self.gates = []
        self.dials = 0
        self.max_reconnect_tries = None
        self.never_connected = False
        self.wants_tunnel = False
        self.previous = None
        self.previous_open_at_dial = []

    def detach(self):
        self.online = False
        self.detached = True
        if self.socket is not None:
            self.socket.close()
        self.socket = None

    def connect(self, initial=False):
        gate = self.gates.pop(0) if self.gates else None
        if gate is not None:
            gate.wait(5)
        self.dials += 1
        if self.previous is not None:
            self.previous_open_at_dial.append(not self.previous.closed)
        if self.fail:
            if initial:
                return False
            raise OSError("connect failed")
        sock = FakeSock()
        self.socket = sock
        self.previous = sock
        BackboneInterface.spawned_interface_filenos[sock.fileno()] = self
        self.online = True
        return True

    def __str__(self):
        return self.name


class Destination:
    def __init__(self, name):
        self.hash = name


class Link:
    PENDING, HANDSHAKE, ACTIVE, STALE, CLOSED = range(5)
    INITIATOR_CLOSED = 2

    def __init__(self, n, interface, status=ACTIVE, dest=None, initiator=True):
        self.n = n
        self.attached_interface = interface
        self.status = status
        self.initiator = initiator
        self.teardown_reason = None
        if dest is not None:
            self.destination = Destination(dest)

    def _Link__teardown_packet(self):
        calls.append(("linkclose", self.n))

    def link_closed(self):
        assert self.status == Link.CLOSED
        assert self.teardown_reason == Link.INITIATOR_CLOSED
        # What the bridge would find if it opened the next link now.
        online = [i.name for i in Transport.interfaces if i.online]
        calls.append(("closed", self.n, tuple(online)))
        if self in Transport.active_links:
            Transport.active_links.remove(self)
        if self in Transport.pending_links:
            Transport.pending_links.remove(self)


def _live(interface):
    """Open sockets of `interface` still registered with the I/O loop."""
    return [
        fd
        for fd, owner in BackboneInterface.spawned_interface_filenos.items()
        if owner is interface and fd not in BackboneInterface.deregistered
    ]


class Transport:
    ready = False
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
    pb.announce_local_destination = lambda reason="": calls.append(("announce", reason))
    pb._run_overlay_sync_maintenance = lambda reason="": calls.append(("maint", reason))
    pb._ping_established_overlay_links = lambda reason: 5
    pb._rns_announce_on_auth_session_end = lambda: calls.append(("auth_end",))
    pb.maybe_emit_transport_state = lambda force=False: calls.append(("ts",))
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


def _told():
    return sorted(call[1] for call in list(calls) if call[0] == "linkclose")


def _order(*wanted):
    return [call[:2] for call in list(calls) if call[:2] in wanted]


def test_refresh_network():
    pb = _install_stubs()
    import qortal_presence_host as h

    h._install_network_pause_gates(pb)
    h._install_reconnect_backoff(Iface)
    a, b = Transport.interfaces
    for interface in (a, b):
        assert interface.connect(initial=True)

    # ── nothing happens before the bridge, and RNS, are up ──
    assert h.refresh_network("early") == 0
    h._started = True
    assert h.refresh_network("rns-booting") == 0
    assert a.dials == 1 and b.dials == 1
    Transport.ready = True

    # ── a switch redials both hubs and closes the links through them ──
    Transport.active_links = [Link(1, a), Link(2, b)]
    Transport.pending_links = [Link(3, None, Link.PENDING)]
    old_a, old_b = a.socket, b.socket
    a.IN = a.OUT = False  # torn down by a socket error under the I/O loop
    a.reconnecting = True  # a stale flag from a loop before the switch
    assert h.refresh_network("switch", 2.0) == 2
    # The old sockets may still work: the other sides are told.
    assert _told() == [1, 2]
    assert _wait_for(lambda: a.dials == 2 and b.dials == 2 and a.online and b.online)
    assert _wait_for(lambda: _closed() == [1, 2, 3])
    # Each only once its hub is back (the bridge asks for a new link at once)
    # and after the hub knows the phone again.
    for n, name in ((1, "a"), (2, "b")):
        assert next(c for c in calls if c[:2] == ("closed", n))[2].count(name) == 1
        assert _order(("tunnel", name), ("closed", n)) == [("tunnel", name), ("closed", n)]
    # The old socket left the I/O loop first and closed only after the new
    # dial, so the new one cannot reuse its fd number.
    assert a.previous_open_at_dial[-1] and b.previous_open_at_dial[-1]
    assert _wait_for(lambda: old_a.closed and old_b.closed)
    assert len(_live(a)) == 1 and len(_live(b)) == 1
    assert a.IN and a.OUT and not a.reconnecting and a.frame_buffer == b""
    assert _wait_for(lambda: calls.count(("maint", "network_resume")) >= 1)
    assert calls.count(("tunnel", "a")) == 1

    # ── a hub dialled after the switch is already on the new network ──
    del calls[:]
    Transport.active_links = [Link(4, a), Link(5, b)]
    Transport.pending_links = []
    a._qortal_dialed_at = time.monotonic() - 10
    b._qortal_dialed_at = time.monotonic() - 1  # after a switch 5 s ago
    assert h.refresh_network("switch-2", 5.0) == 1
    assert _told() == [4]
    assert _wait_for(lambda: a.dials == 3 and a.online)
    assert _wait_for(lambda: _closed() == [4])
    time.sleep(0.05)
    assert b.dials == 2 and b.online and _closed() == [4]

    # ── a hub waiting in its backoff is dialled now, no links closed ──
    del calls[:]
    Transport.active_links = []
    b.fail = True
    b.online = False
    h._forget_socket(b, b.socket)
    b.socket = None
    threading.Thread(target=b.reconnect, daemon=True).start()
    assert _wait_for(lambda: b.reconnecting)
    b.fail = False
    a._qortal_dialed_at = time.monotonic()
    assert h.refresh_network("switch-3", 5.0) == 1
    assert _wait_for(lambda: b.online)
    assert _closed() == [] and _told() == []
    dials = b.dials
    time.sleep(0.2)
    # The old backoff loop woke up stale and gave up: no second socket.
    assert b.dials == dials and len(_live(b)) == 1

    # ── a reconnect loop that wakes after another dial connected ──
    b.fail = True
    b.online = False
    h._forget_socket(b, b.socket)
    b.socket = None
    b.reconnecting = False
    threading.Thread(target=b.reconnect, daemon=True).start()
    assert _wait_for(lambda: b.reconnecting)
    b.fail = False
    assert b.connect(initial=True)  # e.g. a resume dialled it meanwhile
    dials = b.dials
    time.sleep(0.2)
    assert b.dials == dials, "the loop must not dial a connected interface"
    assert not b.reconnecting and len(_live(b)) == 1

    # ── a hub RNS is still building when a refresh lands ──
    c = Iface("c")
    slow = threading.Event()
    c.gates = [slow]
    building = threading.Thread(target=Iface.initial_connect, args=(c,), daemon=True)
    building.start()
    assert _wait_for(lambda: not c.gates)  # its first dial blocks in connect()
    a._qortal_dialed_at = b._qortal_dialed_at = 0.0
    h.refresh_network("switch-4", 2.0)  # c is not in Transport.interfaces yet
    slow.set()
    assert _wait_for(lambda: c.online and c.wants_tunnel)
    assert len(_live(c)) == 1 and not c.detached

    # ── a hub RNS is still building when a pause lands ──
    d = Iface("d")
    slow = threading.Event()
    d.gates = [slow]
    building = threading.Thread(target=Iface.initial_connect, args=(d,), daemon=True)
    building.start()
    assert _wait_for(lambda: not d.gates)
    assert h.pause_network() is True
    assert h.refresh_network("paused") == 0
    slow.set()
    building.join(2)
    assert d.detached and not d.online
    assert any(item[0] is d for item in h._paused_interfaces)
    assert h.resume_network() is True
    assert _wait_for(lambda: d.online and a.online and b.online)


    _sockets_already_offline(h, a, b)
    _reconnect_loop_closes_links(h, a, b)
    _unreachable_hub(h, pb, a, b)
    _incoming_overlay_link(h, pb, a, b)
    _one_offline_one_still_up(h, a, b)


def _lose_socket(interface):
    """What Android does to the sockets of a network that is gone."""
    import qortal_presence_host as h

    interface.online = False
    h._forget_socket(interface, interface.socket)
    interface.socket.close()
    interface.socket = None


def _fresh(h, a, b):
    del calls[:]
    Transport.interfaces = [a, b]
    Transport.active_links = []
    Transport.pending_links = []
    Transport.path_table = {}
    for interface in (a, b):
        interface.fail = False
        assert _wait_for(lambda: interface.online)
        interface._qortal_dialed_at = 0.0


def _sockets_already_offline(h, a, b):
    """Wi-Fi to mobile data in a call, 2026-11-24: ``replaced=0``."""
    _fresh(h, a, b)
    call = Link(11, a)
    overlay = Link(12, b, initiator=False)
    asked = Link(13, None, Link.PENDING, dest=b"peer")
    Transport.active_links = [call, overlay]
    Transport.pending_links = [asked]
    Transport.path_table = {b"peer": b}
    _lose_socket(a)
    _lose_socket(b)
    gate = threading.Event()
    b.gates = [gate]  # b is slow to dial
    dials = (a.dials, b.dials)
    assert h.refresh_network("wifi-to-mobile", 2.0) == 2
    # a is back: the call's link ends at once, the links over b do not yet.
    assert _wait_for(lambda: _closed() == [11])
    assert call.status == Link.CLOSED and call.teardown_reason == Link.INITIATOR_CLOSED
    assert a.online and not b.online
    assert overlay.status == Link.ACTIVE and asked.status == Link.PENDING
    gate.set()
    # A link of the other side's making ends as a local close as well, or the
    # bridge would keep away from that neighbour for 15 s.
    assert _wait_for(lambda: _closed() == [11, 12, 13])
    for n, name in ((11, "a"), (12, "b"), (13, "b")):
        assert _order(("tunnel", name), ("closed", n)) == [("tunnel", name), ("closed", n)]
        assert name in next(c for c in calls if c[:2] == ("closed", n))[2]
    # Nobody is told: there is no connection the packet could take.
    assert _told() == []
    assert (a.dials, b.dials) == (dials[0] + 1, dials[1] + 1)
    assert _wait_for(lambda: calls.count(("maint", "network_resume")) >= 2)
    # New links on the new connections stay.
    Transport.active_links = [Link(14, a), Link(15, b)]
    a._qortal_dialed_at = b._qortal_dialed_at = time.monotonic()
    assert h.refresh_network("late-callback", 5.0) == 0
    time.sleep(0.1)
    assert _closed() == [11, 12, 13]


def _reconnect_loop_closes_links(h, a, b):
    """The backoff loop redials first: a hub restart, or a paced refresh."""
    _fresh(h, a, b)
    Transport.active_links = [Link(21, a), Link(22, b)]
    _lose_socket(a)
    threading.Thread(target=a.reconnect, daemon=True).start()
    assert _wait_for(lambda: a.online)
    assert _wait_for(lambda: _closed() == [21])
    assert _order(("tunnel", "a"), ("closed", 21)) == [("tunnel", "a"), ("closed", 21)]
    assert _wait_for(lambda: calls.count(("maint", "network_resume")) == 1)
    time.sleep(0.05)
    assert _closed() == [21], "links over the other hub stay"
    # An ordinary reconnect with no link over it starts no maintenance.
    del calls[:]
    _lose_socket(a)
    threading.Thread(target=a.reconnect, daemon=True).start()
    assert _wait_for(lambda: a.online and ("tunnel", "a") in calls)
    time.sleep(0.05)
    assert calls == [("tunnel", "a")]


def _unreachable_hub(h, pb, a, b):
    """One hub cannot be dialled from the new network."""
    _fresh(h, a, b)
    over_b = Link(31, b, dest=b"one")
    incoming = Link(32, b, initiator=False)
    elsewhere = Link(33, a, dest=b"three")
    unrouted = Link(34, None, Link.PENDING, dest=b"four")
    Transport.active_links = [over_b, incoming, elsewhere]
    Transport.pending_links = [unrouted]
    two = "22" * 16
    pb._audio_links_by_id = {"x": {"link": incoming, "peerPresenceHash": two}}
    Transport.path_table = {
        b"one": b,
        bytes.fromhex(two): b,
        b"three": a,
        b"five": b,
    }
    _lose_socket(b)
    b.fail = True
    Iface.RECONNECT_WAIT = 30  # b's own loop is nowhere near its next try
    a._qortal_dialed_at = time.monotonic()  # a is on the new network already
    assert h.refresh_network("switch", 5.0) == 1
    assert _wait_for(lambda: _closed() == [31, 32])
    # The new links must not go to the same hub again; other paths stay.
    assert Transport.path_table == {b"three": a, b"five": b}
    assert {c[1] for c in calls if c[0] == "inval"} == {b"one", bytes.fromhex(two)}
    assert elsewhere.status == Link.ACTIVE and unrouted.status == Link.PENDING
    assert _wait_for(lambda: calls.count(("maint", "network_resume")) >= 1)
    pb._audio_links_by_id = {}

    # The same when the reconnect loop finds out (a hub that went down).
    Iface.RECONNECT_WAIT = 0.05
    b.fail = False
    assert h.refresh_network("back", 0.0) == 2
    _fresh(h, a, b)
    Transport.active_links = [Link(37, a), Link(38, b, dest=b"one")]
    Transport.path_table = {b"one": b}
    _lose_socket(b)
    b.fail = True
    threading.Thread(target=b.reconnect, daemon=True).start()
    assert _wait_for(lambda: _closed() == [38] and Transport.path_table == {})
    b.fail = False
    assert _wait_for(lambda: b.online)
    time.sleep(0.05)
    assert _closed() == [38]
    # A hub that came back meanwhile keeps its links.
    assert h._give_up_links_over(a) == 0 and _closed() == [38]

    # With no hub at all the links wait, so that the call's one reopens when
    # it can: as soon as the first hub is back.
    _fresh(h, a, b)
    Transport.active_links = [Link(35, a), Link(36, b, dest=b"one")]
    Transport.path_table = {b"one": b}
    _lose_socket(a)
    _lose_socket(b)
    a.fail = b.fail = True
    gate = threading.Event()
    b.gates = [None, gate]  # b's second dial hangs until the gate opens
    assert h.refresh_network("lost", 5.0) == 2
    time.sleep(0.2)
    assert _closed() == [] and Transport.path_table == {b"one": b}
    a.fail = False
    assert _wait_for(lambda: a.online and _closed() == [35, 36])
    assert Transport.path_table == {} and not b.online
    b.fail = False
    gate.set()
    assert _wait_for(lambda: b.online)
    time.sleep(0.1)
    assert _closed() == [35, 36]


def _incoming_overlay_link(h, pb, a, b):
    """Its neighbour gives the inbound slot back, unless it has a link left."""
    _fresh(h, a, b)
    gone, kept, outgoing = Link(41, a, initiator=False), Link(42, a, initiator=False), Link(43, a)
    Transport.active_links = [gone, kept, outgoing]
    pb._overlay_links_by_id = {
        "g": {"link": gone, "incoming": True, "peerPresenceHash": "AA"},
        "k": {"link": kept, "incoming": True, "peerPresenceHash": "bb"},
        "o": {"link": outgoing, "incoming": False, "peerPresenceHash": "cc"},
    }
    pb._active_overlay_link_id_by_peer_hash = {"bb": "other"}
    pb._inbound_overlay_neighbors = {"aa": 1.0, "bb": 1.0, "cc": 1.0}
    _lose_socket(a)
    b._qortal_dialed_at = time.monotonic()
    assert h.refresh_network("switch", 5.0) == 1
    assert _wait_for(lambda: _closed() == [41, 42, 43])
    assert _wait_for(lambda: sorted(pb._inbound_overlay_neighbors) == ["bb", "cc"])


def _one_offline_one_still_up(h, a, b):
    """Only where the old socket is still up is anyone told."""
    _fresh(h, a, b)
    ended = Link(53, b, Link.CLOSED)  # RNS drops closed links a little later
    Transport.active_links = [Link(51, a), Link(52, b), ended]
    _lose_socket(a)
    assert h.refresh_network("switch", 2.0) == 2
    assert _told() == [52]
    assert _wait_for(lambda: _closed() == [51, 52])
    time.sleep(0.05)
    assert _closed() == [51, 52], "a closed link is not closed again"


if __name__ == "__main__":
    test_refresh_network()
    print("ALL OK")
