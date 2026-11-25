"""Thread reports hold no frames (qortal_presence_host._patch_current_frames).

On the phone a frame of a Kotlin-owned thread can be the last owner of a JNI
local reference, and freeing it on the bridge's watchdog thread aborts GO
(CheckJNI). Here a "JNI reference" is an object that notes which thread frees
it, and the Kotlin thread is a real foreign one: made by libc's
pthread_create, not by Python. The host runs against the REAL Android
presence_bridge.py, so a merge that takes frames another way fails here:

    python3 android/app/src/test/python/test_presence_host_thread_stacks.py
    python3 -m pytest android/app/src/test/python/test_presence_host_thread_stacks.py -q
"""

import contextlib
import ctypes
import ctypes.util
import gc
import inspect
import os
import re
import sys
import threading
import time
import traceback
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

REAL_CURRENT_FRAMES = sys._current_frames

import presence_bridge as pb  # noqa: E402  (the real Android bridge)
import qortal_presence_host as h  # noqa: E402

from _host_test_support import _wait_for  # noqa: E402


@contextlib.contextmanager
def patched(target, **attrs):
    """Set attributes on ``target`` for one check and put them back after."""
    saved = {name: getattr(target, name) for name in attrs}
    for name, value in attrs.items():
        setattr(target, name, value)
    try:
        yield
    finally:
        for name, value in saved.items():
            setattr(target, name, value)


@contextlib.contextmanager
def original_frames():
    """Python's own sys._current_frames, as in the builds that aborted."""
    with patched(sys, _current_frames=REAL_CURRENT_FRAMES):
        yield


@contextlib.contextmanager
def detached_frames():
    """GO's sys._current_frames, the way start() installs it."""
    with patched(sys, _current_frames=REAL_CURRENT_FRAMES), patched(
        h, _real_current_frames=None
    ):
        h._patch_current_frames()
        yield


_LIBC = ctypes.CDLL(ctypes.util.find_library("c") or None)
_START_ROUTINE = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)


class ForeignThread:
    """A thread Python did not create, running ``target`` (like Kotlin's)."""

    def __init__(self, target):
        self.ident = None

        def run(_arg):
            self.ident = threading.get_ident()
            target()
            return None

        self._routine = _START_ROUTINE(run)
        self._handle = ctypes.c_ulong()
        assert (
            _LIBC.pthread_create(ctypes.byref(self._handle), None, self._routine, None) == 0
        )

    def join(self):
        _LIBC.pthread_join(self._handle, None)


class FakeLocalRef:
    """Like Chaquopy's LocalRef: may only be freed by the thread it is of."""

    freed_by_owner = 0
    freed_elsewhere = 0

    def __init__(self):
        self.owner = threading.get_ident()

    def __del__(self):
        if threading.get_ident() == self.owner:
            FakeLocalRef.freed_by_owner += 1
        else:
            FakeLocalRef.freed_elsewhere += 1

    @classmethod
    def reset(cls):
        cls.freed_by_owner = cls.freed_elsewhere = 0


class KotlinLikeReader:
    """Holds a FakeLocalRef in a local until told to let the call return."""

    def __init__(self):
        self.inside = threading.Event()
        self.leave = threading.Event()
        self.done = threading.Event()
        self.thread = ForeignThread(self._run)
        assert self.inside.wait(5)

    def _weak_dict_get(self, key):
        self.inside.set()
        self.leave.wait(10)

    def _run(self):
        self._weak_dict_get((int, FakeLocalRef()))
        self.done.set()

    def finish(self):
        self.leave.set()
        assert self.done.wait(5)
        self.thread.join()


class FakeTime:
    """``time`` for the bridge: the reader's call returns in its first sleep."""

    def __init__(self, reader):
        self._reader = reader
        self.slept = 0

    def __getattr__(self, name):
        return getattr(time, name)

    def sleep(self, _seconds):
        self.slept += 1
        if self.slept == 1:
            self._reader.finish()


