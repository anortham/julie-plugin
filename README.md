# Julie Plugin

This repo installs [Julie](https://github.com/anortham/julie), a Rust code intelligence MCP server, into six AI coding harnesses, with one install path per harness. Julie gives AI coding agents LSP-quality search, navigation, and refactoring across 36 programming languages.

You need Node.js 22.5 or newer; the launcher is a Node script. Nothing else to install: the archive carries the semantic sidecar. Julie extracts the binaries on the first launch, starts its machine service, and indexes your codebase. Later sessions load the cached index and update only the changed files.

For the tools, capabilities, and supported languages, see the [Julie repository](https://github.com/anortham/julie).

### Optional: Web Research

The `/web-research` skill needs [browser39](https://github.com/alejandroqh/browser39). Download the release for your platform from the [browser39 releases page](https://github.com/alejandroqh/browser39/releases). All other Julie features work without it.

## Installation

| Harness | Install | Mechanism |
|---|---|---|
| Claude Code | `/plugin marketplace add anortham/julie-plugin`, then `/plugin install julie@julie-plugin` | plugin manifest with `mcpServers` and hooks |
| Codex | `codex plugin marketplace add anortham/julie-plugin`, then `codex plugin add julie@julie-plugin`, then add the `mcp_servers.julie` block to `~/.codex/config.toml` | skills and hooks from the plugin; stdio command from the config |
| Antigravity | `agy plugin install https://github.com/anortham/julie-plugin`, then add the `mcpServers.julie` block to `~/.gemini/config/mcp_config.json` | skills from the plugin; stdio command from the config |
| OpenCode | clone, `node bin/install-opencode.cjs`, paste the printed `opencode.json` block | `mcp.julie` local command |
| Hermes | clone, add the `mcp_servers.julie` block to `~/.hermes/config.yaml` | stdio command |
| Cursor | clone, add the `mcpServers.julie` block to `~/.cursor/mcp.json` | stdio command |

Every harness runs the same command: `node <plugin-root>/hooks/run.cjs`. The launcher extracts the archive for your platform and starts `julie-server` in the project directory.

### Claude Code

```
/plugin marketplace add anortham/julie-plugin
/plugin install julie@julie-plugin
```

Add `--scope project` to the install command to share the plugin with your team through version control.

For a local checkout: `claude plugin install /path/to/julie-plugin`, or `claude --plugin-dir /path/to/julie-plugin` to load it without an install.

The plugin registers a SessionStart and SubagentStart hook. The hook prints `JULIE_AGENT_INSTRUCTIONS.md`, the same routing text the MCP server sends as its instructions. Set `JULIE_SESSION_HOOKS=0` to turn the hook off.

### Codex

```bash
codex plugin marketplace add anortham/julie-plugin
codex plugin add julie@julie-plugin
```

Codex reads the root `plugin.json`, `skills/`, and `hooks/hooks.json`. Run `codex`, open `/hooks`, and trust the two Julie hooks.

Then register the server in `~/.codex/config.toml`:

```toml
[mcp_servers.julie]
command = "node"
args = ["/absolute/path/to/julie-plugin/hooks/run.cjs"]
```

Use a clone of this repo, or the plugin root that `codex plugin list` prints. Codex starts a plugin's MCP servers inside the plugin directory. It sends no MCP roots. So this repo declares no server for Codex; the config entry starts Julie in the project directory. Set `env = { "JULIE_WORKSPACE" = "/absolute/path/to/your/project" }` on the entry when Codex starts Julie somewhere else.

### Antigravity

```bash
agy plugin install https://github.com/anortham/julie-plugin
```

Antigravity reads the root `plugin.json` and `skills/`. Then register the server in `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "julie": {
      "command": "node",
      "args": ["/absolute/path/to/julie-plugin/hooks/run.cjs"]
    }
  }
}
```

Antigravity starts a plugin's MCP servers inside the plugin directory. It sends no MCP roots. So this repo declares no server for Antigravity; the config entry starts Julie in the project directory.

### OpenCode

```bash
git clone https://github.com/anortham/julie-plugin.git
cd julie-plugin
node bin/install-opencode.cjs
```

The installer links the skills into `~/.config/opencode/skills/` and prints an `opencode.json` block. Paste the block into `~/.config/opencode/opencode.json` (global) or `<repo>/opencode.json` (project):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "julie": {
      "type": "local",
      "command": ["node", "/absolute/path/to/julie-plugin/hooks/run.cjs"],
      "enabled": true
    }
  }
}
```

OpenCode expects `command` as an array. The env key is `environment`, not `env`.

OpenCode expects `command` as an array and the env key is `environment`. `JULIE_WORKSPACE` is optional when OpenCode starts from the repo root.

Run `node bin/install-opencode.cjs --uninstall` to remove the skill links.

### Hermes

Clone the repo, then add this block to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  julie:
    command: node
    args: [/absolute/path/to/julie-plugin/hooks/run.cjs]
```

### Cursor

Clone the repo, then add this block to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "julie": {
      "command": "node",
      "args": ["/absolute/path/to/julie-plugin/hooks/run.cjs"]
    }
  }
}
```

### JULIE_WORKSPACE

The launcher binds every tool call to `JULIE_WORKSPACE` when you set it, else to the directory the harness started it in. Every path above starts Julie in the project directory. Set `JULIE_WORKSPACE` in the MCP config entry when a harness starts Julie somewhere else.

## What the Plugin Provides

- **MCP server** with the Julie tools (`fast_search`, `fast_refs`, `get_symbols`, `get_context`, `deep_dive`, `call_path`, `blast_radius`, `edit_file`, `manage_workspace`, `patterns`)
- **Skills**: `/editing`, `/explore-area`, `/impact-analysis`, `/search-debug`, `/dead-code-audit`, `/web-research`
- **Session hook** for Claude Code and Codex that prints `JULIE_AGENT_INSTRUCTIONS.md`

## Supported Platforms

| Platform | Architecture |
|----------|-------------|
| macOS | Apple Silicon (ARM64), Intel (x86_64) |
| Linux | x86_64 |
| Windows | x86_64 |

## Project Structure

This repo packages pre-built binaries and plugin metadata. Julie's source code lives at [anortham/julie](https://github.com/anortham/julie).

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

Extracted binaries (`bin/aarch64-apple-darwin/`, `bin/x86_64-*/`) are gitignored. Only the archives in `bin/archives/` are tracked. `run.cjs` extracts them on the first launch and again when the archive is newer.

## More Information

- [Julie source repo](https://github.com/anortham/julie): full source, documentation, and development
- [Architecture docs](https://github.com/anortham/julie/blob/main/docs/ARCHITECTURE.md): detailed design
- [Search flow](https://github.com/anortham/julie/blob/main/docs/SEARCH_FLOW.md): how search works

## License

MIT. See [LICENSE](LICENSE).
