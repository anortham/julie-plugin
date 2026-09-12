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