@contextlib.contextmanager
def report_fixture(reader=None):
    """Recorded events and log lines, and a CPU window that asks for stacks."""
    events = []
    lines = []
    ticks = {}

    def thread_cpu_ticks(native_id):
        # Every thread burned 50 ticks since the last sample, so the report
        # takes its extra stack samples on this PC too.
        ticks[native_id] = ticks.get(native_id, 0) + 50
        return ticks[native_id]

    with patched(
        pb,
        log=lambda message, *a, **k: lines.append(message),
        _emit_priority_diagnostic_event=lambda event, payload: events.append((event, payload)),
        _thread_cpu_ticks=thread_cpu_ticks,
        _thread_cpu_ticks_prev={},
        time=FakeTime(reader) if reader is not None else pb.time,
    ):
        yield events, lines


def _report_while_reader_is_in_a_call():
    FakeLocalRef.reset()
    reader = KotlinLikeReader()
    with report_fixture(reader) as (events, lines):
        payload = pb._report_thread_population(force=True)
    # The bridge's ``frames`` has the report's own frame in it, a cycle: only
    # the garbage collector frees those, on whatever thread it runs.
    gc.collect()
    assert FakeLocalRef.freed_by_owner + FakeLocalRef.freed_elsewhere == 1
    return payload, events, lines


def test_the_bridge_alone_frees_a_foreign_reference_on_the_wrong_thread():
    """The abort itself: without the host's patch, the watchdog frees it."""
    with original_frames():
        _report_while_reader_is_in_a_call()
    assert FakeLocalRef.freed_elsewhere == 1


def test_the_report_leaves_a_foreign_reference_to_its_own_thread():
    with detached_frames():
        _report_while_reader_is_in_a_call()
    assert FakeLocalRef.freed_elsewhere == 0
    assert FakeLocalRef.freed_by_owner == 1


def test_stall_dump_leaves_a_foreign_reference_to_its_own_thread():
    def dump_with_the_call_returning_meanwhile():
        FakeLocalRef.reset()
        reader = KotlinLikeReader()

        def interesting(_name):
            if not reader.done.is_set():
                reader.finish()
            return False

        stacks = pb._thread_stacks_snapshot(interesting)
        gc.collect()
        assert FakeLocalRef.freed_by_owner + FakeLocalRef.freed_elsewhere == 1
        return stacks

    with original_frames():
        dump_with_the_call_returning_meanwhile()
    assert FakeLocalRef.freed_elsewhere == 1
    with detached_frames():
        stacks = dump_with_the_call_returning_meanwhile()
    assert FakeLocalRef.freed_elsewhere == 0
    assert any("_weak_dict_get" in text for text in stacks.values())


def test_no_caller_gets_a_real_frame():
    reader = KotlinLikeReader()
    try:
        with detached_frames():
            snapshot = sys._current_frames()
        assert reader.thread.ident in snapshot
        seen = 0
        for frame in snapshot.values():
            while frame is not None:
                assert type(frame) is h._DetachedFrame
                assert not isinstance(frame, types.FrameType)
                # Code objects hold constants only; no locals, no globals.
                assert isinstance(frame.f_code, types.CodeType)
                assert frame.f_locals == {} and frame.f_globals == {}
                frame = frame.f_back
                seen += 1
        assert seen
    finally:
        reader.finish()


def test_no_frame_object_is_left_referenced():
    """Reference counts of foreign and own frames are as before the report."""
    reader = KotlinLikeReader()
    try:
        frame = REAL_CURRENT_FRAMES()[reader.thread.ident]
        # Walk out of threading's wait() to the frame with the reference.
        while frame.f_code.co_name != "_weak_dict_get":
            frame = frame.f_back
        before = sys.getrefcount(frame)
        with detached_frames(), report_fixture():
            payload = pb._report_thread_population(force=True)
            stacks = pb._thread_stacks_snapshot(lambda name: True)
            assert sys.getrefcount(frame) == before
        assert payload["stacks"] and stacks
        assert sys.getrefcount(frame) == before
    finally:
        del frame
        reader.finish()


