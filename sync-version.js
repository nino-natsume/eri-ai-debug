#!/usr/bin/env node
'use strict';
// 版本同步：package.json 是唯一版本号来源；PKGBUILD 使用固定 Git tag，避免 AUR 依赖本地源文件。
const fs = require('fs');
const path = require('path');

const root = __dirname;
const file = (name) => path.join(root, name);
const read = (name) => fs.readFileSync(file(name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json 中的 version 不合法：${String(version)}`);
}

function replaceExactlyOne(text, regex, replacement, label) {
  let count = 0;
  const result = text.replace(regex, (...args) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (count !== 1) throw new Error(`${label}: 预期匹配 1 次，实际 ${count} 次`);
  return result;
}

function atomicWrite(name, content) {
  const dest = file(name);
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8' });
  try {
    if (process.platform === 'win32' && fs.existsSync(dest)) {
      const old = `${tmp}.old`;
      fs.renameSync(dest, old);
      try {
        fs.renameSync(tmp, dest);
      } catch (error) {
        if (!fs.existsSync(dest) && fs.existsSync(old)) fs.renameSync(old, dest);
        throw error;
      }
      fs.rmSync(old, { force: true });
    } else {
      fs.renameSync(tmp, dest);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

let pk = read('PKGBUILD');
let si = read('.SRCINFO');
pk = replaceExactlyOne(pk, /^pkgver=.*$/m, `pkgver=${version}`, 'PKGBUILD pkgver');
pk = replaceExactlyOne(pk, /^source=.*$/m,
  `source=("eri-ai-debug::git+https://github.com/nino-natsume/eri-ai-debug.git#tag=v\${pkgver}")`, 'PKGBUILD source');
pk = replaceExactlyOne(pk, /^sha256sums=.*$/m, `sha256sums=('SKIP')`, 'PKGBUILD sha256sums');

si = replaceExactlyOne(si, /^\tpkgver = .*$/m, `\tpkgver = ${version}`, '.SRCINFO pkgver');
// VCS source: .SRCINFO 必须写出展开后的具体 tag；VCS 源以 SKIP 校验，由 Git tag 固定版本。
si = si.replace(/^\tsource = .*$/gm, '').replace(/^\tsha256sums = .*$/gm, '');
si = replaceExactlyOne(si, /^pkgname = eri-ai-debug$/m,
  `\tsource = eri-ai-debug::git+https://github.com/nino-natsume/eri-ai-debug.git#tag=v${version}\n\tsha256sums = SKIP\npkgname = eri-ai-debug`, '.SRCINFO source insertion');
si = si.replace(/\n{2,}/g, '\n');

let lockText = null;
if (fs.existsSync(file('package-lock.json'))) {
  const lock = JSON.parse(read('package-lock.json'));
  if (lock.version !== undefined) lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  lockText = `${JSON.stringify(lock, null, 2)}\n`;
}

// 所有输入检查完毕后再写入，避免版本或源码条目错误时只更新了一半文件。
atomicWrite('PKGBUILD', pk);
atomicWrite('.SRCINFO', si);
if (lockText !== null) atomicWrite('package-lock.json', lockText);
console.log(`==> 版本已同步为 ${version}：PKGBUILD 与 .SRCINFO 的 Git tag；package-lock.json（如存在）`);
