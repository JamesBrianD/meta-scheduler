#!/usr/bin/env bash
# Install meta-scheduler supervisor as a macOS LaunchAgent.
#
# Usage:
#   scripts/install-supervisor.sh            # install + load
#   scripts/install-supervisor.sh uninstall  # unload + remove

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_NAME="com.meta-scheduler.supervisor.plist"
TARGET="$HOME/Library/LaunchAgents/$PLIST_NAME"
SOURCE="$REPO_DIR/scripts/$PLIST_NAME"

cmd="${1:-install}"

case "$cmd" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.meta-scheduler"
    sed -e "s|__REPO_DIR__|$REPO_DIR|g" -e "s|__HOME__|$HOME|g" "$SOURCE" > "$TARGET"
    launchctl unload "$TARGET" 2>/dev/null || true
    launchctl load "$TARGET"
    echo "✓ installed → $TARGET"
    echo "  logs: $HOME/.meta-scheduler/supervisor.{out,err}.log"
    echo "  dashboard: http://127.0.0.1:7421/"
    echo
    echo "Restart logic is OFF by default. To enable:"
    echo "  edit $TARGET → set RESTART_ENABLED to true → launchctl unload && launchctl load"
    ;;
  uninstall)
    launchctl unload "$TARGET" 2>/dev/null || true
    rm -f "$TARGET"
    echo "✓ uninstalled"
    ;;
  status)
    launchctl list | grep meta-scheduler || echo "(not loaded)"
    ;;
  *)
    echo "usage: $0 [install|uninstall|status]" >&2
    exit 1
    ;;
esac
