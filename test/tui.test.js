'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageMeta = require('../package.json');
const {
  visibleWidth,
  fitAnsi,
  renderMainMenuPreview,
  mainMenuItems,
  ERI_BANNER,
} = require('../lib/tui');

test('TUI display-width helpers count CJK as two terminal cells', () => {
  assert.equal(visibleWidth('ERI 绘里酱'), 10);
  assert.equal(visibleWidth('\u001b[31m绘里酱\u001b[0m'), 6);
});

test('TUI clipping preserves terminal cell width and cannot overflow the frame', () => {
  assert.ok(visibleWidth(fitAnsi('绘里酱终端管理', 7)) <= 7);
  const frame = renderMainMenuPreview({ width: 80, height: 32, cursor: 0 });
  for (const line of frame.split('\n')) {
    assert.equal(visibleWidth(line), 80, `frame line width mismatch: ${line}`);
  }
});

test('main menu is intentionally short and opens feature submenus', () => {
  const items = mainMenuItems();
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((item) => item.label), [
    '开始使用', '工具与人格', '模型与账号', '设置与诊断', '退出 Eri',
  ]);
  assert.ok(items.every((item) => !/OpenCode 深度集成|更新人格|环境诊断|配置导入/.test(item.label)));
});

test('Eri home preview shows hero title and only top-level menu entries', () => {
  const frame = renderMainMenuPreview({ version: packageMeta.version, height: 24, width: 76 });
  assert.match(frame, /Eri/);
  assert.match(frame, /MENU/);
  assert.ok(frame.includes(`绘里酱 · Terminal AI Assistant · v${packageMeta.version}`));
  assert.doesNotMatch(frame, /E R I\s*·\s*T E R M I N A L/);
  assert.match(frame, /开始使用/);
  assert.match(frame, /工具与人格/);
  assert.match(frame, /模型与账号/);
  assert.match(frame, /设置与诊断/);
  assert.doesNotMatch(frame, /字体：.*(?:已安装|未安装)/, 'home TUI must not show font installation status');
  assert.ok(ERI_BANNER.length === 6);
  assert.ok(ERI_BANNER.some((line) => line.includes('█')));
  assert.doesNotMatch(frame, /OpenCode 深度集成|选择推荐免费模型|终端工具选择/);
  assert.match(frame, /Enter 选择/);
  assert.ok(frame.split('\n').length <= 24);
  for (const line of frame.split('\n')) assert.equal(visibleWidth(line), 76);
});

test('TUI font submenu does not query or render installed/uninstalled status', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tui.js'), 'utf8');
  assert.doesNotMatch(source, /getFontStatus|fontStatus|status\.installed|未检测到 Medium 字体文件|安装状态/);
  assert.match(source, /安装并应用字体/);
  assert.match(source, /应用字体配置/);
});

test('menu viewport keeps the current row visible on a short terminal', () => {
  const frame = renderMainMenuPreview({ width: 80, height: 20, cursor: 4 });
  assert.match(frame, /› 05  退出 Eri/);
  assert.ok(frame.split('\n').length <= 20);
  for (const line of frame.split('\n')) assert.equal(visibleWidth(line), 80);
});


test('home title uses six-line Miyu-style bold italic gradient art and does not paint a background', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tui.js'), 'utf8');
  assert.match(source, /BANNER_BLUE/);
  assert.match(source, /BANNER_CORAL/);
  assert.match(source, /renderGradientArt/);
  assert.equal(ERI_BANNER.length, 6);
  assert.ok(ERI_BANNER.some((line) => line.includes('█')));
  assert.doesNotMatch(source, /\\x1b\[(?:[0-9]+;)*(?:4[0-9]|49)(?:;[0-9]+)*m/, 'TUI must not set a terminal background color');
  const frame = renderMainMenuPreview({ width: 80, height: 24, cursor: 0, forceColor: true });
  const sgr = frame.match(/\u001b\[[0-9;]*m/g) || [];
  assert.ok(sgr.some((sequence) => sequence.startsWith('\u001b[38;2;')), 'banner should use an RGB foreground gradient');
  assert.ok(sgr.includes('\u001b[1;3m'), 'banner headline should use bold italic styling like Miyu');
  assert.ok(sgr.every((sequence) => !/(?:^|;)(?:4[0-9]|48|49)(?:;|$)/.test(sequence.slice(2, -1))));
});

test('home menu is separated from the large Miyu-style banner by generous vertical spacing', () => {
  const frame = renderMainMenuPreview({ width: 80, height: 24, cursor: 0 });
  const rows = frame.split('\n').map((row) => row.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ''));
  const tagline = rows.findIndex((row) => row.includes('A little AI companion in your terminal'));
  const menu = rows.findIndex((row) => row.includes('MENU'));
  assert.ok(tagline >= 0 && menu >= 0);
  assert.ok(menu - tagline >= 5, `expected generous blank space, got ${menu - tagline - 1} blank rows`);
});
