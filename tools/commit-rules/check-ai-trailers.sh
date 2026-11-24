#!/bin/sh
# Reads a commit message (or PR text) on stdin.
# Exits 1 and prints the bad lines if the text credits an AI tool,
# for example a "Co-authored-by: Claude" trailer or a
# "Generated with Claude Code" line. Exits 0 otherwise.
#
# Used by .githooks/commit-msg, by the Claude Code hook in .claude/
# and by the commit-rules GitHub workflow, so all three use the same rule.

TOOLS='claude|anthropic|codex|openai|chatgpt|gpt-[0-9]|copilot|cursor|gemini|aider|devin|windsurf|codeium|tabnine|amazon q|codewhisperer'

PATTERN="co-authored-by:.*($TOOLS)"
PATTERN="$PATTERN|generated (with|by|using) .*($TOOLS)"
PATTERN="$PATTERN|(written|created|made) (with|by|using) .*($TOOLS)"
PATTERN="$PATTERN|^[[:space:]]*(claude-session|assisted-by|ai-assisted|generated-by|ai-generated):"
PATTERN="$PATTERN|noreply@anthropic\\.com|@openai\\.com|cursoragent@"
PATTERN="$PATTERN|🤖"

# Lines that git itself drops (comments) are not part of the message.
BAD=$(grep -v '^#' | grep -inE "$PATTERN")

if [ -n "$BAD" ]; then
  echo "$BAD"
  exit 1
fi
exit 0
