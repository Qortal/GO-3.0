"""Stub harness for the network pause/resume in qortal_presence_host.py.

The host patches the vendored RNS at runtime (reconnect backoff, pause gates,
serialised hub dials). This runs those patches against small RNS stand-ins,
without Chaquopy or a network:

    python3 android/app/src/test/python/test_presence_host_pause.py

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
_fd_counter = [100]


class FakeSock:
    def __init__(self):
        _fd_counter[0] += 1
        self._fd = _fd_counter[0]
        self.closed = False

    def fileno(self):
        return -1 if self.closed else self._fd

    def shutdown(self, how):
        pass

    def close(self):
        self.closed = True


class BackboneInterface:
    spawned_interface_filenos = {}
    deregistered = []

    @staticmethod
    def deregister_fileno(fileno):
        BackboneInterface.deregistered.append(fileno)


class Link:
    ACTIVE, CLOSED = 2, 4

    def __init__(self, n):
        self.n = n
        self.status = Link.ACTIVE

    def teardown(self):
        self.status = Link.CLOSED
        calls.append(("teardown", self.n))


class Iface:
    RECONNECT_WAIT = 0.01

    def __init__(self, name):
        self.name = name
        self.initiator = True
        self.IN = True
        self.OUT = True
        self.online = True
        self.detached = False
        self.reconnecting = False
        self.socket = FakeSock()
        self.frame_buffer = b"x"
        self.transmit_buffer = b"y"
        self.fail = False
        self.gates = []
        self.max_reconnect_tries = None
        self.never_connected = False

    def detach(self):
        # Mirrors upstream plus the I/O loop's teardown of a closed socket.
        self.online = False
        self.detached = True
        if self.socket is not None:
            self.socket.close()
        self.socket = None
        self.IN = False
        self.OUT = False

    def connect(self, initial=False):
        gate = self.gates.pop(0) if self.gates else None
        if gate is not None:
            gate.wait(5)
        if self.fail:
            if initial:
                return False
            raise OSError("connect failed")
        sock = FakeSock()
        self.socket = sock
        BackboneInterface.spawned_interface_filenos[sock.fileno()] = self
        self.online = True
        return True

    def initial_connect(self):
        calls.append(("initial", self.name))

    def __str__(self):
        return self.name


class Transport:
    active_links = [Link(1)]
    pending_links = [Link(2)]
    interfaces = [Iface("a"), Iface("b")]

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
    sys.modules["presence_bridge"] = pb
    return pb


def _tunnels(name):
    return calls.count(("tunnel", name))


def test_pause_resume():
    pb = _install_stubs()
    import qortal_presence_host as h

    h._install_network_pause_gates(pb)
    h._install_network_pause_gates(pb)  # idempotent
    h._install_reconnect_backoff(Iface)
    assert pb._ping_established_overlay_links("x") == 5
    h._started = True

    # ── pause closes links and hub sockets, gates the bridge's dialling ──
    assert h.pause_network() is True
    assert h.pause_network() is False
    assert pb._ping_established_overlay_links("x") == 0
    pb.announce_local_destination("gated")
    pb._run_overlay_sync_maintenance("gated")
    assert ("announce", "gated") not in calls
    assert ("maint", "gated") not in calls
    assert ("teardown", 1) in calls and ("teardown", 2) in calls
    a, b = Transport.interfaces
    assert a.detached and b.detached and not a.online

    # A hub interface created while paused stays closed.
    c = Iface("c")
    Iface.initial_connect(c)
    assert c.detached and ("initial", "c") not in calls
    h._paused_interfaces[:] = [p for p in h._paused_interfaces if p[0] is not c]

    # ── resume redials; a failing hub falls back to the backoff loop ──
    b.fail = True
    assert h.resume_network() is True
    assert _wait_for(lambda: a.online and _tunnels("a") == 1)
    assert a.IN and a.OUT and not a.detached and a.frame_buffer == b""
    assert _wait_for(lambda: calls.count(("maint", "network_resume")) == 1)
    assert not b.online

    # Pausing again stops b's retry loop.
    h.pause_network()
    time.sleep(0.1)
    b.fail = False
    time.sleep(0.2)
    assert not b.online, "reconnect loop must stop while paused"
    h.resume_network()
    assert _wait_for(lambda: a.online and b.online)

    # ── two hubs are back: the neighbours are dialled once ──
    for _ in range(2):
        h.pause_network()
        del calls[:]
        h.resume_network()
        assert _wait_for(lambda: _tunnels("a") == 1 and _tunnels("b") == 1)
        time.sleep(0.1)
        assert a.online and b.online
        assert calls.count(("maint", "network_resume")) == 1

    # ── overlapping resumes: a stale dial must not hijack the new one ──
    h.pause_network()
    tunnels_before = _tunnels("a")
    slow = threading.Event()
    a.gates = [slow]
    h.resume_network()  # generation N: its dial blocks in connect()
    assert _wait_for(lambda: not a.gates)
    h.pause_network()
    h.resume_network()  # generation N+2 waits for the per-interface lock
    time.sleep(0.05)
    assert not a.online
    slow.set()
    assert _wait_for(lambda: a.online and _tunnels("a") == tunnels_before + 1)
    time.sleep(0.1)
    assert _tunnels("a") == tunnels_before + 1, "stale dial must not tunnel"
    assert not a.detached, "stale dial must not detach the live socket"
    live = a.socket
    assert live is not None and not live.closed
    owned = [fd for fd, i in BackboneInterface.spawned_interface_filenos.items() if i is a]
    assert live.fileno() in owned
    stale_socks = [fd for fd in owned if fd != live.fileno()]
    # Only sockets closed by pause (already gone from epoll) may linger.
    assert all(fd not in BackboneInterface.deregistered for fd in stale_socks)

    # ── a dial that finishes after a pause is taken down again ──
    h.pause_network()
    slow = threading.Event()
    a.gates = [slow]
    h.resume_network()
    assert _wait_for(lambda: not a.gates)
    h.pause_network()
    slow.set()
    assert _wait_for(lambda: a.detached and a.socket is None)
    time.sleep(0.05)
    assert not a.online and a.detached
    h.resume_network()
    assert _wait_for(lambda: a.online and not a.detached)

    # ── a stale reconnect loop connecting after a newer resume ──
    h.pause_network()
    a.fail = True
    h.resume_network()  # initial dial fails, the backoff loop takes over
    assert _wait_for(lambda: a.reconnecting)
    slow = threading.Event()
    a.gates = [slow]
    assert _wait_for(lambda: not a.gates)  # the loop is inside connect()
    a.fail = False
    h.pause_network()
    tunnels_before = _tunnels("a")
    h.resume_network()  # newer generation waits for the loop's dial
    slow.set()
    assert _wait_for(lambda: a.online and _tunnels("a") == tunnels_before + 1)
    time.sleep(0.2)
    assert _tunnels("a") == tunnels_before + 1
    assert a.online and not a.detached and not a.socket.closed

    # ── the out queue keeps the newest frames ──
    h._OUT_QUEUE_MAX_FRAMES = 3
    for i in range(10):
        h._put_out_frame(str(i))
    assert [h.poll(0) for _ in range(4)] == ["7", "8", "9", ""]


if __name__ == "__main__":
    test_pause_resume()
    print("ALL OK")
