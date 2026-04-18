# Julie Plugin for Claude Code

A [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code/plugins) that installs [Julie](https://github.com/anortham/julie), a Rust-based code intelligence MCP server. Julie gives AI coding agents LSP-quality search, navigation, and refactoring across 34 programming languages.

For full documentation on Julie's tools, capabilities, and supported languages, see the [Julie repository](https://github.com/anortham/julie).

## Prerequisites

Install [`uv`](https://docs.astral.sh/uv/) so Julie can auto-provision Python 3.12 and GPU-accelerated embeddings. You do not need to install Python yourself.

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

- **MCP server** with 10 code intelligence tools (`fast_search`, `get_symbols`, `deep_dive`, `fast_refs`, `call_path`, `get_context`, `rename_symbol`, `manage_workspace`, `edit_file`, `rewrite_symbol`)
- **4 skills** (`/editing`, `/explore-area`, `/impact-analysis`, `/web-research`)
- **SessionStart hook** that injects behavioral guidance so Claude prefers Julie's tools over grep/find/cat

On first launch, Julie extracts a pre-built native binary, installs Python 3.12 + PyTorch via `uv`, detects your GPU, and indexes your codebase. Subsequent sessions load the cached index instantly with incremental updates for changed files.

## Supported Platforms

| Platform | Architecture |
|----------|-------------|
| macOS | Apple Silicon (ARM64) |
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
hooks/
  run.cjs              Node.js launcher: platform detection, extraction, and exec
  session-start.cjs    Emits behavioral guidance JSON for the SessionStart hook
  hooks.json           Hook registration (SessionStart -> session-start.cjs)
skills/                4 skill directories copied from anortham/julie during updates
package.json           Plugin identity and version
```

Extracted binaries (`bin/aarch64-apple-darwin/`, `bin/x86_64-*/`) are gitignored. Only the archives in `bin/archives/` are tracked. `run.cjs` extracts them on first launch and re-extracts when the archive is newer (i.e., after a plugin update).

## More Information

- [Julie source repo](https://github.com/anortham/julie) -- full source, documentation, and development
- [Architecture docs](https://github.com/anortham/julie/blob/main/docs/ARCHITECTURE.md) -- detailed design
- [Search flow](https://github.com/anortham/julie/blob/main/docs/SEARCH_FLOW.md) -- how search works

## License

MIT. See [LICENSE](LICENSE).
