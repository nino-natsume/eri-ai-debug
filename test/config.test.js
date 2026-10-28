'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_MODEL, DEFAULT_TUI_FONT, DEFAULT_TUI_FONT_WEIGHT, DEFAULT_TUI_FONT_SOURCE, FREE_MODELS, configPath, loadConfig, saveConfig } = require('../lib/config');

test('config uses the default model and round-trips selected tools', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-config-test-'));
  const oldHome = process.env.ERI_CONFIG_HOME;
  const oldPath = process.env.ERI_CONFIG_PATH;
  process.env.ERI_CONFIG_HOME = dir;
  delete process.env.ERI_CONFIG_PATH;
  try {
    assert.equal(loadConfig().model, DEFAULT_MODEL);
    const savedPath = saveConfig({ model: DEFAULT_MODEL, selectedTools: ['opencode', 'claude', 'opencode'] });
    assert.equal(savedPath, configPath());
    assert.deepEqual(loadConfig().selectedTools, ['opencode', 'claude']);
    if (process.platform !== 'win32') assert.equal(fs.statSync(savedPath).mode & 0o077, 0);
  } finally {
    if (oldHome === undefined) delete process.env.ERI_CONFIG_HOME; else process.env.ERI_CONFIG_HOME = oldHome;
    if (oldPath === undefined) delete process.env.ERI_CONFIG_PATH; else process.env.ERI_CONFIG_PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('config rejects malformed model IDs and resets to safe default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-config-test-'));
  const oldHome = process.env.ERI_CONFIG_HOME;
  process.env.ERI_CONFIG_HOME = dir;
  try {
    saveConfig({ model: 'malformed model id', selectedTools: [] });
    assert.equal(loadConfig().model, DEFAULT_MODEL);
  } finally {
    if (oldHome === undefined) delete process.env.ERI_CONFIG_HOME; else process.env.ERI_CONFIG_HOME = oldHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('config migrates the previous default free model to the current default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-config-migrate-'));
  const oldHome = process.env.ERI_CONFIG_HOME;
  const oldPath = process.env.ERI_CONFIG_PATH;
  process.env.ERI_CONFIG_HOME = dir;
  delete process.env.ERI_CONFIG_PATH;
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      model: 'opencode/glm-5.3-flash-free',
      selectedTools: ['opencode'],
      mode: 'normal',
    }));
    assert.equal(loadConfig().model, 'opencode/big-pickle');
  } finally {
    if (oldHome === undefined) delete process.env.ERI_CONFIG_HOME; else process.env.ERI_CONFIG_HOME = oldHome;
    if (oldPath === undefined) delete process.env.ERI_CONFIG_PATH; else process.env.ERI_CONFIG_PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('free-model menu contains current OpenCode Zen IDs and keeps Big Pickle default', () => {
  const ids = FREE_MODELS.map((item) => item.id);
  assert.equal(DEFAULT_MODEL, 'opencode/big-pickle');
  assert.ok(ids.includes('opencode/big-pickle'));
  assert.ok(ids.includes('opencode/glm-5.3-flash-free'));
  assert.ok(ids.includes('opencode/deepseek-v4.1-flash-free'));
  assert.ok(ids.includes('opencode/beam-free'));
  assert.ok(ids.includes('opencode/mimo-v2.6-flash-free'));
  assert.ok(!ids.includes('opencode/mimo-v2.5-free'));
});


test('config defaults to JetBrains Maple Mono Medium from the requested font source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-font-config-'));
  const oldHome = process.env.ERI_CONFIG_HOME;
  const oldPath = process.env.ERI_CONFIG_PATH;
  process.env.ERI_CONFIG_HOME = dir;
  delete process.env.ERI_CONFIG_PATH;
  try {
    const config = loadConfig();
    assert.equal(config.fontFamily, DEFAULT_TUI_FONT);
    assert.equal(config.fontWeight, DEFAULT_TUI_FONT_WEIGHT);
    assert.equal(config.fontSource, DEFAULT_TUI_FONT_SOURCE);
    assert.equal(DEFAULT_TUI_FONT, 'JetBrains Maple Mono');
    assert.equal(DEFAULT_TUI_FONT_WEIGHT, 'Medium');
    assert.equal(DEFAULT_TUI_FONT_SOURCE, 'https://fonts.107211.xyz/');
  } finally {
    if (oldHome === undefined) delete process.env.ERI_CONFIG_HOME; else process.env.ERI_CONFIG_HOME = oldHome;
    if (oldPath === undefined) delete process.env.ERI_CONFIG_PATH; else process.env.ERI_CONFIG_PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
