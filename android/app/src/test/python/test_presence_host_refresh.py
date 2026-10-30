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


class Link:
    def __init__(self, n, interface):
        self.n = n
        self.attached_interface = interface

    def teardown(self):
        calls.append(("teardown", self.n))


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

    @staticmethod
    def synthesize_tunnel(interface):
        calls.append(("tunnel", interface.name))


def _install_stubs():
    rns = types.ModuleType("RNS")
    rns.Transport = Transport
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
    sys.modules["presence_bridge"] = pb
    return pb


def _teardowns():
    return sorted(call[1] for call in calls if call[0] == "teardown")


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
    Transport.pending_links = [Link(3, None)]
    old_a, old_b = a.socket, b.socket
    a.IN = a.OUT = False  # torn down by a socket error under the I/O loop
    a.reconnecting = True  # a stale flag from a loop before the switch
    assert h.refresh_network("switch", 2.0) == 2
    assert _teardowns() == [1, 2, 3]
    assert _wait_for(lambda: a.dials == 2 and b.dials == 2 and a.online and b.online)
    # The old socket left the I/O loop first and closed only after the new
    # dial, so the new one cannot reuse its fd number.
    assert a.previous_open_at_dial[-1] and b.previous_open_at_dial[-1]
    assert _wait_for(lambda: old_a.closed and old_b.closed)
    assert len(_live(a)) == 1 and len(_live(b)) == 1
    assert a.IN and a.OUT and not a.reconnecting and a.frame_buffer == b""
    assert _wait_for(lambda: calls.count(("maint", "network_resume")) == 1)
    assert calls.count(("tunnel", "a")) == 1

    # ── a hub dialled after the switch is already on the new network ──
    del calls[:]
    Transport.active_links = [Link(4, a), Link(5, b)]
    Transport.pending_links = []
    a._qortal_dialed_at = time.monotonic() - 10
    b._qortal_dialed_at = time.monotonic() - 1  # after a switch 5 s ago
    assert h.refresh_network("switch-2", 5.0) == 1
    assert _teardowns() == [4]
    assert _wait_for(lambda: a.dials == 3 and a.online)
    time.sleep(0.05)
    assert b.dials == 2 and b.online

    # ── a hub waiting in its backoff is dialled now, no links closed ──
    del calls[:]
    b.fail = True
    b.online = False
    h._forget_socket(b, b.socket)
    b.socket = None
    threading.Thread(target=b.reconnect, daemon=True).start()
    assert _wait_for(lambda: b.reconnecting)
    b.fail = False
    a._qortal_dialed_at = time.monotonic()
    assert h.refresh_network("switch-3", 5.0) == 1
    assert _teardowns() == []
    assert _wait_for(lambda: b.online)
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


if __name__ == "__main__":
    test_refresh_network()
    print("ALL OK")
