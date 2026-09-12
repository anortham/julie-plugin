const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('portable plugin manifests register the Julie stdio launcher', () => {
  const agent = JSON.parse(fs.readFileSync(path.join(root, 'mcp.json'), 'utf8'));
  assert.equal(agent.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(agent.mcpServers.julie, {
    type: 'stdio',
    command: 'node',
    args: ['${PLUGIN_ROOT}/hooks/run.cjs'],
  });

  const antigravity = JSON.parse(fs.readFileSync(path.join(root, 'mcp_config.json'), 'utf8'));
  assert.deepEqual(antigravity.mcpServers.julie, {
    command: 'node',
    args: ['./hooks/run.cjs'],
  });
});

test('release workflow is reusable and pins the reviewed plugin source', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/update-binaries.yml'), 'utf8');
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /plugin_source_sha:/);
  assert.match(workflow, /ref: \$\{\{ inputs\.plugin_source_sha \}\}/);
  assert.match(workflow, /publication_token:/);
  assert.match(workflow, /published_sha/);
  assert.match(workflow, /node --test/);
  assert.match(workflow, /uses: actions\/setup-node@v4/);
  assert.match(workflow, /node-version: 22\.5\.0/);
  assert.match(workflow, /node --test hooks\/\*\.test\.cjs/);
  assert.match(workflow, /julie-v\$\{VERSION\}-aarch64-apple-darwin\.tar\.gz/);
  assert.match(workflow, /julie-v\$\{VERSION\}-x86_64-pc-windows-msvc\.zip/);
  assert.match(workflow, /find \. -type l/);
  assert.match(workflow, /bin\/aarch64-apple-darwin/);
});
