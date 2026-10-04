#!/usr/bin/env bash
# Checks what a built APK packages from the web bundle (GO-40). Fails when a
# release APK still holds source maps or debug pages, or when index.html or
# any file it loads is missing. Release builds run the same map and debug-page
# check themselves (task verifyReleaseApkWebAssets); this script is for an APK
# from somewhere else, and also checks every file index.html loads.
#
#   android/app/release-web-assets-test/check-apk.sh app/build/outputs/apk/release/app-release.apk
#
# A debug APK fails the first two checks on purpose: it keeps everything.
set -euo pipefail

apk="${1:?usage: check-apk.sh path/to/app.apk}"
listing="$(unzip -Z1 "$apk")"

maps="$(grep -E '^assets/public/.*\.map$' <<<"$listing" || true)"
debug="$(grep -E '^assets/public/(qortino-debug\.html|audio-surface\.html|pdfjs/web/)' <<<"$listing" || true)"
# The debug pages' entry chunks. The build keeps one when the app itself
# names it, so this is only a warning.
entry_chunks="$(grep -E '^assets/public/assets/(audioSurface|qortinoDebug)-[^/]*\.js$' <<<"$listing" || true)"
count() { if [ -z "$1" ]; then echo 0; else wc -l <<<"$1" | tr -d ' '; fi; }

# A page URL as a path under assets/public, by the rules of localWebPath() in
# ../release-web-assets.gradle; returns 1 for anything that is not a plain
# local path (a scheme, '//host', '..', an empty or '#' link).
local_path() {
  local u="$1"
  u="${u#"${u%%[![:space:]]*}"}"
  u="${u%"${u##*[![:space:]]}"}"
  u="${u%%#*}"
  u="${u%%\?*}"
  case "$u" in '' | *:* | //* | *..*) return 1 ;; esac
  while [[ "$u" == ./* ]]; do u="${u#./}"; done
  while [[ "$u" == /* ]]; do u="${u#/}"; done
  [ -n "$u" ] || return 1
  printf '%s\n' "$u"
}

problems=0
echo "source maps:            $(count "$maps")"
echo "debug pages and files:  $(count "$debug")"
if [ -n "$maps" ] || [ -n "$debug" ]; then problems=$((problems + 1)); fi
if [ -n "$debug" ]; then head -n 5 <<<"$debug" | sed 's/^/  /'; fi
if [ -n "$entry_chunks" ]; then
  echo "warning: debug page entry chunks packaged (fine only if the app imports them):"
  sed 's/^/  /' <<<"$entry_chunks"
fi

if grep -qxF 'assets/public/index.html' <<<"$listing"; then
  echo "index.html:             packaged"
  while IFS= read -r ref; do
    path="$(local_path "$ref")" || continue
    if ! grep -qxF "assets/public/$path" <<<"$listing"; then
      echo "  index.html loads $ref, which is not packaged"
      problems=$((problems + 1))
    fi
  done < <(unzip -p "$apk" assets/public/index.html \
    | grep -oiE "(src|href)[[:space:]]*=[[:space:]]*(\"[^\"]*\"|'[^']*')" \
    | sed -E 's/^[^=]*=[[:space:]]*.//; s/.$//' || true)
else
  echo "index.html:             MISSING"
  problems=$((problems + 1))
fi

if [ "$problems" -gt 0 ]; then
  echo "FAIL: not a clean release APK"
  exit 1
fi
echo "OK: no source maps or debug pages; index.html and everything it loads are packaged"
