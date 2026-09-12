const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const hookSource = path.join(__dirname, 'session-start.cjs');
const instructions = fs.readFileSync(path.join(__dirname, '..', 'JULIE_AGENT_INSTRUCTIONS.md'), 'utf8');

function stagePlugin({ withInstructions }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-hook-'));
  fs.mkdirSync(path.join(root, 'hooks'));
  fs.copyFileSync(hookSource, path.join(root, 'hooks', 'session-start.cjs'));
  if (withInstructions) {
    fs.writeFileSync(path.join(root, 'JULIE_AGENT_INSTRUCTIONS.md'), instructions);
  }
  return root;
}

function runHook(root, event, env = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'hooks', 'session-start.cjs'), event], {
    cwd: root,
    env: { ...process.env, JULIE_SESSION_HOOKS: '', ...env },
    input: '{}',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('session-start prints the instructions file as SessionStart context', () => {
  const root = stagePlugin({ withInstructions: true });
  const output = JSON.parse(runHook(root, 'session-start'));
  assert.deepEqual(output, {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: instructions.trim(),
    },
  });
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /manage_workspace\(operation="open", path="\/absolute\/project"\)/,
  );
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /`health`, `refresh`, and `remove` require `workspace_id`/,
  );
});

test('subagent-start prints the instructions file as SubagentStart context', () => {
  const root = stagePlugin({ withInstructions: true });
  assert.deepEqual(JSON.parse(runHook(root, 'subagent-start')), {
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: instructions.trim(),
    },
  });
});

test('prints nothing when the instructions file is missing', () => {
  const root = stagePlugin({ withInstructions: false });
  assert.equal(runHook(root, 'session-start'), '');
});

test('prints nothing when JULIE_SESSION_HOOKS disables it', () => {
  const root = stagePlugin({ withInstructions: true });
  assert.equal(runHook(root, 'session-start', { JULIE_SESSION_HOOKS: '0' }), '');
  assert.equal(runHook(root, 'session-start', { JULIE_SESSION_HOOKS: 'false' }), '');
});

test('exits 0 and prints nothing on an unknown event', () => {
  const root = stagePlugin({ withInstructions: true });
  assert.equal(runHook(root, 'pre-tool-use'), '');
});
