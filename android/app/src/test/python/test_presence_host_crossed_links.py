"""Two audio links to one peer: which one stays.

Two that cross: both phones must keep the same one. A new one after a network
switch: the phone that did not switch must not keep the dead one. Runs the real
Android presence_bridge with the hook of qortal_presence_host.py, from both
phones' points of view:

    python3 android/app/src/test/python/test_presence_host_crossed_links.py

It also works under pytest.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import presence_bridge as pb  # noqa: E402  (the real Android bridge)
import qortal_presence_host as h  # noqa: E402

LOW, HIGH = "11" * 16, "ee" * 16
ORIGINAL = pb._audio_link_pick_keep


def _link(incoming, age, activity=0.0, **extra):
    now = time.time()
    return dict(
        {
            "incoming": incoming,
            "established": True,
            "established_at": now - age,
            "created_at": now - age - 0.5,
            "last_activity_at": now - activity,
        },
        **extra,
    )


def _keeps(local, peer, state_a, state_b):
    saved = pb._local_presence_hash_hex
    pb._local_presence_hash_hex = lambda: local
    try:
        keep, lose = pb._audio_link_pick_keep(peer, "a", state_a, "b", state_b)
        assert {keep, lose} == {"a", "b"}
        # The order the two are asked about must not matter.
        assert pb._audio_link_pick_keep(peer, "b", state_b, "a", state_a) == (keep, lose)
        return keep
    finally:
        pb._local_presence_hash_hex = saved


def _crossing():
    """(kept by low, kept by high); "low" is the link the lower phone opened."""
    # On each phone its own link came up 0.3 s before the other one came in,
    # and the one that came in is the latest to have been heard.
    low = _keeps(LOW, HIGH, _link(False, 0.3, 0.02), _link(True, 0.0))
    high = _keeps(HIGH, LOW, _link(False, 0.3, 0.02), _link(True, 0.0))
    return {"a": "low", "b": "high"}[low], {"a": "high", "b": "low"}[high]


def test_crossed_links():
    pb._audio_link_pick_keep = ORIGINAL
    assert _crossing() == ("high", "low"), "each drops the one the other keeps"

    h._install_audio_link_choice(pb)
    hooked = pb._audio_link_pick_keep
    h._install_audio_link_choice(pb)
    assert pb._audio_link_pick_keep is hooked, "installed once"
    assert _crossing() == ("low", "low")

    for local, peer in ((LOW, HIGH), (HIGH, LOW)):
        # A dead link from before the switch loses to the new one, whatever
        # its direction and even while audio is still being sent into it.
        for incoming in (True, False):
            assert _keeps(local, peer, _link(not incoming, 60.0, 0.5), _link(incoming, 0.1)) == "b"
        # Two that came in, or two this phone opened: the bridge's own rule.
        for incoming in (True, False):
            assert _keeps(local, peer, _link(incoming, 0.5, 0.4), _link(incoming, 0.1)) == "b"
        # One that is not up yet, or is closing.
        pending = _link(False, 0.1, established=False)
        assert _keeps(local, peer, _link(True, 0.3, 0.2), pending) == "a"
        closing = _link(local > peer, 0.1, 0.2, closing=True)
        assert _keeps(local, peer, closing, _link(local < peer, 0.3)) == "b"
        # A clock that was set back: that one is from before.
        ahead = _link(local > peer, -600.0, 0.2)
        assert _keeps(local, peer, ahead, _link(local < peer, 0.3, 0.0)) == "b"
        ahead = _link(True, -600.0, 0.0)
        assert _keeps(local, peer, ahead, _link(True, 0.3, 0.0)) == "b"

        # Crossed, but noticed late (a busy phone): still the hashes.
        for age in (0.0, 20.0, 300.0):
            own, other = _link(False, age + 2.0), _link(True, age)
            assert _keeps(local, peer, own, other) == ("b" if local > peer else "a")
            own, other = _link(False, age), _link(True, age + 2.0)
            assert _keeps(local, peer, own, other) == ("b" if local > peer else "a")
        # More than that apart: not crossed.
        own, other = _link(False, 3.5), _link(True, 0.1)
        assert _keeps(local, peer, own, other) == "b"
        own, other = _link(False, 0.1), _link(True, 3.5)
        assert _keeps(local, peer, own, other) == "a"

    # Not known who is who: the bridge's own rule.
    assert _keeps("", HIGH, _link(False, 0.3, 0.2), _link(True, 0.1)) == "b"
    assert _keeps(LOW, "nonsense", _link(False, 0.3, 0.2), _link(True, 0.1)) == "b"


class _RnsLink:
    def __init__(self, activated_at):
        self.activated_at = activated_at


def test_the_new_link_after_a_switch():
    """The other phone switched: it opened a new link, the old one is dead."""
    pb._audio_link_pick_keep = ORIGINAL
    now = time.time()
    # This phone sent a voice frame into the dead link after the new one came
    # up: the bridge closes the new one.
    dead = _link(False, 17.0, 0.0, last_rx_at=now - 4.0, last_send_ok_at=now + 0.005)
    new = _link(True, 0.01, 0.01)
    assert _keeps(LOW, HIGH, dead, new) == "a", "the bridge's own rule"

    h._install_audio_link_choice(pb)
    for local, peer in ((LOW, HIGH), (HIGH, LOW)):
        for incoming in (True, False):
            for age in (3.2, 17.0, 600.0):
                dead = _link(incoming, age, 0.0, last_send_ok_at=now + 1.0)
                assert _keeps(local, peer, dead, _link(True, 0.01, 0.01)) == "b"
                # Nor does a late frame from before the switch count.
                dead["last_rx_at"] = now + 1.0
                assert _keeps(local, peer, dead, _link(True, 0.01, 0.01)) == "b"
        # Switched twice within a moment: the first new link is dead as well.
        dead = _link(True, 1.2, 0.0, last_send_ok_at=now + 1.0)
        assert _keeps(local, peer, dead, _link(True, 0.01, 0.01)) == "b"
        # RNS knows when a link came up; the bridge notes an incoming one only
        # with its first packet.
        early = _link(True, 0.0, 0.0, link=_RnsLink(now - 30.0))
        late = _link(True, 8.0, 0.0, link=_RnsLink(now - 1.0))
        assert _keeps(local, peer, early, late) == "b"
        # Crossed for RNS, whenever their first packets were handled.
        own = _link(False, 6.0, 0.0, link=_RnsLink(now - 6.0))
        other = _link(True, 0.1, 0.0, link=_RnsLink(now - 5.5))
        assert _keeps(local, peer, own, other) == ("b" if local > peer else "a")
        # Without a time there, the bridge's counts.
        early = _link(True, 30.0, 0.0, link=_RnsLink(None))
        assert _keeps(local, peer, early, _link(True, 1.0, 0.5, link=object())) == "b"
        # Up at the same moment in the same direction, or not known when: the
        # bridge's own rule.
        one = _link(True, 5.0, 0.0)
        two = dict(one, last_activity_at=one["last_activity_at"] - 1.0)
        assert _keeps(local, peer, one, two) == "a"
        one = _link(True, 5.0, 0.0, established_at=None)
        assert _keeps(local, peer, one, _link(True, 1.0, 0.5)) == "a"

    # The hook never fails the choice.
    saved, pb._local_presence_hash_hex = pb._local_presence_hash_hex, lambda: 1 / 0
    try:
        keep, lose = pb._audio_link_pick_keep(
            HIGH, "a", _link(False, 0.3, 0.2), "b", _link(True, 0.1)
        )
        assert (keep, lose) == ("b", "a")
    finally:
        pb._local_presence_hash_hex = saved


def test_the_bridge_keeps_the_new_link():
    """The same through the bridge's own bookkeeping."""
    pb._audio_link_pick_keep = ORIGINAL
    h._install_audio_link_choice(pb)
    torn = []
    saved = pb._enqueue_audio_link_teardown
    pb._enqueue_audio_link_teardown = lambda link_id, reason: torn.append((link_id, reason))
    try:
        now = time.time()
        dead = _link(False, 17.0, 0.0, last_send_ok_at=now + 1.0, last_rx_at=now - 3.0)
        pb._audio_links_by_id.update({"dead": dead, "new": _link(True, 0.01, 0.01)})
        assert pb._register_active_audio_for_peer(HIGH, "dead") is dead
        pb._register_active_audio_for_peer(HIGH, "new")
        assert pb._active_audio_link_id_by_peer_hash[HIGH] == "new"
        assert torn == [("dead", "dedup_same_peer")]
        # A frame that was still under way comes in over the dead one.
        dead["last_rx_at"] = now + 2.0
        pb._register_active_audio_for_peer(HIGH, "dead")
        assert pb._active_audio_link_id_by_peer_hash[HIGH] == "new"
        assert torn[1:] == [("dead", "dedup_same_peer")]
        # The choices for sending and for a fallback agree.
        for state in pb._audio_links_by_id.values():
            state["link"] = object()
            state["peerPresenceHash"] = HIGH
        assert pb._best_established_audio_link_id_for_peer(HIGH) == "new"
        assert pb._promote_audio_fallback_locked(HIGH) == "new"
    finally:
        pb._enqueue_audio_link_teardown = saved
        pb._audio_links_by_id.clear()
        pb._active_audio_link_id_by_peer_hash.clear()
        pb._outgoing_audio_link_id_by_peer_hash.clear()


if __name__ == "__main__":
    test_crossed_links()
    test_the_new_link_after_a_switch()
    test_the_bridge_keeps_the_new_link()
    print("ALL OK")
