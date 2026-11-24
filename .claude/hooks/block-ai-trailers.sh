#!/bin/sh
# Claude Code PreToolUse hook for Bash.
# Blocks "git commit" and "gh pr/issue" commands whose text credits an AI tool.
# Exit code 2 blocks the command and shows the message to the agent.

INPUT=$(cat)

case "$INPUT" in
  *"git commit"*|*"gh pr"*|*"gh issue"*|*"git tag"*) ;;
  *) exit 0 ;;
esac

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# The command arrives as a JSON string: turn the escaped "\n" back into lines.
if BAD=$(printf '%s' "$INPUT" | awk '{ gsub(/\\n/, "\n"); print }' \
          | "$ROOT/tools/commit-rules/check-ai-trailers.sh"); then
  exit 0
fi

cat >&2 <<EOF
Blocked by the repository rule in CLAUDE.md: commit messages, PR and issue
texts must not credit an AI tool. Remove these lines and run the command again:
$BAD
Do not add "Co-Authored-By: <AI tool>", "Generated with ..." or similar lines.
EOF
exit 2
