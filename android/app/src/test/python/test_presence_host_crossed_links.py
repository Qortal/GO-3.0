"""Two audio links that cross: both phones must keep the same one.

Runs the real Android presence_bridge with the hook of
qortal_presence_host.py, from both phones' points of view:

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

    h._install_crossed_audio_link_rule(pb)
    hooked = pb._audio_link_pick_keep
    h._install_crossed_audio_link_rule(pb)
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
        # A clock that was set back.
        ahead = _link(local > peer, -600.0, 0.2)
        assert _keeps(local, peer, ahead, _link(local < peer, 0.3, 0.0)) in ("a", "b")

    # Not known who is who: the bridge's own rule.
    assert _keeps("", HIGH, _link(False, 0.3, 0.2), _link(True, 0.1)) == "b"
    assert _keeps(LOW, "nonsense", _link(False, 0.3, 0.2), _link(True, 0.1)) == "b"


if __name__ == "__main__":
    test_crossed_links()
    print("ALL OK")
