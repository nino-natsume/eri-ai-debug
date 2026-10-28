#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');
const { parse, modify, applyEdits } = require('./lib/jsonc-lite');
const { DEFAULT_MODEL, FREE_MODELS, configPath, loadConfig, saveConfig, defaultConfig } = require('./lib/config');
const { runTui, toolPicker, configMenu } = require('./lib/tui');
const { installAndApplyFont, applyTerminalFont, getFontStatus, showFontGuide } = require('./lib/font');

const HOME = os.homedir();
const SCRIPT_DIR = __dirname;
const PKG_DIR = '/usr/share/eri-ai-debug';
const DEFAULT_URL = 'https://raw.githubusercontent.com/nino-natsume/eri-ai-debug/main/eri.md';

let VERSION = '0.0.0';
try { VERSION = require('./package.json').version; } catch { /* ignore */ }

const h = (...a) => path.join(HOME, ...a);

const TOOLS = [
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', pdir: h('.config', 'opencode', 'agents'), pfile: 'eri.md' },
  { id: 'claude', name: 'Claude Code', cmd: 'claude', pdir: h('.claude'), pfile: 'CLAUDE.md' },
  { id: 'codex', name: 'Codex CLI (OpenAI)', cmd: 'codex', pdir: h('.codex'), pfile: 'AGENTS.md' },
  { id: 'gemini', name: 'Gemini CLI (Google)', cmd: 'gemini', pdir: h('.gemini'), pfile: 'GEMINI.md' },
  { id: 'qwen', name: 'Qwen Code (Alibaba)', cmd: 'qwen', pdir: h('.qwen'), pfile: 'GEMINI.md' },
  { id: 'aider', name: 'Aider', cmd: 'aider', pdir: h('.config', 'aider'), pfile: 'eri.md', mode: 'aider' },
  { id: 'cursor', name: 'Cursor CLI', cmd: 'cursor-agent', pdir: h('.cursor'), pfile: 'AGENTS.md' },
  { id: 'windsurf', name: 'Windsurf CLI', cmd: 'windsurf', pdir: h('.windsurf'), pfile: 'AGENTS.md' },
  { id: 'amp', name: 'Amp', cmd: 'amp', pdir: h('.amp'), pfile: 'AGENTS.md' },
  { id: 'goose', name: 'Goose (Block)', cmd: 'goose', pdir: h('.config', 'goose'), pfile: 'AGENTS.md' },
  { id: 'copilot', name: 'GitHub Copilot CLI', cmd: 'copilot', pdir: h('.github', 'copilot'), pfile: 'AGENTS.md' },
  { id: 'plandex', name: 'Plandex', cmd: 'plandex', pdir: h('.plandex'), pfile: 'AGENTS.md' },
  { id: 'tabby', name: 'Tabby', cmd: 'tabby-agent', pdir: h('.tabby'), pfile: 'AGENTS.md' },
  { id: 'fabric', name: 'Fabric', cmd: 'fabric', pdir: h('.config', 'fabric'), pfile: 'AGENTS.md' },
  { id: 'openhands', name: 'OpenHands', cmd: 'openhands', pdir: h('.openhands'), pfile: 'AGENTS.md' },
  { id: 'crush', name: 'Crush', cmd: 'crush', pdir: h('.crush'), pfile: 'AGENTS.md' },
  { id: 'devin', name: 'Devin CLI', cmd: 'devin', pdir: h('.devin'), pfile: 'AGENTS.md' },
  { id: 'continue', name: 'Continue', cmd: 'continue', pdir: h('.continue'), pfile: 'AGENTS.md' },
];

const RC_FILES = [
  h('.bashrc'), h('.bash_profile'), h('.zshrc'), h('.profile'), h('.zprofile'),
  h('.kshrc'), h('.config', 'fish', 'config.fish'), h('.tcshrc'), h('.cshrc'),
];

function getOpenCodeConfigPath(configDir) {
  const jsonc = path.join(configDir, 'opencode.jsonc');
  const json = path.join(configDir, 'opencode.json');

  if (fs.existsSync(jsonc)) return jsonc;
  if (fs.existsSync(json)) return json;

  return jsonc;
}

// ---------------------------------------------------------------- utilities

function commandExists(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const d of dirs) {
    for (const ext of exts) {
      const full = path.join(d, cmd + ext);
      try {
        if (!fs.statSync(full).isFile()) continue;
        if (process.platform !== 'win32') {
          fs.accessSync(full, fs.constants.X_OK);
        }
        return full;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

function sameContent(a, b) {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; }
}

function timestampSuffix() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '') + `-${process.pid}`;
}

function backupExistingFile(target) {
  if (!fs.existsSync(target)) return null;
  const firstBackup = `${target}.bak`;
  const backup = fs.existsSync(firstBackup)
    ? `${target}.eri-backup-${timestampSuffix()}`
    : firstBackup;
  fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  console.log(`  备份现有文件: ${backup}`);
  return backup;
}

