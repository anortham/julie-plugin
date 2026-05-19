# Julie Plugin for Claude Code (and Codex CLI, OpenCode)

A [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code/plugins) that installs [Julie](https://github.com/anortham/julie), a Rust-based code intelligence MCP server. Julie gives AI coding agents LSP-quality search, navigation, and refactoring across 34 programming languages.

This package also ships manual install paths for the [Codex CLI](https://github.com/openai/codex) and [OpenCode](https://opencode.ai) — see [Codex CLI install](#codex-cli-install) and [OpenCode install](#opencode-install) below.

For full documentation on Julie's tools, capabilities, and supported languages, see the [Julie repository](https://github.com/anortham/julie).

## Recommended Prerequisite

Install [`uv`](https://docs.astral.sh/uv/) so Julie can auto-provision Python 3.12 and GPU-accelerated embeddings. You do not need to install Python yourself. If `uv` is missing or embeddings cannot start, Julie still provides keyword search and code navigation; embedding-backed features are disabled until the sidecar is available.

```bash
# macOS
brew install uv

# Windows (PowerShell)
winget install --id=astral-sh.uv -e

# Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Optional: Web Research

To enable the `/web-research` skill for fetching and indexing web content, install [browser39](https://github.com/alejandroqh/browser39):

```bash
# Download the latest release for your platform from:
# https://github.com/alejandroqh/browser39/releases
```

This is optional. All other Julie features work without browser39.

## Installation

### As a Claude Code Plugin (Recommended)

```bash
# Add the Julie plugin repository as a marketplace
/plugin marketplace add anortham/julie-plugin

# Install the plugin (user scope, available across all projects)
/plugin install julie@julie-plugin
```

You can also scope the installation to a specific project:

```bash
# Project scope (shared with team via version control)
/plugin install julie@julie-plugin --scope project
```

### From a Local Clone

```bash
git clone https://github.com/anortham/julie-plugin.git

# Install as a plugin
claude plugin install /path/to/julie-plugin

# Or load from local directory (useful for development)
claude --plugin-dir /path/to/julie-plugin
```

## What the Plugin Provides

- **MCP server** with 10+ code intelligence tools (`fast_search`, `get_symbols`, `deep_dive`, `fast_refs`, `call_path`, `get_context`, `blast_radius`, `rename_symbol`, `manage_workspace`, `edit_file`, `rewrite_symbol`)
- **4 skills** (`/editing`, `/explore-area`, `/impact-analysis`, `/web-research`)

The plugin intentionally does not install behavioral hooks. Julie's MCP tools and skills are the durable integration surface; hook-based coaching created too much client-specific configuration drift.

On first launch, Julie extracts a pre-built native binary, prepares the embedding sidecar when `uv` is available, detects your GPU, and indexes your codebase. Subsequent sessions load the cached index instantly with incremental updates for changed files.

## Codex CLI install

The plugin ships an installer that wires Julie's skills into the Codex CLI. It does **not** touch any `config.toml`; it prints the exact MCP registration command for your checkout after install.

**Prerequisites:** Node.js 18+, Codex CLI installed.

**Install:**

```bash
# From a julie-plugin checkout (or anywhere — the script resolves paths from its own location)
node bin/install-codex.cjs
```

This is idempotent and adds:

- **Skills** — symlinks `skills/<name>/` to `~/.codex/skills/julie-<name>/` for all 4 skills

During install and uninstall it also removes legacy Julie hook entries and the old `<!-- julie-precedence start/end -->` AGENTS block if they exist.

**Register the MCP server in Codex** (one-time, you do this manually):

User-scope:

```bash
codex mcp add julie -- node /absolute/path/to/julie-plugin/hooks/run.cjs
```

Codex CLI and Codex Desktop do not send MCP roots, so Julie uses the process cwd/startup hint. If a desktop app starts Julie from the wrong directory, set `JULIE_WORKSPACE` in that app's MCP config or launch from the repo root:

```toml
[mcp_servers.julie]
command = "node"
args = ["/absolute/path/to/julie-plugin/hooks/run.cjs"]
env = { "JULIE_WORKSPACE" = "/absolute/path/to/your/project" }
```

**Uninstall:**

```bash
node bin/install-codex.cjs --uninstall
```

Removes the Julie skill symlinks and any legacy Julie hook/AGENTS artifacts; leaves your other Codex configuration intact.

## OpenCode install

The plugin ships a parallel installer that wires Julie's skills into [OpenCode](https://opencode.ai). It does **not** touch `opencode.json`; it prints a ready-to-copy MCP block after install.

**Prerequisites:** Node.js 18+, OpenCode installed.

**Install:**

```bash
node bin/install-opencode.cjs
```

This is idempotent and adds, all under `~/.config/opencode/`:

- **Skills** — symlinks `skills/<name>/` to `skills/julie-<name>/` for all 4 skills (auto-discovered by OpenCode)

During install and uninstall it also removes the legacy `plugins/julie-precedence.js` module and old `<!-- julie-precedence start/end -->` AGENTS block if they exist.

**Register the MCP server in OpenCode** (one-time, you do this manually):

Add to `~/.config/opencode/opencode.json` (global) or `<repo>/opencode.json` (project):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
      "julie": {
        "type": "local",
        "command": ["node", "/absolute/path/to/julie-plugin/hooks/run.cjs"],
        "enabled": true,
        "environment": {
          "JULIE_WORKSPACE": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Note: OpenCode expects `command` as an array and the env key is `environment` (not `env`). `JULIE_WORKSPACE` is optional when OpenCode starts from the repo root; set it when OpenCode launches the server from an unreliable `cwd`.

**Uninstall:**

```bash
node bin/install-opencode.cjs --uninstall
```

Removes the Julie skill symlinks and any legacy Julie plugin/AGENTS artifacts; leaves your other OpenCode configuration intact.

## Supported Platforms

| Platform | Architecture |
|----------|-------------|
| macOS | Apple Silicon (ARM64), Intel (x86_64) |
| Linux | x86_64 |
| Windows | x86_64 |

## Project Structure

This repo packages pre-built binaries and plugin metadata. Julie's source code lives at [anortham/julie](https://github.com/anortham/julie).

```
.claude-plugin/        Plugin manifest and marketplace metadata
  plugin.json          MCP server definition (command: node hooks/run.cjs)
  marketplace.json     Registry entry for /plugin marketplace
bin/
  archives/            Compressed platform binaries (committed to git)
  install-codex.cjs    Idempotent installer for Codex CLI skills; prunes legacy hooks
  install-opencode.cjs Idempotent installer for OpenCode skills; prunes legacy hooks
hooks/
  run.cjs              Node.js launcher: platform detection, extraction, and exec
  hooks.json           Empty hook registration; behavior hooks are intentionally not shipped
skills/                4 skill directories synced from anortham/julie via `cargo xtask sync-plugin`
package.json           Plugin identity and version
```

Extracted binaries (`bin/aarch64-apple-darwin/`, `bin/x86_64-*/`) are gitignored. Only the archives in `bin/archives/` are tracked. `run.cjs` extracts them on first launch and re-extracts when the archive is newer (i.e., after a plugin update).

## More Information

- [Julie source repo](https://github.com/anortham/julie) -- full source, documentation, and development
- [Architecture docs](https://github.com/anortham/julie/blob/main/docs/ARCHITECTURE.md) -- detailed design
- [Search flow](https://github.com/anortham/julie/blob/main/docs/SEARCH_FLOW.md) -- how search works

## License

MIT. See [LICENSE](LICENSE).
