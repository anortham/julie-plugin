# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

This is the **plugin distribution repo** for [Julie](https://github.com/anortham/julie), a Rust-based code intelligence MCP server. This repo does not contain Julie's source code. It packages pre-built binaries and skills for installation as a Claude Code plugin.

The actual Julie server source lives at `anortham/julie`. Changes to server behavior, MCP tools, or language support happen there, not here.

## Architecture

```
.claude-plugin/        Plugin manifest and marketplace metadata
  plugin.json          MCP server definition (command: node hooks/run.cjs)
  marketplace.json     Registry entry for /plugin marketplace
bin/
  archives/            Compressed platform binaries (committed via LFS-like workflow)
hooks/
  run.cjs              Node.js launcher: platform detection, extraction, and exec
  hooks.json           Empty hook registration; behavior hooks are intentionally not shipped
skills/                4 SKILL.md files copied from anortham/julie during updates
package.json           Plugin identity and version
```

### Key Design Decisions

- **No build step.** Binaries ship as compressed archives in `bin/archives/`. `run.cjs` extracts on first use and re-extracts when the archive is newer (plugin updated).
- **Cross-platform via Node.js.** `run.cjs` handles platform detection, archive extraction, and binary exec entirely in Node (which Claude Code guarantees). On Windows, it uses the system bsdtar (`%SystemRoot%\System32\tar.exe`) for zip extraction to avoid MSYS2/Git Bash's GNU tar which can't handle zip. Launcher scripts must use LF line endings (enforced via `.gitattributes`).
- **No behavior hooks.** The plugin intentionally avoids SessionStart/PreToolUse/PostToolUse coaching hooks. Julie's MCP server and skills are the stable integration surface; hook-driven nudges caused too much per-client config drift.
- **Skills are copied, not authored here.** The `update-binaries.yml` workflow clones the julie source repo at a given tag and copies `skills/` wholesale. Edit skills in `anortham/julie`, not here.
- **Extracted binaries are gitignored.** Only the archives in `bin/archives/` are tracked. Platform-specific extraction dirs (`bin/aarch64-apple-darwin/`, etc.) are in `.gitignore`.

## Updating to a New Julie Version

Run the `Update Plugin` workflow (`.github/workflows/update-binaries.yml`) with the version and tag:

```
gh workflow run update-binaries.yml -f version=6.5.0 -f tag=v6.5.0
```

This downloads archives from `anortham/julie` releases, replaces `bin/archives/`, copies skills, bumps version in all three manifests (`plugin.json`, `marketplace.json`, `package.json`), commits, tags, and pushes.

## Version Syncing

The version appears in three files that must stay in sync:
- `package.json` (top-level `version`)
- `.claude-plugin/plugin.json` (top-level `version`)
- `.claude-plugin/marketplace.json` (`plugins[0].version`)

The update workflow handles this automatically. If you bump manually, update all three.

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
# Load plugin from local directory (no install needed)
claude --plugin-dir /path/to/julie-plugin

# Or install locally
claude plugin install /path/to/julie-plugin
```
