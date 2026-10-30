"""Checks the RNS log clean-up in qortal_presence_host.py.

Older launches named the RNS log per process id (logfile.bridge.<pid>), so
every launch left another file behind. start() now uses one fixed name and
removes the per-pid files:

    python3 android/app/src/test/python/test_presence_host_log_files.py

It also works under pytest.
"""

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True


def _host():
    import qortal_presence_host as h

    return h


def test_remove_pid_log_files_keeps_everything_else():
    h = _host()
    removed = ["logfile.bridge.123", "logfile.bridge.123.1", "logfile.bridge.9"]
    kept = [
        "logfile.bridge.go",
        "logfile.bridge.go.1",
        "logfile",
        "config",
        "logfile.bridge.abc",
        "logfile.bridge.12.2",
    ]
    with tempfile.TemporaryDirectory() as tmp:
        for name in removed + kept:
            with open(os.path.join(tmp, name), "w") as f:
                f.write("x\n")
        os.mkdir(os.path.join(tmp, "storage"))
        h._remove_pid_log_files(tmp)
        remaining = set(os.listdir(tmp))
    assert remaining == set(kept) | {"storage"}, sorted(remaining)


def test_remove_pid_log_files_ignores_a_missing_dir():
    h = _host()
    with tempfile.TemporaryDirectory() as tmp:
        missing = os.path.join(tmp, "missing")
        h._remove_pid_log_files(missing)
        assert not os.path.exists(missing)


if __name__ == "__main__":
    test_remove_pid_log_files_keeps_everything_else()
    test_remove_pid_log_files_ignores_a_missing_dir()
    print("ok")
