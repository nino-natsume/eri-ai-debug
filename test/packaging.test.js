'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const lineStartingWith = (text, prefix) =>
  text.split(/\r?\n/).find((line) => line.startsWith(prefix));

test('AUR metadata tracks package.json version and a fixed upstream VCS tag', () => {
  const build = read('PKGBUILD');
  const srcinfo = read('.SRCINFO');

  // package.json is the single source of truth for this test repo version.
  assert.equal(lineStartingWith(build, 'pkgver='), `pkgver=${pkg.version}`);
  assert.equal(
    lineStartingWith(build, 'source='),
    'source=("eri-ai-debug::git+https://github.com/nino-natsume/eri-ai-debug.git#tag=v${pkgver}")'
  );
  assert.equal(lineStartingWith(build, 'sha256sums='), "sha256sums=('SKIP')");

  assert.equal(lineStartingWith(srcinfo, '\tpkgver = '), `\tpkgver = ${pkg.version}`);
  assert.equal(
    lineStartingWith(srcinfo, '\tsource = '),
    `\tsource = eri-ai-debug::git+https://github.com/nino-natsume/eri-ai-debug.git#tag=v${pkg.version}`
  );
  assert.equal(lineStartingWith(srcinfo, '\tsha256sums = '), '\tsha256sums = SKIP');
  assert.equal((srcinfo.match(/^\tsource = /gm) || []).length, 1);
  assert.equal((srcinfo.match(/^\tsha256sums = /gm) || []).length, 1);
});

test('every file copied by PKGBUILD exists in the source checkout', () => {
  const build = read('PKGBUILD');
  const packageBlock = build.match(/for f in \\\n([\s\S]*?)\; do/);
  assert.ok(packageBlock, 'PKGBUILD file install list should be parseable');
  const entries = packageBlock[1]
    .replace(/\\\s*\n/g, ' ')
    .trim()
    .split(/\s+/);
  const missing = entries.filter((entry) => !fs.existsSync(path.join(root, entry)));
  assert.deepEqual(missing, [], `missing package files: ${missing.join(', ')}`);
});

test('README preserves header artwork and documents the current eri-ai-debug TUI version', () => {
  const readme = read('README.md');
  assert.equal(pkg.name, 'eri-ai-debug');
  assert.equal(pkg.version, '0.0.2');
  assert.equal(pkg.homepage, 'https://github.com/nino-natsume/eri-ai-debug');
  assert.equal(pkg.repository.url, 'git+https://github.com/nino-natsume/eri-ai-debug.git');
  assert.notEqual(
    pkg.private,
    true,
    'npm-publishable package must not set private: true; remove private:true from package.json to publish'
  );
  assert.ok(readme.startsWith('<img src="https://img.107211.xyz/file/img/UEcg2RpU.webp" width="400" height="400" alt="绘里酱" align="right" />'));
  assert.match(
    readme,
    /\[!\[License: AGPL-3\.0-or-later\]\(https:\/\/img\.shields\.io\/badge\/License-AGPL--3\.0--or--later-blue\.svg\)\]\(\.\/LICENSE\)/,
    'license badge must be static and link to the local license file'
  );
  const license = read('LICENSE');
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 19 November 2007/);
  assert.doesNotMatch(readme, /img\.shields\.io\/github\/license\/nino-natsume\/eri-ai-debug/);
  assert.match(readme, /https:\/\/github\.com\/nino-natsume\/eri-ai-debug/);
  assert.match(readme, /git clone https:\/\/github\.com\/nino-natsume\/eri-ai-debug\.git/);
  assert.match(readme, /https:\/\/github\.com\/user-attachments\/assets\/46969d8f-a4db-4db4-bf0e-c68b49f94588/);
  assert.match(readme, new RegExp(`版本为 \\*\\*${pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*`));
  assert.match(readme, /六行 ANSI Shadow 风格的 \*\*ERI 艺术字\*\*/);
  assert.match(readme, /首页只绘制前景色，不设置终端背景色/);
  assert.match(readme, /透明背景示意/);
  assert.doesNotMatch(readme, /JetBrains Maple Mono|fonts\.107211\.xyz|eri-ai-debug font (?:install|apply|status)/i, 'README must not include font documentation');
  assert.ok(readme.includes('当前仓库与 npm 包统一命名为 **`eri-ai-debug`**'), 'README must use one project name for both repository and npm package');
  assert.doesNotMatch(readme, /1\.1\.7|1\.3\.0/);
});


test('public project, package and CLI names consistently use eri-ai-debug', () => {
  assert.deepEqual(pkg.bin, { 'eri-ai-debug': 'index.js' });
  assert.ok(Object.keys(pkg.scripts).some((name) => name === 'eri-ai-debug:help'));
  assert.equal(pkg.homepage, 'https://github.com/nino-natsume/eri-ai-debug');
  assert.equal(pkg.repository.url, 'git+https://github.com/nino-natsume/eri-ai-debug.git');
  assert.equal(JSON.parse(read('opencode-package.json')).name, 'eri-ai-debug-opencode-config');
  assert.match(read('ui/core.js'), /\.eri-ai-debug-panel\.json/);

  const formerName = ['eri', 'debug'].join('-');
  const publicFiles = [
    'package.json', 'README.md', 'SKILL.md',
    'index.js', 'install-eri.sh', 'install-eri.ps1', 'eri.install',
    'PKGBUILD', '.SRCINFO', 'sync-version.js', 'opencode-package.json',
    'ui/core.js', 'lib/config.js', 'lib/font.js',
  ];
  for (const name of publicFiles) {
    assert.doesNotMatch(read(name), new RegExp(`\\b${formerName}\\b`), `${name} contains a legacy project/CLI name`);
  }
});
