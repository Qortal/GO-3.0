#!/usr/bin/env bash
# Runs ReleaseWebAssetsTest, the tests for ../release-web-assets.gradle and
# check-apk.sh. Run it after any AGP or Gradle upgrade: it checks every AGP
# and Gradle call the script makes against the new versions' API.
#
# Uses the Groovy and JUnit jars inside the Gradle distribution named in
# gradle/wrapper/gradle-wrapper.properties, plus the AGP API jar of the
# version android/build.gradle uses, both from the local Gradle caches. It
# compiles and runs the tests with plain `java`; no Gradle build is started.
# Compiled classes go to app/build/release-web-assets-test (or
# $RELEASE_WEB_ASSETS_TEST_OUT).
#
#   android/app/release-web-assets-test/run.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
android="$(cd "$here/../.." && pwd)"
gradle_home="${GRADLE_USER_HOME:-$HOME/.gradle}"

dist_version="$(sed -n 's#.*/gradle-\([0-9.]*\)-\(all\|bin\)\.zip.*#\1#p' \
  "$android/gradle/wrapper/gradle-wrapper.properties")"
agp_version="$(sed -n "s#.*com\.android\.tools\.build:gradle:\([0-9.]*\)['\"].*#\1#p" \
  "$android/build.gradle")"

lib=""
for candidate in "$gradle_home"/wrapper/dists/gradle-"$dist_version"-*/*/gradle-"$dist_version"/lib; do
  if [ -d "$candidate" ]; then lib="$candidate"; break; fi
done
agp_api=""
for candidate in "$gradle_home"/caches/modules-2/files-2.1/com.android.tools.build/gradle-api/"$agp_version"/*/gradle-api-"$agp_version".jar; do
  if [ -f "$candidate" ]; then agp_api="$candidate"; break; fi
done
if [ -z "$dist_version" ] || [ -z "$agp_version" ] || [ -z "$lib" ] || [ -z "$agp_api" ]; then
  echo "Needs the Gradle ${dist_version:-?} distribution and the AGP ${agp_version:-?} API jar" \
    "in $gradle_home; one normal Gradle build of the app downloads both." >&2
  exit 2
fi

java_bin="java"
if [ -n "${JAVA_HOME:-}" ]; then java_bin="$JAVA_HOME/bin/java"; fi
classpath="$lib/*:$lib/plugins/*:$agp_api"
out="${RELEASE_WEB_ASSETS_TEST_OUT:-$android/app/build/release-web-assets-test}"
mkdir -p "$out"

"$java_bin" -cp "$classpath" org.codehaus.groovy.tools.FileSystemCompiler \
  -d "$out" "$here/ReleaseWebAssetsTest.groovy"
"$java_bin" -cp "$out:$classpath" \
  -Djava.io.tmpdir="${TMPDIR:-/tmp}" \
  -DreleaseWebAssets.script="$android/app/release-web-assets.gradle" \
  -DreleaseWebAssets.checkApk="$here/check-apk.sh" \
  -DreleaseWebAssets.syncedAssets="$android/app/src/main/assets" \
  org.junit.runner.JUnitCore ReleaseWebAssetsTest
