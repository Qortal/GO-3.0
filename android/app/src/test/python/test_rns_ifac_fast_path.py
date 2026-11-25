"""IFAC masking and HKDF in the vendored RNS (backport of RNS 1.5.5).

Every packet to and from a Qortal hub is masked with an interface access
code. RNS 1.3.4 did that with a Python loop over every byte and a new HMAC
object per 32 bytes of key, which cost a slow phone 3-6 ms per packet. The
vendored copy carries upstream's faster versions; these checks hold them to
the bytes of the code they replace, kept here as the reference:

    python3 android/app/src/test/python/test_rns_ifac_fast_path.py

It also works under pytest.
"""

import os
import random
import sys
from math import ceil

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "main", "python"))
sys.dont_write_bytecode = True

import RNS  # noqa: E402
from RNS.Cryptography import HMAC  # noqa: E402

SIZES = [2, 3, 15, 16, 17, 18, 19, 31, 32, 33, 64, 100, 219, 365, 465, 500, 1064]


class FakeInterface:
    def __init__(self, ifac_size=16):
        self.ifac_key = os.urandom(64)
        self.ifac_identity = RNS.Identity.from_bytes(self.ifac_key)
        self.ifac_size = ifac_size
        self.sent = []

    def process_outgoing(self, data):
        self.sent.append(data)


def reference_hkdf(length, derive_from, salt, context=None):
    """RNS 1.3.4's hkdf()."""
    if salt is None or len(salt) == 0:
        salt = bytes([0] * 32)
    context = context or b""
    prk = HMAC.new(salt, derive_from).digest()
    block = derived = b""
    for i in range(ceil(length / 32)):
        block = HMAC.new(prk, block + context + bytes([(i + 1) % (0xFF + 1)])).digest()
        derived += block
    return derived[:length]


def reference_mask(interface, raw):
    """RNS 1.3.4's Transport.transmit() up to process_outgoing()."""
    ifac = interface.ifac_identity.sign(raw)[-interface.ifac_size :]
    mask = reference_hkdf(len(raw) + interface.ifac_size, ifac, interface.ifac_key)
    new_raw = bytes([raw[0] | 0x80, raw[1]]) + ifac + raw[2:]
    masked = b""
    for i, byte in enumerate(new_raw):
        if i == 0:
            masked += bytes([byte ^ mask[i] | 0x80])
        elif i == 1 or i > interface.ifac_size + 1:
            masked += bytes([byte ^ mask[i]])
        else:
            masked += bytes([byte])
    return masked


def reference_unmask(interface, raw):
    """RNS 1.3.4's IFAC check in Transport.inbound(); None = packet dropped."""
    size = interface.ifac_size
    ifac = raw[2 : 2 + size]
    mask = reference_hkdf(len(raw), ifac, interface.ifac_key)
    unmasked = b""
    for i, byte in enumerate(raw):
        if i <= 1 or i > size + 1:
            unmasked += bytes([byte ^ mask[i]])
        else:
            unmasked += bytes([byte])
    new_raw = bytes([unmasked[0] & 0x7F, unmasked[1]]) + unmasked[2 + size :]
    expected = interface.ifac_identity.sign(new_raw)[-size:]
    return new_raw if ifac == expected else None


def test_hkdf_matches_rns_1_3_4():
    rng = random.Random(1)
    for length in (1, 16, 31, 32, 33, 64, 219, 481, 1080, 32 * 256, 32 * 300):
        for salt in (None, b"", os.urandom(16), os.urandom(32), os.urandom(64), os.urandom(100)):
            for context in (None, b"", b"ctx", os.urandom(40)):
                ikm = os.urandom(rng.randrange(1, 80))
                assert RNS.Cryptography.hkdf(
                    length=length, derive_from=ikm, salt=salt, context=context
                ) == reference_hkdf(length, ikm, salt, context), (length, salt, context)


