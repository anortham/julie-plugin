# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

This is the **plugin distribution repo** for [Julie](https://github.com/anortham/julie), a Rust-based code intelligence MCP server. This repo does not contain Julie's source code. It packages pre-built binaries, skills, and one install path per harness: Claude Code, Codex, Antigravity, OpenCode, Hermes, and Cursor.

The actual Julie server source lives at `anortham/julie`. Changes to server behavior, MCP tools, or language support happen there, not here.

## Architecture

```
plugin.json                  Root manifest: Agent Plugins schema (Codex) and Antigravity read it
.claude-plugin/
  plugin.json                Claude Code manifest (mcpServers, hooks)
  marketplace.json           Claude Code marketplace entry
.codex-plugin/
  plugin.json                Codex compatibility manifest (skills, hooks)
.agents/plugins/
  marketplace.json           Codex marketplace entry
hooks/
  run.cjs                    Node.js launcher: platform detection, extraction, and exec
  hooks.json                 SessionStart and SubagentStart hooks (Claude Code and Codex)
  session-start.cjs          Prints JULIE_AGENT_INSTRUCTIONS.md as additional context
bin/
  archives/                  Compressed platform binaries with the semantic sidecar (committed)
  install-opencode.cjs       Links skills into OpenCode and prints the opencode.json block
skills/                      Skill directories copied from anortham/julie at the release tag
JULIE_AGENT_INSTRUCTIONS.md  Routing text copied from anortham/julie at the release tag
package.json                 Plugin identity and version
```

Every MCP declaration runs the same command: `node <plugin-root>/hooks/run.cjs`. The path form differs per harness: `${CLAUDE_PLUGIN_ROOT}/hooks/run.cjs` for Claude Code, and the absolute path of the clone for Codex, Antigravity, OpenCode, Hermes, and Cursor. Codex and Antigravity start a plugin's MCP servers inside the plugin directory. They send no MCP roots. So the plugin declares no server for them. The user's config entry starts Julie in the project directory.

### Key Design Decisions

- **No build step.** Binaries ship as compressed archives in `bin/archives/`. `run.cjs` extracts on first use and re-extracts when the archive is newer (plugin updated).
- **Cross-platform via Node.js.** `run.cjs` handles platform detection, archive extraction, and binary exec entirely in Node (which Claude Code guarantees). On Windows, it uses the system bsdtar (`%SystemRoot%\System32\tar.exe`) for zip extraction to avoid MSYS2/Git Bash's GNU tar which can't handle zip. Launcher scripts must use LF line endings (enforced via `.gitattributes`).
- **One session hook, one shared text.** Claude Code shares about a 4 KB instruction budget across all configured MCP servers and truncates the tail (anthropics/claude-code issue 43474). A user with two or three other servers can lose Julie's instructions. The SessionStart and SubagentStart hook in `hooks/hooks.json` prints the same `JULIE_AGENT_INSTRUCTIONS.md` the MCP instructions embed, nothing else. `JULIE_SESSION_HOOKS=0` disables it. Do not add coaching or tool-use hooks; the hook exists only to deliver the routing text.
- **Skills and instructions are copied, not authored here.** The `update-binaries.yml` workflow clones the julie source repo at a given tag and copies `skills/` and `JULIE_AGENT_INSTRUCTIONS.md`. Edit them in `anortham/julie`, not here.
- **Extracted binaries are gitignored.** Only the archives in `bin/archives/` are tracked. Platform-specific extraction dirs (`bin/aarch64-apple-darwin/`, etc.) are in `.gitignore`.

## Updating to a New Julie Version

Run the `Update Plugin` workflow (`.github/workflows/update-binaries.yml`) with the version and tag:

```
gh workflow run update-binaries.yml -f version=6.5.0 -f tag=v6.5.0
```

This downloads archives from `anortham/julie` releases, replaces `bin/archives/`, copies skills and `JULIE_AGENT_INSTRUCTIONS.md`, bumps the version in every manifest, commits, and pushes.

## Version Syncing

The version appears in six files that must stay in sync:
- `package.json` (top-level `version`)
- `plugin.json` (top-level `version`)
- `.claude-plugin/plugin.json` (top-level `version`)
- `.codex-plugin/plugin.json` (top-level `version`)
- `.claude-plugin/marketplace.json` (`plugins[0].version`)
- `.agents/plugins/marketplace.json` (`plugins[0].version`)

The update workflow handles this automatically. If you bump manually, update all six.

## Resolving Local vs Workflow Divergence

The `update-binaries.yml` workflow commits and pushes directly to `main` from CI. If you have local commits on top of an older base when the workflow runs, your local `main` diverges from `origin/main`. Both sides touch the same files (`bin/archives/`, version manifests, possibly `skills/`), so a plain `git pull` or rebase will conflict on binaries.

**Recovery procedure** (when `git push` is rejected as non-fast-forward after a workflow run):

1. Fetch and inspect the divergence:
   ```bash
   git fetch origin
   git log --oneline HEAD..origin/main      # what the workflow added
   git log --oneline origin/main..HEAD      # what we have locally
   git diff --stat origin/main..HEAD        # files that differ
   ```

2. Identify which local commits are pure version bumps (superseded by the workflow) vs real feature/fix work (must be preserved). Workflow commits supersede any local "update to julie vX.Y.Z" commit because the workflow rebuilds binaries, manifests, and skills from the source repo.

3. Backup, reset, and cherry-pick only the real work:
   ```bash
   git branch backup-before-rebase-$(date +%Y-%m-%d)
   git reset --hard origin/main
   git cherry-pick <feature-commits-in-order>
   ```

4. Resolve conflicts. Common spots: `package.json` (engines field), `hooks/run.cjs` (launcher changes), `skills/*/SKILL.md` (description edits). Cherry-picks of fixes that the workflow already incorporated (e.g. tool renames synced from julie source) become empty — `git cherry-pick --skip` them.

5. Push the cleaned history: `git push origin main`.

Do **not** force-push without first reconciling — the workflow's commit must remain in history so the next workflow run sees the right base.

## Launcher Scripts

Scripts in `hooks/` must:
- Use LF line endings (`.gitattributes` enforces this)
- Be written in Node.js (`.cjs`) so they work cross-platform without a bash dependency

## Testing Locally

```bash
node --test hooks/*.test.cjs

claude --plugin-dir /path/to/julie-plugin
claude plugin install /path/to/julie-plugin
```
