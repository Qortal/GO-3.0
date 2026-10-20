"""Resource.REJECTED fix for the vendored RNS 1.3.4 (qortal_presence_host.py).

RNS 1.3.4 ships ``Resource.REJECTED = 0x00``, the same value as ``NONE``, so
a rejected outgoing Resource's watchdog never exits and wakes every 1 ms.
The host sets it to 0x09 (upstream RNS 1.4.2) before the bridge creates any
Resource. This drives the vendored RNS with a fake Link, without Chaquopy,
RNS daemons or a network:

    python3 android/app/src/test/python/test_rns_resource_rejected.py

It also works under pytest.
"""

import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import RNS  # noqa: E402
import qortal_presence_host as host  # noqa: E402

Resource = RNS.Resource


class FakeLink:
    def __init__(self):
        self.outgoing_resources = []
        self.concluded = []

    def cancel_outgoing_resource(self, resource):
        if resource in self.outgoing_resources:
            self.outgoing_resources.remove(resource)

    def resource_concluded(self, resource):
        self.concluded.append(resource)


def _advertised_resource():
    """An outgoing Resource in ADVERTISED state, as Resource.advertise()
    leaves it, without packing any data."""
    resource = Resource.__new__(Resource)
    resource.link = FakeLink()
    resource.link.outgoing_resources.append(resource)
    resource.watchdog_lock = False
    resource._Resource__watchdog_job_id = 0
    resource.initiator = True
    resource.callback = None
    resource.status = Resource.ADVERTISED
    resource.adv_sent = time.time()
    # Long: only the REJECTED exit matters here, not the advertisement timeout.
    resource.timeout = 3600
    resource.retries_left = 4
    return resource


def _start_watchdog(resource):
    """Start the Resource's watchdog and return its thread."""
    before = {thread.ident for thread in threading.enumerate()}
    resource.watchdog_job()
    deadline = time.time() + 1.0
    while time.time() < deadline:
        started = [
            thread
            for thread in threading.enumerate()
            if thread.ident not in before
        ]
        if started:
            assert len(started) == 1, started
            return started[0]
        time.sleep(0.01)
    raise AssertionError("watchdog thread did not start")


def check_unpatched_value_spins():
    """Control: with the vendored constant the watchdog really keeps running
    after _rejected(). Skipped once RNS itself ships a distinct value."""
    if Resource.REJECTED != Resource.NONE:
        return False
    resource = _advertised_resource()
    thread = _start_watchdog(resource)
    time.sleep(0.1)
    resource._rejected()
    thread.join(1.5)
    spinning = thread.is_alive()
    # Stop it: the loop also ends when its job id is superseded.
    resource._Resource__watchdog_job_id += 1
    thread.join(1.5)
    assert spinning, "1.3.4 watchdog exited although REJECTED == NONE"
    assert not thread.is_alive()
    return True


def check_patch_values():
    host._patch_rns_resource_rejected()
    assert Resource.REJECTED == 0x09, Resource.REJECTED
    assert Resource.NONE != Resource.REJECTED
    # Distinct from every other status, and past the watchdog's loop bound.
    others = {
        Resource.NONE,
        Resource.QUEUED,
        Resource.ADVERTISED,
        Resource.TRANSFERRING,
        Resource.AWAITING_PROOF,
        Resource.ASSEMBLING,
        Resource.COMPLETE,
        Resource.FAILED,
        Resource.CORRUPT,
    }
    assert Resource.REJECTED not in others
    assert Resource.REJECTED >= Resource.ASSEMBLING
    # Running it again (another start) keeps the value.
    host._patch_rns_resource_rejected()
    assert Resource.REJECTED == 0x09


def check_rejected_watchdog_exits():
    resource = _advertised_resource()
    thread = _start_watchdog(resource)
    time.sleep(0.1)
    assert thread.is_alive()
    resource._rejected()
    assert resource.status == Resource.REJECTED
    assert resource not in resource.link.outgoing_resources
    thread.join(1.5)
    assert not thread.is_alive(), "rejected Resource's watchdog still running"


def check_tune_applies_fix():
    """The host's start() path (_tune_rns_for_battery) applies the fix."""
    saved = Resource.REJECTED
    saved_tuning = (
        RNS.Transport.job_interval,
        RNS.Link.WATCHDOG_MAX_SLEEP,
    )
    try:
        Resource.REJECTED = Resource.NONE
        host._tune_rns_for_battery()
        assert Resource.REJECTED == 0x09
    finally:
        Resource.REJECTED = saved
        RNS.Transport.job_interval, RNS.Link.WATCHDOG_MAX_SLEEP = saved_tuning


def test_rns_resource_rejected():
    check_unpatched_value_spins()
    check_patch_values()
    check_rejected_watchdog_exits()
    check_tune_applies_fix()


if __name__ == "__main__":
    test_rns_resource_rejected()
    print("ALL OK")
