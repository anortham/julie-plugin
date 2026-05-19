#!/usr/bin/env node
// Codex CLI installer for the Julie plugin.
//
// Idempotent. Runs three independent operations:
//   1. Symlink each skill from ./skills/<name>/ to ~/.codex/skills/julie-<name>/
//   2. Remove any legacy Julie hook entries from ~/.codex/hooks.json
//   3. Remove any legacy Julie precedence section from ~/.codex/AGENTS.md
//
// Does NOT touch any config.toml. MCP server registration is managed by the
// user, and this installer prints the recommended user-level command.
//
// Usage:
//   node bin/install-codex.cjs              # install/update
//   node bin/install-codex.cjs --uninstall  # remove all Julie additions

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(PLUGIN_ROOT, "skills");
const CODEX_HOME = path.join(os.homedir(), ".codex");
const CODEX_SKILLS = path.join(CODEX_HOME, "skills");
const CODEX_HOOKS = path.join(CODEX_HOME, "hooks.json");
const CODEX_AGENTS = path.join(CODEX_HOME, "AGENTS.md");

const SENTINEL_START = "<!-- julie-precedence start -->";
const SENTINEL_END = "<!-- julie-precedence end -->";
const HOOK_TAG = "julie-plugin"; // appears in commands so we can find/remove

const args = new Set(process.argv.slice(2));
const UNINSTALL = args.has("--uninstall");

function log(msg) { process.stdout.write(`[install-codex] ${msg}\n`); }

// ---------- 1. Skills ----------

function syncSkills() {
  if (!fs.existsSync(CODEX_SKILLS)) {
    fs.mkdirSync(CODEX_SKILLS, { recursive: true });
  }

  // Remove any existing julie-* symlinks so renames/removes are idempotent.
  for (const entry of fs.readdirSync(CODEX_SKILLS)) {
    if (!entry.startsWith("julie-")) continue;
    const full = path.join(CODEX_SKILLS, entry);
    try {
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(full);
        log(`removed stale symlink: ${entry}`);
      }
    } catch (_) { /* ignore */ }
  }

  if (UNINSTALL) return;

  for (const skill of fs.readdirSync(SKILLS_DIR)) {
    const src = path.join(SKILLS_DIR, skill);
    if (!fs.statSync(src).isDirectory()) continue;
    const dst = path.join(CODEX_SKILLS, `julie-${skill}`);
    fs.symlinkSync(src, dst, "dir");
    log(`linked skill: julie-${skill} -> ${src}`);
  }
}

// ---------- 2. Legacy hooks cleanup ----------

function pruneLegacyHooks() {
  if (!fs.existsSync(CODEX_HOOKS)) {
    return;
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CODEX_HOOKS, "utf-8"));
    if (!cfg.hooks) cfg.hooks = {};
  } catch (e) {
    log(`WARNING: ~/.codex/hooks.json is not valid JSON; aborting hook cleanup: ${e.message}`);
    return;
  }

  for (const event of ["PreToolUse", "SessionStart", "PostToolUse", "UserPromptSubmit", "Stop"]) {
    if (!Array.isArray(cfg.hooks[event])) continue;
    cfg.hooks[event] = cfg.hooks[event].filter((entry) => {
      const inner = entry.hooks || [];
      return !inner.some((h) => typeof h.command === "string" && h.command.includes(HOOK_TAG));
    });
    if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
  }

  fs.writeFileSync(CODEX_HOOKS, JSON.stringify(cfg, null, 2) + "\n");
  log("removed legacy Julie hook entries");
}

// ---------- 3. Legacy AGENTS.md cleanup ----------

function pruneLegacyAgentsMd() {
  if (!fs.existsSync(CODEX_AGENTS)) {
    return;
  }

  let body = fs.readFileSync(CODEX_AGENTS, "utf-8");

  // Remove any existing block between sentinels.
  const startIdx = body.indexOf(SENTINEL_START);
  const endIdx = body.indexOf(SENTINEL_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return;
  }

  const before = body.slice(0, startIdx).replace(/\n+$/, "\n");
  const after = body.slice(endIdx + SENTINEL_END.length).replace(/^\n+/, "\n");
  body = before + after;
  fs.writeFileSync(CODEX_AGENTS, body);
  log(`removed legacy Julie precedence section from ${CODEX_AGENTS}`);
}

// ---------- main ----------

function printMcpHint() {
  const launcher = path.join(PLUGIN_ROOT, "hooks", "run.cjs");
  log("next step: register Julie MCP server in Codex");
  process.stdout.write(`
  User-level registration:
    codex mcp add julie -- node "${launcher}"

  If a desktop app starts Julie from the wrong directory, set JULIE_WORKSPACE
  in that app's MCP config or launch the app from the repo root.
`);
}

function main() {
  log(UNINSTALL ? "uninstalling" : `installing from ${PLUGIN_ROOT}`);
  syncSkills();
  pruneLegacyHooks();
  pruneLegacyAgentsMd();
  if (!UNINSTALL) printMcpHint();
  log("done");
}

main();
