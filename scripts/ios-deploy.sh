#!/usr/bin/env bash
# Build the iOS app and install it on a connected device via ios-deploy.
#
# One-time prerequisites (not handled here):
#   npm run tauri ios init          # generates src-tauri/gen/apple
#   open the Xcode project once and configure your signing team
#   brew install ios-deploy         # (or: npm install -g ios-deploy)
#
# Usage:
#   npm run ios:deploy                        # build, install, launch
#   npm run ios:deploy -- --no-build          # reuse the previous .ipa
#   npm run ios:deploy -- --device <udid>     # target a specific device
#   npm run ios:deploy -- --debug             # launch with lldb attached
#   npm run ios:deploy -- --install-only      # install without launching
#   npm run ios:deploy -- --export-method release-testing
#
# List connected devices/UDIDs with:  ios-deploy --detect
# The export method defaults to "debugging" (development signing), which is
# what direct-to-device installs need; override with --export-method or the
# IOS_EXPORT_METHOD env var.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=1
LAUNCH_FLAG="--justlaunch"
DEVICE_ARGS=()
EXPORT_METHOD="${IOS_EXPORT_METHOD:-debugging}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --debug) LAUNCH_FLAG="--debug" ;;
    --install-only) LAUNCH_FLAG="" ;;
    --device)
      shift
      [[ $# -gt 0 ]] || { echo "--device needs a UDID" >&2; exit 2; }
      DEVICE_ARGS=(--id "$1")
      ;;
    --export-method)
      shift
      [[ $# -gt 0 ]] || { echo "--export-method needs a value" >&2; exit 2; }
      EXPORT_METHOD="$1"
      ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

if [[ "$(uname)" != "Darwin" ]]; then
  echo "✗ iOS builds require macOS + Xcode." >&2
  exit 1
fi
if ! command -v ios-deploy >/dev/null 2>&1; then
  echo "✗ ios-deploy not found. Install it with:" >&2
  echo "    brew install ios-deploy    (or: npm install -g ios-deploy)" >&2
  exit 1
fi
if [[ ! -d src-tauri/gen/apple ]]; then
  echo "✗ src-tauri/gen/apple missing — run 'npm run tauri ios init' first." >&2
  exit 1
fi

if [[ $BUILD -eq 1 ]]; then
  echo "▸ building (tauri ios build --export-method $EXPORT_METHOD)"
  npx --no-install tauri ios build --export-method "$EXPORT_METHOD"
fi

# Tauri writes the signed .ipa under src-tauri/gen/apple/build/<arch>/;
# pick the most recent one (filenames may contain spaces).
IPA=$(find src-tauri/gen/apple/build -type f -name '*.ipa' -print0 2>/dev/null \
  | xargs -0 ls -t 2>/dev/null | head -n 1 || true)
if [[ -z "$IPA" ]]; then
  echo "✗ no .ipa found under src-tauri/gen/apple/build — did the build succeed?" >&2
  exit 1
fi

echo "▸ installing '$IPA' via ios-deploy"
# shellcheck disable=SC2086  # LAUNCH_FLAG is intentionally a single optional token
ios-deploy ${DEVICE_ARGS[@]+"${DEVICE_ARGS[@]}"} $LAUNCH_FLAG --bundle "$IPA"
echo "✓ deployed to device"
