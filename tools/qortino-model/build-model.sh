#!/usr/bin/env bash
# Rebuild the Qortino AI model parts published on QDN, from the official
# Qwen3-4B-Instruct-2507 weights, with the llama.cpp commit GO ships.
#
#   tools/qortino-model/build-model.sh <work-dir> <out-dir>
#
# The three-part layout goes to <out-dir>/public-node.
#
# Steps: download the weights at a pinned revision (LFS sha256 checked) →
# convert to GGUF BF16 → quantize to Q4_K_M (no imatrix, so the result is
# reproducible byte for byte) → split into two parts under QDN's 2 GiB file
# limit, and into three parts under 1 GiB for the public node (it cuts any
# single download near 1 GiB) → print sizes and sha256 for
# src/qortinoAgent/manifest.ts.
#
# Needs: git, curl, python3 with `uv`, a C++ toolchain, cmake + ninja (the
# Android SDK's copies work), ~25 GB free in <work-dir>.
set -euo pipefail

WORK="$(realpath -m "${1:?work dir}")"
OUT="$(realpath -m "${2:?output dir}")"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LLAMA="$ROOT/android/app/src/main/cpp/llama.cpp"
REPO="Qwen/Qwen3-4B-Instruct-2507"
REV="cdbee75f17c01a7cc42f958dc650907174af0554"
NAME="qortino-qwen3-4b-2507-q4km"
# M = 1,000,000 bytes: two parts of ≤1.3 GB, far below QDN's 2 GiB limit.
SPLIT_MAX="1300M"
# Three parts of ≤900 MB (QORTINO_MODEL_PUBLIC_NODE), each under 1 GiB.
SPLIT_MAX_PUBLIC="900M"
CMAKE="${CMAKE:-$(command -v cmake || echo "$HOME/android-sdk/cmake/3.22.1/bin/cmake")}"
NINJA="${NINJA:-$(command -v ninja || echo "$HOME/android-sdk/cmake/3.22.1/bin/ninja")}"

mkdir -p "$WORK/hf" "$OUT"
"$ROOT/android/app/src/main/cpp/fetch-llama.sh"

echo "== weights ($REPO @ $REV)"
curl -fsS "https://huggingface.co/api/models/$REPO/tree/$REV" | python3 -c '
import json, sys
for f in json.load(sys.stdin):
    print(f["path"], f.get("size", 0), (f.get("lfs") or {}).get("oid", ""))
' > "$WORK/hf-files.txt"
while read -r path size sha; do
  case "$path" in .gitattributes|README.md) continue ;; esac
  if [[ ! -f "$WORK/hf/$path" || "$(stat -c %s "$WORK/hf/$path")" != "$size" ]]; then
    curl -fL --retry 5 -C - -s -o "$WORK/hf/$path" \
      "https://huggingface.co/$REPO/resolve/$REV/$path"
  fi
  if [[ -n "$sha" ]]; then
    echo "$sha  $WORK/hf/$path" | sha256sum -c --quiet
  fi
done < "$WORK/hf-files.txt"

echo "== llama.cpp tools"
"$CMAKE" -S "$LLAMA" -B "$WORK/llama-host" -G Ninja -DCMAKE_MAKE_PROGRAM="$NINJA" \
  -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_SERVER=OFF > "$WORK/llama-host.log"
"$CMAKE" --build "$WORK/llama-host" -j "$(nproc)" \
  --target llama-quantize llama-gguf-split >> "$WORK/llama-host.log"

echo "== convert"
if [[ ! -x "$WORK/venv/bin/python" ]]; then
  uv venv --python 3.12 "$WORK/venv"
  uv pip install --python "$WORK/venv/bin/python" \
    --index-url https://download.pytorch.org/whl/cpu "torch==2.11.0+cpu"
  uv pip install --python "$WORK/venv/bin/python" "numpy~=1.26.4" \
    "sentencepiece>=0.1.98,<0.3.0" "transformers==4.57.6" "protobuf>=4.21.0,<5.0.0"
fi
BF16="$WORK/qwen3-4b-instruct-2507-bf16.gguf"
PYTHONPATH="$LLAMA/gguf-py" "$WORK/venv/bin/python" "$LLAMA/convert_hf_to_gguf.py" \
  "$WORK/hf" --outtype bf16 --outfile "$BF16"

echo "== quantize + split"
Q4="$WORK/$NAME.gguf"
"$WORK/llama-host/bin/llama-quantize" "$BF16" "$Q4" Q4_K_M "$(nproc)"
rm -f "$OUT/$NAME"-*.gguf
"$WORK/llama-host/bin/llama-gguf-split" --split --split-max-size "$SPLIT_MAX" "$Q4" "$OUT/$NAME"

echo "== parts (paste into QORTINO_MODEL.parts)"
( cd "$OUT" && for f in "$NAME"-*.gguf; do
    printf '%s  %s bytes  sha256 %s\n' "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
  done )
( cd "$OUT" && sha256sum "$NAME"-*.gguf > SHA256SUMS )

echo "== public node parts (paste into QORTINO_MODEL_PUBLIC_NODE.parts)"
mkdir -p "$OUT/public-node"
rm -f "$OUT/public-node/$NAME"-*.gguf
"$WORK/llama-host/bin/llama-gguf-split" --split --split-max-size "$SPLIT_MAX_PUBLIC" "$Q4" "$OUT/public-node/$NAME"
( cd "$OUT/public-node" && for f in "$NAME"-*.gguf; do
    printf '%s  %s bytes  sha256 %s\n' "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
  done )
( cd "$OUT/public-node" && sha256sum "$NAME"-*.gguf > SHA256SUMS )
