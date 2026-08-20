const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const codexInstaller = path.join(root, 'bin', 'install-codex.cjs');
const opencodeInstaller = path.join(root, 'bin', 'install-opencode.cjs');

const JULIE_BLOCK = `
<!-- julie-precedence start -->
## Julie tool precedence

legacy hook guidance
<!-- julie-precedence end -->
`;

function runInstaller(script, home) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `${path.basename(script)} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );

  return result.stdout;
}

test('Codex installer links skills but removes legacy Julie hooks and AGENTS block', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-codex-'));
  const codexHome = path.join(home, '.codex');
  fs.mkdirSync(codexHome, { recursive: true });

  const hooksPath = path.join(codexHome, 'hooks.json');
  fs.writeFileSync(
    hooksPath,
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node "/old/codex-sessionstart.cjs" # julie-plugin',
                },
              ],
            },
            {
              hooks: [{ type: 'command', command: 'node "/keep/me.cjs"' }],
            },
          ],
        },
      },
      null,
      2
    ) + '\n'
  );
  fs.writeFileSync(path.join(codexHome, 'AGENTS.md'), `user content\n${JULIE_BLOCK}`);

  runInstaller(codexInstaller, home);

  assert.ok(fs.lstatSync(path.join(codexHome, 'skills', 'julie-editing')).isSymbolicLink());

  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  assert.deepEqual(hooks, {
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: 'command', command: 'node "/keep/me.cjs"' }],
        },
      ],
    },
  });

  const agents = fs.readFileSync(path.join(codexHome, 'AGENTS.md'), 'utf8');
  assert.match(agents, /user content/);
  assert.doesNotMatch(agents, /julie-precedence/);
  assert.doesNotMatch(agents, /legacy hook guidance/);
});

test('OpenCode installer links skills but removes legacy plugin and AGENTS block', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-opencode-'));
  const opencodeHome = path.join(home, '.config', 'opencode');
  const pluginsDir = path.join(opencodeHome, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });

  const pluginPath = path.join(pluginsDir, 'julie-precedence.js');
  fs.writeFileSync(pluginPath, 'legacy plugin');
  fs.writeFileSync(path.join(opencodeHome, 'AGENTS.md'), `user content\n${JULIE_BLOCK}`);

  runInstaller(opencodeInstaller, home);

  assert.ok(
    fs.lstatSync(path.join(opencodeHome, 'skills', 'julie-editing')).isSymbolicLink()
  );
  assert.ok(!fs.existsSync(pluginPath), 'legacy OpenCode precedence plugin was removed');

  const agents = fs.readFileSync(path.join(opencodeHome, 'AGENTS.md'), 'utf8');
  assert.match(agents, /user content/);
  assert.doesNotMatch(agents, /julie-precedence/);
  assert.doesNotMatch(agents, /legacy hook guidance/);
});