// 保留首次安装前的 .bak；已有 .bak 时，仍将本次覆盖前内容保存为带时间戳的副本。
function copyWithBackup(src, target) {
  mkdirp(path.dirname(target));
  if (fs.existsSync(target) && !sameContent(src, target)) {
    backupExistingFile(target);
  }
  if (!sameContent(src, target)) {
    const tmp = `${target}.eri-tmp-${process.pid}`;
    fs.copyFileSync(src, tmp);
    try {
      if (process.platform === 'win32' && fs.existsSync(target)) {
        const old = `${tmp}.old`;
        fs.renameSync(target, old);
        try {
          fs.renameSync(tmp, target);
        } catch (err) {
          if (!fs.existsSync(target) && fs.existsSync(old)) fs.renameSync(old, target);
          throw err;
        }
        fs.rmSync(old, { force: true });
      } else {
        fs.renameSync(tmp, target);
      }
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}

// 卸载前保存当前文件，避免把用户后来编辑的内容直接丢弃。
function preserveBeforeUninstall(target) {
  if (!fs.existsSync(target)) return null;
  const archive = `${target}.eri-uninstall-${timestampSuffix()}`;
  fs.copyFileSync(target, archive, fs.constants.COPYFILE_EXCL);
  return archive;
}

// 定位 Bun 运行时（面板独立窗口依赖 bun:ffi）。npm 的 bun.cmd 垫片旁通常有真 exe。
function findBun() {
  if (process.versions && process.versions.bun) return process.execPath;
  const found = commandExists('bun');
  if (!found) return null;
  if (/\.(cmd|bat)$/i.test(found)) {
    const real = path.join(path.dirname(found), 'node_modules', 'bun', 'bin', 'bun.exe');
    try { if (fs.statSync(real).isFile()) return real; } catch { /* ignore */ }
  }
  return found;
}

function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }

function firstExisting(paths) {
  for (const p of paths) { if (fs.existsSync(p)) return p; }
  return null;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve(ans); });
  });
}

function download(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error('URL 格式无效')); return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error('仅允许 http/https 下载地址'));
      return;
    }
    if (depth > 5) {
      reject(new Error('重定向次数过多'));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(parsed, { headers: { 'User-Agent': 'eri-ai-debug' } }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, parsed).toString();
        resolve(download(nextUrl, dest, depth + 1));
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`HTTP ${code}`));
        return;
      }
      const file = fs.createWriteStream(dest, { flags: 'w', mode: 0o600 });
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        file.destroy();
        try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
        reject(err);
      };
      file.on('error', fail);
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('下载连接中断')));
      file.on('finish', () => {
        file.close((err) => {
          if (err) return fail(err);
          if (settled) return;
          settled = true;
          resolve(dest);
        });
      });
      res.pipe(file);
    });
    req.setTimeout(30000, () => req.destroy(new Error('下载超时（30 秒）')));
    req.on('error', (err) => {
      try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
      reject(err);
    });
  });
}

async function resolvePersona(rawUrl) {
  const local = firstExisting([path.join(SCRIPT_DIR, 'eri.md'), path.join(PKG_DIR, 'eri.md')]);
  const tmp = path.join(os.tmpdir(), `eri-${process.pid}-${Date.now()}.md`);
  console.log(`==> 下载人格文件: ${rawUrl}`);
  try {
    await download(rawUrl, tmp);
    return { file: tmp, cleanup: true };
  } catch (err) {
    if (local && rawUrl === DEFAULT_URL) {
      console.log(`==> 默认人格下载失败(${err.message}), 改用本地人格文件: ${local}`);
      return { file: local, cleanup: false };
    }
    throw new Error(`下载失败: ${rawUrl} (${err.message})`);
  }
}

// ------------------------------------------------------- config manipulation

function parseOpenCodeJsonc(text, cfgPath) {
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) {
    const e = errors[0];
    throw new Error(`OpenCode 配置解析失败，未修改原文件：${cfgPath}（offset=${e.offset}, code=${e.error}）`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`OpenCode 配置根节点必须是对象，未修改原文件：${cfgPath}`);
  }
  return value;
}

