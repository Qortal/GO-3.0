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
    pause_network()           # hub sockets down, bridge stays up (no GO screen)
    resume_network()          # redial the hubs after pause_network()
    stop()                    # EOF the bridge and let main() unwind
"""

import io
import os
import queue
import sys
import threading
import time
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

# Kotlin stops polling while no Activity is attached (GO swiped away), so the
# backlog must not grow for hours. Matches the bridge socket's client queue.
_OUT_QUEUE_MAX_FRAMES = 8192

# Network pause (see pause_network). The generation changes on every pause and
# resume so a reconnect loop from an earlier phase notices it is stale.
_network_paused = False
_network_generation = 0
_paused_interfaces = []  # [(interface, IN, OUT)]; None = leave as is
_resume_kick_generation = 0


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
                _put_out_frame(line)
        return len(s)

    def flush(self):
        pass


def _put_out_frame(line):
    """Queue one frame for Kotlin, dropping the oldest once nobody drains."""
    while _out_queue.qsize() >= _OUT_QUEUE_MAX_FRAMES:
        try:
            _out_queue.get_nowait()
        except queue.Empty:
            break
    _out_queue.put(line)


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
        # NOTICE: RNS reopens and re-stats its log file on every line, and at
        # INFO it wrote one per inbound announce and link event.
        "  loglevel = 3",
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


def _tune_rns_for_battery():
    """Relax RNS transport timers that were sized for a mains-powered desktop.

    The Backbone client keeps every hub socket alive with a kernel TCP probe
    after 5 s of silence, then every 2 s: across three hubs that is a packet
    roughly every 1.7 s, which never lets the phone's radio leave its
    high-power state. Probing after 45 s (15 s apart, four probes) still
    detects a dead hub in about two minutes; the bridge's own overlay pings
    and the JS presence heartbeat notice peer loss well before that. RNS's
    250 ms job loop and 5 s per-link watchdogs are desktop-sized: 1 s / 30 s
    only add jitter to timeout detection, not to delivery.
    """
    try:
        import RNS
        from RNS.Interfaces.BackboneInterface import BackboneClientInterface

        BackboneClientInterface.TCP_PROBE_AFTER = 45
        BackboneClientInterface.TCP_PROBE_INTERVAL = 15
        BackboneClientInterface.TCP_PROBES = 4
        BackboneClientInterface.TCP_USER_TIMEOUT = 120
        _install_reconnect_backoff(BackboneClientInterface)
        RNS.Transport.job_interval = 1.0
        RNS.Link.WATCHDOG_MAX_SLEEP = 30
    except Exception as exc:  # noqa: BLE001 - tuning is best effort
        try:
            sys.stderr.write(f"[presence_bridge] rns battery tuning skipped: {exc}\n")
        except Exception:
            pass


_RECONNECT_BACKOFF_MAX_SECONDS = 60

# Packet mix counters: key -> [count, bytes]. Keys are
# "<dir>:<packet_type>/<destination_type>/<context>" using RNS' numeric
# codes (packet: 0 data, 1 announce, 2 linkrequest, 3 proof; destination:
# 0 single, 1 group, 2 plain, 3 link; context: 0 none, 1 resource,
# 2 resource_adv, 3 resource_req, 4 resource_hmu, 5 resource_prf, 9 request,
# 10 response, 11 path_response, 250 keepalive, 253 linkproof, 255 lrproof).
_packet_mix = {}
_packet_mix_lock = threading.Lock()


def _count_packet(direction, packet_type, destination_type, context, size):
    key = f"{direction}:{packet_type}/{destination_type}/{context}"
    with _packet_mix_lock:
        entry = _packet_mix.get(key)
        if entry is None:
            _packet_mix[key] = [1, int(size)]
        else:
            entry[0] += 1
            entry[1] += int(size)


def _install_packet_mix_counters():
    """Tally inbound/outbound RNS packets by type so a field status snapshot
    can say *what* the hub sockets carry, not just how many bytes."""
    import RNS

    original_unpack = RNS.Packet.unpack

    def unpack(self):
        result = original_unpack(self)
        try:
            if result is not False and self.raw is not None:
                _count_packet(
                    "rx",
                    self.packet_type,
                    self.destination_type,
                    self.context,
                    len(self.raw),
                )
        except Exception:
            pass
        return result

    RNS.Packet.unpack = unpack

    original_outbound = RNS.Transport.outbound

    def outbound(packet):
        result = original_outbound(packet)
        try:
            raw = getattr(packet, "raw", None)
            if raw is not None:
                _count_packet(
                    "tx",
                    packet.packet_type,
                    getattr(packet.destination, "type", -1),
                    packet.context,
                    len(raw),
                )
        except Exception:
            pass
        return result

    RNS.Transport.outbound = staticmethod(outbound)


def _install_reconnect_backoff(client_cls):
    """Back off reconnect attempts to a hub that stays down.

    Upstream retries every ``RECONNECT_WAIT`` (5 s) forever: a DNS lookup plus
    a TCP SYN to an offline hub, twelve times a minute, from every phone on the
    mesh, which keeps the radio out of its low-power state. Double the wait
    after each failure up to a minute; the other hubs' keepalives already wake
    the radio at that cadence, and network recovery is still noticed within
    ``_RECONNECT_BACKOFF_MAX_SECONDS``.

    The loop also ends when the network is paused (see pause_network) or a
    later pause/resume made it stale, so a sleeping retry never reopens a hub
    socket behind a pause or races the redial of resume_network.
    """
    import RNS

    def reconnect(self):
        if not self.initiator:
            RNS.log(
                "Attempt to reconnect on a non-initiator TCP interface. This should not happen.",
                RNS.LOG_ERROR,
            )
            raise IOError("Attempt to reconnect on a non-initiator TCP interface")
        if self.reconnecting:
            return
        self.reconnecting = True
        generation = _network_generation
        attempts = 0
        wait = float(client_cls.RECONNECT_WAIT)
        sock = None
        while not self.online and not self.detached:
            time.sleep(wait)
            if _network_paused or generation != _network_generation:
                return
            attempts += 1
            if self.max_reconnect_tries is not None and attempts > self.max_reconnect_tries:
                RNS.log("Max reconnection attempts reached for " + str(self), RNS.LOG_WARNING)
                self.teardown()
                break
            try:
                sock = _connect_current(self, generation) or sock
            except Exception as exc:  # noqa: BLE001 - mirrors upstream
                RNS.log(
                    "Connection attempt for " + str(self) + " failed: " + str(exc),
                    RNS.LOG_DEBUG,
                )
            wait = min(wait * 2.0, float(_RECONNECT_BACKOFF_MAX_SECONDS))

        if not self.online:
            return
        if _network_paused or generation != _network_generation:
            # Connected while a pause was applied or a newer resume took
            # over: close only what this loop opened.
            with _interface_lock(self):
                if sock is not None:
                    _drop_stale_socket(self, sock)
                elif _network_paused:
                    _detach_for_pause(self)
            if _network_paused:
                self.reconnecting = False
            return
        if not self.never_connected:
            RNS.log("Reconnected socket for " + str(self) + ".", RNS.LOG_INFO)
        self.reconnecting = False
        RNS.Transport.synthesize_tunnel(self)

    client_cls.reconnect = reconnect

    def initial_connect(self):
        # RNS creates the hub interfaces while it boots; a pause that landed
        # first must keep them closed until resume_network().
        with _lock:
            generation = _network_generation
            if _network_paused:
                self.detached = True
                _paused_interfaces.append((self, None, None))
                return
        # Upstream initial_connect, with the dial serialised against the
        # reattach threads of a pause/resume that lands meanwhile.
        sock = None
        try:
            sock = _connect_current(self, generation, initial=True)
        except Exception as exc:  # noqa: BLE001 - connect(initial) returns False
            _log_host(f"initial connect failed for {self}: {exc}")
        if _network_paused or generation != _network_generation:
            # resume_network() redials this interface itself.
            if sock is not None:
                with _interface_lock(self):
                    _drop_stale_socket(self, sock)
            return
        if sock is None:
            threading.Thread(target=self.reconnect, daemon=True).start()
        else:
            self.wants_tunnel = True

    client_cls.initial_connect = initial_connect


def _disable_audio_fd_threads(pb):
    """The call-audio path uses Unix pipe FD3/FD4, absent in embedded CPython."""
    noop = lambda *a, **k: None
    for attr in ("_audio_fd3_reader_loop", "_audio_binary_out_writer_loop"):
        if hasattr(pb, attr):
            setattr(pb, attr, noop)


def _apply_mobile_overlay_limits(pb):
    """Fewer overlay neighbours on a phone.

    The bridge defaults (12 outbound + 8 inbound links) suit an always-on
    desktop that relays for others. Every overlay link costs a keepalive
    schedule, an RNS watchdog thread and a copy of every gossiped group digest
    (measured: ~220 forwarded digests a minute across 11 links). A leaf that
    no longer relays needs redundancy, not breadth.

    Gossip is flooded: every neighbour forwards every group digest, sub and
    typing wire to us, so the phone decrypts and JSON-decodes one copy per
    link and keeps one. Measured with 12 links: 3 250 inbound overlay packets
    a minute, of which ~440 were new (7.4 copies each), ~10 KB/s downstream
    around the clock and the single largest Python CPU item. Copies scale
    with link count, so 6 + 6 takes ~40 % off that against the old 12 + 8
    while keeping several independent routes for our own sends. The healthy-
    fanout floor drops with it so the bootstrap does not fight the cap.

    The inbound cap is deliberately not lower: desktops seeking fanout keep
    dialling an advertised phone, and every refused Link still costs a full
    handshake on both ends. Measured: 4 inbound slots -> ~150 refused links a
    minute (2.5/s); 6 slots -> ~18 a minute.
    """
    _apply_overlay_profile(pb, OVERLAY_PROFILE_LEAF)


# Overlay profiles (bridge command ``configure_overlay_profile``). "leaf" is
# the phone default above; "full" restores the desktop sizes while GO is on
# the charger and an unmetered network (native relayProfileChanged), when the
# extra copies cost neither battery nor data.
OVERLAY_PROFILE_LEAF = "leaf"
OVERLAY_PROFILE_FULL = "full"
_OVERLAY_PROFILE_CAPS = {
    OVERLAY_PROFILE_LEAF: (6, 6, 4),
    OVERLAY_PROFILE_FULL: (12, 8, 8),
}
_overlay_profile = None


def _apply_overlay_profile(pb, profile):
    """Set the overlay caps for ``profile``; returns True when they changed.

    The bridge reads these module globals at call time, so a change applies
    to the next admission and maintenance pass. Nothing is closed here:
    going back to "leaf" only stops new admissions above the smaller caps,
    and when the total drops below the open links the bridge's own pressure
    trim closes the least useful ones first (pinned chat/call peers, which
    include own devices, sort last and fit within the smaller total).
    """
    global _overlay_profile
    outbound, inbound, fanout_floor = _OVERLAY_PROFILE_CAPS[profile]
    changed = _overlay_profile != profile
    pb._OVERLAY_MAX_OUTBOUND_NEIGHBORS = outbound
    pb._OVERLAY_MAX_INBOUND_NEIGHBORS = inbound
    pb._OVERLAY_BOOTSTRAP_MAX_OUTBOUND_NEIGHBORS = outbound
    pb._OVERLAY_MIN_HEALTHY_FANOUT = fanout_floor
    pb._OVERLAY_MAX_TOTAL_LINKS = (
        outbound
        + inbound
        + pb._OVERLAY_MAX_PINNED_CHAT_PEERS
        + pb._OVERLAY_MAX_PINNED_CALL_PEERS
        + 4
    )
    _overlay_profile = profile
    return changed


def _install_overlay_profile_command(pb):
    """Answer ``configure_overlay_profile`` {profile: "full" | "leaf"}.

    Handled here rather than in the shared bridge so the caps stay in one
    place. The wrapper runs on the bridge's command lane like any command,
    so the caps change between overlay passes. Idempotent.
    """
    original = getattr(pb, "handle_command", None)
    if original is None or getattr(original, "_qortal_overlay_profile", False):
        return

    def handle_command(message):
        if not isinstance(message, dict) or message.get("action") != "configure_overlay_profile":
            return original(message)
        req_id = str(message.get("id") or "")
        payload = message.get("payload")
        profile = payload.get("profile") if isinstance(payload, dict) else None
        if profile not in _OVERLAY_PROFILE_CAPS:
            if req_id:
                pb.emit_resp(req_id, False, error=f"Unknown overlay profile: {profile}")
            return None
        changed = _apply_overlay_profile(pb, profile)
        if changed:
            _log_host(
                "overlay profile %s (%d outbound + %d inbound)"
                % (
                    profile,
                    pb._OVERLAY_MAX_OUTBOUND_NEIGHBORS,
                    pb._OVERLAY_MAX_INBOUND_NEIGHBORS,
                )
            )
        if req_id:
            pb.emit_resp(
                req_id,
                True,
                payload={
                    "profile": profile,
                    "changed": changed,
                    "outbound": pb._OVERLAY_MAX_OUTBOUND_NEIGHBORS,
                    "inbound": pb._OVERLAY_MAX_INBOUND_NEIGHBORS,
                },
            )
        return None

    handle_command._qortal_overlay_profile = True
    handle_command.__wrapped__ = original
    pb.handle_command = handle_command


def _install_network_pause_gates(pb):
    """Skip the bridge's own periodic dialling and announcing while paused.

    The overlay maintenance loop keeps running during a pause; without these
    gates it would build a Link to every neighbour candidate every 20 s, each
    with its own watchdog thread, only for it to time out on a closed socket.
    Names are looked up as module globals at call time, so every caller inside
    presence_bridge goes through the gate.
    """

    def gate(name, paused_result=None):
        original = getattr(pb, name, None)
        if original is None or getattr(original, "_qortal_pause_gate", False):
            return

        def gated(*args, **kwargs):
            if _network_paused:
                return paused_result
            return original(*args, **kwargs)

        gated._qortal_pause_gate = True
        gated.__wrapped__ = original
        setattr(pb, name, gated)

    gate("announce_local_destination")
    gate("_run_overlay_sync_maintenance")
    gate("_ping_established_overlay_links", 0)


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
        _tune_rns_for_battery()
        try:
            _install_packet_mix_counters()
        except Exception as exc:  # noqa: BLE001 - diagnostics are best effort
            sys.stderr.write(f"[presence_bridge] packet mix counters skipped: {exc}\n")
        import presence_bridge as pb

        _disable_audio_fd_threads(pb)
        # Route call audio over base64 JSON events/commands instead of FD3/FD4.
        pb._MOBILE_JSON_AUDIO = True
        _apply_mobile_overlay_limits(pb)
        _install_overlay_profile_command(pb)
        _install_network_pause_gates(pb)

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


def transport_status():
    """Snapshot of the bridge's own RNS hub interfaces, as a JSON string.

    The Kotlin plugin used to run a second, independent Reticulum stack
    (reticulum-kt) purely so the status badge had something to report. That
    stack held two more TCP sockets to the hubs, ran its own keepalives and
    decrypted every announce on the mesh a second time. Reading the counters
    off this instance costs one GIL acquisition per poll instead.
    """
    import json

    result = {
        "started": bool(_started),
        "online": False,
        "networkName": NETWORK_NAME,
        "ifacSize": 0,
        "interfaces": 0,
        "announces": 0,
        "rxBytes": 0,
        "txBytes": 0,
    }
    if not _started:
        return json.dumps(result)
    try:
        import RNS

        interfaces = [
            iface
            for iface in list(getattr(RNS.Transport, "interfaces", []) or [])
            if getattr(iface, "IN", False) or getattr(iface, "OUT", False)
        ]
        online = [iface for iface in interfaces if getattr(iface, "online", False)]
        result["interfaces"] = len(online)
        result["online"] = bool(online)
        ifac_sizes = [
            int(getattr(iface, "ifac_size", 0) or 0)
            for iface in interfaces
            if getattr(iface, "ifac_size", None)
        ]
        result["ifacSize"] = max(ifac_sizes) if ifac_sizes else 0
        result["rxBytes"] = sum(int(getattr(iface, "rxb", 0) or 0) for iface in interfaces)
        result["txBytes"] = sum(int(getattr(iface, "txb", 0) or 0) for iface in interfaces)
        # Destinations learned from announces; RNS keeps no raw announce
        # counter and adding a handler would spawn a thread per announce.
        result["announces"] = len(getattr(RNS.Transport, "path_table", {}) or {})
        try:
            from RNS.Cryptography import Provider as _crypto_provider

            result["cryptoBackend"] = _crypto_provider.backend()
        except Exception:
            pass
        with _packet_mix_lock:
            mix = sorted(
                _packet_mix.items(), key=lambda item: item[1][1], reverse=True
            )[:24]
        result["packetMix"] = [
            {"key": key, "count": count, "bytes": size} for key, (count, size) in mix
        ]
    except Exception as exc:  # noqa: BLE001 - status is best effort
        result["error"] = str(exc)
    return json.dumps(result)


def _log_host(message):
    try:
        sys.stderr.write(f"[presence_host] {message}\n")
        sys.stderr.flush()
    except Exception:
        pass


def _detach_for_pause(interface):
    """Close one hub socket and keep its reconnect loop from reopening it."""
    # detach() only sets `detached` when a socket exists; an interface that is
    # between reconnect attempts has none and would redial otherwise.
    interface.detached = True
    try:
        interface.detach()
    except Exception as exc:  # noqa: BLE001 - best effort, the flag holds
        _log_host(f"detach failed for {interface}: {exc}")


def _interface_lock(interface):
    """Per-interface lock that keeps one hub dial at a time."""
    with _lock:
        lock = getattr(interface, "_qortal_connect_lock", None)
        if lock is None:
            lock = threading.Lock()
            interface._qortal_connect_lock = lock
        return lock


def _connect_current(interface, generation, initial=False):
    """Dial ``interface`` for ``generation``; returns its socket or None.

    A reattach thread or reconnect loop from an earlier pause/resume can still
    be dialling (DNS has no time-out, TCP waits 5 s) when a newer one starts,
    and connect() overwrites interface.socket. The lock keeps one dial at a
    time, and a dial that finishes stale closes only the socket it opened, so
    it can neither leak the newer socket nor detach the live connection.
    Raises like connect() when ``initial`` is False.
    """
    with _interface_lock(interface):
        if _network_paused or generation != _network_generation:
            return None
        if not interface.connect(initial=initial):
            return None
        sock = interface.socket
        if _network_paused or generation != _network_generation:
            _drop_stale_socket(interface, sock)
            return None
        return sock


def _drop_stale_socket(interface, sock):
    """Close ``sock``, which a stale dial opened; hold the interface lock."""
    if sock is None:
        return
    try:
        from RNS.Interfaces.BackboneInterface import BackboneInterface

        fileno = sock.fileno()
        filenos = BackboneInterface.spawned_interface_filenos
        if fileno >= 0 and filenos.get(fileno) is interface:
            filenos.pop(fileno, None)
            BackboneInterface.deregister_fileno(fileno)
    except Exception:
        pass
    if interface.socket is sock:
        if _network_paused:
            _detach_for_pause(interface)
        else:
            # A newer resume owns the interface and dials it next.
            interface.online = False
            interface.socket = None
    try:
        sock.close()
    except Exception:
        pass


def _emit_transport_state():
    try:
        import presence_bridge as pb

        pb.maybe_emit_transport_state(force=True)
    except Exception:
        pass


def pause_network():
    """Take the hub sockets down while no GO screen needs the mesh.

    Kotlin calls this on the dataSync time-out, when GO is swiped from recents
    and after logout. ``stop()`` is not enough there: it only ends the command
    loop, while RNS keeps its hub sockets, links and keepalives running with
    nobody listening. RNS itself cannot be restarted inside this process (it
    is a singleton), so the bridge stays up and only the network goes: links
    are closed (peers get a LINKCLOSE instead of a timeout), the hub
    interfaces are detached and the bridge's own dialling is gated off.
    Returns True when this call paused the network.
    """
    global _network_paused, _network_generation
    with _lock:
        if not _started or _network_paused:
            return False
        _network_paused = True
        _network_generation += 1

    import RNS
    import presence_bridge as pb

    # Stops the 15 min announce timer; the next presence heartbeat after
    # resume_network() announces again.
    try:
        pb._rns_announce_on_auth_session_end()
    except Exception:
        pass

    closed = 0
    links = list(getattr(RNS.Transport, "active_links", []) or [])
    links += list(getattr(RNS.Transport, "pending_links", []) or [])
    for link in links:
        try:
            link.teardown()
            closed += 1
        except Exception:
            pass
    if closed:
        # Same window RNS gives teardown packets before detaching interfaces.
        time.sleep(0.15)

    paused = []
    for interface in list(getattr(RNS.Transport, "interfaces", []) or []):
        if not getattr(interface, "initiator", False):
            continue
        # A socket closed under the I/O loop tears the interface down (IN and
        # OUT go False); remember them so resume_network() can undo that.
        paused.append(
            (interface, getattr(interface, "IN", None), getattr(interface, "OUT", None))
        )
        _detach_for_pause(interface)
    with _lock:
        _paused_interfaces.extend(paused)
    _emit_transport_state()
    _log_host(f"network paused links_closed={closed} interfaces={len(paused)}")
    return True


def _after_network_resumed(generation):
    """First hub back after a resume: dial overlay neighbours right away."""
    global _resume_kick_generation
    with _lock:
        if _network_paused or generation != _network_generation:
            return
        if _resume_kick_generation == generation:
            return
        _resume_kick_generation = generation
    _emit_transport_state()
    try:
        import presence_bridge as pb

        pb._run_overlay_sync_maintenance("network_resume")
    except Exception as exc:  # noqa: BLE001 - the 20 s maintenance loop retries
        _log_host(f"overlay maintenance after resume failed: {exc}")


def _reattach_interface(interface, generation):
    import RNS

    sock = None
    try:
        sock = _connect_current(interface, generation, initial=True)
    except Exception as exc:  # noqa: BLE001 - falls back to the retry loop
        _log_host(f"reconnect failed for {interface}: {exc}")
    if _network_paused or generation != _network_generation:
        if sock is not None:
            with _interface_lock(interface):
                _drop_stale_socket(interface, sock)
        return
    if sock is not None:
        RNS.Transport.synthesize_tunnel(interface)
    else:
        # Backoff loop from _install_reconnect_backoff; it gives up on its own
        # when the network is paused again.
        interface.reconnect()
    if getattr(interface, "online", False):
        _after_network_resumed(generation)


def resume_network():
    """Redial the hub interfaces closed by pause_network()."""
    global _network_paused, _network_generation
    with _lock:
        if not _network_paused:
            return False
        _network_paused = False
        _network_generation += 1
        generation = _network_generation
        paused = list(_paused_interfaces)
        del _paused_interfaces[:]

    try:
        import presence_bridge as pb

        # A heartbeat that arrived while paused set the flag without a real
        # announce (the announce was gated); make the next one announce.
        pb._rns_announce_on_auth_session_end()
    except Exception:
        pass

    seen = set()
    for interface, was_in, was_out in paused:
        if id(interface) in seen:
            continue
        seen.add(id(interface))
        if was_in is not None:
            interface.IN = was_in
        if was_out is not None:
            interface.OUT = was_out
        interface.online = False
        interface.reconnecting = False
        interface.frame_buffer = b""
        interface.transmit_buffer = b""
        interface.detached = False
        threading.Thread(
            target=_reattach_interface,
            args=(interface, generation),
            name="presence-host-reattach",
            daemon=True,
        ).start()
    _log_host(f"network resumed interfaces={len(seen)}")
    return True


def stop():
    """Signal EOF so the bridge main loop unwinds cleanly."""
    global _started
    if _stdin_shim is not None:
        _stdin_shim.eof()
    _started = False
