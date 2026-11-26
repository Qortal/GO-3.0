# Reticulum License
#
# Copyright (c) 2016-2025 Mark Qvist
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# - The Software shall not be used in any kind of system which includes amongst
#   its functions the ability to purposefully do harm to human beings.
#
# - The Software shall not be used, directly or indirectly, in the creation of
#   an artificial intelligence, machine learning or language model training
#   dataset, including but not limited to any use that contributes to the
#   training or development of such a model or algorithm.
#
# - The above copyright notice and this permission notice shall be included in
#   all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import hashlib
from math import ceil
from RNS.Cryptography import HMAC

# Precomputed byte-permutation tables used to key the inner
# and outer hashing states of the HMAC construction
trans_5C = bytes((x ^ 0x5C) for x in range(256))
trans_36 = bytes((x ^ 0x36) for x in range(256))

# Precomputed HKDF counter bytes
_counters = [bytes([(i + 1) % 0x100]) for i in range(0x100)]

# Qortal patch (backport of RNS 1.5.5): keys the HMAC once per derivation
# instead of building a new HMAC object for every 32 bytes of output.
def hkdf(length=None, derive_from=None, salt=None, context=None):
    hash_len = 32
    hash_block_size = 64

    if length == None or length < 1:
        raise ValueError("Invalid output key length")

    if derive_from == None or derive_from == "":
        raise ValueError("Cannot derive key from empty input material")

    if salt == None or len(salt) == 0:
        salt = bytes([0] * hash_len)

    if context == None:
        context = b""

    # The pseudorandom key is always a 32-byte digest, so it never needs the
    # long-key branch of the HMAC key schedule
    pseudorandom_key = HMAC.new(salt, derive_from).digest()
    key = pseudorandom_key.ljust(hash_block_size, b"\x00")
    inner_state = hashlib.sha256(key.translate(trans_36))
    outer_state = hashlib.sha256(key.translate(trans_5C))

    block = b""
    derived = bytearray()

    for i in range(ceil(length / hash_len)):
        inner = inner_state.copy()
        inner.update(block + context + _counters[i & 0xFF])

        outer = outer_state.copy()
        outer.update(inner.digest())

        block = outer.digest()
        derived += block

    return bytes(derived[:length])