function updateOpenCodeJsonc(cfgPath, key, value) {
  const exists = fs.existsSync(cfgPath);
  const before = exists
    ? fs.readFileSync(cfgPath, 'utf8')
    : '{\n}\n';

  parseOpenCodeJsonc(before, cfgPath); // 修改前校验
  const edits = modify(before, [key], value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: before.includes('\r\n') ? '\r\n' : '\n',
    },
  });
  const after = applyEdits(before, edits);
  parseOpenCodeJsonc(after, cfgPath); // 写入前再次校验

  // 临时文件与目标文件位于同一目录，避免写一半留下半份 JSONC。
  const tmp = `${cfgPath}.eri-tmp-${process.pid}`;
  const mode = exists ? (fs.statSync(cfgPath).mode & 0o777) : 0o600;
  fs.writeFileSync(tmp, after, { encoding: 'utf8', mode });
  if (exists) fs.chmodSync(tmp, mode);
  try {
    if (process.platform === 'win32' && fs.existsSync(cfgPath)) {
      const old = `${tmp}.old`;
      fs.renameSync(cfgPath, old);
      try {
        fs.renameSync(tmp, cfgPath);
      } catch (err) {
        if (!fs.existsSync(cfgPath) && fs.existsSync(old)) fs.renameSync(old, cfgPath);
        throw err;
      }
      fs.rmSync(old, { force: true });
    } else {
      fs.renameSync(tmp, cfgPath);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function setOpenCodeDefaultAgent(cfgPath, agentName) {
  if (!fs.existsSync(cfgPath)) {
    mkdirp(path.dirname(cfgPath));
    const initial = `${JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      default_agent: agentName,
    }, null, 2)}\n`;
    // 新建配置同样通过临时文件写入。
    const tmp = `${cfgPath}.eri-tmp-${process.pid}`;
    fs.writeFileSync(tmp, initial, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, cfgPath);
    return;
  }
  const before = fs.readFileSync(cfgPath, 'utf8');
  const root = parseOpenCodeJsonc(before, cfgPath);
  if (root.default_agent === agentName) return;
  backupExistingFile(cfgPath);
  updateOpenCodeJsonc(cfgPath, 'default_agent', agentName);
}

function updateAiderRead(cfgPath, personaFile) {
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(cfgPath, `read: ${JSON.stringify(personaFile)}\n`, { mode: 0o600 });
    return;
  }

  const content = fs.readFileSync(cfgPath, 'utf8');
  if (content.includes(personaFile)) {
    console.log('    aider read 已包含本路径,无需修改');
    return;
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const readIndex = lines.findIndex((line) => /^read\s*:/.test(line));
  let out;

  if (readIndex >= 0) {
    const match = lines[readIndex].match(/^read\s*:\s*(.*)$/);
    const value = match ? match[1].trim() : '';
    if (value !== '') {
      console.warn(`==> Aider read 字段不是空的多行列表；为避免破坏 YAML，未自动修改：${cfgPath}`);
      console.warn(`    请手动将路径加入 read：${personaFile}`);
      return;
    }
    backupExistingFile(cfgPath);
    out = [...lines.slice(0, readIndex + 1), `  - ${JSON.stringify(personaFile)}`, ...lines.slice(readIndex + 1)];
  } else {
    backupExistingFile(cfgPath);
    out = [...lines, `read: ${JSON.stringify(personaFile)}`];
  }

  const finalText = out.join(newline);
  fs.writeFileSync(cfgPath, finalText, { mode: fs.statSync(cfgPath).mode & 0o777 });
}

function removeAiderRead(cfgPath, personaFile) {
  if (!fs.existsSync(cfgPath)) return;
  const content = fs.readFileSync(cfgPath, 'utf8');
  if (!content.includes(personaFile)) return;

  const lines = content.split(/\r?\n/);
  const out = [];
  let inReadList = false;
  let readIndent = 0;

  for (const line of lines) {
    const keyMatch = line.match(/^(\s*)read\s*:\s*(.*)$/);
    if (keyMatch && keyMatch[1].length === 0) {
      inReadList = false;
      const value = keyMatch[2].trim();
      if (value === '') {
        out.push(line);
        inReadList = true;
        readIndent = 0;
        continue;
      }
      if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        const items = inner === '' ? [] : inner.split(',').map((s) => s.trim());
        const filtered = items.filter((item) => item !== personaFile && item !== `"${personaFile}"` && item !== `'${personaFile}'`);
        out.push(`read: [${filtered.join(', ')}]`);
        continue;
      }
      // Plain scalar parsing is ambiguous when paths contain spaces; fail closed.
      console.warn(`==> Aider read 配置不是可安全识别的列表，未自动修改：${cfgPath}`);
      out.push(line);
      continue;
    }

    if (inReadList) {
      if (/^\s*-[ \t]+/.test(line)) {
        if (line.includes(personaFile)) continue;
        out.push(line);
        continue;
      }
      if (line.trim() !== '' && !/^\s*#/.test(line) && !/^\s/.test(line)) {
        inReadList = false;
      }
    }
    out.push(line);
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const finalText = out.join(newline) + (content.endsWith('\n') ? newline : '');
  fs.writeFileSync(cfgPath, finalText, { mode: fs.statSync(cfgPath).mode & 0o777 });
}

function removeOpenCodeDefaultAgent(cfgPath) {
  if (!fs.existsSync(cfgPath)) return false;
  const before = fs.readFileSync(cfgPath, 'utf8');
  const root = parseOpenCodeJsonc(before, cfgPath);
  // 只移除顶层且值确实为 eri 的配置，不碰用户自己的其他 default_agent。
  if (root.default_agent !== 'eri') return false;
  updateOpenCodeJsonc(cfgPath, 'default_agent', undefined);
  return true;
}

// ----------------------------------------------------------- persona deploy

function deployPersona(tool, srcFile) {
  mkdirp(tool.pdir);
  const target = path.join(tool.pdir, tool.pfile);

  copyWithBackup(srcFile, target);
  console.log(`  updated: ${target}`);

  if (tool.mode === 'aider') {
    updateAiderRead(h('.aider.conf.yml'), target);
  }
  if (tool.id === 'opencode') {
    const cfgDir = path.dirname(tool.pdir);
	const cfg = getOpenCodeConfigPath(cfgDir);
	setOpenCodeDefaultAgent(cfg, path.basename(tool.pfile, '.md'));
    console.log(`    opencode.jsonc: default_agent = ${path.basename(tool.pfile, '.md')}`);
  }
}

function installedTools() {
  return TOOLS.filter((t) => commandExists(t.cmd));
}

// ------------------------------------------------------------ deep integrate

function deepSrc() {
  for (const d of [SCRIPT_DIR, PKG_DIR]) {
    if (fs.existsSync(path.join(d, 'personality.json'))) return d;
  }
  return null;
}

function deepPick(dir, rel, flat) {
  const relPath = path.join(dir, rel);
  if (fs.existsSync(relPath)) return relPath;
  const flatPath = path.join(dir, flat);
  if (fs.existsSync(flatPath)) return flatPath;
  return null;
}

async function deployDeep() {
  const src = deepSrc();
  if (!src) {
    console.error('==> 错误：未找到深度部署资源(personality.json)');
    return false;
  }
  const cfg = h('.config', 'opencode');
  mkdirp(path.join(cfg, 'agent'));
  mkdirp(path.join(cfg, 'skill', 'eri'));

  copyWithBackup(path.join(src, 'personality.json'), path.join(cfg, 'personality.json'));
  console.log(`==> personality.json -> ${path.join(cfg, 'personality.json')}`);

  for (const a of ['erotic-chan', 'code-monkey', 'debug-san', 'architect-sama', 'test-chan']) {
    const f = deepPick(src, path.join('agent', `${a}.md`), `${a}.md`);
    if (f) {
      copyWithBackup(f, path.join(cfg, 'agent', `${a}.md`));
      console.log(`==> agent/${a}.md -> ${path.join(cfg, 'agent', `${a}.md`)}`);
    } else {
      console.warn(`==> 警告：缺少子智慧体 ${a}.md,已跳过`);
    }
  }

  const skill = deepPick(src, path.join('skill', 'eri', 'SKILL.md'), 'SKILL.md');
  if (skill) {
    copyWithBackup(skill, path.join(cfg, 'skill', 'eri', 'SKILL.md'));
    console.log(`==> SKILL.md -> ${path.join(cfg, 'skill', 'eri', 'SKILL.md')}`);
  } else {
    console.warn('==> 警告：缺少 SKILL.md,skill 不可用');
  }

  const oc = getOpenCodeConfigPath(cfg);
  if (!fs.existsSync(oc)) {
    copyWithBackup(path.join(src, 'opencode.json'), path.join(cfg, 'opencode.jsonc'));
    console.log(`==> opencode.json -> ${path.join(cfg, 'opencode.jsonc')}`);
  } else {
    const content = fs.readFileSync(oc, 'utf8');
    let currentConfig;
    try {
      currentConfig = parseOpenCodeJsonc(content, oc);
    } catch (err) {
      console.error(`==> ${err.message}`);
      console.error('    为保护现有配置，已跳过深度模板覆盖。');
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(currentConfig, 'plugin')) {
      console.log(`==> 已有 opencode 配置含 plugin 字段,跳过模板写入: ${oc}`);
    } else {
      let writeTpl = false;
      if (process.stdin.isTTY) {
        const ans = await ask('已有 opencode 配置缺少深度集成字段，是否先备份再用模板覆盖？[y/N] ');
        writeTpl = ans === 'y' || ans === 'Y' || ans === 'yes' || ans === 'YES';
      } else {
        console.warn('==> 非交互模式：保留现有 OpenCode 配置，不自动覆盖。');
      }
      if (writeTpl) {
        const oldAgent = typeof currentConfig.default_agent === 'string'
          ? currentConfig.default_agent
          : null;
        copyWithBackup(path.join(src, 'opencode.json'), oc);
        console.log(`==> 深度配置已写入: ${oc} (旧配置备份已保留)`);
        if (oldAgent) {
          setOpenCodeDefaultAgent(oc, oldAgent);
          console.log(`==> 已保留原 default_agent = ${oldAgent}`);
        }
      } else {
        console.log(`注意：请手动合并 ${path.join(src, 'opencode.json')} 中的 plugin/agent/skills/command 字段到 ${oc}`);
      }
    }
  }

  const srcManifest = path.join(src, 'opencode-package.json');
  if (fs.existsSync(srcManifest) && !fs.existsSync(path.join(cfg, 'package.json'))) {
    fs.copyFileSync(srcManifest, path.join(cfg, 'package.json'));
    console.log(`==> package.json (OpenCode 依赖清单) -> ${path.join(cfg, 'package.json')}`);
  }
  const srcLock = path.join(src, 'opencode-package-lock.json');
  if (fs.existsSync(srcLock) && !fs.existsSync(path.join(cfg, 'package-lock.json'))) {
    fs.copyFileSync(srcLock, path.join(cfg, 'package-lock.json'));
    console.log(`==> package-lock.json -> ${path.join(cfg, 'package-lock.json')}`);
  }

  if (!commandExists('npm')) {
    console.error('==> 错误：未找到 npm,请先安装 Node.js/npm 后重试');
    return false;
  }
  console.log(`==> 在 ${cfg} 执行 npm install ...`);
  const npmArgs = ['install', '--no-audit', '--no-fund'];
  const r = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd ' + npmArgs.join(' ')], { cwd: cfg, encoding: 'utf8' })
    : spawnSync('npm', npmArgs, { cwd: cfg, encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error('==> 错误：npm install 失败,请检查网络后在配置目录下重试');
    return false;
  }

  console.log('==> OpenCode 深度部署完成！重启 opencode 生效。');
  console.log('    之后可用 /personality 管理人格, /force-chat 与 /force-work 切换模式, /mood 设置心情。');
  return true;
}

// ----------------------------------------------------------------- commands

function showHelp() {
  console.log(`eri-ai-debug - 绘里酱跨平台终端助手 (v${VERSION})

用法:
  eri-ai-debug                         打开交互式 TUI
  eri-ai-debug tui                     打开交互式 TUI（显式命令）
  eri-ai-debug init [--reset-config]   初始化 Eri 用户配置
  eri-ai-debug chat [--model ID]       使用 OpenCode TUI 聊天（默认 OpenCode Zen 免费模型）
  eri-ai-debug dev [--model ID]        进入 OpenCode 开发模式
  eri-ai-debug tools [--list]          终端工具管理：统一选择多个 CLI 并部署人格
  eri-ai-debug config [show|reset|model ID]
                              查看/修改 Eri 默认模型和工具选择
  eri-ai-debug connect                 打开 OpenCode 官方登录/提供商连接流程
  eri-ai-debug models                  刷新并列出 OpenCode 可用模型
  eri-ai-debug sessions                列出 OpenCode 会话
  eri-ai-debug status                  查看安装、模型和工具选择状态
  eri-ai-debug doctor                  检查运行环境和配置
  eri-ai-debug font                    查看字体安装/应用说明
  eri-ai-debug font install [URL]      下载并安装 JetBrains Maple Mono Medium，再应用终端配置
  eri-ai-debug font install --yes      非交互安装 / 跳过大文件确认
  eri-ai-debug font apply              应用已安装字体到已识别终端配置
  eri-ai-debug font status             查看字体文件安装状态
  eri-ai-debug update [RAW_URL]        更新所有已安装工具的人格
  eri-ai-debug update --selected       只更新 eri-ai-debug tools 保存的已选工具
  eri-ai-debug deep                    部署 OpenCode 深度集成
  eri-ai-debug ui                      TUI 主界面别名
  eri-ai-debug panel                   兼容别名：打开 TUI 主界面
  eri-ai-debug export [FILE]           导出 Eri 配置（不含密钥）
  eri-ai-debug import FILE             导入并验证 Eri 配置
  eri-ai-debug uninstall [--yes]       卸载已部署的人格
  eri-ai-debug help | version          显示帮助/版本

默认模型:
  ${DEFAULT_MODEL}

环境变量:
  ERI_MODEL                  临时覆盖默认模型
  ERI_URL                    自定义人格文件 URL
  ERI_CONFIG_HOME            自定义 Eri 配置目录
  ERI_CONFIG_PATH            自定义 Eri 配置文件完整路径
  ERI_FONT_ARCHIVE_URL       自定义字体 ZIP 的 HTTPS 直链（不是网页目录地址）

说明:
  免费模型的服务端可用性、认证和额度可能变化。Eri 通过官方 OpenCode CLI 调用模型，
  不内置共享密钥，也不绕过服务提供商的访问策略。首次使用请执行 eri-ai-debug connect。
`);
}

async function doUpdate(rawUrl, selectedIds = null) {
  const detected = installedTools();
  const tools = Array.isArray(selectedIds)
    ? detected.filter((tool) => selectedIds.includes(tool.id))
    : detected;
  if (tools.length === 0) {
    console.error(Array.isArray(selectedIds)
      ? '==> 没有匹配的已选择且已安装的终端工具；请先运行 eri-ai-debug tools。'
      : '==> 未检测到任何已安装的终端工具');
    process.exitCode = 1;
    return;
  }

  const { file, cleanup } = await resolvePersona(rawUrl || process.env.ERI_URL || DEFAULT_URL);
  let count = 0;
  let failed = 0;
  for (const tool of tools) {
    try {
      deployPersona(tool, file);
      count++;
    } catch (err) {
      failed++;
      console.error(`==> 部署失败 ${tool.name}: ${err.message}`);
    }
  }
  if (cleanup) fs.rmSync(file, { force: true });
  console.log(`==> 已更新 ${count} 个工具的人格文件, 重启对应工具生效♡`);
  if (count === 0 || failed > 0) process.exitCode = 1;
}

async function doUninstall(args) {
  const yes = args.includes('--yes') || args.includes('-y') || args.includes('-yes');
  console.log('==> 绘里酱人格卸载\n');
  console.log('将执行以下操作:');
  console.log('  • 删除/恢复各工具的人格文件 (如 .bak 存在则恢复备份)');
  console.log('  • 清理 OpenCode default_agent 与 aider read 配置');
  console.log('  • 从 shell 配置中移除本工具添加的 PATH 行\n');

  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error('==> 非交互模式, 如需静默卸载请加 --yes (eri-ai-debug uninstall --yes)');
      process.exitCode = 1;
      return;
    }
    const ans = await ask('确认卸载? [y/N] ');
    if (ans !== 'y' && ans !== 'Y') {
      console.log('==> 已取消');
      return;
    }
  }

  for (const tool of TOOLS) {
    const target = path.join(tool.pdir, tool.pfile);
    const backup = `${target}.bak`;
    if (!fs.existsSync(target) && !fs.existsSync(backup)) continue;
    try {
      if (fs.existsSync(target)) {
        const archive = preserveBeforeUninstall(target);
        if (archive) console.log(`  卸载前副本: ${archive}`);
      }
      if (fs.existsSync(backup)) {
        fs.rmSync(target, { force: true });
        fs.renameSync(backup, target);
        console.log(`  已恢复: ${target} (来自备份)`);
      } else if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        console.log(`  已删除: ${target}`);
      }
    } catch (err) {
      console.error(`  卸载文件失败 ${target}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  const aiderCfg = h('.aider.conf.yml');
  const myAiderPath = h('.config', 'aider', 'eri.md');
  let aiderConfigRestored = false;

  if (fs.existsSync(aiderCfg + '.bak')) {
    if (fs.existsSync(aiderCfg)) {
      const archive = preserveBeforeUninstall(aiderCfg);
      if (archive) console.log(`  卸载前 Aider 配置副本: ${archive}`);
    }
    fs.rmSync(aiderCfg, { force: true });
    fs.renameSync(aiderCfg + '.bak', aiderCfg);
    aiderConfigRestored = true;
    console.log(`  已恢复: ${aiderCfg} (来自备份)`);
  }

  // 恢复原始配置后绝不再做 token 清理；只有没有备份可恢复时才清理旧版残留。
  if (!aiderConfigRestored && fs.existsSync(aiderCfg)) {
    const before = fs.readFileSync(aiderCfg, 'utf8');
    removeAiderRead(aiderCfg, myAiderPath);
    if (fs.readFileSync(aiderCfg, 'utf8') !== before) {
      console.log(`  已清理: ${aiderCfg} (移除本工具的 read 路径)`);
    }
  }

  for (const name of ['opencode.jsonc', 'opencode.json']) {
    const cfg = h('.config', 'opencode', name);
    if (fs.existsSync(cfg + '.bak')) {
      if (fs.existsSync(cfg)) {
        const archive = preserveBeforeUninstall(cfg);
        if (archive) console.log(`  卸载前 OpenCode 配置副本: ${archive}`);
      }
      fs.rmSync(cfg, { force: true });
      fs.renameSync(cfg + '.bak', cfg);
      console.log(`  已恢复: ${cfg} (来自备份)`);
      continue; // 恢复后不再清理 default_agent，避免二次修改原配置
    }
    if (removeOpenCodeDefaultAgent(cfg)) {
      console.log(`  已清理: ${cfg} (移除 default_agent)`);
    }
  }

  for (const rc of RC_FILES) {
    if (!fs.existsSync(rc)) continue;
    const lines = fs.readFileSync(rc, 'utf8').split(/\r?\n/);
    let changed = false;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '# eri: ensure ~/.local/bin in PATH') {
        i++;
        changed = true;
        continue;
      }
      out.push(lines[i]);
    }
    if (changed) {
      fs.writeFileSync(rc, out.join('\n'));
      console.log(`  已清理 PATH: ${rc}`);
    }
  }

  const localEri = h('.local', 'bin', 'eri-ai-debug');
  const localEriBackup = `${localEri}.bak`;
  try {
    if (fs.existsSync(localEri) && fs.realpathSync(localEri) !== fs.realpathSync(__filename)) {
      if (fs.existsSync(localEriBackup)) {
        fs.rmSync(localEri, { force: true });
        fs.renameSync(localEriBackup, localEri);
        console.log(`  已恢复安装前的 eri 命令: ${localEri}`);
      } else {
        fs.rmSync(localEri, { force: true });
        console.log(`  已删除: ${localEri}`);
      }
    } else if (!fs.existsSync(localEri) && fs.existsSync(localEriBackup)) {
      fs.renameSync(localEriBackup, localEri);
      console.log(`  已恢复安装前的 eri 命令: ${localEri}`);
    }
  } catch (err) {
    console.error(`  无法处理本地 eri 命令：${err.message}`);
    process.exitCode = 1;
  }

  if (fs.existsSync(h('.config', 'opencode', 'personality.json'))) {
    console.log('\n  提示: OpenCode 深度集成文件仍保留, 未自动移除:');
    console.log('    ~/.config/opencode/personality.json');
    console.log('    ~/.config/opencode/skill/eri/  ~/.config/opencode/agent/  ~/.config/opencode/package.json');
    console.log('    如需彻底移除, 删除上述文件/目录, 并从 opencode.jsonc 中移除 plugin/skills/agent/command 字段');
  }

  console.log('\n==> 卸载完成! 新开终端生效♡');
}

// --------------------------------------------------------------------- main

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function runInteractiveCommand(command, args = []) {
  const executable = commandExists(command);
  if (!executable) {
    console.error(`==> 未找到命令：${command}`);
    return 127;
  }
  let result;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const line = [executable, ...args].map(quoteCmdArg).join(' ');
    result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
      stdio: 'inherit',
      windowsVerbatimArguments: true,
    });
  } else {
    result = spawnSync(executable, args, { stdio: 'inherit' });
  }
  if (result.error) {
    console.error(`==> 启动 ${command} 失败：${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function parseModelArg(args) {
  const index = args.indexOf('--model');
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error('--model 必须是 provider/model 格式，例如 opencode/big-pickle');
  }
  return value;
}

async function launchChat(dev = false, modelOverride = null) {
  const config = loadConfig();
  const model = modelOverride || process.env.ERI_MODEL || config.model || DEFAULT_MODEL;
  if (!commandExists('opencode')) {
    console.error('==> 未检测到 OpenCode CLI。');
    console.error('    请先按官方文档安装 OpenCode，然后执行 eri-ai-debug connect 连接 OpenCode Zen。');
    console.error('    https://opencode.ai/docs/');
    process.exitCode = 1;
    return;
  }
  console.log(`==> 启动 OpenCode${dev ? ' 开发模式' : ''}，模型：${model}`);
  console.log('    模型免费状态、额度和认证由 OpenCode 服务端决定。');
  const args = ['--model', model];
  if (dev) args.push('--agent', 'build');
  const code = runInteractiveCommand('opencode', args);
  if (code !== 0) process.exitCode = code;
}

function printStatus() {
  const config = loadConfig();
  const installed = new Set(installedTools().map((tool) => tool.id));
  const selected = new Set(config.selectedTools);
  console.log(`Eri ${VERSION}`);
  console.log(`配置文件：${configPath()}`);
  console.log(`默认模型：${process.env.ERI_MODEL || config.model}`);
  console.log(`OpenCode CLI：${commandExists('opencode') || '未检测到'}`);
  console.log('终端工具：');
  for (const tool of TOOLS) {
    const mark = installed.has(tool.id) ? '已安装' : '未检测到';
    const choice = selected.size ? (selected.has(tool.id) ? '已选择' : '未选择') : '默认全量';
    console.log(`  ${installed.has(tool.id) ? '[✓]' : '[ ]'} ${tool.name.padEnd(22)} ${mark.padEnd(8)} ${choice}`);
  }
  console.log('\n提示：认证状态请运行 eri-ai-debug connect，或在 OpenCode 中使用 /connect。');
}

function printDoctor() {
  const checks = [];
  checks.push({ name: 'Node.js >= 18', ok: Number(process.versions.node.split('.')[0]) >= 18, detail: process.version });
  checks.push({ name: '配置文件', ok: fs.existsSync(configPath()), detail: configPath() });
  checks.push({ name: 'OpenCode CLI', ok: Boolean(commandExists('opencode')), detail: commandExists('opencode') || '未安装；TUI 聊天需要 OpenCode' });
  checks.push({ name: 'npm', ok: Boolean(commandExists('npm')), detail: commandExists('npm') || '未检测到 npm' });
  checks.push({ name: '人格源文件', ok: fs.existsSync(path.join(SCRIPT_DIR, 'eri.md')) || fs.existsSync(path.join(PKG_DIR, 'eri.md')), detail: 'eri.md' });
  const installed = new Set(installedTools().map((tool) => tool.id));
  const config = loadConfig();
  const selected = config.selectedTools.length ? config.selectedTools : null;
  for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}: ${item.detail}`);
  if (selected) {
    const missing = selected.filter((id) => !installed.has(id));
    if (missing.length) console.log(`! 已选择但未安装的工具：${missing.join(', ')}`);
  }
  console.log('\n诊断不会自动安装软件或修改 OpenCode 配置。');
  if (checks.some((item) => !item.ok && item.name !== '配置文件')) process.exitCode = 1;
}

function initialize(resetConfig = false) {
  const file = configPath();
  if (fs.existsSync(file) && !resetConfig) {
    console.log(`Eri 配置已存在：${file}`);
    console.log('如需重新生成默认配置，请执行 eri-ai-debug init --reset-config。');
    return;
  }
  if (fs.existsSync(file) && resetConfig) {
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
    console.log(`旧配置已备份：${backup}`);
  }
  saveConfig(defaultConfig());
  console.log(`Eri 配置已初始化：${file}`);
  console.log(`默认模型：${DEFAULT_MODEL}`);
  if (commandExists('opencode')) {
    console.log('下一步：运行 eri-ai-debug connect，在官方登录流程中选择 OpenCode Zen。');
  } else {
    console.log('下一步：安装 OpenCode CLI，随后运行 eri-ai-debug connect。');
  }
}

function exportConfig(destination) {
  const target = path.resolve(destination || `eri-config-${new Date().toISOString().slice(0, 10)}.json`);
  const config = loadConfig();
  // 当前配置只保存模型和工具选择，不保存 API key。
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(`已导出配置：${target}`);
}

function importConfig(source) {
  if (!source) throw new Error('用法：eri import FILE');
  const text = fs.readFileSync(path.resolve(source), 'utf8');
  const incoming = JSON.parse(text);
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('导入文件根节点必须是对象');
  const current = loadConfig();
  const merged = {
    ...current,
    model: typeof incoming.model === 'string' ? incoming.model : current.model,
    selectedTools: Array.isArray(incoming.selectedTools) ? incoming.selectedTools : current.selectedTools,
    mode: incoming.mode === 'dev' ? 'dev' : 'normal',
    fontFamily: typeof incoming.fontFamily === 'string' ? incoming.fontFamily : current.fontFamily,
    fontWeight: typeof incoming.fontWeight === 'string' ? incoming.fontWeight : current.fontWeight,
    fontSource: typeof incoming.fontSource === 'string' ? incoming.fontSource : current.fontSource,
  };
  const file = saveConfig(merged);
  console.log(`已导入并验证配置：${file}`);
}

function printTools() {
  const installed = new Set(installedTools().map((tool) => tool.id));
  console.log('终端工具：');
  for (const tool of TOOLS) console.log(`  ${installed.has(tool.id) ? '[✓]' : '[ ]'} ${tool.id.padEnd(12)} ${tool.name} (${tool.cmd})`);
}

async function runToolsSubcommand() {
  if (process.argv.includes('--list') || !process.stdin.isTTY) {
    printTools();
    return;
  }
  const api = createTuiApi();
  await toolPicker(api, { deployAfter: true });
}

function createTuiApi() {
  return {
    TOOLS,
    configPath,
    loadConfig,
    saveConfig,
    installedTools,
    chat: launchChat,
    connect: async () => {
      if (!commandExists('opencode')) {
        console.error('未检测到 OpenCode CLI；请先安装它。');
        process.exitCode = 1;
        return;
      }
      const code = runInteractiveCommand('opencode', ['auth', 'login']);
      if (code !== 0) process.exitCode = code;
    },
    models: async () => {
      const code = runInteractiveCommand('opencode', ['models', '--refresh']);
      if (code !== 0) process.exitCode = code;
    },
    sessions: async () => {
      const code = runInteractiveCommand('opencode', ['session', 'list']);
      if (code !== 0) process.exitCode = code;
    },
    update: (ids = null) => doUpdate(DEFAULT_URL, ids),
    exportConfig,
    importConfig,
    version: VERSION,
    deep: async () => {
      const ok = await deployDeep();
      if (!ok) process.exitCode = 1;
    },
    status: printStatus,
    doctor: printDoctor,
    uninstall: (args = []) => doUninstall(args),
    fontInstall: async () => {
      const result = await installAndApplyFont();
      if (!result.installed && !result.cancelled) process.exitCode = 1;
      return result;
    },
    fontApply: applyTerminalFont,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await runTui(createTuiApi());
    } else {
      // 无交互终端时不应将裸 `eri-ai-debug` 解释为联网更新，避免脚本/CI 中意外写配置。
      showHelp();
    }
    return;
  }
  const sub = args[0];

  switch (sub) {
    case 'help': case '-h': case '--help': showHelp(); return;
    case 'version': case '-v': case '-V': case '--version': console.log(VERSION); return;
    case 'init': initialize(args.includes('--reset-config')); return;
    case 'chat': await launchChat(false, parseModelArg(args.slice(1))); return;
    case 'dev': await launchChat(true, parseModelArg(args.slice(1))); return;
    case 'tools': await runToolsSubcommand(); return;
    case 'status': printStatus(); return;
    case 'doctor': printDoctor(); return;
    case 'font': {
      const action = args[1] || 'help';
      if (action === 'install') {
        const archiveUrl = args.slice(2).find((arg) => !arg.startsWith('--'));
        const result = await installAndApplyFont({ archiveUrl, yes: args.includes('--yes') });
        console.log(result.message);
        if (!result.installed && !result.cancelled) process.exitCode = 1;
        return;
      }
      if (action === 'apply') {
        const result = applyTerminalFont();
        console.log(result.message);
        for (const item of result.results) console.log(`  ${item.terminal}: ${item.file}${item.backup ? `（备份：${item.backup}）` : ''}`);
        return;
      }
      if (action === 'status') {
        const status = getFontStatus();
        console.log(status.installed ? `已安装：${status.path}` : `未检测到 ${status.family} Medium 字体文件。`);
        return;
      }
      showFontGuide(loadConfig());
      return;
    }
    case 'connect': await createTuiApi().connect(); return;
    case 'models': await createTuiApi().models(); return;
    case 'sessions': await createTuiApi().sessions(); return;
    case 'config': {
      const configArgs = args.slice(1);
      if (configArgs[0] === 'show' || configArgs.length === 0 && !process.stdin.isTTY) {
        console.log(JSON.stringify(loadConfig(), null, 2));
        return;
      }
      if (configArgs[0] === 'reset') {
        saveConfig(defaultConfig());
        console.log(`已恢复默认配置：${configPath()}`);
        return;
      }
      if (configArgs[0] === 'model') {
        const model = configArgs[1];
        if (!model || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(model)) throw new Error('用法：eri config model provider/model');
        const cfg = loadConfig(); cfg.model = model; saveConfig(cfg);
        console.log(`默认模型已设置为：${model}`);
        return;
      }
      if (!process.stdin.isTTY) { console.log('用法：eri config [show|reset|model provider/model]'); return; }
      await configMenu(createTuiApi());
      return;
    }
    case 'export': exportConfig(args[1]); return;
    case 'import': importConfig(args[1]); return;
    case 'deep': {
      const ok = await deployDeep();
      if (!ok) process.exitCode = 1;
      return;
    }
    case 'tui':
    case 'ui':
    case 'panel':
      // 该发行包以跨平台 TUI 为统一入口；旧版原生桌面面板资源不在本次改动中删除。
      await runTui(createTuiApi());
      return;
    case 'uninstall': case 'remove': case 'rm': await doUninstall(args.slice(1)); return;
    case 'update': {
      const updateArgs = args.slice(1);
      const selectedOnly = updateArgs.includes('--selected');
      const rawUrl = updateArgs.find((arg) => !arg.startsWith('--')) || process.env.ERI_URL || DEFAULT_URL;
      const selected = selectedOnly ? loadConfig().selectedTools : null;
      await doUpdate(rawUrl, selected);
      return;
    }
    default: {
      // 保持历史兼容：eri-ai-debug <RAW_URL> 等价于 eri-ai-debug update <RAW_URL>。
      if (/^https?:\/\//i.test(sub)) {
        await doUpdate(sub);
        return;
      }
      showHelp();
      process.exitCode = 2;
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`==> ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { TOOLS, main, doUpdate, doUninstall, deployDeep, installedTools, commandExists, setOpenCodeDefaultAgent, removeOpenCodeDefaultAgent, runInteractiveCommand, printStatus, printDoctor, createTuiApi };
