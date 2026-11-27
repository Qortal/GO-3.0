"""poll_batch: call-audio frames go to the page in batches, nothing else waits.

    python3 -m pytest android/app/src/test/python/test_presence_host_poll_batch.py -q
    python3 android/app/src/test/python/test_presence_host_poll_batch.py
"""

import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import qortal_presence_host as h  # noqa: E402


def _audio(i):
    return json.dumps({"event": "group_audio_packet", "payload": {"n": i}})


def _other(name):
    return json.dumps({"event": name})


def _drain():
    while True:
        try:
            h._out_queue.get_nowait()
        except Exception:
            return


def test_single_non_audio_frame_is_returned_alone_and_at_once():
    _drain()
    h._put_out_frame(_other("presence_update"))
    h._put_out_frame(_audio(1))
    t0 = time.monotonic()
    out = h.poll_batch(100, 32, 200)
    assert out == _other("presence_update")
    assert time.monotonic() - t0 < 0.05
    assert h.poll_batch(100, 32, 0) == _audio(1)


def test_queued_audio_frames_come_back_together_in_order():
    _drain()
    for i in range(5):
        h._put_out_frame(_audio(i))
    out = h.poll_batch(100, 32, 5)
    assert out.split("\n") == [_audio(i) for i in range(5)]


def test_a_non_audio_frame_ends_the_batch_and_keeps_its_place():
    _drain()
    h._put_out_frame(_audio(0))
    h._put_out_frame(_audio(1))
    h._put_out_frame(_other("call_message"))
    h._put_out_frame(_audio(2))
    assert h.poll_batch(100, 32, 50).split("\n") == [_audio(0), _audio(1), _other("call_message")]
    assert h.poll_batch(100, 32, 0) == _audio(2)


def test_waits_at_most_linger_for_more_audio():
    _drain()
    h._put_out_frame(_audio(0))

    def later():
        time.sleep(0.004)
        h._put_out_frame(_audio(1))

    threading.Thread(target=later, daemon=True).start()
    t0 = time.monotonic()
    out = h.poll_batch(100, 32, 30)
    took = time.monotonic() - t0
    assert out.split("\n") == [_audio(0), _audio(1)]
    assert took < 0.2


def test_respects_max_frames():
    _drain()
    for i in range(10):
        h._put_out_frame(_audio(i))
    assert len(h.poll_batch(100, 4, 50).split("\n")) == 4
    assert len(h.poll_batch(100, 32, 0).split("\n")) == 6


def test_empty_queue_times_out_like_poll():
    _drain()
    t0 = time.monotonic()
    assert h.poll_batch(30, 32, 12) == ""
    assert 0.02 <= time.monotonic() - t0 < 0.5


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
