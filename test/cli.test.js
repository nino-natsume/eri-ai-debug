'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
function run(args, envExtra = {}) {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-cli-test-'));
  try {
    const env = { ...process.env, ERI_CONFIG_HOME: configHome, ...envExtra };
    delete env.ERI_CONFIG_PATH;
    return spawnSync(process.execPath, [path.join(root, 'index.js'), ...args], {
      cwd: root, env, encoding: 'utf8', timeout: 10000,
    });
  } finally {
    fs.rmSync(configHome, { recursive: true, force: true });
  }
}

test('CLI help describes TUI, tool manager, default model and connect flow', () => {
  const result = run(['help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /终端工具管理/);
  assert.match(result.stdout, /opencode\/big-pickle/);
  assert.match(result.stdout, /eri-ai-debug connect/);
  assert.match(result.stdout, /eri-ai-debug tui/);
  assert.match(result.stdout, /eri-ai-debug font/);
});

test('CLI version uses package.json version', () => {
  const result = run(['version']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), pkg.version);
});

test('bare CLI in non-interactive environments prints help rather than updating from network', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /eri-ai-debug connect/);
  assert.match(result.stdout, /opencode\/big-pickle/);
});

test('CLI config show works in non-interactive environments', () => {
  const result = run(['config', 'show']);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.model, 'opencode/big-pickle');
  assert.deepEqual(value.selectedTools, []);
});


test('CLI font command prints install/apply instructions and configured font source', () => {
  const result = run(['font']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /JetBrains Maple Mono/);
  assert.match(result.stdout, /fonts\.107211\.xyz/);
  assert.match(result.stdout, /eri-ai-debug font install/);
  assert.match(result.stdout, /Windows Terminal/);
});
