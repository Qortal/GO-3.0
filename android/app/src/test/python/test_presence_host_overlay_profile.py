"""Checks for the runtime overlay profile in qortal_presence_host.py.

The bridge command ``configure_overlay_profile`` switches the overlay caps
between the phone ("leaf", 6 + 6) and desktop ("full", 12 + 8) sizes. This
runs the host's wrapper against a small stand-in for presence_bridge:

    python3 android/app/src/test/python/test_presence_host_overlay_profile.py

It also works under pytest.
"""

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True


def _fake_bridge():
    pb = types.ModuleType("presence_bridge_overlay_stub")
    pb._OVERLAY_MAX_OUTBOUND_NEIGHBORS = 12
    pb._OVERLAY_MAX_INBOUND_NEIGHBORS = 8
    pb._OVERLAY_BOOTSTRAP_MAX_OUTBOUND_NEIGHBORS = 12
    pb._OVERLAY_MIN_HEALTHY_FANOUT = 8
    pb._OVERLAY_MAX_PINNED_CHAT_PEERS = 4
    pb._OVERLAY_MAX_PINNED_CALL_PEERS = 4
    pb._OVERLAY_MAX_TOTAL_LINKS = 32
    pb.handled = []
    pb.responses = []

    def handle_command(message):
        pb.handled.append(message.get("action"))

    def emit_resp(req_id, ok, payload=None, error=None):
        pb.responses.append((req_id, ok, payload, error))

    pb.handle_command = handle_command
    pb.emit_resp = emit_resp
    return pb


def _caps(pb):
    return (
        pb._OVERLAY_MAX_OUTBOUND_NEIGHBORS,
        pb._OVERLAY_MAX_INBOUND_NEIGHBORS,
        pb._OVERLAY_BOOTSTRAP_MAX_OUTBOUND_NEIGHBORS,
        pb._OVERLAY_MIN_HEALTHY_FANOUT,
        pb._OVERLAY_MAX_TOTAL_LINKS,
    )


def _cmd(req_id, profile):
    return {
        "type": "cmd",
        "id": req_id,
        "action": "configure_overlay_profile",
        "payload": {"profile": profile},
    }


def test_overlay_profile_switch():
    import qortal_presence_host as h

    pb = _fake_bridge()
    # Startup: the phone caps, as before this command existed.
    h._apply_mobile_overlay_limits(pb)
    assert _caps(pb) == (6, 6, 6, 4, 24), _caps(pb)

    h._install_overlay_profile_command(pb)
    wrapped = pb.handle_command
    h._install_overlay_profile_command(pb)
    assert pb.handle_command is wrapped, "installing twice must not double-wrap"

    # Other commands still reach the bridge.
    pb.handle_command({"id": "1", "action": "publish_presence", "payload": {}})
    assert pb.handled == ["publish_presence"], pb.handled

    pb.handle_command(_cmd("2", "full"))
    assert _caps(pb) == (12, 8, 12, 8, 32), _caps(pb)
    req_id, ok, payload, _error = pb.responses[-1]
    assert req_id == "2" and ok and payload["changed"] is True
    assert payload["outbound"] == 12 and payload["inbound"] == 8

    # Idempotent: the same profile again changes nothing.
    pb.handle_command(_cmd("3", "full"))
    assert _caps(pb) == (12, 8, 12, 8, 32)
    assert pb.responses[-1][1] is True and pb.responses[-1][2]["changed"] is False

    pb.handle_command(_cmd("4", "leaf"))
    assert _caps(pb) == (6, 6, 6, 4, 24), _caps(pb)
    assert pb.responses[-1][2]["changed"] is True

    # Unknown profile: refused, caps untouched.
    pb.handle_command(_cmd("5", "huge"))
    assert _caps(pb) == (6, 6, 6, 4, 24)
    assert pb.responses[-1][0] == "5" and pb.responses[-1][1] is False

    # Missing payload is refused too, without raising.
    pb.handle_command({"id": "6", "action": "configure_overlay_profile"})
    assert pb.responses[-1][1] is False

    # The command never reached the bridge's own handler.
    assert pb.handled == ["publish_presence"], pb.handled


def test_native_frame_without_id_applies_silently():
    """Native feeds the "leaf" change itself (KeepAlivePolicy
    .nativeOverlayProfileFrame) with no id: applied, no reply frame."""
    import json

    import qortal_presence_host as h

    pb = _fake_bridge()
    h._install_overlay_profile_command(pb)
    pb.handle_command(_cmd("1", "full"))
    assert _caps(pb) == (12, 8, 12, 8, 32), _caps(pb)
    replies = len(pb.responses)

    native = json.loads(
        '{"type":"cmd","action":"configure_overlay_profile",'
        '"payload":{"profile":"leaf"}}'
    )
    pb.handle_command(native)
    assert _caps(pb) == (6, 6, 6, 4, 24), _caps(pb)
    assert len(pb.responses) == replies, pb.responses
    assert pb.handled == [], pb.handled


if __name__ == "__main__":
    test_overlay_profile_switch()
    test_native_frame_without_id_applies_silently()
    print("ok")
