#!/usr/bin/env bash
# Fetches llama.cpp sources required to build the QortinoLlm native plugin.
# Pinned to the commit GO ships (ggml 0.17.0), so every checkout builds the same engine.
set -euo pipefail
LLAMA_REPO="https://github.com/ggml-org/llama.cpp.git"
LLAMA_COMMIT="fb92d8f1873c96ec63f9c59721d58a55bf46d441"
ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="$ROOT/llama.cpp"
if [[ -d "$TARGET/.git" ]]; then
  # No commit yet means an earlier fetch was cut off: fetch again below.
  HAVE="$(git -C "$TARGET" rev-parse -q --verify 'HEAD^{commit}' || true)"
  if [[ "$HAVE" == "$LLAMA_COMMIT" ]]; then
    echo "llama.cpp already present at $TARGET ($LLAMA_COMMIT)"
    exit 0
  fi
  if [[ -n "$HAVE" ]]; then
    echo "llama.cpp at $TARGET is at $HAVE, expected $LLAMA_COMMIT" >&2
    echo "Switch with: git -C \"$TARGET\" fetch --depth 1 $LLAMA_REPO $LLAMA_COMMIT && git -C \"$TARGET\" checkout --detach FETCH_HEAD" >&2
    exit 1
  fi
fi
git init -q "$TARGET"
git -C "$TARGET" fetch --depth 1 "$LLAMA_REPO" "$LLAMA_COMMIT"
git -C "$TARGET" checkout -q --detach FETCH_HEAD
echo "Fetched llama.cpp $LLAMA_COMMIT into $TARGET"
