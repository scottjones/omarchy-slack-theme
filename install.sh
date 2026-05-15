#!/usr/bin/env bash
# Install the native messaging host manifest for the Omarchy Slack Theme extension.
#
# Usage:
#   ./install.sh <EXTENSION_ID> [--browser brave|chrome|chromium]
#
# Find <EXTENSION_ID> in your browser at chrome://extensions after loading
# the unpacked ./extension/ folder with Developer mode enabled.

set -euo pipefail

EXT_ID="${1:-}"
BROWSER="brave"

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser) BROWSER="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$EXT_ID" ]]; then
  echo "Error: extension ID is required." >&2
  echo "Usage: $0 <EXTENSION_ID> [--browser brave|chrome|chromium]" >&2
  exit 2
fi

if [[ ! "$EXT_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Warning: '$EXT_ID' doesn't look like a Chrome extension ID (expected 32 lowercase letters a-p)." >&2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/native-host/omarchy-theme-host.py"
TEMPLATE="$SCRIPT_DIR/native-host/com.omarchy.slack_theme.json.template"

if [[ ! -x "$HOST_SCRIPT" ]]; then
  chmod +x "$HOST_SCRIPT" || true
fi

case "$BROWSER" in
  brave)    DEST_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
  chrome)   DEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
  chromium) DEST_DIR="$HOME/.config/chromium/NativeMessagingHosts" ;;
  *) echo "Unknown browser: $BROWSER" >&2; exit 2 ;;
esac

mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/com.omarchy.slack_theme.json"

sed \
  -e "s|__HOST_PATH__|$HOST_SCRIPT|g" \
  -e "s|__EXTENSION_ID__|$EXT_ID|g" \
  "$TEMPLATE" > "$DEST"

echo "Installed native messaging host manifest:"
echo "  $DEST"
echo "  → script: $HOST_SCRIPT"
echo "  → extension: $EXT_ID"
echo
echo "Restart $BROWSER to pick up the new manifest, then visit app.slack.com."
