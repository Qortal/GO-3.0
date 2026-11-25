"""Hang-ups and rejects that went into a dead overlay link.

``send_call`` calls a packet sent once it is handed to the link, so between a
network switch and the redial a hang-up is lost without anyone noticing. The
hook in qortal_presence_host.py sends it once more when the overlay link to
that peer has been replaced:

    python3 android/app/src/test/python/test_presence_host_call_end.py

It also works under pytest. The module is loaded once; the checks run in one
ordered function.
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

PEER = "ab" * 16


class Link:
    pass


def _stub_bridge():
    pb = types.ModuleType("presence_bridge")
    pb._state_lock = threading.RLock()
    pb._overlay_links_by_id = {}
    pb._active_overlay_link_id_by_peer_hash = {}
    pb._overlay_link_is_fanout_usable = lambda state: state.get("usable", True)
    pb.sent = []
    pb.opened = []
    pb.refuse = 0

    def handle_send_call(req_id, payload):
        pb.sent.append(("page", payload["message"]["t"], _active(pb)))

    def send_wire(peer, wire):
        if pb.refuse > 0:
            pb.refuse -= 1
            return {"error": "Packet send returned False"}
        pb.sent.append(("again", wire, _active(pb)))
        return None

    pb.handle_send_call = handle_send_call
    pb._encode_call_signal_wire = lambda msg: {"ok": True, "wire_bytes": msg["t"]}
    pb._send_call_signal_wire_to_peer = send_wire
    pb.known = []
    pb.ensure_known_peer_from_recall = lambda peer, source: pb.known.append(peer)

    def ensure_overlay_link(peer, await_path, open_reason):
        # On the watch's own thread: the bridge's queues may be busy.
        assert threading.current_thread().name == "presence-host-call-end"
        assert pb.known and await_path and open_reason == "call_signal_prepare"
        pb.opened.append(peer)

    pb._ensure_overlay_link = ensure_overlay_link
    return pb


def _active(pb):
    state = pb._overlay_links_by_id.get(pb._active_overlay_link_id_by_peer_hash.get(PEER))
    return state and state["link"]


def _use(pb, link, usable=True):
    pb._overlay_links_by_id = {"l": {"link": link, "usable": usable}} if link else {}
    pb._active_overlay_link_id_by_peer_hash = {PEER: "l"} if link else {}


def _again(pb):
    return [entry for entry in pb.sent if entry[0] == "again"]


def _watchers():
    return [t for t in threading.enumerate() if t.name == "presence-host-call-end"]


def test_call_end_resend():
    import qortal_presence_host as h

    h._CALL_END_WATCH_INTERVAL_SECONDS = 0.01
    h._CALL_END_WATCH_SECONDS = 0.4
    pb = _stub_bridge()
    h._install_call_end_resend(pb)
    hooked = pb.handle_send_call, pb._ensure_overlay_link
    h._install_call_end_resend(pb)
    assert (pb.handle_send_call, pb._ensure_overlay_link) == hooked, "installed once"
    assert hasattr(pb._ensure_overlay_link, "opening"), "one open per peer"

    def send(kind):
        pb.handle_send_call(
            "r1", {"peerPresenceHash": PEER.upper(), "message": {"t": kind, "c": "id"}}
        )

    def settle():
        assert _wait_for(lambda: not _watchers())

    # The link it went into stays: nothing is repeated.
    old = Link()
    _use(pb, old)
    send("CH")
    settle()
    assert pb.sent == [("page", "CH", old)] and not pb.opened

    # Other signals are never repeated: rings, accepts and WebRTC parts have
    # their own retries and must not outlive their call.
    for kind in ("CR", "CA", "RS", "RH", "RP", "RA", "RR"):
        send(kind)
    assert not _watchers()

    # The link turned out dead: ask for a new one, send once it is usable.
    for kind in ("CH", "CX"):
        del pb.sent[:], pb.opened[:]
        old, new = Link(), Link()
        _use(pb, old)
        send(kind)
        _use(pb, None)
        old._qortal_dead = True  # _close_dead_links
        assert _wait_for(lambda: len(pb.opened) >= 2), "asked again until one is up"
        assert set(pb.opened) == {PEER}
        _use(pb, new, usable=False)
        time.sleep(0.05)
        assert not _again(pb)
        _use(pb, new)
        assert _wait_for(lambda: _again(pb) == [("again", kind, new)])
        settle()
        assert len(_again(pb)) == 1, "once per new link"

    # The other side's network switched, and it opened the new link.
    del pb.sent[:], pb.opened[:]
    old, new = Link(), Link()
    _use(pb, old)
    send("CH")
    pb.refuse = 2  # not established after all: tried again
    _use(pb, new)
    assert _wait_for(lambda: _again(pb) == [("again", "CH", new)])
    settle()
    assert not pb.opened

    # Closed in the ordinary way: no link is opened only to repeat it.
    del pb.sent[:], pb.opened[:]
    _use(pb, Link())
    send("CH")
    _use(pb, None)
    settle()
    assert not pb.opened and not _again(pb)

    # No usable link: the send failed, and the page repeats it by itself.
    send("CH")
    assert not _watchers()

    # A link that keeps changing is not a reason to send for ever.
    del pb.sent[:]
    _use(pb, Link())
    send("CH")
    for _ in range(8):
        _use(pb, Link())
        time.sleep(0.03)
    settle()
    assert 1 <= len(_again(pb)) <= h._CALL_END_MAX_RESENDS

    # Signed out or swiped away meanwhile.
    del pb.sent[:]
    _use(pb, Link())
    send("CH")
    h._network_paused = True
    _use(pb, Link())
    settle()
    assert not _again(pb)
    h._network_paused = False

    # The send itself never fails because of the hook.
    pb._overlay_link_is_fanout_usable = lambda state: 1 / 0
    del pb.sent[:]
    send("CH")
    assert len(pb.sent) == 1


def test_one_overlay_open_per_peer():
    """The watch and the peer's queue never open the same link at once."""
    import qortal_presence_host as h

    pb = _stub_bridge()
    lock = threading.Lock()
    inside = []
    overlaps = []
    calls = []
    go = threading.Event()

    def open_link(peer, await_path=True, open_reason="open"):
        with lock:
            calls.append((peer, await_path, open_reason))
            overlaps.append(tuple(inside))
            inside.append(peer)
        if peer == "fail":
            with lock:
                inside.remove(peer)
            raise RuntimeError("no path")
        if open_reason == "nested":
            pb._ensure_overlay_link(peer, False, "inner")
        go.wait(0.05)
        with lock:
            inside.remove(peer)
        return {"peer": peer}

    pb._ensure_overlay_link = open_link
    h._install_one_overlay_open_per_peer(pb)
    results = []
    threads = [
        threading.Thread(
            target=lambda p=p: results.append(
                pb._ensure_overlay_link(p, await_path=False, open_reason="sync")
            )
        )
        # Spelled differently, still one peer.
        for p in (PEER, PEER.upper(), " " + PEER, PEER, "cd" * 16)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(5)
    assert len(results) == 5 and all(entry for entry in results)
    assert all(call[1:] == (False, "sync") for call in calls)
    for (peer, _, _), others in zip(calls, overlaps):
        own = peer.strip().lower()
        assert all(other.strip().lower() != own for other in others), "one at a time"
    assert any(others for others in overlaps), "another peer does not wait"
    # One that comes while the second has its turn still waits for it.
    entered, leave = [], [threading.Event() for _ in range(3)]

    def stepped(peer, number):
        entered.append(number)
        leave[number].wait(5)

    pb._ensure_overlay_link = stepped
    h._install_one_overlay_open_per_peer(pb)
    threads = []
    for number in range(3):
        threads.append(
            threading.Thread(target=pb._ensure_overlay_link, args=(PEER, number))
        )
        if number == 2:
            leave[0].set()
            assert _wait_for(lambda: entered == [0, 1])
        threads[-1].start()
        assert _wait_for(lambda: pb._ensure_overlay_link.opening[PEER][1] >= min(number + 1, 2))
    time.sleep(0.05)
    assert entered == [0, 1], "the third waits"
    leave[1].set()
    assert _wait_for(lambda: entered == [0, 1, 2])
    leave[2].set()
    for thread in threads:
        thread.join(5)
    assert not pb._ensure_overlay_link.opening

    # A failing open and one inside another give the lock back.
    pb._ensure_overlay_link = open_link
    h._install_one_overlay_open_per_peer(pb)
    try:
        pb._ensure_overlay_link("fail")
        assert False, "errors still reach the caller"
    except RuntimeError:
        pass
    assert pb._ensure_overlay_link(PEER, True, "nested") == {"peer": PEER}
    assert pb._ensure_overlay_link(PEER) == {"peer": PEER}
    assert not pb._ensure_overlay_link.opening, "nothing is kept"


def test_hook_matches_the_bridge():
    """The names the hook uses exist in GO's bridge."""
    with open(
        os.path.join(HERE, "..", "..", "main", "python", "presence_bridge.py"),
        encoding="utf-8",
    ) as fh:
        source = fh.read()
    for needle in (
        "def handle_send_call(req_id: str, payload: Dict[str, Any]) -> None:",
        "def _send_call_signal_wire_to_peer(peer_hash: str, wire_bytes: bytes)",
        "def _encode_call_signal_wire(msg: Dict[str, Any])",
        "def ensure_known_peer_from_recall(\n"
        '    peer_hash_hex: str, registration_source: str = "recall"\n',
        "def _ensure_overlay_link(\n"
        "    peer_hash: str,\n"
        "    await_path: bool = True,\n"
        '    open_reason: str = "open",\n',
        "def _overlay_link_is_fanout_usable(state: Dict[str, Any]) -> bool:",
        "_active_overlay_link_id_by_peer_hash: Dict[",
        "_inbound_overlay_neighbors: Dict[",
        "def _invalidate_reticulum_path_availability(",
    ):
        assert needle in source, needle


if __name__ == "__main__":
    test_call_end_resend()
    test_one_overlay_open_per_peer()
    test_hook_matches_the_bridge()
    print("ALL OK")
