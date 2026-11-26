"""A new hub connection that gets the number of one that has just ended.

The Backbone I/O loop of RNS closes a socket before it takes its number out of
its table. The loop is played here, step by step, on real sockets and with the
vendored RNS:

    python3 android/app/src/test/python/test_presence_host_hub_sockets.py

It also works under pytest.
"""

import os
import select
import socket
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

from RNS.Interfaces import BackboneInterface as backbone_module  # noqa: E402
import qortal_presence_host as h  # noqa: E402

Backbone = backbone_module.BackboneInterface
server = socket.socket()
server.bind(("127.0.0.1", 0))
server.listen(20)


class Hub(backbone_module.BackboneClientInterface):
    def __init__(self, initiator=True):
        self.initiator = initiator
        self.online = True
        self.detached = False
        self.socket = None
        self.asked = threading.Event()
        self.torn = False
        self.frame_buffer = b""

    def reconnect(self):
        self.asked.set()

    def teardown(self):
        self.torn = True

    def __str__(self):
        return "hub"


def _connected(number=None):
    sock = socket.create_connection(server.getsockname())
    if number is not None and sock.fileno() != number:
        # The lowest number that is free is usually the one just closed.
        moved = os.dup2(sock.fileno(), number)
        sock.close()
        sock = socket.socket(fileno=moved)
    return sock


def _setup():
    Backbone._job_active = True  # no loop: these checks are it
    h._install_hub_socket_guards(Backbone, Hub)
    table, receive = Backbone.spawned_interface_filenos, Hub.receive
    h._install_hub_socket_guards(Backbone, Hub)
    assert Backbone.spawned_interface_filenos is table, "installed once"
    assert Hub.receive is receive
    return table


def _is_read(sock):
    Backbone.epoll.modify(sock.fileno(), select.EPOLLIN)
    return True


def _end(hub):
    """What the loop does first: the rest is done by _rest_of()."""
    number = hub.socket.fileno()
    Backbone.deregister_fileno(number)
    hub.socket.close()
    return number


def _rest_of(hub, number):
    table = Backbone.spawned_interface_filenos
    if number in table:
        table.pop(number)
    hub.receive(b"")


def _add(hub, sock):
    hub.socket = sock
    Backbone.add_client_socket(sock, hub)
    hub.online = True


def test_another_hub_gets_the_number():
    table = _setup()
    ended, other = Hub(), Hub()
    _add(ended, _connected())
    number = _end(ended)
    _add(other, _connected(number))
    _rest_of(ended, number)
    assert table[number] is other and _is_read(other.socket)
    assert other.online and not other.asked.is_set()
    # The one that ended is told.
    assert not ended.online and ended.asked.wait(2)
    # And later the other one as well.
    assert _end(other) == number
    _rest_of(other, number)
    assert number not in table and not other.online and other.asked.wait(2)


def test_the_same_hub_gets_it_again():
    """Dialled on another thread, for a switch of network."""
    table = _setup()
    for same_number in (True, False):
        hub = Hub()
        _add(hub, _connected())
        number = _end(hub)
        taken = None if same_number else os.open(os.devnull, os.O_RDONLY)
        _add(hub, _connected(number if same_number else None))
        assert (hub.socket.fileno() == number) is same_number
        _rest_of(hub, number)
        assert (number in table) is same_number
        if taken is not None:
            os.close(taken)
        assert hub.online and not hub.asked.wait(0.05), "the next one is up"
        assert table[hub.socket.fileno()] is hub and _is_read(hub.socket)
        # Its own end is not missed.
        number = _end(hub)
        _rest_of(hub, number)
        assert number not in table and not hub.online and hub.asked.wait(2)


def test_an_ordinary_end():
    table = _setup()
    hub = Hub()
    _add(hub, _connected())
    number = _end(hub)
    _rest_of(hub, number)
    assert number not in table and not hub.online and hub.asked.wait(2)
    # Without a socket at all (paused).
    hub = Hub()
    hub.receive(b"")
    assert not hub.online and hub.asked.wait(2)
    # Not one of the hubs GO dials: as ever.
    caller = Hub(initiator=False)
    caller.socket = _connected()
    caller.receive(b"")
    assert caller.torn
    # Data is data.
    hub = Hub()
    hub.socket = _connected()
    hub.receive(b"\x7e\x01\x02")
    assert hub.frame_buffer == b"\x7e\x01\x02" and hub.online


def test_the_table():
    table = _setup()
    hub = Hub()
    _add(hub, _connected())
    number = hub.socket.fileno()
    assert table.pop(number) is hub and number in table, "its socket is open"
    assert table.pop(number, None) is hub and number not in table, "GO's own way"
    assert table.pop(number, "nothing") == "nothing"
    try:
        table.pop(number)
        assert False, "as a dict"
    except KeyError:
        pass
    table[number + 1] = hub  # another number than its socket has
    assert table.pop(number + 1) is hub and number + 1 not in table
    table[number] = hub
    hub.socket.close()
    assert table.pop(number) is hub and number not in table
    table[number] = hub
    hub.socket = None
    assert table.pop(number) is hub and number not in table
    table[number] = object()
    assert table.pop(number) and number not in table

    # What was in the table before stays.
    class Other:
        spawned_interface_filenos = {5: hub}

    h._install_hub_socket_guards(Other, Hub)
    assert Other.spawned_interface_filenos == {5: hub}
    assert isinstance(Other.spawned_interface_filenos, h._HubSockets)


def test_what_this_is_about():
    """The order in the loop, and that the guard is installed."""
    with open(backbone_module.__file__, encoding="utf-8") as fh:
        source = fh.read()
    assert "BackboneInterface.deregister_fileno(fileno); client_socket.close()\n" in source
    assert source.index(
        "BackboneInterface.deregister_fileno(fileno); client_socket.close()"
    ) < source.index("BackboneInterface.spawned_interface_filenos.pop(fileno)")
    original = backbone_module.BackboneClientInterface.receive
    h._tune_rns_for_battery()
    assert backbone_module.BackboneClientInterface.receive is not original
    assert isinstance(Backbone.spawned_interface_filenos, h._HubSockets)


if __name__ == "__main__":
    test_another_hub_gets_the_number()
    test_the_same_hub_gets_it_again()
    test_an_ordinary_end()
    test_the_table()
    test_what_this_is_about()
    print("ALL OK")