def test_hkdf_matches_rfc_5869():
    # RFC 5869 A.1 and A.3 (HKDF-SHA256)
    assert RNS.Cryptography.hkdf(
        length=42,
        derive_from=bytes([0x0B] * 22),
        salt=bytes(range(0x0D)),
        context=bytes(range(0xF0, 0xFA)),
    ).hex() == (
        "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
        "34007208d5b887185865"
    )
    assert RNS.Cryptography.hkdf(
        length=42, derive_from=bytes([0x0B] * 22), salt=b"", context=b""
    ).hex() == (
        "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d"
        "9d201395faa4b61a96c8"
    )


def test_hkdf_still_refuses_bad_input():
    for kwargs in (
        {"length": 0, "derive_from": b"x"},
        {"length": None, "derive_from": b"x"},
        {"length": 32, "derive_from": None},
        {"length": 32, "derive_from": ""},
    ):
        try:
            RNS.Cryptography.hkdf(salt=b"salt", **kwargs)
        except ValueError:
            continue
        raise AssertionError(f"accepted {kwargs}")


def test_outgoing_packets_are_byte_identical():
    for ifac_size in (1, 8, 16, 64):
        interface = FakeInterface(ifac_size)
        for size in SIZES:
            for first in (0x00, 0x01, 0x40, 0x7F):
                raw = bytes([first]) + os.urandom(size - 1)
                RNS.Transport.transmit(interface, raw)
                sent = interface.sent.pop()
                assert sent == reference_mask(interface, raw), (ifac_size, size)
                assert isinstance(sent, bytes) and sent[0] & 0x80


def test_incoming_packets_are_unmasked_the_same():
    for ifac_size in (1, 8, 16, 64):
        interface = FakeInterface(ifac_size)
        for size in SIZES:
            raw = bytes([0x21]) + os.urandom(size - 1)
            masked = reference_mask(interface, raw)
            if len(masked) <= 2 + ifac_size:
                continue  # inbound() drops it before the check
            result = RNS.Transport.handle_ifac(masked, interface)
            assert result == raw == reference_unmask(interface, masked)
            assert isinstance(result, bytes)


def test_packets_with_a_wrong_ifac_are_refused():
    interface = FakeInterface()
    other = FakeInterface()
    raw = bytes([0x21]) + os.urandom(199)
    masked = reference_mask(interface, raw)
    assert RNS.Transport.handle_ifac(masked, other) is None
    for position in (0, 1, 2, 17, 18, 120, len(masked) - 1):
        # Byte 0 keeps the IFAC flag, or inbound() drops it earlier.
        tampered = bytearray(masked)
        tampered[position] ^= 0x01
        tampered = bytes(tampered)
        assert reference_unmask(interface, tampered) is None, position
        assert RNS.Transport.handle_ifac(tampered, interface) is None, position
    for _ in range(50):
        noise = bytes([0x80]) + os.urandom(random.randrange(18, 300))
        assert RNS.Transport.handle_ifac(noise, interface) == reference_unmask(
            interface, noise
        )


def test_inbound_passes_only_authenticated_packets_on():
    """Through the real Transport.inbound(), up to the packet it unpacks."""
    interface = FakeInterface()
    seen = []

    def unpack(packet):
        seen.append(packet.raw)
        return False  # inbound() stops after a packet it cannot unpack

    saved = (
        RNS.Transport.ready,
        RNS.Transport.identity,
        RNS.Packet.unpack,
    )
    RNS.Transport.ready = True
    RNS.Transport.identity = interface.ifac_identity
    RNS.Packet.unpack = unpack
    try:
        raw = bytes([0x21]) + os.urandom(199)
        masked = reference_mask(interface, raw)
        RNS.Transport.inbound(masked, interface)
        assert seen == [raw]
        # Tampered, unflagged and too short packets never reach unpack().
        tampered = masked[:-1] + bytes([masked[-1] ^ 1])
        RNS.Transport.inbound(tampered, interface)
        RNS.Transport.inbound(raw, interface)
        RNS.Transport.inbound(masked[:18], interface)
        assert seen == [raw]
        # Without IFAC on the interface nothing changes.
        plain = FakeInterface()
        plain.ifac_identity = None
        RNS.Transport.inbound(raw, plain)
        assert seen == [raw, raw]
        RNS.Transport.transmit(plain, raw)
        assert plain.sent == [raw]
    finally:
        RNS.Transport.ready, RNS.Transport.identity, RNS.Packet.unpack = saved


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
