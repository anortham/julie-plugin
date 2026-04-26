# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

This is the **plugin distribution repo** for [Julie](https://github.com/anortham/julie), a Rust-based code intelligence MCP server. This repo does not contain Julie's source code. It packages pre-built binaries, skills, and hooks for installation as a Claude Code plugin.

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
  session-start.cjs    Emits behavioral guidance JSON for SessionStart hook
  hooks.json           Hook registration (SessionStart -> session-start.cjs)
skills/                8 SKILL.md files copied from anortham/julie during updates
package.json           Plugin identity and version
```

### Key Design Decisions

- **No build step.** Binaries ship as compressed archives in `bin/archives/`. `run.cjs` extracts on first use and re-extracts when the archive is newer (plugin updated).
- **Cross-platform via Node.js.** `run.cjs` handles platform detection, archive extraction, and binary exec entirely in Node (which Claude Code guarantees). On Windows, it uses the system bsdtar (`%SystemRoot%\System32\tar.exe`) for zip extraction to avoid MSYS2/Git Bash's GNU tar which can't handle zip. All hook scripts must use LF line endings (enforced via `.gitattributes`).
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

## Hook Scripts

All scripts in `hooks/` must:
- Use LF line endings (`.gitattributes` enforces this)
- Be written in Node.js (`.cjs`) so they work cross-platform without a bash dependency

## Testing Locally

```bash
# Load plugin from local directory (no install needed)
claude --plugin-dir /path/to/julie-plugin

# Or install locally
claude plugin install /path/to/julie-plugin
```
