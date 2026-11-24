#!/bin/sh
# Claude Code SessionStart hook.
# Turns on the repository git hooks (.githooks) in this clone.
# It changes nothing when the clone already sets a hooks path or has its
# own hooks in .git/hooks, because core.hooksPath would turn those off.

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -d "$ROOT/.githooks" ] || exit 0
[ -z "$(git -C "$ROOT" config --get core.hooksPath)" ] || exit 0

HOOKS_DIR=$(git -C "$ROOT" rev-parse --git-common-dir)/hooks
case "$HOOKS_DIR" in /*) ;; *) HOOKS_DIR="$ROOT/$HOOKS_DIR" ;; esac
for f in "$HOOKS_DIR"/*; do
  case "$f" in *.sample) continue ;; esac
  if [ -f "$f" ]; then
    echo "This clone has its own git hooks in .git/hooks, so .githooks is not turned on." >&2
    exit 0
  fi
done

git -C "$ROOT" config core.hooksPath .githooks
exit 0
