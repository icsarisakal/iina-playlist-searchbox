#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
IINA_PLUGIN="${IINA_PLUGIN:-/Applications/IINA.app/Contents/MacOS/iina-plugin}"
"$IINA_PLUGIN" unlink "$ROOT" 2>/dev/null || true
"$IINA_PLUGIN" link "$ROOT"
echo "Linked development plugin. Restart IINA, then enable Playlist Searchbox in Settings → Plugins."
