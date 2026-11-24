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
    descriptors that do not exist in the embedded interpreter, and carries
    call audio-link frames as JSON instead: ``group_audio_packet`` events
    out, ``send_group_audio`` commands in (see :func:`_install_json_audio_io`).

Kotlin lifecycle:
    start(config_dir)         # once
    feed('{"type":"cmd",...}')# send a command (start / publish_presence / ...)
    line = poll(timeout_ms)   # read one outbound JSON frame ("" when idle)
    pause_network()           # hub sockets down, bridge stays up (no GO screen)
    resume_network()          # redial the hubs after pause_network()
    refresh_network(reason)   # redial the hubs after a switch of default network
"""

import base64
import inspect
import io
import json
import math
import os
import queue
import sys
import threading
import time
import traceback
import zlib

# Must mirror the desktop Hub's BackboneInterface hub set (electron
# DEFAULT_RETICULUM_HUBS) so mobile joins the SAME Reticulum mesh. The desktop
# community is anchored on phantom.mobilefabrik.com (its primary Backbone hub);
# connecting only to the reticulum.qortal.link TCP hubs lands on a different
# population, so mobile and Hub never see each other.
APP_HUBS = (
    ("Backbone Client Qortal Hub", "phantom.mobilefabrik.com", 4400),
    ("Crowetic Reticulum Hub", "reticulum.qortal.link", 4444),
    ("Crowetic Reticulum Hub 2", "reticulum2.qortal.link", 4444),
    ("Crowetic Reticulum Hub 3", "reticulum3.qortal.link", 4444),
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
# Copy diagnostics: the deepest the queue to Kotlin got, and the frames
# dropped at the cap (both since the bridge started; plain int updates).
_out_queue_high_water = 0
_out_queue_drops = 0
# /proc/self/stat utime+stime and the monotonic time at the last detail
# read, for the process CPU share between two Copy diagnostics.
_process_cpu_prev = None

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

    def readable(self):
        return True

    def readline(self, size=-1):
        item = self._q.get()
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
        if "\n" not in s:
            self._buf += s
            return len(s)
        *lines, self._buf = (self._buf + s).split("\n")
        for line in lines:
            if line:
                _put_out_frame(line)
        return len(s)

    def flush(self):
        pass


def _put_out_frame(line):
    """Queue one frame for Kotlin, dropping the oldest once nobody drains."""
    global _out_queue_high_water, _out_queue_drops
    while _out_queue.qsize() >= _OUT_QUEUE_MAX_FRAMES:
        try:
            _out_queue.get_nowait()
        except queue.Empty:
            break
        _out_queue_drops += 1
    _out_queue.put(line)
    size = _out_queue.qsize()
    if size > _out_queue_high_water:
        _out_queue_high_water = size


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


# RNS 1.4.2's value. The vendored 1.3.4 ships Resource.REJECTED = 0x00,
# the same value as Resource.NONE.
_RNS_RESOURCE_REJECTED = 0x09


def _patch_rns_resource_rejected():
    """Give RNS.Resource.REJECTED its own status value, as upstream RNS 1.4.2
    does.

    With REJECTED equal to NONE (0), a rejected outgoing Resource's watchdog
    never leaves its ``status < ASSEMBLING`` loop: it wakes every 1 ms for the
    life of the process and keeps the Resource (and a split send's open
    file) alive. presence_bridge's provider response watcher also reads a
    next segment that is not advertised yet (status NONE) as rejected and
    fails the response. The status never goes on the wire, and Resource.py
    and presence_bridge only read it through the class attribute, so setting
    it before the bridge creates any Resource is enough. A vendored RNS that
    already has a distinct value is left alone.
    """
    try:
        import RNS

        resource_class = RNS.Resource
        if getattr(resource_class, "REJECTED", None) == getattr(
            resource_class, "NONE", None
        ):
            resource_class.REJECTED = _RNS_RESOURCE_REJECTED
    except Exception as exc:  # noqa: BLE001 - best effort, like the tuning
        try:
            sys.stderr.write(
                f"[presence_bridge] rns Resource.REJECTED fix skipped: {exc}\n"
            )
        except Exception:
            pass


def _tune_rns_for_battery():
    """Relax RNS transport timers that were sized for a mains-powered desktop.

    The Backbone client keeps every hub socket alive with a kernel TCP probe
    after 5 s of silence, then every 2 s: across three hubs that is a packet
    roughly every 1.7 s, which never lets the phone's radio leave its
    high-power state. Probing after 45 s (15 s apart, four probes) still
    detects a dead hub in about two minutes; the bridge's own overlay pings
    and the JS presence heartbeat notice peer loss well before that. RNS's
    250 ms job loop and 5 s per-link watchdogs are desktop-sized: 1 s / 30 s
    only add jitter to timeout detection, not to delivery. A rejected
    Resource's 1 ms watchdog spin is fixed here too, on its own so a tuning
    failure cannot skip it.
    """
    _patch_rns_resource_rejected()
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
            if self.online:
                # A refresh or resume dialled meanwhile (and tunnelled):
                # dialling again would leave two sockets on one interface.
                self.reconnecting = False
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
        if _network_paused:
            # A pause landed while RNS was still building this interface,
            # so pause_network() did not see it: park it here so that
            # resume_network() redials it.
            if sock is not None:
                with _interface_lock(self):
                    _drop_stale_socket(self, sock)
            with _lock:
                self.detached = True
                if not any(item[0] is self for item in _paused_interfaces):
                    _paused_interfaces.append((self, None, None))
            return
        if generation != _network_generation:
            # A refresh (or a pause and resume) landed during the dial;
            # neither knew this interface yet. Dial for the current one.
            generation = _network_generation
            try:
                sock = _connect_current(self, generation, initial=True)
            except Exception as exc:  # noqa: BLE001 - as above
                _log_host(f"initial connect retry failed for {self}: {exc}")
                sock = None
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


# Pre-signed presence heartbeats (GO only, wire-neutral).
#
# GO signs presence with the account key in the WebView page. Off screen on
# battery Chromium freezes that page, so heartbeats stop and after ~90 s every
# other device shows the phone offline: friends cannot call it any more,
# although a call request would still reach Python and ring natively. When GO
# goes off screen the page signs the coming heartbeats in advance (ordinary
# PRESENCE_HEARTBEAT envelopes, one per 25 s) and hands them over with
# ``schedule_presence_heartbeats``. This scheduler publishes each one at its
# own timestamp through the normal ``publish_presence`` command, so receivers
# see a normal, fresh, correctly signed heartbeat (desktop Hubs accept a
# heartbeat up to 60 s old / 30 s ahead). Nothing is published while the page
# still sends its own heartbeats, while the network is paused, or once the
# page cancels (back on screen, sign-out, status change). A PRESENCE_OFFLINE
# publish also clears the schedule.
_SCHEDULED_HEARTBEAT_ID_PREFIX = "go-scheduled-heartbeat:"
_SCHEDULED_HEARTBEAT_MAX = 400
_SCHEDULED_HEARTBEAT_MAX_BYTES = 4096
# A live heartbeat this recent makes a scheduled one redundant. Longer than
# the page's own 25-30 s heartbeat spacing, so a pre-signed (idle) heartbeat
# never slips in between two live ones while the page still runs off screen.
_SCHEDULED_HEARTBEAT_LIVE_GRACE_SECONDS = 35.0
# A scheduled heartbeat more than this late is dropped (desktops refuse
# heartbeats older than 60 s; keep a margin for transit).
_SCHEDULED_HEARTBEAT_MAX_LATE_SECONDS = 20.0
# Not accepted further ahead than this (2 h of heartbeats plus slack).
_SCHEDULED_HEARTBEAT_MAX_AHEAD_SECONDS = 3 * 60 * 60

_scheduled_heartbeat_cond = threading.Condition()
_scheduled_heartbeats = []  # [(timestamp_seconds, envelope)] sorted
_scheduled_heartbeat_generation = 0
_scheduled_heartbeat_thread = None
_scheduled_heartbeat_seq = 0
_last_live_presence_publish_at = 0.0
_scheduled_heartbeat_stats = {"sent": 0, "skippedLive": 0, "skippedLate": 0, "skippedPaused": 0}


def _validate_scheduled_heartbeats(envelopes, address=None, now=None):
    """The envelopes to keep, sorted by time; raises ValueError on bad input."""
    if not isinstance(envelopes, list):
        raise ValueError("envelopes must be a list")
    if len(envelopes) > _SCHEDULED_HEARTBEAT_MAX:
        raise ValueError("too many envelopes")
    now = time.time() if now is None else now
    kept = []
    sender = None
    for env in envelopes:
        if not isinstance(env, dict) or env.get("type") != "PRESENCE_HEARTBEAT":
            raise ValueError("only PRESENCE_HEARTBEAT envelopes can be scheduled")
        if len(json.dumps(env, separators=(",", ":"))) > _SCHEDULED_HEARTBEAT_MAX_BYTES:
            raise ValueError("envelope too large")
        ts = env.get("timestamp")
        if not isinstance(ts, (int, float)) or isinstance(ts, bool) or not math.isfinite(ts):
            raise ValueError("envelope timestamp missing")
        payload = env.get("payload")
        env_sender = payload.get("address") if isinstance(payload, dict) else None
        if not isinstance(env_sender, str) or not env_sender:
            raise ValueError("envelope address missing")
        if sender is None:
            sender = env_sender
        elif env_sender != sender:
            raise ValueError("envelopes of more than one account")
        if address and env_sender != address:
            raise ValueError("envelope address does not match")
        if not isinstance(env.get("signature"), str) or not env.get("signature"):
            raise ValueError("envelope signature missing")
        seconds = float(ts) / 1000.0
        if seconds < now - _SCHEDULED_HEARTBEAT_MAX_LATE_SECONDS:
            continue
        if seconds > now + _SCHEDULED_HEARTBEAT_MAX_AHEAD_SECONDS:
            continue
        kept.append((seconds, env))
    kept.sort(key=lambda item: item[0])
    return kept


def _replace_scheduled_heartbeats(items):
    global _scheduled_heartbeat_generation
    with _scheduled_heartbeat_cond:
        _scheduled_heartbeats[:] = items
        _scheduled_heartbeat_generation += 1
        _scheduled_heartbeat_cond.notify_all()


def _scheduled_heartbeat_loop(pb):
    global _scheduled_heartbeat_seq
    while True:
        with _scheduled_heartbeat_cond:
            while not _scheduled_heartbeats:
                _scheduled_heartbeat_cond.wait()
            due_at, env = _scheduled_heartbeats[0]
            delay = due_at - time.time()
            if delay > 0:
                _scheduled_heartbeat_cond.wait(timeout=min(delay, 30.0))
                continue
            _scheduled_heartbeats.pop(0)
        now = time.time()
        if now - due_at > _SCHEDULED_HEARTBEAT_MAX_LATE_SECONDS:
            _scheduled_heartbeat_stats["skippedLate"] += 1
            continue
        if now - _last_live_presence_publish_at < _SCHEDULED_HEARTBEAT_LIVE_GRACE_SECONDS:
            _scheduled_heartbeat_stats["skippedLive"] += 1
            continue
        if _network_paused or _stdin_shim is None:
            _scheduled_heartbeat_stats["skippedPaused"] += 1
            continue
        _scheduled_heartbeat_seq += 1
        frame = {
            "type": "cmd",
            "id": f"{_SCHEDULED_HEARTBEAT_ID_PREFIX}{_scheduled_heartbeat_seq}",
            "action": "publish_presence",
            "payload": {"envelope": env},
        }
        try:
            _stdin_shim.feed(json.dumps(frame, separators=(",", ":")))
            _scheduled_heartbeat_stats["sent"] += 1
        except Exception as exc:  # noqa: BLE001 - never kill the scheduler
            _log_host(f"scheduled heartbeat feed failed: {str(exc)[:120]}")


def _install_scheduled_presence_heartbeats(pb):
    """Commands ``schedule_presence_heartbeats`` {envelopes, address} and
    ``cancel_presence_heartbeats``; see the comment above. Idempotent."""
    global _scheduled_heartbeat_thread
    original = getattr(pb, "handle_command", None)
    if original is None or getattr(original, "_qortal_scheduled_heartbeats", False):
        return
    original_emit_resp = pb.emit_resp

    def emit_resp(req_id, *args, **kwargs):
        # Answers to our own scheduled publishes are not for the page.
        if isinstance(req_id, str) and req_id.startswith(_SCHEDULED_HEARTBEAT_ID_PREFIX):
            return None
        return original_emit_resp(req_id, *args, **kwargs)

    emit_resp.__wrapped__ = original_emit_resp
    pb.emit_resp = emit_resp

    def handle_command(message):
        global _last_live_presence_publish_at
        if not isinstance(message, dict):
            return original(message)
        action = message.get("action")
        req_id = str(message.get("id") or "")
        payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
        if action == "publish_presence" and not req_id.startswith(_SCHEDULED_HEARTBEAT_ID_PREFIX):
            env = payload.get("envelope") if isinstance(payload.get("envelope"), dict) else {}
            env_type = env.get("type")
            if env_type == "PRESENCE_OFFLINE":
                _replace_scheduled_heartbeats([])
            elif env_type in ("PRESENCE_HEARTBEAT", "PRESENCE_ANNOUNCE"):
                _last_live_presence_publish_at = time.time()
            return original(message)
        if action == "schedule_presence_heartbeats":
            try:
                address = payload.get("address")
                items = _validate_scheduled_heartbeats(
                    payload.get("envelopes"),
                    address if isinstance(address, str) else None,
                )
            except ValueError as exc:
                if req_id:
                    pb.emit_resp(req_id, False, error=str(exc))
                return None
            if payload.get("append") is True:
                with _scheduled_heartbeat_cond:
                    current = list(_scheduled_heartbeats)
                senders = {
                    (env.get("payload") or {}).get("address") for _, env in current
                }
                if current and senders != {(items[0][1].get("payload") or {}).get("address")} and items:
                    if req_id:
                        pb.emit_resp(req_id, False, error="append for another account")
                    return None
                seen = {env.get("timestamp") for _, env in current}
                merged = current + [item for item in items if item[1].get("timestamp") not in seen]
                if len(merged) > _SCHEDULED_HEARTBEAT_MAX:
                    if req_id:
                        pb.emit_resp(req_id, False, error="too many envelopes")
                    return None
                merged.sort(key=lambda item: item[0])
                items = merged
            _replace_scheduled_heartbeats(items)
            _log_host(
                "scheduled %d presence heartbeats (until %s)"
                % (
                    len(items),
                    time.strftime("%H:%M:%S", time.localtime(items[-1][0])) if items else "-",
                )
            )
            if req_id:
                pb.emit_resp(req_id, True, payload={"scheduled": len(items)})
            return None
        if action == "cancel_presence_heartbeats":
            with _scheduled_heartbeat_cond:
                dropped = len(_scheduled_heartbeats)
            _replace_scheduled_heartbeats([])
            if req_id:
                pb.emit_resp(
                    req_id,
                    True,
                    payload={"dropped": dropped, "stats": dict(_scheduled_heartbeat_stats)},
                )
            return None
        return original(message)

    handle_command._qortal_scheduled_heartbeats = True
    handle_command.__wrapped__ = original
    pb.handle_command = handle_command
    if _scheduled_heartbeat_thread is None:
        _scheduled_heartbeat_thread = threading.Thread(
            target=_scheduled_heartbeat_loop,
            args=(pb,),
            name="go-scheduled-heartbeats",
            daemon=True,
        )
        _scheduled_heartbeat_thread.start()


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


# Community STUN discovery query (bridge command get_community_stun_endpoints).
# The bridge answers with its live endpoint list and also sends one
# {"v":1,"q":true} announce from its community-STUN destination, which lives
# 24 h. RNS transport nodes rate-limit announces per destination (default
# announce_rate_target 3600 s, grace 5): after about 6 the hubs drop GO's
# queries for an hour. GO asks for ICE servers at every bridge `ready` and
# whenever a call wants them (a call that finds the pool empty asks every
# 750 ms for 12 s, directVoiceWebRtcTransport.ts), which spent that allowance
# in seconds. So the query goes out at most once per interval, and only while
# a hub interface is online; every other call gets the same pruned reply
# without the announce. GO never contributes an endpoint itself (no
# configure_community_stun), so nothing else announces from that destination.
_COMMUNITY_STUN_QUERY_MIN_INTERVAL_SECONDS = 10 * 60
_community_stun_query_lock = threading.Lock()
_community_stun_last_query_at = None  # _community_stun_clock() of the last query
_community_stun_query_stats = {"sent": 0, "throttled": 0, "offline": 0}


def _pick_community_stun_clock():
    """Seconds that keep counting while the phone sleeps.

    time.monotonic() is CLOCK_MONOTONIC on Linux/Android, which stops in
    suspend (Doze): after hours asleep it could still hold back the first
    query. The hubs' announce rate limit runs on wall time. CLOCK_BOOTTIME
    counts suspend and never jumps back; monotonic only where it is missing.
    """
    clock_id = getattr(time, "CLOCK_BOOTTIME", None)
    if clock_id is not None:
        try:
            time.clock_gettime(clock_id)
            return lambda: time.clock_gettime(clock_id)
        except (AttributeError, OSError):
            pass
    return time.monotonic


_community_stun_clock = _pick_community_stun_clock()


def _community_stun_query_reachable():
    """True when a query announce can reach a hub (best effort)."""
    if _network_paused:
        return False
    try:
        import RNS

        return any(
            getattr(iface, "online", False)
            and (getattr(iface, "IN", False) or getattr(iface, "OUT", False))
            for iface in list(getattr(RNS.Transport, "interfaces", []) or [])
        )
    except Exception:  # noqa: BLE001 - unknown: let the bridge send it
        return True


def _install_community_stun_query_throttle(pb):
    """Send the bridge's community-STUN query announce at most every 10 min.

    ``handle_command`` looks ``handle_get_community_stun_endpoints`` up as a
    module global at call time, so replacing it covers every caller.
    Idempotent; skipped (bridge unchanged) if the names it needs are gone.
    """
    original = getattr(pb, "handle_get_community_stun_endpoints", None)
    if original is None or getattr(original, "_qortal_query_throttle", False):
        return
    required = (
        "_state_lock",
        "_community_stun_recent_endpoints",
        "_community_stun_seen_endpoints",
        "emit_resp",
    )
    missing = [name for name in required if not hasattr(pb, name)]
    if missing:
        _log_host(
            "community stun query throttle skipped, bridge names changed: "
            + ",".join(missing)
        )
        return

    def handle_get_community_stun_endpoints(req_id, *args, **kwargs):
        global _community_stun_last_query_at
        with _community_stun_query_lock:
            now = _community_stun_clock()
            last = _community_stun_last_query_at
            due = (
                last is None
                or now < last
                or now - last >= _COMMUNITY_STUN_QUERY_MIN_INTERVAL_SECONDS
            )
            reachable = due and _community_stun_query_reachable()
            if reachable:
                _community_stun_last_query_at = now
                _community_stun_query_stats["sent"] += 1
            elif due:
                _community_stun_query_stats["offline"] += 1
            else:
                _community_stun_query_stats["throttled"] += 1
        if reachable:
            return original(req_id, *args, **kwargs)
        # The bridge handler's pruning and reply, without the query announce.
        now_ms = int(time.time() * 1000)
        with pb._state_lock:
            recent = pb._community_stun_recent_endpoints
            expired = [
                key
                for key, value in recent.items()
                if int(value.get("expiresAt") or 0) <= now_ms
            ]
            for key in expired:
                recent.pop(key, None)
                pb._community_stun_seen_endpoints.pop(key, None)
            endpoints = list(recent.values())[:128]
        pb.emit_resp(req_id, True, payload={"endpoints": endpoints})
        return None

    handle_get_community_stun_endpoints._qortal_query_throttle = True
    handle_get_community_stun_endpoints.__wrapped__ = original
    pb.handle_get_community_stun_endpoints = handle_get_community_stun_endpoints


# ---------------------------------------------------------------------------
# Call audio-link I/O for the WebView
#
# On the desktop the Electron main process exchanges call audio-link frames
# with the bridge over two binary pipes: FD3 carries outbound QAUD batches
# into ``_process_audio_input_frames`` and FD4 carries every inbound frame,
# media *and* link control (link-auth GC_JOIN, GC_KEY, GC_KEY_REQUEST, the
# GO0/GO1 fragments of WebRTC signals and DM hang-ups), out of
# ``_emit_binary_audio``. Embedded CPython has no such pipes, so GO carries
# the same frames as JSON:
#
#   * inbound: ``_emit_binary_audio`` is replaced. Each QAUD batch it is
#     handed is split back into frames and every frame becomes one
#     ``group_audio_packet`` event {linkId, roomId, peerPresenceHash,
#     peerDestinationHash, receivedAtWallMs, data(base64)}, the shape
#     capacitorBridge.handleGroupAudioPacket reads. The bridge's call sites
#     look the name up as a module global at call time, so they all go
#     through the replacement.
#   * outbound: the ``send_group_audio`` command {linkId, roomId,
#     peerPresenceHash, peerDestinationHash, receivedAtWallMs, data(base64)}
#     is answered here in feed(), before the stdin queue, so a voice frame
#     never waits behind chat sends on the bridge's command lanes. It enters
#     the bridge exactly where an FD3 frame would. ``receivedAtWallMs`` 0
#     (used for link-control frames) skips the 320 ms live-audio deadline.
#
# GO lost this path once already when an upstream bridge merge replaced
# presence_bridge.py (Hub 3.0.1, 8f029ab4), which is why it lives here and
# start() checks it: a merge that renames the hooked functions shows up in
# logcat and Copy diagnostics instead of as silent calls.
# ---------------------------------------------------------------------------

_SEND_GROUP_AUDIO_ACTION = "send_group_audio"
# Kotlin serialises commands with org.json: `"action":"send_group_audio"`.
# The closing quote keeps send_group_audio_link_control/_heartbeat out.
_SEND_GROUP_AUDIO_MARKER = '"' + _SEND_GROUP_AUDIO_ACTION + '"'
# presenceCommandWithResult (capacitorBridge.ts) ids; Kotlin's own are UUIDs.
# Only a caller that waits for an answer gets one: a resp per voice frame
# would double the JNI and WebView traffic of a call.
_CORRELATED_COMMAND_ID_PREFIX = "cmd-"
_GROUP_AUDIO_PACKET_EVENT = "group_audio_packet"
_GC_LINK_CONTROL_MAGIC = b"QGCCTL1\x00"
# Shares of the bridge's priority event queue (512) that inbound audio may
# fill; the rest stays free for link lifecycle events. Half is ~5 s of one
# peer's media at 50 frames/s, far more than is worth playing late.
_JSON_AUDIO_MEDIA_PRIORITY_SHARE = 0.5
_JSON_AUDIO_CONTROL_PRIORITY_SHARE = 0.875
_JSON_AUDIO_HOOK_FLAG = "_qortal_json_audio_io"
_JSON_AUDIO_REQUIRED_ATTRS = (
    "AUDIO_MAGIC",
    "AUDIO_HEADER_BYTES",
    "AUDIO_MAX_PAYLOAD",
    "AUDIO_MAX_LINK_ID_LEN",
    "AUDIO_MAX_ROOM_ID_LEN",
    "AUDIO_MAX_HASH_LEN",
    "_parse_audio_batch_body",
    "_encode_audio_batch_binary",
    "_process_audio_input_frames",
    "_json_priority_event_queue",
    "_json_event_queue",
    "emit_resp",
)

# Counters for Copy diagnostics (transport_status detail). Plain ints under
# the GIL; an occasional lost increment does not matter for diagnostics.
_json_audio_stats = {
    "rxFrames": 0,
    "rxControl": 0,
    "rxDropped": 0,
    "rxMediaShed": 0,
    "rxBadBatch": 0,
    "txFrames": 0,
    "txControl": 0,
    "txNotQueued": 0,
    "txRejected": 0,
}
_json_audio_last_error = ""
_json_audio_self_check = None  # {"ok": bool, "problems": [...]} after start()


class _SendGroupAudioError(ValueError):
    """A send_group_audio command that cannot become an audio frame."""


def _audio_chunk_frames(pb, chunk):
    """Split one QAUD batch (as given to ``_emit_binary_audio``) into frames.

    Returns ``[(linkId, roomId, peerPresenceHash, peerDestinationHash,
    receivedAtWallMs, raw)]``; raises ValueError for a malformed batch.
    """
    data = bytes(chunk)
    header = int(pb.AUDIO_HEADER_BYTES)
    if len(data) < header or data[:4] != pb.AUDIO_MAGIC:
        raise ValueError("not a QAUD batch")
    body_len = int.from_bytes(data[5:9], "big")
    body = data[header:]
    if body_len != len(body):
        raise ValueError("QAUD length mismatch")
    return pb._parse_audio_batch_body(body)


def _priority_headroom_limit(q, fraction_of_max):
    """How deep ``q`` may get before audio frames stop using it."""
    maxsize = int(getattr(q, "maxsize", 0) or 0)
    if maxsize <= 0:
        return None  # unbounded
    return max(1, int(maxsize * fraction_of_max))


def _queue_json_audio_event(pb, frame, is_control):
    """Queue one ``group_audio_packet`` ahead of ordinary events.

    Never blocks the RNS callback that delivered the packet. The bridge's
    priority queue also carries link lifecycle events
    (group_audio_link_established / _closed, error, ready) that cannot be
    coalesced and are lost when it is full, and the call code depends on
    them (a lost "closed" leaves a ghost link, a lost "established" skips
    link-auth). So audio frames never fill it: live media uses at most half
    of it and is dropped beyond that (it would be stale by the time it
    played); link control may go deeper but leaves a reserve, then falls
    back to the ordinary event queue, because a lost link-auth or room key
    stalls the whole call.
    """
    priority = pb._json_priority_event_queue
    limit = _priority_headroom_limit(
        priority,
        _JSON_AUDIO_CONTROL_PRIORITY_SHARE if is_control else _JSON_AUDIO_MEDIA_PRIORITY_SHARE,
    )
    queued = False
    if limit is None or priority.qsize() < limit:
        try:
            priority.put_nowait(frame)
            queued = True
        except queue.Full:
            queued = False
    if not queued:
        if not is_control:
            _json_audio_stats["rxDropped"] += 1
            _json_audio_stats["rxMediaShed"] += 1
            return False
        try:
            pb._json_event_queue.put_nowait(frame)
        except queue.Full:
            _json_audio_stats["rxDropped"] += 1
            return False
    available = getattr(pb, "_json_out_available", None)
    if available is not None:
        available.set()
    return True


def _emit_json_audio_chunk(pb, chunk):
    """``_emit_binary_audio`` replacement: QAUD batch -> group_audio_packet."""
    try:
        frames = _audio_chunk_frames(pb, chunk)
    except Exception:  # noqa: BLE001 - a bad batch must not break the RNS callback
        _json_audio_stats["rxBadBatch"] += 1
        return False
    queued_all = True
    for link_id, room_id, pph, pch, received_at_wall_ms, raw in frames:
        raw = bytes(raw)
        is_control = raw[: len(_GC_LINK_CONTROL_MAGIC)] == _GC_LINK_CONTROL_MAGIC
        # `type` and `event` first: Kotlin reads the event name off the
        # frame prefix without parsing (BridgeSocketServer).
        frame = {
            "type": "event",
            "event": _GROUP_AUDIO_PACKET_EVENT,
            "payload": {
                "linkId": str(link_id or ""),
                "roomId": str(room_id or ""),
                "peerPresenceHash": str(pph or ""),
                "peerDestinationHash": str(pch or ""),
                "receivedAtWallMs": int(received_at_wall_ms or 0),
                "data": base64.b64encode(raw).decode("ascii"),
            },
        }
        if _queue_json_audio_event(pb, frame, is_control):
            _json_audio_stats["rxFrames"] += 1
            if is_control:
                _json_audio_stats["rxControl"] += 1
        else:
            queued_all = False
    return queued_all


def _install_json_audio_io(pb):
    """Route inbound audio-link frames to ``group_audio_packet``. Idempotent."""
    original = getattr(pb, "_emit_binary_audio", None)
    if original is not None and getattr(original, _JSON_AUDIO_HOOK_FLAG, False):
        return

    def _emit_binary_audio(chunk):
        return _emit_json_audio_chunk(pb, chunk)

    setattr(_emit_binary_audio, _JSON_AUDIO_HOOK_FLAG, True)
    _emit_binary_audio.__wrapped__ = original
    pb._emit_binary_audio = _emit_binary_audio


def _bounded_text(value, max_bytes, what, lower=False):
    text = str(value or "").strip()
    if lower:
        text = text.lower()
    if len(text.encode("utf-8")) > int(max_bytes):
        raise _SendGroupAudioError(f"{what} too long")
    return text


def _send_group_audio_frame(pb, payload):
    """Validate a send_group_audio payload into one FD3-style audio frame."""
    if not isinstance(payload, dict):
        raise _SendGroupAudioError("missing payload")
    data_b64 = payload.get("data")
    if not isinstance(data_b64, str) or not data_b64:
        raise _SendGroupAudioError("missing audio data")
    try:
        raw = base64.b64decode(data_b64)
    except (ValueError, TypeError) as exc:
        raise _SendGroupAudioError(f"invalid base64 audio: {exc}") from None
    if not raw or len(raw) > int(pb.AUDIO_MAX_PAYLOAD):
        raise _SendGroupAudioError("audio payload empty or too large")
    link_id = _bounded_text(payload.get("linkId"), pb.AUDIO_MAX_LINK_ID_LEN, "linkId")
    room_id = _bounded_text(payload.get("roomId"), pb.AUDIO_MAX_ROOM_ID_LEN, "roomId")
    if not room_id:
        raise _SendGroupAudioError("missing roomId")
    peer_presence_hash = _bounded_text(
        payload.get("peerPresenceHash"), pb.AUDIO_MAX_HASH_LEN, "peerPresenceHash", True
    )
    peer_destination_hash = _bounded_text(
        payload.get("peerDestinationHash"),
        pb.AUDIO_MAX_HASH_LEN,
        "peerDestinationHash",
        True,
    )
    if not (link_id or peer_presence_hash or peer_destination_hash):
        raise _SendGroupAudioError("missing linkId or peer hash")
    received = payload.get("receivedAtWallMs")
    try:
        received_at_wall_ms = (
            0 if received is None or isinstance(received, bool) else int(received)
        )
    except (TypeError, ValueError):
        received_at_wall_ms = 0
    return (
        link_id,
        room_id,
        peer_presence_hash,
        peer_destination_hash,
        max(0, received_at_wall_ms),
        raw,
    )


def _handle_send_group_audio(pb, message):
    """Queue one outbound audio-link frame, as an FD3 batch of one would be."""
    global _json_audio_last_error
    req_id = str(message.get("id") or "")
    error = None
    queued = False
    try:
        frame = _send_group_audio_frame(pb, message.get("payload"))
        is_control = (
            frame[5][: len(_GC_LINK_CONTROL_MAGIC)] == _GC_LINK_CONTROL_MAGIC
        )
        queued = bool(pb._process_audio_input_frames([frame], time.monotonic()))
        if queued:
            _json_audio_stats["txFrames"] += 1
            if is_control:
                _json_audio_stats["txControl"] += 1
        else:
            # Missed the live deadline or the decoded queue was full; the
            # bridge counts the reason in its own audio diagnostics.
            _json_audio_stats["txNotQueued"] += 1
    except _SendGroupAudioError as exc:
        error = str(exc)
        _json_audio_stats["txRejected"] += 1
    except Exception as exc:  # noqa: BLE001 - never take the feed thread down
        error = f"queue audio failed: {exc}"
        _json_audio_stats["txRejected"] += 1
    if error:
        _json_audio_last_error = error[:160]
    if req_id.startswith(_CORRELATED_COMMAND_ID_PREFIX):
        if error:
            pb.emit_resp(req_id, False, payload={"code": "invalid_audio_frame"}, error=error)
        else:
            pb.emit_resp(req_id, True, payload={"queued": queued})


def _feed_send_group_audio(line):
    """Answer a send_group_audio command line; False leaves it to the bridge."""
    pb = sys.modules.get("presence_bridge")
    if pb is None:
        return False
    try:
        message = json.loads(line)
    except ValueError:
        return False
    if not isinstance(message, dict) or message.get("action") != _SEND_GROUP_AUDIO_ACTION:
        return False
    _handle_send_group_audio(pb, message)
    return True


def _json_audio_io_problems(pb):
    """What stops call audio I/O from working with this bridge (empty = ok)."""
    problems = [
        f"presence_bridge.{name} missing"
        for name in _JSON_AUDIO_REQUIRED_ATTRS
        if not hasattr(pb, name)
    ]
    emit = getattr(pb, "_emit_binary_audio", None)
    if emit is None or not getattr(emit, _JSON_AUDIO_HOOK_FLAG, False):
        problems.append("_emit_binary_audio is not routed to group_audio_packet")
    if problems:
        return problems
    sample = (
        "selfcheck",
        "dmv:selfcheck",
        "a" * 32,
        "b" * 32,
        0,
        _GC_LINK_CONTROL_MAGIC + b'{"t":"GAC"}',
    )
    try:
        chunk = pb._encode_audio_batch_binary([sample])
        if [tuple(frame) for frame in _audio_chunk_frames(pb, chunk)] != [sample]:
            problems.append("QAUD batch round trip changed the frame")
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        problems.append(f"QAUD batch round trip failed: {exc}")
    return problems


def _run_json_audio_self_check(pb):
    global _json_audio_self_check
    problems = _json_audio_io_problems(pb)
    _json_audio_self_check = {"ok": not problems, "problems": problems[:8]}
    if problems:
        _log_host("CALL AUDIO I/O SELF-CHECK FAILED: " + "; ".join(problems))
    else:
        _log_host("call audio I/O ready (group_audio_packet / send_group_audio)")
    return not problems


def _install_call_heartbeat_lane(pb):
    """Answer audio-link heartbeats off the chat lane.

    The bridge runs ``send_group_audio_link_heartbeat`` on ``control-send``,
    the lane every chat send uses. A Hub PINGs each call link every 5 s and
    marks it unready after two missed PONGs (group-call.ts:8418-8459), and on
    a busy phone that lane can be seconds deep. ``audio-control`` (link
    open/close only) is idle during a call. Idempotent.
    """
    original = getattr(pb, "_scheduler_lane_for_command", None)
    if original is None or getattr(original, "_qortal_call_lanes", False):
        return

    def _scheduler_lane_for_command(action, message=None):
        if str(action or "") == "send_group_audio_link_heartbeat":
            return "audio-control"
        return original(action, message)

    _scheduler_lane_for_command._qortal_call_lanes = True
    _scheduler_lane_for_command.__wrapped__ = original
    pb._scheduler_lane_for_command = _scheduler_lane_for_command


# ---------------------------------------------------------------------------
# WebRTC signalling over a slow mobile uplink (gcall control channel)
#
# Every WebRTC signal of a call (capability, offer, answer, candidates, ack,
# reconnect) and every DM call-control frame leaves as one GO0 + n GO1
# bundle on the audio link's reliable RNS Channel
# (presence_bridge._send_group_audio_control_bundle). Measured on the vivo
# on mobile data (2026-10-19): a link whose handshake rtt was above 1.45 s
# (RNS Channel.RTT_SLOW) got a window of 1 for its whole life, the bridge
# waited a fixed 6 s per frame and dropped bundles half-way, and the
# bundles that did complete left the phone 21-30 s after they were signed.
# The unmodified Hub drops RTC signals older than 20 s
# (GCALL_RTC_SIGNAL_TTL_MS, group-call.ts isValidRtcSignalInput) and DM
# call-control older than 30 s (verifyAndDeliverDmCallLinkControl), so it
# never got one GO signal and WebRTC never came up.
#
# presence_bridge.py is left exactly as the upstream copy, so GO wraps it
# here. The wire does not change (same GO0/GO1 frames, same signed
# GC_RTC_SIGNAL):
#   * window floor: a control channel that RNS built with window_max < 2
#     gets window = window_min = 2 and window_max = WINDOW_MAX_SLOW. This is
#     sender side only; the receiving Channel accepts up to WINDOW_MAX ahead.
#   * one deadline per bundle instead of 6 s per frame, from the signed
#     timestamp inside the deflated signal JSON: TTL (20 s RTC, 30 s
#     call-control) minus max(2 s, median audio-link RTT) minus 1 s clock
#     skew.
#   * feasibility before the first frame: an RTC bundle that cannot reach
#     the channel before its deadline (ceil(frames / window) rounds of the
#     median RTT, frames already in flight included) is not started, so it
#     never leaves half a bundle in the window. Call-control (hang-ups) is
#     never skipped and never waits less per frame than the bridge did.
#   * latest wins for capability/ack/reconnect/offer/answer: a newer signal
#     for the same link:room:session:type:inner kind:recipient replaces a
#     queued one in place (the inner kind keeps a DM's voice and
#     screen-share offers/answers apart; unreadable signals are never
#     coalesced). The queued task sends the newest payload; a later task
#     whose payload was already superseded and sent does nothing.
#   * one ``gcall_control_bundle_result`` event per bundle {signalId,
#     signalType, roomId, ok, reason, ...}, so the audio surface can
#     re-offer or re-answer at once (capacitorBridge.ts forwards it as the
#     window event ``go-gcall-control-bundle-result``).
# ---------------------------------------------------------------------------

_GCALL_CONTROL_HOOK_FLAG = "_qortal_gcall_control"
_GCALL_WINDOW_FLOOR_HOOK_FLAG = "_qortal_gcall_window_floor"
_GCALL_BUNDLE_RESULT_EVENT = "gcall_control_bundle_result"
_GCALL_RTC_SIGNAL_TYPES = frozenset(
    ("capability", "offer", "answer", "candidate", "candidates", "ack", "reconnect")
)
_GCALL_CALL_CONTROL_TYPE = "call-control"
_GCALL_LATEST_WINS_TYPES = frozenset(("capability", "ack", "reconnect", "offer", "answer"))
# group-call.ts GCALL_RTC_SIGNAL_TTL_MS / verifyAndDeliverDmCallLinkControl.
_GCALL_RTC_SIGNAL_TTL_SECONDS = 20.0
_GCALL_CALL_CONTROL_TTL_SECONDS = 30.0
_GCALL_DEADLINE_MIN_RTT_MARGIN_SECONDS = 2.0
_GCALL_CLOCK_SKEW_SECONDS = 1.0
# The bridge's own wait per frame; call-control never waits less.
_GCALL_LEGACY_FRAME_WAIT_SECONDS = 6.0
# The Hub inflates with maxOutputLength 96 KB (GCALL_RTC_SIGNAL_MAX_PAYLOAD_BYTES).
_GCALL_SIGNAL_MAX_BYTES = 96 * 1024
# A timestamp further than this from our clock is not trusted as one.
_GCALL_SIGNAL_TIMESTAMP_MAX_SKEW_SECONDS = 24 * 3600
_GCALL_RECORDS_MAX = 256
_GCALL_RECORD_MAX_AGE_SECONDS = 120.0
_GCALL_PRUNE_INTERVAL_SECONDS = 10.0
_GCALL_CHANNEL_WINDOW_FLOOR = 2
_GCALL_CHANNEL_WINDOW_FLEXIBILITY = 3
_GCALL_GO0_MAX_PARTS = 1024
_GCALL_CONTROL_REQUIRED_ATTRS = (
    "handle_send_group_audio_link_control",
    "_send_group_audio_control_bundle_task",
    "_send_group_audio_control_bundle",
    "_send_group_audio_control_channel_message",
    "emit_audio_link_closed",
    "_group_audio_control_pending_dedupe",
    "_state_lock",
    "get_audio_link_state",
    "emit_event",
    "_decode_group_audio_wire",
    "_GC_LINK_CONTROL_MAGIC",
)
# What the bridge's bundle task may touch: anything more and replacing it
# would drop behaviour, so the hooks stay off (see _gcall_control_problems).
_GCALL_TASK_EXPECTED_NAMES = frozenset(
    (
        "_group_audio_control_pending_dedupe",
        "_send_group_audio_control_bundle",
        "_state_lock",
        "discard",
    )
)

_gcall_lock = threading.Lock()
_gcall_tls = threading.local()
_gcall_seq = 0
_gcall_last_prune_at = 0.0
# signalId -> record of a send_group_audio_link_control request (see
# _gcall_register_request). Latest-wins records keep their payload.
_gcall_records = {}
# latest-wins key -> newest record for it
_gcall_latest = {}
# (task link id, latest-wins key) -> (record seq handed to the channel, at)
_gcall_attempted = {}
_gcall_stats = {
    "bundlesSent": 0,
    "bundlesFailed": 0,
    "expired": 0,
    "infeasible": 0,
    "linkFailed": 0,
    "notSent": 0,
    "superseded": 0,
    "coalesced": 0,
    "windowFloorApplied": 0,
    "resultEventsDropped": 0,
}
_gcall_self_check = None  # {"ok": bool, "problems": [...]} after start()


class _GcallBundle:
    """One bundle being handed to the control channel (thread-local)."""

    __slots__ = (
        "link_id",
        "room_id",
        "signal_type",
        "signal_id",
        "signed_at",
        "rtt",
        "deadline_mono",
        "never_skip",
        "total",
        "attempted",
        "sent",
        "reason",
        "needed",
        "started_mono",
    )

    def __init__(self, link_id, room_id, signal_type, signal_id, signed_at, rtt, deadline_mono, never_skip):
        self.link_id = link_id
        self.room_id = room_id
        self.signal_type = signal_type
        self.signal_id = signal_id
        self.signed_at = signed_at
        self.rtt = rtt
        self.deadline_mono = deadline_mono
        self.never_skip = never_skip
        self.total = 0
        self.attempted = 0
        self.sent = 0
        self.reason = ""
        self.needed = None
        self.started_mono = time.monotonic()


def _gcall_finite_positive(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value > 0
    )


def _gcall_inflate_signal(raw):
    """The signal JSON object in a raw-deflated bundle payload, else None.

    GroupCallManager sends deflateRawSync(JSON.stringify(signal)) for both
    GC_RTC_SIGNAL (sendRtcSignal) and DM call-control
    (sendDmCallLinkControl). Inflation is bounded like the Hub's.
    """
    try:
        inflater = zlib.decompressobj(-zlib.MAX_WBITS)
        text = inflater.decompress(bytes(raw), _GCALL_SIGNAL_MAX_BYTES)
        if inflater.unconsumed_tail:
            return None
        doc = json.loads(text.decode("utf-8"))
    except Exception:  # noqa: BLE001 - not a signal we can read
        return None
    return doc if isinstance(doc, dict) else None


def _gcall_signed_at(raw, now=None, doc=None):
    """Wall-clock seconds of the signed ``timestamp`` in a deflated signal.

    Both signal kinds carry the signer's Date.now(), which on GO is this
    device's clock. ``doc`` is the already inflated signal, if there is one.
    Anything unreadable counts as signed now.
    """
    now = time.time() if now is None else float(now)
    if doc is None:
        doc = _gcall_inflate_signal(raw)
    ts = doc.get("timestamp") if isinstance(doc, dict) else None
    if not _gcall_finite_positive(ts):
        return now
    signed_at = float(ts) / 1000.0
    if abs(now - signed_at) > _GCALL_SIGNAL_TIMESTAMP_MAX_SKEW_SECONDS:
        return now
    return min(signed_at, now)


def _gcall_signal_variant(doc):
    """(inner kind, latest-wins variant) of a GC_RTC_SIGNAL; (None, None)
    when the inner signal cannot be read.

    signalType alone does not say which transport a signal belongs to: in a
    DM call the voice WebRTC signals ('description', 'ice-refresh-request')
    and the screen-share signals ('screen-description', 'screen-stop') go
    out with the same room, session and signalType ('offer'/'answer',
    'reconnect'). Group calls name it ``type`` instead of ``kind``. The
    recipient keeps two accounts behind one link apart. A signal whose
    variant is unknown is not coalesced at all (as upstream).
    """
    if not isinstance(doc, dict):
        return None, None
    inner = doc.get("payload")
    if not isinstance(inner, str) or not inner:
        return None, None
    try:
        signal = json.loads(inner)
    except Exception:  # noqa: BLE001 - opaque payload: no variant
        return None, None
    if not isinstance(signal, dict):
        return None, None
    kind = signal.get("kind")
    if not isinstance(kind, str) or not kind:
        kind = signal.get("type")
    if not isinstance(kind, str) or not kind or len(kind) > 64:
        return None, None
    to_address = doc.get("toAddress")
    to_address = to_address.strip() if isinstance(to_address, str) else ""
    if len(to_address) > 128:
        return kind, None
    return kind, f"{kind}:{to_address}"


def _gcall_link_rtt_seconds(state):
    """Median audio-link RTT (the bridge's probes), else the handshake RTT."""
    if not isinstance(state, dict):
        return None
    for key in ("rtt_median_ms", "rtt_handshake_ms"):
        value = state.get(key)
        if _gcall_finite_positive(value):
            return float(value) / 1000.0
    rtt = getattr(state.get("link"), "rtt", None)
    if _gcall_finite_positive(rtt):
        return float(rtt)
    return None


def _gcall_bundle_deadline(signal_type, signed_at, rtt):
    """Wall-clock time by which the last frame must reach the channel."""
    ttl = (
        _GCALL_RTC_SIGNAL_TTL_SECONDS
        if signal_type in _GCALL_RTC_SIGNAL_TYPES
        else _GCALL_CALL_CONTROL_TTL_SECONDS
    )
    margin = max(_GCALL_DEADLINE_MIN_RTT_MARGIN_SECONDS, rtt or 0.0) + _GCALL_CLOCK_SKEW_SECONDS
    return signed_at + ttl - margin


def _gcall_prune_locked(now_mono, force=False):
    global _gcall_last_prune_at
    if (
        not force
        and len(_gcall_records) <= _GCALL_RECORDS_MAX
        and now_mono - _gcall_last_prune_at < _GCALL_PRUNE_INTERVAL_SECONDS
    ):
        return
    _gcall_last_prune_at = now_mono
    cutoff = now_mono - _GCALL_RECORD_MAX_AGE_SECONDS
    for signal_id, record in list(_gcall_records.items()):
        if record["registeredAt"] < cutoff:
            del _gcall_records[signal_id]
    for key, record in list(_gcall_latest.items()):
        if record["registeredAt"] < cutoff:
            del _gcall_latest[key]
    for key, (_seq, at) in list(_gcall_attempted.items()):
        if at < cutoff:
            del _gcall_attempted[key]
    while len(_gcall_records) > _GCALL_RECORDS_MAX:
        del _gcall_records[next(iter(_gcall_records))]
    while len(_gcall_attempted) > _GCALL_RECORDS_MAX:
        del _gcall_attempted[next(iter(_gcall_attempted))]


def _gcall_register_request(payload, max_room_bytes=255):
    """Remember one send_group_audio_link_control request before the bridge
    queues it: its signed time and, for latest-wins types, its payload.

    Runs on the command lane ahead of the bridge's handler, so the record
    exists before the bundle task can. A request the bridge then refuses
    (link not ready) stays a valid newer signal for a queued task of the
    same key; anything malformed is not recorded.
    """
    global _gcall_seq
    if not isinstance(payload, dict):
        return None
    signal_type = str(payload.get("signalType") or "")
    if signal_type not in _GCALL_RTC_SIGNAL_TYPES and signal_type != _GCALL_CALL_CONTROL_TYPE:
        return None
    signal_id = str(payload.get("signalId") or "")
    room_id = str(payload.get("roomId") or "")
    session_id = str(payload.get("callSessionId") or "")
    encoded = payload.get("payload")
    if (
        not signal_id
        or len(signal_id) > 128
        or not room_id
        or len(room_id.encode("utf-8")) > int(max_room_bytes)
        or not session_id
        or len(session_id) > 128
        or not isinstance(encoded, str)
        or not encoded
        or len(encoded) > (_GCALL_SIGNAL_MAX_BYTES * 4) // 3 + 4
    ):
        return None
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        return None
    if not raw or len(raw) > _GCALL_SIGNAL_MAX_BYTES:
        return None
    doc = _gcall_inflate_signal(raw)
    signed_at = _gcall_signed_at(raw, doc=doc)
    signal_kind, variant = _gcall_signal_variant(doc)
    route = str(payload.get("linkId") or "").strip()
    if not route:
        route = "peer:" + str(payload.get("peerPresenceHash") or "").strip().lower()
    key = (
        f"{route}:{room_id}:{session_id}:{signal_type}:{variant}"
        if signal_type in _GCALL_LATEST_WINS_TYPES and variant
        else ""
    )
    now_mono = time.monotonic()
    with _gcall_lock:
        _gcall_seq += 1
        record = {
            "seq": _gcall_seq,
            "key": key,
            "route": route,
            "signalId": signal_id,
            "signalType": signal_type,
            "signalKind": signal_kind or "",
            "roomId": room_id,
            "signedAt": signed_at,
            "payload": raw if key else None,
            "registeredAt": now_mono,
        }
        _gcall_records.pop(signal_id, None)
        _gcall_records[signal_id] = record
        if key:
            _gcall_latest[key] = record
        _gcall_prune_locked(now_mono)
    return record


def _gcall_take_latest(link_id, room_id, payload, signal_type, signal_id):
    """(payload, signalId) a bundle task should send, None if superseded."""
    with _gcall_lock:
        own = _gcall_records.get(signal_id)
        if (
            own is None
            or not own["key"]
            or own["signalType"] != signal_type
            or own["roomId"] != room_id
        ):
            return payload, signal_id
        latest = _gcall_latest.get(own["key"])
        chosen = latest if latest is not None and latest["seq"] > own["seq"] else own
        attempted_key = (str(link_id or ""), own["key"])
        attempted = _gcall_attempted.get(attempted_key)
        if attempted is not None and attempted[0] >= chosen["seq"]:
            return None
        _gcall_attempted[attempted_key] = (chosen["seq"], time.monotonic())
        if chosen is own:
            return payload, signal_id
        _gcall_stats["coalesced"] += 1
        return chosen["payload"], chosen["signalId"]


def _gcall_signed_at_for(signal_id, payload):
    with _gcall_lock:
        record = _gcall_records.get(signal_id)
        signed_at = record["signedAt"] if record is not None else None
    return signed_at if signed_at is not None else _gcall_signed_at(payload)


def _gcall_signal_kind_for(signal_id):
    """Inner signal kind of a registered request ('' when unknown)."""
    with _gcall_lock:
        record = _gcall_records.get(signal_id)
        return str(record.get("signalKind") or "") if record is not None else ""


def _gcall_forget_link(link_id):
    """Drop latest-wins state for a closed audio link."""
    link = str(link_id or "")
    if not link:
        return
    with _gcall_lock:
        for key in [key for key in _gcall_attempted if key[0] == link]:
            del _gcall_attempted[key]
        for key, record in list(_gcall_latest.items()):
            if record["route"] == link:
                del _gcall_latest[key]
        for signal_id, record in list(_gcall_records.items()):
            if record["route"] == link:
                del _gcall_records[signal_id]


def _gcall_bundle_frame_total(pb, wire):
    """Frames in a bundle (GO0 + parts) read off its first frame, 0 if unknown."""
    try:
        decoded = pb._decode_group_audio_wire(wire)
        if not decoded:
            return 0
        raw = bytes(decoded[2])
        magic = bytes(pb._GC_LINK_CONTROL_MAGIC)
        if raw[: len(magic)] != magic:
            return 0
        frame = json.loads(raw[len(magic):].decode("utf-8"))
    except Exception:  # noqa: BLE001 - unknown: send without the check
        return 0
    if not isinstance(frame, dict) or frame.get("t") != "GO0":
        return 0
    parts = frame.get("n")
    if isinstance(parts, bool) or not isinstance(parts, int):
        return 0
    if parts < 1 or parts > _GCALL_GO0_MAX_PARTS:
        return 0
    return parts + 1


def _gcall_bundle_feasible(pb, bundle):
    """Can every frame reach the channel before the bundle's deadline?"""
    if bundle.total <= 0 or not bundle.rtt:
        return True
    state = pb.get_audio_link_state(bundle.link_id)
    channel = (state or {}).get("control_channel")
    try:
        window = max(1, int(getattr(channel, "window", 1) or 1))
    except (TypeError, ValueError):
        window = 1
    try:
        in_flight = len(getattr(channel, "_tx_ring", None) or ())
    except TypeError:
        in_flight = 0
    rounds = math.ceil((bundle.total + in_flight) / window)
    bundle.needed = rounds * bundle.rtt
    return bundle.needed <= bundle.deadline_mono - time.monotonic()


def _gcall_send_channel_message(pb, original, link_id, kind, data, wait_seconds, *args, **kwargs):
    """Per-frame send inside a bundle: the bundle's deadline, not 6 s."""
    bundle = getattr(_gcall_tls, "bundle", None)
    if bundle is None or bundle.link_id != link_id:
        return original(link_id, kind, data, wait_seconds, *args, **kwargs)
    if bundle.reason:
        return False
    if bundle.attempted == 0:
        bundle.total = _gcall_bundle_frame_total(pb, data)
        if not bundle.never_skip and not _gcall_bundle_feasible(pb, bundle):
            bundle.reason = "infeasible"
            return False
    bundle.attempted += 1
    remaining = bundle.deadline_mono - time.monotonic()
    if bundle.never_skip:
        remaining = max(remaining, _GCALL_LEGACY_FRAME_WAIT_SECONDS)
    elif remaining <= 0:
        bundle.reason = "expired"
        return False
    ok = original(link_id, kind, data, remaining, *args, **kwargs)
    if ok:
        bundle.sent += 1
        return ok
    if bundle.never_skip:
        bundle.reason = "link"
    else:
        bundle.reason = "expired" if time.monotonic() >= bundle.deadline_mono else "link"
    return ok


def _gcall_queue_result_event(pb, frame):
    """Queue a bundle result ahead of chat events (link-lifecycle share)."""
    priority = getattr(pb, "_json_priority_event_queue", None)
    if priority is not None:
        limit = _priority_headroom_limit(priority, _JSON_AUDIO_CONTROL_PRIORITY_SHARE)
        if limit is None or priority.qsize() < limit:
            try:
                priority.put_nowait(frame)
                available = getattr(pb, "_json_out_available", None)
                if available is not None:
                    available.set()
                return True
            except queue.Full:
                pass
    try:
        pb.emit_event(frame["event"], frame["payload"])
        return True
    except Exception:  # noqa: BLE001 - diagnostics must not break the lane
        return False


def _gcall_report_bundle(pb, bundle):
    if bundle.reason:
        ok, reason = False, bundle.reason
    elif bundle.attempted == 0:
        state = pb.get_audio_link_state(bundle.link_id)
        gone = (
            state is None
            or state.get("closing") is True
            or state.get("control_channel") is None
        )
        ok, reason = False, ("link" if gone else "not-sent")
    elif bundle.total and bundle.sent < bundle.total:
        ok, reason = False, "not-sent"
    else:
        ok, reason = True, "sent"
    if ok:
        _gcall_stats["bundlesSent"] += 1
    else:
        _gcall_stats["bundlesFailed"] += 1
        counter = {
            "expired": "expired",
            "infeasible": "infeasible",
            "link": "linkFailed",
        }.get(reason, "notSent")
        _gcall_stats[counter] += 1
    now_wall = time.time()
    age_ms = max(0, int((now_wall - bundle.signed_at) * 1000))
    elapsed_ms = max(0, int((time.monotonic() - bundle.started_mono) * 1000))
    if not ok or elapsed_ms >= 1000:
        needed = (
            f" needed_ms={int(bundle.needed * 1000)}" if bundle.needed is not None else ""
        )
        rtt = f"{int(bundle.rtt * 1000)}" if bundle.rtt else "na"
        _log_host(
            f"gcall-control bundle_{'sent' if ok else 'failed'} reason={reason} "
            f"link={str(bundle.link_id)[:16]} signal={bundle.signal_type} "
            f"id={str(bundle.signal_id)[:12]} sent={bundle.sent} total={bundle.total} "
            f"age_ms={age_ms} elapsed_ms={elapsed_ms} rtt_ms={rtt}{needed}"
        )
    frame = {
        "type": "event",
        "event": _GCALL_BUNDLE_RESULT_EVENT,
        "payload": {
            "signalId": str(bundle.signal_id),
            "signalType": str(bundle.signal_type),
            # 'description' (voice) vs 'screen-description' (screen share)
            # share signalType 'offer'/'answer'; '' when unknown.
            "signalKind": _gcall_signal_kind_for(bundle.signal_id),
            "roomId": str(bundle.room_id),
            "linkId": str(bundle.link_id),
            "ok": ok,
            "reason": reason,
            "sent": int(bundle.sent),
            "total": int(bundle.total),
            "ageMs": age_ms,
        },
    }
    if not _gcall_queue_result_event(pb, frame):
        _gcall_stats["resultEventsDropped"] += 1
    return ok


def _gcall_send_bundle(pb, original, link_id, room_id, payload, signal_type, signal_id, *args, **kwargs):
    """The bridge's bundle send under one deadline, with a result event."""
    signed_at = _gcall_signed_at_for(signal_id, payload)
    rtt = _gcall_link_rtt_seconds(pb.get_audio_link_state(link_id))
    deadline_wall = _gcall_bundle_deadline(signal_type, signed_at, rtt)
    now_wall = time.time()
    bundle = _GcallBundle(
        link_id,
        room_id,
        signal_type,
        signal_id,
        signed_at,
        rtt,
        time.monotonic() + (deadline_wall - now_wall),
        signal_type not in _GCALL_RTC_SIGNAL_TYPES,
    )
    if not bundle.never_skip and deadline_wall <= now_wall:
        bundle.reason = "expired"
    else:
        previous = getattr(_gcall_tls, "bundle", None)
        _gcall_tls.bundle = bundle
        try:
            original(link_id, room_id, payload, signal_type, signal_id, *args, **kwargs)
        finally:
            _gcall_tls.bundle = previous
    _gcall_report_bundle(pb, bundle)
    return None


def _gcall_run_bundle_task(pb, link_id, room_id, payload, signal_type, signal_id, dedupe_key):
    """The bridge's bundle task, latest wins.

    The bridge frees its capability/reconnect dedupe slot only after the
    send, so a newer request arriving during a slow send was coalesced into
    a slot nobody read any more. It is freed first here: a request during
    the send queues its own task, which sends the newer payload.
    """
    if dedupe_key:
        with pb._state_lock:
            pb._group_audio_control_pending_dedupe.discard(dedupe_key)
    choice = _gcall_take_latest(link_id, room_id, payload, signal_type, signal_id)
    if choice is None:
        _gcall_stats["superseded"] += 1
        _log_host(
            f"gcall-control bundle_superseded link={str(link_id)[:16]} "
            f"signal={signal_type} id={str(signal_id)[:12]}"
        )
        return None
    payload, signal_id = choice
    return pb._send_group_audio_control_bundle(link_id, room_id, payload, signal_type, signal_id)


def _gcall_original(pb, name, flag=_GCALL_CONTROL_HOOK_FLAG):
    fn = getattr(pb, name, None)
    while fn is not None and getattr(fn, flag, False):
        fn = getattr(fn, "__wrapped__", None)
    return fn


def _gcall_param_names(fn):
    try:
        return [
            p.name
            for p in inspect.signature(fn).parameters.values()
            if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
        ]
    except (TypeError, ValueError):
        return None


def _gcall_global_names(fn):
    code = getattr(fn, "__code__", None)
    return set(code.co_names) if code is not None else set()


def _gcall_control_problems(pb):
    """Why the bundle hooks cannot wrap this bridge safely (empty = ok)."""
    problems = [
        f"presence_bridge.{name} missing"
        for name in _GCALL_CONTROL_REQUIRED_ATTRS
        if not hasattr(pb, name)
    ]
    if problems:
        return problems
    handler = _gcall_original(pb, "handle_send_group_audio_link_control")
    task = _gcall_original(pb, "_send_group_audio_control_bundle_task")
    bundle = _gcall_original(pb, "_send_group_audio_control_bundle")
    message = _gcall_original(pb, "_send_group_audio_control_channel_message")
    closed = _gcall_original(pb, "emit_audio_link_closed")
    if _gcall_param_names(handler) != ["req_id", "payload"]:
        problems.append("handle_send_group_audio_link_control signature changed")
    if "_send_group_audio_control_bundle_task" not in _gcall_global_names(handler):
        problems.append("handle_send_group_audio_link_control no longer queues the bundle task")
    if _gcall_param_names(task) != [
        "link_id",
        "room_id",
        "payload",
        "signal_type",
        "signal_id",
        "dedupe_key",
    ]:
        problems.append("_send_group_audio_control_bundle_task signature changed")
    task_names = _gcall_global_names(task)
    if "_send_group_audio_control_bundle" not in task_names or not task_names <= _GCALL_TASK_EXPECTED_NAMES:
        problems.append("_send_group_audio_control_bundle_task does more than send the bundle")
    if _gcall_param_names(bundle) != ["link_id", "room_id", "payload", "signal_type", "signal_id"]:
        problems.append("_send_group_audio_control_bundle signature changed")
    if "_send_group_audio_control_channel_message" not in _gcall_global_names(bundle):
        problems.append("_send_group_audio_control_bundle no longer sends per channel message")
    if (_gcall_param_names(message) or [])[:4] != ["link_id", "kind", "data", "wait_seconds"]:
        problems.append("_send_group_audio_control_channel_message signature changed")
    if (_gcall_param_names(closed) or [])[:1] != ["link_id"]:
        problems.append("emit_audio_link_closed signature changed")
    if not isinstance(getattr(pb, "_group_audio_control_pending_dedupe", None), set):
        problems.append("_group_audio_control_pending_dedupe is not a set")
    return problems


def _install_gcall_control_bundles(pb):
    """Deadline, feasibility, latest wins and result events for the bridge's
    gcall control bundles. Idempotent; leaves the bridge as it is (and says
    so in logcat and Copy diagnostics) when its names or shapes changed.
    """
    if getattr(getattr(pb, "_send_group_audio_control_bundle", None), _GCALL_CONTROL_HOOK_FLAG, False):
        return True
    problems = _gcall_control_problems(pb)
    if problems:
        _log_host("gcall control slow-link hooks skipped: " + "; ".join(problems[:6]))
        return False
    orig_handler = pb.handle_send_group_audio_link_control
    orig_task = pb._send_group_audio_control_bundle_task
    orig_bundle = pb._send_group_audio_control_bundle
    orig_message = pb._send_group_audio_control_channel_message
    orig_closed = pb.emit_audio_link_closed
    max_room_bytes = int(getattr(pb, "AUDIO_MAX_ROOM_ID_LEN", 255) or 255)

    def handle_send_group_audio_link_control(req_id, payload, *args, **kwargs):
        try:
            _gcall_register_request(payload, max_room_bytes)
        except Exception as exc:  # noqa: BLE001 - the bridge still sends it
            _log_host(f"gcall-control register failed: {str(exc)[:120]}")
        return orig_handler(req_id, payload, *args, **kwargs)

    def _send_group_audio_control_bundle_task(
        link_id, room_id, payload, signal_type, signal_id, dedupe_key="", *args, **kwargs
    ):
        return _gcall_run_bundle_task(
            pb, link_id, room_id, payload, signal_type, signal_id, dedupe_key
        )

    def _send_group_audio_control_bundle(link_id, room_id, payload, signal_type, signal_id, *args, **kwargs):
        return _gcall_send_bundle(
            pb, orig_bundle, link_id, room_id, payload, signal_type, signal_id, *args, **kwargs
        )

    def _send_group_audio_control_channel_message(link_id, kind, data=b"", wait_seconds=2.0, *args, **kwargs):
        return _gcall_send_channel_message(
            pb, orig_message, link_id, kind, data, wait_seconds, *args, **kwargs
        )

    def emit_audio_link_closed(link_id, *args, **kwargs):
        try:
            return orig_closed(link_id, *args, **kwargs)
        finally:
            _gcall_forget_link(link_id)

    for name, wrapper, original in (
        ("handle_send_group_audio_link_control", handle_send_group_audio_link_control, orig_handler),
        ("_send_group_audio_control_bundle_task", _send_group_audio_control_bundle_task, orig_task),
        ("_send_group_audio_control_channel_message", _send_group_audio_control_channel_message, orig_message),
        ("emit_audio_link_closed", emit_audio_link_closed, orig_closed),
        # Last: it is the "already installed" marker above.
        ("_send_group_audio_control_bundle", _send_group_audio_control_bundle, orig_bundle),
    ):
        setattr(wrapper, _GCALL_CONTROL_HOOK_FLAG, True)
        wrapper.__wrapped__ = original
        setattr(pb, name, wrapper)
    return True


def _apply_gcall_channel_window_floor(pb, link_id):
    """Raise a window-1 control channel to the RNS slow-link window.

    RNS gives a Channel window 1 (window_max 1) for the link's whole life
    when the handshake rtt is above Channel.RTT_SLOW, so every frame waits
    for the proof of the one before it. The floor is sender side only: the
    receiving Channel accepts up to WINDOW_MAX sequence numbers ahead.
    Returns True when it raised the window, None when there is no channel.
    """
    state = pb.get_audio_link_state(link_id)
    channel = (state or {}).get("control_channel")
    lock = getattr(channel, "_lock", None)
    if channel is None or lock is None:
        return None
    if not all(
        hasattr(channel, name)
        for name in ("window", "window_max", "window_min", "window_flexibility")
    ):
        return None
    slow_max = getattr(type(channel), "WINDOW_MAX_SLOW", 5)
    if not isinstance(slow_max, int) or slow_max < _GCALL_CHANNEL_WINDOW_FLOOR:
        slow_max = 5
    with lock:
        raised = int(channel.window_max) < _GCALL_CHANNEL_WINDOW_FLOOR
        if raised:
            channel.window = _GCALL_CHANNEL_WINDOW_FLOOR
            channel.window_min = _GCALL_CHANNEL_WINDOW_FLOOR
            channel.window_max = slow_max
            channel.window_flexibility = _GCALL_CHANNEL_WINDOW_FLEXIBILITY
        window, window_max = channel.window, channel.window_max
    rtt = _gcall_link_rtt_seconds(state)
    _log_host(
        f"gcall-control channel link={str(link_id)[:16]} "
        f"rtt_ms={int(rtt * 1000) if rtt else 'na'} window={window} "
        f"window_max={window_max} floor={'raised' if raised else 'no'}"
    )
    if raised:
        _gcall_stats["windowFloorApplied"] += 1
    return raised


def _install_gcall_control_window_floor(pb):
    """Apply the window floor whenever the bridge sets up a control channel."""
    original = getattr(pb, "_configure_group_audio_control_channel", None)
    if original is None or getattr(original, _GCALL_WINDOW_FLOOR_HOOK_FLAG, False):
        return original is not None
    if _gcall_param_names(original) != ["link", "link_id"] or not hasattr(pb, "get_audio_link_state"):
        _log_host("gcall control window floor skipped: bridge names changed")
        return False

    def _configure_group_audio_control_channel(link, link_id, *args, **kwargs):
        result = original(link, link_id, *args, **kwargs)
        try:
            _apply_gcall_channel_window_floor(pb, link_id)
        except Exception as exc:  # noqa: BLE001 - keep RNS's own window
            _log_host(f"gcall-control window floor failed: {str(exc)[:120]}")
        return result

    setattr(_configure_group_audio_control_channel, _GCALL_WINDOW_FLOOR_HOOK_FLAG, True)
    _configure_group_audio_control_channel.__wrapped__ = original
    pb._configure_group_audio_control_channel = _configure_group_audio_control_channel
    return True


def _gcall_control_hook_problems(pb):
    """Which slow-link hooks are not in place (empty = all of them)."""
    problems = []
    for name in (
        "handle_send_group_audio_link_control",
        "_send_group_audio_control_bundle_task",
        "_send_group_audio_control_bundle",
        "_send_group_audio_control_channel_message",
        "emit_audio_link_closed",
    ):
        if not getattr(getattr(pb, name, None), _GCALL_CONTROL_HOOK_FLAG, False):
            problems.append(f"{name} not hooked")
    configure = getattr(pb, "_configure_group_audio_control_channel", None)
    if not getattr(configure, _GCALL_WINDOW_FLOOR_HOOK_FLAG, False):
        problems.append("_configure_group_audio_control_channel not hooked")
    sample = {
        "timestamp": 1_700_000_000_000,
        "signalType": "offer",
        "toAddress": "Qpeer",
        "payload": json.dumps({"kind": "screen-description", "generation": "g"}),
    }
    deflater = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    raw = deflater.compress(json.dumps(sample).encode("utf-8")) + deflater.flush()
    if _gcall_signed_at(raw, now=1_700_000_005.0) != 1_700_000_000.0:
        problems.append("signed timestamp round trip failed")
    if _gcall_signal_variant(_gcall_inflate_signal(raw)) != (
        "screen-description",
        "screen-description:Qpeer",
    ):
        problems.append("signal variant round trip failed")
    return problems


def _run_gcall_control_self_check(pb):
    global _gcall_self_check
    problems = _gcall_control_hook_problems(pb)
    if not problems:
        problems = _gcall_control_problems(pb)
    _gcall_self_check = {"ok": not problems, "problems": problems[:8]}
    if problems:
        _log_host("GCALL CONTROL SLOW-LINK SELF-CHECK FAILED: " + "; ".join(problems[:6]))
    else:
        _log_host("gcall control slow-link hooks ready (deadline, window floor, latest wins)")
    return not problems


def _gcall_control_detail():
    out = dict(_gcall_stats)
    if _gcall_self_check is not None:
        out["selfCheckOk"] = bool(_gcall_self_check.get("ok"))
        if _gcall_self_check.get("problems"):
            out["selfCheckProblems"] = list(_gcall_self_check["problems"])
    return out


def _json_audio_detail():
    out = dict(_json_audio_stats)
    if _json_audio_self_check is not None:
        out["selfCheckOk"] = bool(_json_audio_self_check.get("ok"))
        if _json_audio_self_check.get("problems"):
            out["selfCheckProblems"] = list(_json_audio_self_check["problems"])
    if _json_audio_last_error:
        out["lastError"] = _json_audio_last_error
    return out


def _remove_pid_log_files(config_dir):
    """Delete RNS logs from earlier launches (logfile.bridge.<pid>[.1])."""
    prefix = "logfile.bridge."
    try:
        names = os.listdir(config_dir)
    except OSError:
        return
    for name in names:
        if not name.startswith(prefix):
            continue
        rest = name[len(prefix):]
        if rest.endswith(".1"):
            rest = rest[:-2]
        if not rest.isdigit():
            continue
        try:
            os.remove(os.path.join(config_dir, name))
        except OSError:
            pass


def start(config_dir):
    """Initialise stdio shims + RNS config and launch the bridge main loop."""
    global _started, _stdin_shim, _main_thread
    with _lock:
        if _started:
            return True
        _write_reticulum_config(config_dir)
        os.environ["QORTAL_RETICULUM_CONFIG_DIR"] = config_dir
        os.environ.setdefault(
            "QORTAL_RNS_LOG_FILE", os.path.join(config_dir, "logfile.bridge.go")
        )
        _remove_pid_log_files(config_dir)
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
        _install_json_audio_io(pb)
        _install_call_heartbeat_lane(pb)
        _run_json_audio_self_check(pb)
        # WebRTC signalling that survives a slow mobile uplink.
        _install_gcall_control_window_floor(pb)
        _install_gcall_control_bundles(pb)
        _run_gcall_control_self_check(pb)
        _apply_mobile_overlay_limits(pb)
        _install_overlay_profile_command(pb)
        _install_scheduled_presence_heartbeats(pb)
        _install_network_pause_gates(pb)
        _install_community_stun_query_throttle(pb)

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
    """Submit one command frame (JSON string) to the bridge's stdin.

    ``send_group_audio`` (call audio and link control, up to 50 frames a
    second each way) is queued for the RNS executor right here instead.
    """
    if _stdin_shim is None:
        return
    if _SEND_GROUP_AUDIO_MARKER in line and _feed_send_group_audio(line):
        return
    _stdin_shim.feed(line)


def poll(timeout_ms=250):
    """Return one outbound JSON frame, or "" if none arrived within timeout."""
    try:
        return _out_queue.get(timeout=max(0, timeout_ms) / 1000.0)
    except queue.Empty:
        return ""


def transport_status(detail=False):
    """Snapshot of the bridge's own RNS hub interfaces, as a JSON string.

    The Kotlin plugin used to run a second, independent Reticulum stack
    (reticulum-kt) purely so the status badge had something to report. That
    stack held two more TCP sockets to the hubs, ran its own keepalives and
    decrypted every announce on the mesh a second time. Reading the counters
    off this instance costs one GIL acquisition per poll instead.

    ``detail`` (Copy diagnostics only, never the badge poll) adds
    ``result["bridge"]`` from :func:`_bridge_detail`. It is a direct call,
    not a lane command: nothing is queued and no bridge lock is taken.
    """
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
    if detail:
        try:
            result["bridge"] = _bridge_detail()
        except Exception as exc:  # noqa: BLE001 - diagnostics are best effort
            result["bridge"] = {"error": str(exc)[:160]}
    return json.dumps(result)


_TASK_LABEL_HEX = frozenset("0123456789abcdefABCDEF")
_BRIDGE_LANE_KEYS = (
    "lane",
    "queueDepth",
    "queueDepthHighWater",
    "queueMax",
    "dwellMsMax",
    "busyMsMax",
    "droppedTasks",
    "slowTaskCount",
    "completedTasks",
)


def _task_label_part_is_word(part):
    """A plain lower-case word (a command action or a reason), not an id."""
    if not part or len(part) > 40 or not ("a" <= part[0] <= "z"):
        return False
    if len(part) >= 6 and all(c in _TASK_LABEL_HEX for c in part):
        return False
    return all(("a" <= c <= "z") or c in "_-" for c in part)


def _task_label(name):
    """A lane task name without the ids some names carry.

    Names such as ``overlay-open:<reason>:<peer prefix>`` or
    ``<traffic>:<envelope id>:<peer prefix>`` hold id prefixes. Copy
    diagnostics keeps the kind, plus the second part only when it is a plain
    word (``cmd:send_reticulum_chat``, ``overlay-open:announce``).
    """
    parts = str(name or "").split(":")
    head = parts[0][:32]
    # The kind is a fixed name ("cmd", "rns-packet", "presence_announce_replay",
    # "land-state-forward-3"); anything else is replaced, not shown.
    words = head.replace("_", "-").split("-")
    if not all(
        _task_label_part_is_word(word) or (word.isdigit() and len(word) <= 3)
        for word in words
    ):
        head = "task"
    if len(parts) > 1 and _task_label_part_is_word(parts[1]):
        return f"{head}:{parts[1]}"[:48]
    return head


def _bridge_detail():
    """Read-only bridge counters for Copy diagnostics.

    Never takes ``_state_lock`` (a stall may be holding it), never imports
    presence_bridge (only reads it when start() already did) and sends
    nothing. ``_scheduler_diagnostics`` takes only its leaf stats lock.
    Lane maxima and high-water marks count since the bridge started, which
    outlives the page.
    """
    out = {}
    rns = sys.modules.get("RNS")
    start_time = (
        getattr(getattr(rns, "Transport", None), "start_time", None) if rns else None
    )
    if start_time:
        try:
            out["transportStartedAtMs"] = int(float(start_time) * 1000)
        except (TypeError, ValueError):
            pass
    pb = sys.modules.get("presence_bridge")
    if pb is None:
        return out
    now = time.monotonic()
    lanes = []
    for stats in pb._scheduler_diagnostics():
        lane = {key: stats.get(key) for key in _BRIDGE_LANE_KEYS}
        task = str(stats.get("currentTask") or "")
        started = float(stats.get("currentTaskStartedAt") or 0.0)
        if task and started > 0:
            lane["currentTask"] = _task_label(task)
            lane["runningMs"] = max(0, int((now - started) * 1000))
        busy_task = str(stats.get("busyMaxTask") or "")
        if busy_task:
            lane["busyMaxTask"] = _task_label(busy_task)
        lanes.append(lane)
    out["lanes"] = lanes
    for attr, key in (
        ("_cmd_queue_bounded", "cmdQueue"),
        ("_json_event_queue", "eventQueue"),
        ("_json_priority_event_queue", "priorityEventQueue"),
        ("_json_resp_queue", "respQueue"),
    ):
        q = getattr(pb, attr, None)
        if q is not None:
            out[key] = q.qsize()
    out["cmdQueueMax"] = getattr(pb, "_CMD_QUEUE_MAX", None)
    last = float(getattr(pb, "_rns_executor_last_loop_at", 0.0) or 0.0)
    if last > 0:
        out["executorIdleMs"] = max(0, int((now - last) * 1000))
    out["gilLagMsMax"] = float(getattr(pb, "_gil_probe_lag_ms_max", 0.0) or 0.0)
    waiters = getattr(pb, "_resource_session_provider_waiters", None)
    if waiters is not None:
        # len() is atomic under the GIL; no lock.
        out["providerPendingAuth"] = len(waiters)
    refused = getattr(pb, "_provider_refused_counts", None)
    if isinstance(refused, dict):
        out["providerRefused"] = {
            str(k): int(v or 0) for k, v in dict(refused).items()
        }
    out["jsonOutDrops"] = int(getattr(pb, "_audio_drops_json_out", 0) or 0)
    out["callAudioIo"] = _json_audio_detail()
    out["gcallControl"] = _gcall_control_detail()
    _bridge_detail_process(out, pb, rns)
    return out


def _bridge_detail_process(out, pb, rns):
    """Thread, link, queue, fd and CPU counters for Copy diagnostics.

    Each read is lock-free and on its own: a failure costs its key only. The
    /proc reads happen here, so only when diagnostics are copied.
    """
    try:
        out["threadCount"] = threading.active_count()
    except Exception:
        pass
    try:
        out["outQueue"] = _out_queue.qsize()
        out["outQueueHighWater"] = int(_out_queue_high_water)
        out["outQueueDrops"] = int(_out_queue_drops)
    except Exception:
        pass
    try:
        out["openFds"] = len(os.listdir("/proc/self/fd"))
    except Exception:
        pass
    try:
        cpu = _process_cpu_detail()
        if cpu:
            out.update(cpu)
    except Exception:
        pass
    try:
        links = _bridge_link_counts(pb, rns)
        if links:
            out["links"] = links
    except Exception:
        pass
    try:
        out["rejectedResourceWatchdogs"] = _rejected_resource_watchdogs(rns)
    except Exception:
        pass
    try:
        refused = getattr(pb, "_provider_refused_by_busy_kind", None)
        if isinstance(refused, dict):
            out["providerRefusedByBusyKind"] = {
                str(k)[:48]: int(v or 0) for k, v in list(refused.items())[:32]
            }
    except Exception:
        pass


def _process_cpu_detail():
    """Process CPU ticks (utime+stime) in total and since the last read."""
    global _process_cpu_prev
    with open("/proc/self/stat", "rb") as fh:
        raw = fh.read().decode("ascii", "replace")
    # comm may contain spaces; the fields after the closing paren are stable.
    rest = raw[raw.rfind(")") + 2 :].split()
    ticks = int(rest[11]) + int(rest[12])
    try:
        hz = int(os.sysconf("SC_CLK_TCK")) or 100
    except (ValueError, OSError, AttributeError):
        hz = 100
    now = time.monotonic()
    result = {"processCpuMs": int(ticks * 1000 / hz)}
    prev = _process_cpu_prev
    _process_cpu_prev = (ticks, now)
    if prev is not None and now > prev[1]:
        result["processCpuDeltaMs"] = int(max(0, ticks - prev[0]) * 1000 / hz)
        result["processCpuWindowMs"] = int((now - prev[1]) * 1000)
    return result


def _bridge_link_counts(pb, rns):
    """Open links by kind; resource sessions by direction and lane."""
    links = {}
    for attr, key in (
        ("_overlay_links_by_id", "overlay"),
        ("_audio_links_by_id", "audio"),
        ("_pending_inbound_classify_link_ids", "inboundHandshakes"),
    ):
        value = getattr(pb, attr, None)
        if value is not None:
            links[key] = len(value)
    files = getattr(pb, "_qchat_file_links_by_id", None)
    if files is not None:
        sessions = {}
        other = 0
        # list() copies the values in one step under the GIL; no lock.
        for state in list(files.values()):
            if not isinstance(state, dict):
                continue
            if state.get("manager_kind") != "resource_session":
                other += 1
                continue
            direction = "in" if state.get("incoming") is True else "out"
            lane = str(state.get("sessionLane") or "none").strip().lower()[:16]
            if not lane.replace("_", "").replace("-", "").isalnum():
                lane = "other"
            key = f"{direction}:{lane}"
            sessions[key] = sessions.get(key, 0) + 1
        links["resourceSessions"] = sessions
        links["fileLinks"] = other
    transport = getattr(rns, "Transport", None) if rns else None
    if transport is not None:
        for attr, key in (("active_links", "rnsActive"), ("pending_links", "rnsPending")):
            value = getattr(transport, attr, None)
            if value is not None:
                links[key] = len(value)
    return links


def _rejected_resource_watchdogs(rns):
    """Threads still running the watchdog of a Resource that was rejected.

    Before REJECTED had its own value (see _patch_rns_resource_rejected) a
    rejected resource's watchdog spun forever; this counts any left.
    """
    resource_cls = getattr(rns, "Resource", None) if rns else None
    if not isinstance(resource_cls, type):
        return 0
    rejected = getattr(resource_cls, "REJECTED", None)
    if rejected is None:
        return 0
    count = 0
    for thread in threading.enumerate():
        owner = getattr(getattr(thread, "_target", None), "__self__", None)
        if isinstance(owner, resource_cls) and getattr(owner, "status", None) == rejected:
            count += 1
    return count


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
        interface._qortal_dialed_at = time.monotonic()
        if _network_paused or generation != _network_generation:
            _drop_stale_socket(interface, sock)
            return None
        return sock


def _forget_socket(interface, sock):
    """Take ``sock`` out of the Backbone I/O loop; it stays open."""
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


def _close_quietly(sock):
    if sock is None:
        return
    try:
        sock.close()
    except Exception:
        pass


def _drop_stale_socket(interface, sock):
    """Close ``sock``, which a stale dial opened; hold the interface lock."""
    if sock is None:
        return
    _forget_socket(interface, sock)
    if interface.socket is sock:
        if _network_paused:
            _detach_for_pause(interface)
        else:
            # A newer resume owns the interface and dials it next.
            interface.online = False
            interface.socket = None
    _close_quietly(sock)


def _emit_transport_state():
    try:
        import presence_bridge as pb

        pb.maybe_emit_transport_state(force=True)
    except Exception:
        pass


def pause_network():
    """Take the hub sockets down while no GO screen needs the mesh.

    Kotlin calls this on the dataSync time-out, when GO is swiped from recents
    and after logout. Just ending the command loop is not enough there: RNS
    would keep its hub sockets, links and keepalives running with
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

    # Swipe-away, logout or the background time-out: the page that signed
    # heartbeats in advance is not coming back as it was (the next login
    # signs its own), so none of them may go out after a resume.
    _replace_scheduled_heartbeats([])

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


def _reattach_interface(interface, generation, after_first_dial=None):
    import RNS

    sock = None
    try:
        sock = _connect_current(interface, generation, initial=True)
    except Exception as exc:  # noqa: BLE001 - falls back to the retry loop
        _log_host(f"reconnect failed for {interface}: {exc}")
    finally:
        if after_first_dial is not None:
            after_first_dial()
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


def _refresh_interface(interface, generation):
    """Close one hub socket and dial it again at once (see refresh_network)."""
    with _interface_lock(interface):
        if _network_paused or generation != _network_generation:
            return
        # Offline first, so nothing queues data for the old socket; then out
        # of the Backbone I/O loop, so the loop starts no backed-off redial of
        # its own. The old socket stays open until the new one is dialled:
        # closing it first would let the new socket reuse its fd number while
        # the I/O loop may still hold an event for that number.
        interface.online = False
        old_socket = getattr(interface, "socket", None)
        _forget_socket(interface, old_socket)
        interface.socket = None
        # A reconnect loop from before the switch may still be asleep in its
        # backoff; the newer generation makes it give up when it wakes.
        interface.reconnecting = False
        interface.frame_buffer = b""
        interface.transmit_buffer = b""
        # A socket error under the I/O loop tears an interface down (IN and
        # OUT False) for good; every GO hub interface is configured both ways.
        interface.IN = True
        interface.OUT = True
    _reattach_interface(
        interface, generation, after_first_dial=lambda: _close_quietly(old_socket)
    )


def refresh_network(reason="network_change", since_switch_seconds=0.0):
    """Redial the hub sockets now, after the phone switched networks.

    Moving between Wi-Fi and mobile data leaves the hub sockets on a network
    that is gone, or still up but no longer the default (Wi-Fi without
    internet). TCP keepalive notices a silent one only after 45 s plus four
    15 s probes, and the reconnect loop then waits out its 5-60 s backoff, so
    chat could stay deaf for about two minutes. Kotlin calls this once the
    default network has settled.

    Hub sockets dialled after the switch are on the new network already and
    are left alone. Every RNS link through a hub that is redialled is torn
    down first: a hub only forwards link traffic that arrives on the exact
    connection the link came in on, so those links are dead even though the
    phone still counts them as up. The overlay maintenance that follows the
    first hub back dials the neighbours again at once. Hubs that are offline
    (waiting in their backoff) are dialled now as well.

    The dials run on one thread per hub, so a dial stuck in DNS never blocks
    the caller. Returns how many hubs are being redialled.
    """
    global _network_generation
    import RNS

    with _lock:
        if not _started or _network_paused:
            return 0
        if not getattr(RNS.Transport, "ready", False):
            # RNS is still building its interfaces; they dial on their own.
            return 0
        cutoff = time.monotonic() - max(0.0, float(since_switch_seconds or 0.0))
        targets = []
        replaced = []
        for interface in list(getattr(RNS.Transport, "interfaces", []) or []):
            if not getattr(interface, "initiator", False):
                continue
            if getattr(interface, "detached", False):
                continue
            if getattr(interface, "online", False):
                if getattr(interface, "_qortal_dialed_at", 0.0) >= cutoff:
                    continue
                replaced.append(interface)
            targets.append(interface)
        if not targets:
            return 0
        _network_generation += 1
        generation = _network_generation

    closed = 0
    if replaced:
        replaced_ids = {id(interface) for interface in replaced}
        links = list(getattr(RNS.Transport, "active_links", []) or [])
        links += list(getattr(RNS.Transport, "pending_links", []) or [])
        for link in links:
            attached = getattr(link, "attached_interface", None)
            if attached is not None and id(attached) not in replaced_ids:
                continue
            try:
                link.teardown()
                closed += 1
            except Exception:
                pass
        if closed:
            # Same window pause_network() gives teardown packets.
            time.sleep(0.15)

    for interface in targets:
        threading.Thread(
            target=_refresh_interface,
            args=(interface, generation),
            name="presence-host-refresh",
            daemon=True,
        ).start()
    _log_host(
        f"network refresh reason={reason} interfaces={len(targets)} "
        f"replaced={len(replaced)} links_closed={closed}"
    )
    return len(targets)
