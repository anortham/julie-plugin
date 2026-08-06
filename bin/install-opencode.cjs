#!/usr/bin/env node
// OpenCode installer for the Julie plugin.
//
// Idempotent. Runs three independent operations against the global
// OpenCode config dir (~/.config/opencode/):
//
//   1. Symlink each skill from ./skills/<name>/ to skills/julie-<name>/
//   2. Remove the legacy plugins/julie-precedence.js hook module, if present
//   3. Remove the legacy Julie precedence section from AGENTS.md, if present
//
// Does NOT touch opencode.json. MCP server registration is managed by the
// user, and this installer prints a ready-to-copy config block.
//
// Usage:
//   node bin/install-opencode.cjs              # install/update
//   node bin/install-opencode.cjs --uninstall  # remove all Julie additions

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SKILLS_SRC = path.join(PLUGIN_ROOT, "skills");

const OPENCODE_HOME = path.join(os.homedir(), ".config", "opencode");
const OPENCODE_SKILLS = path.join(OPENCODE_HOME, "skills");
const OPENCODE_PLUGINS = path.join(OPENCODE_HOME, "plugins");
const OPENCODE_PLUGIN_DST = path.join(OPENCODE_PLUGINS, "julie-precedence.js");
const OPENCODE_AGENTS = path.join(OPENCODE_HOME, "AGENTS.md");

const SENTINEL_START = "<!-- julie-precedence start -->";
const SENTINEL_END = "<!-- julie-precedence end -->";

const args = new Set(process.argv.slice(2));
const UNINSTALL = args.has("--uninstall");

function log(msg) { process.stdout.write(`[install-opencode] ${msg}\n`); }

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ---------- 1. Skills ----------

function syncSkills() {
  ensureDir(OPENCODE_SKILLS);

  // Remove any existing julie-* symlinks so renames/removes are idempotent.
  for (const entry of fs.readdirSync(OPENCODE_SKILLS)) {
    if (!entry.startsWith("julie-")) continue;
    const full = path.join(OPENCODE_SKILLS, entry);
    try {
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(full);
        log(`removed stale symlink: skills/${entry}`);
      }
    } catch (_) { /* ignore */ }
  }

  if (UNINSTALL) return;

  for (const skill of fs.readdirSync(SKILLS_SRC)) {
    const src = path.join(SKILLS_SRC, skill);
    if (!fs.statSync(src).isDirectory()) continue;
    const dst = path.join(OPENCODE_SKILLS, `julie-${skill}`);
    fs.symlinkSync(src, dst, "dir");
    log(`linked skill: skills/julie-${skill} -> ${src}`);
  }
}

// ---------- 2. Legacy plugin cleanup ----------

function pruneLegacyPlugin() {
  ensureDir(OPENCODE_PLUGINS);

  // Remove any existing julie-precedence.js (symlink or stale file, including
  // broken symlinks which fs.existsSync would miss).
  try {
    fs.unlinkSync(OPENCODE_PLUGIN_DST);
    log(`removed plugin: plugins/julie-precedence.js`);
  } catch (_) {
    // Nothing to prune.
  }
}

// ---------- 3. Legacy AGENTS.md cleanup ----------

function pruneLegacyAgentsMd() {
  ensureDir(OPENCODE_HOME);

  if (!fs.existsSync(OPENCODE_AGENTS)) {
    return;
  }

  let body = fs.readFileSync(OPENCODE_AGENTS, "utf-8");

  const startIdx = body.indexOf(SENTINEL_START);
  const endIdx = body.indexOf(SENTINEL_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return;
  }

  const before = body.slice(0, startIdx).replace(/\n+$/, "\n");
  const after = body.slice(endIdx + SENTINEL_END.length).replace(/^\n+/, "\n");
  body = before + after;

  if (body.trim().length === 0) {
    try { fs.unlinkSync(OPENCODE_AGENTS); } catch (_) { /* ignore */ }
    log(`removed empty AGENTS.md`);
  } else {
    fs.writeFileSync(OPENCODE_AGENTS, body);
    log(`removed legacy Julie precedence section from AGENTS.md`);
  }
}

// ---------- post-install MCP registration hint ----------

function printMcpHint() {
  if (UNINSTALL) return;
  const launcher = path.join(PLUGIN_ROOT, "hooks", "run.cjs");
  process.stdout.write(`
[install-opencode] next step: register Julie's MCP server in opencode.json

  Global  ~/.config/opencode/opencode.json
  Project <repo>/opencode.json

  {
    "$schema": "https://opencode.ai/config.json",
    "mcp": {
      "julie": {
        "type": "local",
        "command": ["node", "${launcher}"],
        "enabled": true,
        "environment": {
          "JULIE_WORKSPACE": "/absolute/path/to/your/project"
        }
      }
    }
  }

  Note: \`command\` is an array; the env key is \`environment\` (not \`env\`).
  JULIE_WORKSPACE is optional when OpenCode starts from the repo root; set it
  when OpenCode launches the server from an unreliable cwd.
`);
}

// ---------- main ----------

function main() {
  log(UNINSTALL ? "uninstalling" : `installing from ${PLUGIN_ROOT}`);
  syncSkills();
  pruneLegacyPlugin();
  pruneLegacyAgentsMd();
  printMcpHint();
  log("done");
}

main();
