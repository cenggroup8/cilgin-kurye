# Rules for coding agents

These rules apply to every coding agent working in this repository
(Claude Code, Codex, Copilot, Cursor and others).

## Commits, pull requests and issues

- Only people are authors. Never add a `Co-authored-by:` line for an AI tool.
- Never add lines like `Generated with ...`, `Assisted-by: ...`, `Claude-Session: ...`
  or a 🤖 line to a commit message, a pull request or an issue.
- Write the commit message as the person who asked for the change.

The repository checks this in three places, all with the same script
(`tools/commit-rules/check-ai-trailers.sh`):

1. The `commit-msg` git hook in `.githooks/` rejects such a commit on your computer.
   Turn it on once per clone: `git config core.hooksPath .githooks`
2. The Claude Code hook in `.claude/` blocks such a `git commit` or `gh pr` command.
3. The `commit-rules` GitHub workflow fails on every push and pull request that
   contains such a commit, and `main` only accepts changes that pass it.

If a commit is rejected, remove the lines that the message lists and commit again.
For a commit you already made: `git commit --amend`, or `git rebase -i` for older ones.
