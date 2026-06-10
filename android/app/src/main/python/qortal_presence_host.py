"""
Android host adapter for the Qortal Hub Reticulum presence bridge.

The desktop Hub runs ``presence_bridge.py`` as a *subprocess* and talks to it
over stdin/stdout (newline-delimited JSON), while a separate ``rnsd`` daemon
owns the TCP interfaces to the Qortal hubs. On Android there is no subprocess
and no separate daemon: Chaquopy runs CPython *in-process*, so this adapter

  * writes an RNS config that connects directly to the Qortal community hubs
    (TCPClientInterface + IFAC ``network_name = qortal-hub``), making the
    bridge its own standalone Reticulum instance (no shared rnsd);
  * forces ``RNS.Reticulum(require_shared_instance=False)`` since there is no
    shared instance to attach to;
  * replaces ``sys.stdin`` / ``sys.stdout`` with in-memory shims (Chaquopy maps
    real stdio to Logcat / EOF), so Kotlin drives the bridge by calling
    :func:`feed` and reads frames by calling :func:`poll`;
  * disables the call-audio FD3 threads, which assume Unix pipe file
    descriptors that do not exist in the embedded interpreter.

Kotlin lifecycle:
    start(config_dir)         # once
    feed('{"type":"cmd",...}')# send a command (start / publish_presence / ...)
    line = poll(timeout_ms)   # read one outbound JSON frame ("" when idle)
    stop()                    # EOF the bridge and let main() unwind
"""

import io
import os
import queue
import sys
import threading
import traceback

# Must mirror the desktop Hub's BackboneInterface hub set (electron
# DEFAULT_RETICULUM_HUBS) so mobile joins the SAME Reticulum mesh. The desktop
# community is anchored on phantom.mobilefabrik.com (its primary Backbone hub);
# connecting only to the reticulum.qortal.link TCP hubs lands on a different
# population, so mobile and Hub never see each other.
APP_HUBS = (
    ("Backbone Client Qortal Hub", "phantom.mobilefabrik.com", 4400),
    ("Crowetic Reticulum Hub", "reticulum.qortal.link", 4444),
    ("Crowetic Reticulum Hub 2", "reticulum2.qortal.link", 4444),
)
NETWORK_NAME = "qortal-hub"

_started = False
_lock = threading.RLock()
_stdin_shim = None
_out_queue: "queue.Queue[str]" = queue.Queue()
_main_thread = None


class _StdinShim(io.TextIOBase):
    """Blocking, line-oriented stdin fed by Kotlin via :func:`feed`."""

    def __init__(self):
        self._q: "queue.Queue" = queue.Queue()

    def feed(self, line):
        self._q.put(line)

    def eof(self):
        self._q.put(None)

    def readable(self):
        return True

    def readline(self, size=-1):
        item = self._q.get()
        if item is None:
            return ""  # EOF
        if not item.endswith("\n"):
            item = item + "\n"
        return item

    def __iter__(self):
        return self

    def __next__(self):
        line = self.readline()
        if line == "":
            raise StopIteration
        return line


class _StdoutShim(io.TextIOBase):
    """Collects the bridge's newline-delimited JSON frames for Kotlin to poll."""

    def __init__(self):
        self._buf = ""

    def writable(self):
        return True

    def write(self, s):
        if not s:
            return 0
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            if line:
                _out_queue.put(line)
        return len(s)

    def flush(self):
        pass