def test_thread_list_of_the_report_is_unchanged():
    """Counts, CPU per group and per thread, stacks of the same groups."""
    stop = threading.Event()
    workers = [
        threading.Thread(target=stop.wait, args=(30,), name=f"reticulum-control-send-{i}")
        for i in range(3)
    ]
    for worker in workers:
        worker.start()
    try:
        with original_frames(), report_fixture() as (_events, _lines):
            plain = pb._report_thread_population(force=True)
        with detached_frames(), report_fixture() as (events, lines):
            detached = pb._report_thread_population(force=True)
    finally:
        stop.set()
        for worker in workers:
            worker.join()

    assert detached.keys() == plain.keys()
    for key in ("threadCount", "groups", "totalCpuTicks", "cpuTicksByGroup", "threads"):
        assert detached[key] == plain[key], key
    assert {"name": "reticulum-control-send", "count": 3} in detached["groups"]
    assert {"name": "reticulum-control-send", "ticks": 150} in detached["cpuTicksByGroup"]
    base = [group for group in detached["stacks"] if "#" not in group]
    assert base == [group for group in plain["stacks"] if "#" not in group]
    assert any("#cpu" in group for group in detached["stacks"])
    assert events == [("bridge_thread_population", detached)]
    assert "thread_population total=" in lines[0]


def test_stack_text_is_what_traceback_prints_for_the_real_frames():
    reader = KotlinLikeReader()
    try:
        real = REAL_CURRENT_FRAMES()[reader.thread.ident]
        # Same lines; the source text of a line comes from the file either way.
        for limit in (None, 3, 12):
            with detached_frames():
                detached = sys._current_frames()[reader.thread.ident]
            assert traceback.format_stack(detached, limit=limit) == traceback.format_stack(
                real, limit=limit
            )
        del real
    finally:
        reader.finish()


