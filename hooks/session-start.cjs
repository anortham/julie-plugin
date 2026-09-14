#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const INSTRUCTIONS_FILE = path.join(__dirname, '..', 'JULIE_AGENT_INSTRUCTIONS.md');
const MAX_STDIN_BYTES = 65536;

const EVENT_CONFIG = {
  'session-start': { hookEventName: 'SessionStart' },
  'subagent-start': { hookEventName: 'SubagentStart' },
};

function sessionHooksDisabled() {
  const flag = (process.env.JULIE_SESSION_HOOKS ?? '').trim().toLowerCase();
  return flag === '0' || flag === 'false';
}

function readInstructions() {
  if (!fs.existsSync(INSTRUCTIONS_FILE)) return null;
  const content = fs.readFileSync(INSTRUCTIONS_FILE, 'utf8').replaceAll('\r\n', '\n').trim();
  return content.length > 0 ? content : null;
}

function drainStdin(maxBytes = MAX_STDIN_BYTES) {
  if (process.stdin.isTTY) return;
  try {
    fs.readSync(0, Buffer.alloc(maxBytes), 0, maxBytes, null);
  } catch {
    return;
  }
}

function main() {
  if (sessionHooksDisabled()) return;

  const config = EVENT_CONFIG[process.argv[2]];
  if (!config) return;

  const instructions = readInstructions();
  if (!instructions) return;

  drainStdin();

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: config.hookEventName,
        additionalContext: instructions,
      },
    }),
  );
}

try {
  main();
} catch {
  // Fail open: a hook fault must never disturb the host session.
}