def _write_reticulum_config(config_dir):
    """Write an RNS config that dials the Qortal hubs directly (no shared rnsd)."""
    os.makedirs(config_dir, exist_ok=True)
    config_path = os.path.join(config_dir, "config")
    lines = [
        "[reticulum]",
        "  enable_transport = No",
        "  share_instance = No",
        "  panic_on_interface_error = No",
        "",
        "[logging]",
        "  loglevel = 4",
        "",
        "[interfaces]",
        "",
        "  [[Default Interface]]",
        "    type = AutoInterface",
        "    enabled = no",
    ]
    for name, host, port in APP_HUBS:
        lines += [
            "",
            f"  [[{name}]]",
            "    type = BackboneInterface",
            "    enabled = yes",
            f"    remote = {host}",
            f"    target_port = {port}",
            f"    network_name = {NETWORK_NAME}",
        ]
    with open(config_path, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    return config_path


def _patch_rns_standalone():
    """Force a standalone Reticulum instance (the desktop attaches to rnsd).

    ``presence_bridge.ensure_started`` calls ``RNS.Reticulum(..., require_
    shared_instance=True)`` because the desktop has a separate ``rnsd`` daemon
    to attach to. On Android there is none, so we must run standalone
    (``require_shared_instance=False``) with our own TCP interfaces.

    This MUST be a *subclass*, not a wrapper function: RNS internals reference
    class members such as ``RNS.Reticulum.get_instance()`` and ``RNS.Reticulum.
    MTU`` (e.g. ``Interface.__init__``), so replacing the class with a plain
    function raises ``AttributeError: 'function' object has no attribute
    'get_instance'`` the moment an interface is created.
    """
    import RNS

    original = RNS.Reticulum

    class _StandaloneReticulum(original):
        def __init__(self, *args, **kwargs):
            kwargs["require_shared_instance"] = False
            super().__init__(*args, **kwargs)

    RNS.Reticulum = _StandaloneReticulum


def _patch_signal_main_thread_safe():
    """Allow RNS to initialise from a non-main thread.

    ``RNS.Reticulum.__init__`` calls ``signal.signal(SIGINT/SIGTERM, ...)`` near
    the end of startup. CPython only permits ``signal.signal`` on the *main*
    thread of the main interpreter, but the bridge initialises Reticulum from a
    scheduler worker thread under Chaquopy, so the call raises
    ``ValueError: signal only works in main thread`` — which aborts ``__init__``
    *after* the singleton (``Reticulum.__instance``) is set and Transport has
    started, leaving the bridge half-initialised (RNS connected, but no presence
    destination). Android owns the process lifecycle, so these POSIX handlers are
    unnecessary here; swallow the off-main-thread failure so startup completes.
    """
    import signal as _signal

    original_signal = _signal.signal

    def _safe_signal(signalnum, handler):
        try:
            return original_signal(signalnum, handler)
        except (ValueError, OSError, RuntimeError) as exc:
            try:
                sys.stderr.write(
                    "[presence_bridge] signal.signal(%r) skipped off main thread: %s\n"
                    % (signalnum, exc)
                )
                sys.stderr.flush()
            except Exception:
                pass
            return None

    _signal.signal = _safe_signal


def _patch_rns_no_exit():
    """Stop RNS from killing the whole Android app.

    RNS ``panic()``/``exit()`` call ``os._exit()`` — designed for the desktop's
    standalone RNS subprocess, but here CPython is embedded in the app process,
    so ``os._exit`` tears down the entire UI. Replace them with exceptions and
    log the originating stack to ``sys.stderr`` (which Chaquopy routes to
    Logcat as ``python.stderr``) so a panic is contained and diagnosable.
    """
    import RNS

    def _safe_panic():
        try:
            sys.stderr.write(
                "[presence_bridge] RNS.panic() suppressed (embedded). Stack:\n"
                + "".join(traceback.format_stack())
                + "\n"
            )
            sys.stderr.flush()
        except Exception:
            pass
        raise RuntimeError("RNS.panic suppressed (embedded interpreter)")

    def _safe_exit(code=0):
        try:
            sys.stderr.write(
                "[presence_bridge] RNS.exit(%r) suppressed (embedded). Stack:\n"
                % (code,)
                + "".join(traceback.format_stack())
                + "\n"
            )
            sys.stderr.flush()
        except Exception:
            pass
        raise SystemExit(code)

    RNS.panic = _safe_panic
    RNS.exit = _safe_exit


def _disable_audio_fd_threads(pb):
    """The call-audio path uses Unix pipe FD3/FD4, absent in embedded CPython."""
    noop = lambda *a, **k: None
    for attr in ("_audio_fd3_reader_loop", "_audio_binary_out_writer_loop"):
        if hasattr(pb, attr):
            setattr(pb, attr, noop)


def start(config_dir):
    """Initialise stdio shims + RNS config and launch the bridge main loop."""
    global _started, _stdin_shim, _main_thread
    with _lock:
        if _started:
            return True
        _write_reticulum_config(config_dir)
        os.environ["QORTAL_RETICULUM_CONFIG_DIR"] = config_dir
        os.environ.setdefault("HOME", config_dir)

        _stdin_shim = _StdinShim()
        sys.stdin = _stdin_shim
        sys.stdout = _StdoutShim()
        sys.argv = ["presence_bridge"]

        _patch_signal_main_thread_safe()
        _patch_rns_standalone()
        _patch_rns_no_exit()
        import presence_bridge as pb

        _disable_audio_fd_threads(pb)
        # Route call audio over base64 JSON events/commands instead of FD3/FD4.
        pb._MOBILE_JSON_AUDIO = True

        def _run():
            try:
                pb.main()
            except SystemExit:
                pass
            except BaseException as exc:  # noqa: BLE001 - surface to Kotlin
                _out_queue.put(
                    '{"type":"event","event":"error","payload":{"code":"host_fatal",'
                    '"message":%r,"detail":%r}}'
                    % (str(exc), traceback.format_exc(limit=6))
                )

        _main_thread = threading.Thread(
            target=_run, name="presence-bridge-main", daemon=True
        )
        _main_thread.start()
        _started = True
        return True


def feed(line):
    """Submit one command frame (JSON string) to the bridge's stdin."""
    if _stdin_shim is not None:
        _stdin_shim.feed(line)


def poll(timeout_ms=250):
    """Return one outbound JSON frame, or "" if none arrived within timeout."""
    try:
        return _out_queue.get(timeout=max(0, timeout_ms) / 1000.0)
    except queue.Empty:
        return ""


def stop():
    """Signal EOF so the bridge main loop unwinds cleanly."""
    global _started
    if _stdin_shim is not None:
        _stdin_shim.eof()
    _started = False
