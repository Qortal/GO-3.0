#!/usr/bin/env bash
# Fetches llama.cpp sources required to build the QortinoLlm native plugin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="$ROOT/llama.cpp"
if [[ -d "$TARGET/.git" ]]; then
  echo "llama.cpp already present at $TARGET"
  exit 0
fi
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$TARGET"
echo "Cloned llama.cpp into $TARGET"
