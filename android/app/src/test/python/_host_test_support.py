"""Helpers shared by the Python host tests.

Not a test itself (no ``test_`` prefix). The tests import it from their own
directory, which is on sys.path when a test runs as a script or under pytest.
"""

import time


def _wait_for(condition, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if condition():
            return True
        time.sleep(0.01)
    return condition()