def test_line_numbers_match_everywhere():
    """Every position of real functions, and the odd values."""
    for function in (pb._report_thread_population, h.start, _churn, threading.Thread.run):
        code = function.__code__
        positions = list(code.co_positions())  # one per 2-byte code unit
        for lasti in range(0, len(code.co_code), 2):
            assert h._DetachedFrame(((code, lasti),)).f_lineno == positions[lasti // 2][0]
    assert h._DetachedFrame(((code, -1),)).f_lineno == code.co_firstlineno
    assert h._DetachedFrame(((code, 10**6),)).f_lineno is None


def test_calling_thread_starts_at_the_caller():
    with detached_frames():
        own = sys._current_frames()[threading.get_ident()]
    assert own.f_code is sys._getframe().f_code


def test_deep_stacks_keep_the_innermost_frames():
    inside = threading.Event()
    leave = threading.Event()

    def deep(n):
        if n:
            return deep(n - 1)
        inside.set()
        leave.wait(10)

    thread = threading.Thread(target=deep, args=(200,))
    thread.start()
    try:
        assert inside.wait(5)
        with detached_frames():
            frame = sys._current_frames()[thread.ident]
        names = []
        while frame is not None:
            names.append(frame.f_code.co_name)
            frame = frame.f_back
        assert len(names) == h._THREAD_STACK_MAX_FRAMES
        assert names[:2] == ["wait", "wait"] and set(names[2:]) == {"deep"}
    finally:
        leave.set()
        thread.join()


def test_the_kept_depth_covers_every_limit_the_bridge_prints():
    source = inspect.getsource(pb._report_thread_population) + inspect.getsource(
        pb._thread_stacks_snapshot
    )
    limits = [int(n) for n in re.findall(r"format_stack\([^)]*limit=(\d+)", source)]
    limits.append(pb._STALL_DUMP_MAX_FRAMES)
    assert len(limits) >= 3
    assert max(limits) <= h._THREAD_STACK_MAX_FRAMES


def _churn(seconds, snapshot):
    """Foreign and Python threads whose calls end all the time, meanwhile
    ``snapshot()`` in a loop. Returns the number of snapshots."""
    stop = threading.Event()

    def weak_dict_get(data, key):
        try:
            return data[key]
        except KeyError:
            total = 0
            for i in range(20):  # room for a thread switch
                total += i
            return None

    def poll_loop():
        data = {}
        while not stop.is_set():
            weak_dict_get(data, (int, FakeLocalRef()))

    gc.collect()
    FakeLocalRef.reset()
    interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    foreign = [ForeignThread(poll_loop) for _ in range(3)]
    own = [threading.Thread(target=poll_loop) for _ in range(3)]
    for thread in own:
        thread.start()
    count = 0
    try:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            snapshot()
            count += 1
            time.sleep(0.0005)
    finally:
        sys.setswitchinterval(interval)
        stop.set()
        for thread in foreign + own:
            thread.join()
    gc.collect()
    return count


def test_stress_original_frames_do_free_references_elsewhere():
    """Control for the check below: this is how often it goes wrong."""

    def snapshot():
        for _ident, frame in sys._current_frames().items():
            traceback.format_stack(frame, limit=8)

    with original_frames():
        _churn(4.0, snapshot)
    assert FakeLocalRef.freed_elsewhere > 0


def test_stress_detached_frames_never_do():
    with detached_frames():
        count = _churn(6.0, lambda: sys._current_frames())
    assert count > 200
    assert FakeLocalRef.freed_by_owner > 10_000
    assert FakeLocalRef.freed_elsewhere == 0


def test_stress_the_whole_report_never_does():
    def snapshot():
        pb._report_thread_population(force=True)
        pb._thread_stacks_snapshot(lambda name: True)

    with detached_frames(), report_fixture(), patched(
        pb, _THREAD_CPU_STACK_SAMPLE_GAP_SECONDS=0.001
    ):
        count = _churn(6.0, snapshot)
    assert count > 10
    assert FakeLocalRef.freed_by_owner > 10_000
    assert FakeLocalRef.freed_elsewhere == 0


def test_installed_at_start_and_idempotent():
    source = inspect.getsource(h.start)
    assert source.index("_patch_current_frames()") < source.index("import presence_bridge")
    assert "_run_thread_stack_self_check(pb)" in source
    with detached_frames():
        assert sys._current_frames is h._detached_current_frames
        h._patch_current_frames()
        assert sys._current_frames is h._detached_current_frames
        assert h._real_current_frames is REAL_CURRENT_FRAMES


def test_unchecked_interpreters_go_without_stacks():
    fake = types.SimpleNamespace(major=3, minor=14)
    with patched(sys, _current_frames=REAL_CURRENT_FRAMES), patched(
        h, _real_current_frames=None, _THREAD_STACK_PYTHON_VERSIONS=((fake.major, fake.minor),)
    ):
        h._patch_current_frames()
        assert sys._current_frames is h._no_current_frames
        with report_fixture() as (events, _lines):
            payload = pb._report_thread_population(force=True)
        assert payload["stacks"] == {} and payload["groups"] and payload["threads"]
        assert payload["cpuTicksByGroup"] and events
        assert pb._thread_stacks_snapshot(lambda name: True) == {}
        assert h._thread_stack_problems(pb) == [
            "stacks left out: unchecked Python %d.%d" % tuple(sys.version_info[:2])
        ]


def test_self_check():
    logged = []
    with patched(h, _log_host=logged.append):
        with detached_frames():
            assert h._run_thread_stack_self_check(pb)
            assert logged == ["thread stacks ready (no frame references)"]

            # Something else took the hook away again.
            with patched(sys, _current_frames=REAL_CURRENT_FRAMES):
                assert not h._run_thread_stack_self_check(pb)
                assert "sys._current_frames is not GO's" in logged[-1]

            # A bridge that took its own reference at import.
            pb._current_frames = REAL_CURRENT_FRAMES
            try:
                assert not h._run_thread_stack_self_check(pb)
                assert "does not use sys._current_frames" in logged[-1]
            finally:
                del pb._current_frames

            # A snapshot that hangs on to the frames.
            kept = []
            detached = h._detached_current_frames

            def leaky():
                kept.append(REAL_CURRENT_FRAMES())
                return detached()

            with patched(sys, _current_frames=leaky), patched(
                h, _detached_current_frames=leaky
            ):
                assert h._thread_stack_problems(pb)[0].startswith("a frame is still referenced")
            kept.clear()


def test_bridge_only_takes_frames_through_sys():
    """Every use in the Android sources is ``sys._current_frames``."""
    root = os.path.join(HERE, "..", "..", "main", "python")
    uses = 0
    for folder, _dirs, names in os.walk(root):
        for name in names:
            if not name.endswith(".py") or name == "qortal_presence_host.py":
                continue
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                text = fh.read()
            uses += text.count("sys._current_frames(")
            assert len(re.findall(r"_current_frames\b", text)) == text.count(
                "sys._current_frames("
            ), name
            assert "_current_exceptions" not in text, name
    assert uses >= 3


if __name__ == "__main__":
    failed = 0
    for test_name, test in sorted(globals().items()):
        if not test_name.startswith("test_") or not callable(test):
            continue
        try:
            test()
            print("ok  ", test_name)
        except Exception:
            failed += 1
            print("FAIL", test_name)
            traceback.print_exc()
    sys.exit(1 if failed else 0)
