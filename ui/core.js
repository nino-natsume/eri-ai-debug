'use strict';
// 面板后端核心：人格配置读写、工具探测、聊天子进程（流式）。
// 只负责逻辑与子进程；传输层（窗口 bind + 环形队列）在 panel.js / worker.js。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parse } = require('../lib/jsonc-lite');
const { DEFAULT_MODEL } = require('../lib/config');

const HOME = os.homedir();
const h = (...a) => path.join(HOME, ...a);
const IS_COMPILED = typeof Bun !== 'undefined' && Bun.isStandaloneExecutable;
const PKG = (() => { try { return require('../package.json'); } catch { return { version: '0.0.0' }; } })();
const BUILTIN_PERSONALITY = (() => { try { return require('../personality.json'); } catch { return null; } })();
const BUILTIN_OPENCODE = (() => { try { return require('../opencode.json'); } catch { return null; } })();

const CONFIG_DIR = h('.config', 'opencode');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'personality.json');
const UI_STATE_PATH = path.join(CONFIG_DIR, '.eri-ai-debug-panel.json');

// 终端工具清单（与 index.js / 安装脚本一致）
const TOOLS = [
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
  { id: 'claude', name: 'Claude Code', cmd: 'claude' },
  { id: 'codex', name: 'Codex CLI (OpenAI)', cmd: 'codex' },
  { id: 'gemini', name: 'Gemini CLI (Google)', cmd: 'gemini' },
  { id: 'qwen', name: 'Qwen Code (Alibaba)', cmd: 'qwen' },
  { id: 'aider', name: 'Aider', cmd: 'aider' },
  { id: 'cursor-agent', name: 'Cursor CLI', cmd: 'cursor-agent' },
  { id: 'copilot', name: 'GitHub Copilot CLI', cmd: 'copilot' },
  { id: 'amp', name: 'Amp', cmd: 'amp' },
  { id: 'goose', name: 'Goose (Block)', cmd: 'goose' },
  { id: 'crush', name: 'Crush', cmd: 'crush' },
  { id: 'plandex', name: 'Plandex', cmd: 'plandex' },
  { id: 'fabric', name: 'Fabric', cmd: 'fabric' },
  { id: 'openhands', name: 'OpenHands', cmd: 'openhands' },
  { id: 'devin', name: 'Devin CLI', cmd: 'devin' },
  { id: 'continue', name: 'Continue', cmd: 'continue' },
  { id: 'windsurf', name: 'Windsurf CLI', cmd: 'windsurf' },
  { id: 'tabby', name: 'Tabby', cmd: 'tabby-agent' },
];

// 非交互“一次性”调用参数（提示词以参数传入）
const OPENCODE_MODEL = DEFAULT_MODEL;
const CHAT_ARGS = {
  opencode: (p) => ['run', '--model', OPENCODE_MODEL, p],
  claude: (p) => ['-p', p],
  codex: (p) => ['exec', p],
  gemini: (p) => ['-p', p],
  qwen: (p) => ['-p', p],
  aider: (p) => ['--message', p, '--no-auto-commits', '--yes'],
  copilot: (p) => ['-p', p],
  'cursor-agent': (p) => ['-p', p],
  amp: (p) => ['-x', p],
};

// 仅用于本机/CI 自测的假工具
const ECHO_TOOL = { id: 'echo', name: '（自测）Echo', cmd: '__eri_echo__' };
if (process.env.ERI_PANEL_ECHO === '1') TOOLS.push(ECHO_TOOL);

// ---------------------------------------------------------------- utilities
function commandExists(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        if (!fs.statSync(full).isFile()) continue;
        if (process.platform !== 'win32') fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

function toolInfo(t) {
  const exe = commandExists(t.cmd);
  return {
    id: t.id,
    name: t.name,
    cmd: t.cmd,
    installed: t.id === 'echo' || !!exe,
    supported: !!CHAT_ARGS[t.id] || t.id === 'echo',
  };
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
  catch {
    if (!BUILTIN_PERSONALITY) return null;
    return JSON.parse(JSON.stringify(BUILTIN_PERSONALITY));
  }
}

function settingsSource() {
  return fs.existsSync(SETTINGS_PATH) ? SETTINGS_PATH : '(内置默认)';
}

function loadUiState() {
  try {
    const value = JSON.parse(fs.readFileSync(UI_STATE_PATH, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function saveUiState(obj) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${UI_STATE_PATH}.tmp-${process.pid}`;
  const text = JSON.stringify(obj, null, 2) + '\n';
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    if (process.platform === 'win32' && fs.existsSync(UI_STATE_PATH)) {
      const old = `${tmp}.old`;
      fs.renameSync(UI_STATE_PATH, old);
      try {
        fs.renameSync(tmp, UI_STATE_PATH);
      } catch (err) {
        if (!fs.existsSync(UI_STATE_PATH) && fs.existsSync(old)) fs.renameSync(old, UI_STATE_PATH);
        throw err;
      }
      fs.rmSync(old, { force: true });
    } else {
      fs.renameSync(tmp, UI_STATE_PATH);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function activeMood(p) {
  const m = (p && p.mood) || {};
  const name = m.override || m.default || '';
  const found = ((p && p.moods) || []).find((x) => x.name === name);
  return { name, hint: found ? found.hint || '' : '' };
}

function buildHint(s) {
  if (!s || !s.personalities) return '';
  const p = s.personalities[s.active];
  if (!p) return '';
  const md = activeMood(p);
  let text = p.description || '';
  if (md.name) text += '\n\n【当前心情】' + md.name + (md.hint ? '：' + md.hint : '');
  return text;
}

// 使用 JSONC 解析器读取 OpenCode 配置，兼容注释及尾随逗号。
function parseOpenCodeConfig(file) {
  const text = fs.readFileSync(file, 'utf8');
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function agentsFromOpencode() {
  const sources = [];
  for (const file of ['opencode.jsonc', 'opencode.json']) {
    const full = path.join(CONFIG_DIR, file);
    try {
      if (fs.existsSync(full)) {
        const value = parseOpenCodeConfig(full);
        if (value) sources.push(value);
      }
    } catch { /* malformed config is ignored for display only */ }
  }
  sources.push(BUILTIN_OPENCODE);
  for (const oc of sources) {
    const agents = (oc && oc.agent) || {};
    const keys = Object.keys(agents);
    if (keys.length) {
      return keys.map((name) => ({
        name,
        description: (agents[name] && agents[name].description) || '',
      }));
    }
  }
  return [];
}

// 当前运行中的子智慧体：从 OpenCode 数据目录读取最近活跃会话的 agent（只读）。
// bun:sqlite 仅在 Bun Worker 中加载；Node 下静默返回空。
function opencodeDataDir() {
  const base = process.env.XDG_DATA_HOME || h('.local', 'share');
  return path.join(base, 'opencode');
}

function currentSubagent() {
  try {
    const dbPath = path.join(opencodeDataDir(), 'opencode.db');
    if (!fs.existsSync(dbPath)) return '';
    const { Database } = require('bun:sqlite');
    const db = new Database(dbPath, { readonly: true });
    let row = null;
    try { row = db.query('SELECT agent FROM session ORDER BY time_updated DESC LIMIT 1').get(); }
    finally { db.close(); }
    return (row && row.agent) || '';
  } catch { return ''; }
}

// Windows: .cmd/.bat 需经 cmd.exe；参数必须单独转义。
const META_WIN = /([()\][%!^"`<>&|;, *?])/g;
function escapeCommand(arg) {
  return String(arg).replace(META_WIN, '^$1');
}
function escapeArgument(arg, doubleEscapeMetaChars) {
  arg = String(arg);
  arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  arg = arg.replace(/(?=(\\+?)?)\1$/, '$1$1');
  arg = '"' + arg + '"';
  arg = arg.replace(META_WIN, '^$1');
  if (doubleEscapeMetaChars) arg = arg.replace(META_WIN, '^$1');
  return arg;
}
const CMD_SHIM_RE = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;
function flat(s) {
  return String(s).replace(/\r?\n+/g, ' ').trim();
}
function spawnTool(exe, args, cwd) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    const dbl = CMD_SHIM_RE.test(exe);
    const line = [escapeCommand(exe), ...args.map((a) => escapeArgument(a, dbl))].join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + line + '"'], {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(exe, args, { cwd, windowsHide: true });
}

// ------------------------------------------------------------------- state
function buildState() {
  const s = loadSettings();
  const list = [];
  if (s && s.personalities) {
    for (const name of Object.keys(s.personalities)) {
      const p = s.personalities[name];
      list.push({
        name,
        moods: (p.moods || []).map((m) => ({ name: m.name, hint: m.hint || '', score: m.score })),
        moodDefault: (p.mood && p.mood.default) || '',
        moodOverride: (p.mood && p.mood.override) || '',
      });
    }
  }
  const agents = agentsFromOpencode();
  const rawAgent = currentSubagent();
  return {
    version: PKG.version,
    settingsSource: settingsSource(),
    active: (s && s.active) || '',
    personalities: list,
    personalitiesCount: list.length,
    tools: TOOLS.map(toolInfo),
    agents,
    currentAgent: agents.some((a) => a.name === rawAgent) ? rawAgent : '',
    home: HOME,
    defaults: BUILTIN_PERSONALITY ? Object.keys(BUILTIN_PERSONALITY.personalities || {}) : [],
  };
}

// ------------------------------------------------------------------- jobs
// 面板只需要打开 Eri/OpenCode 的固定配置目录，不接受来自前端的任意路径。
function openJob() {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const cmd = process.platform === 'win32'
        ? 'explorer'
        : (process.platform === 'darwin' ? 'open' : 'xdg-open');
      const child = spawn(cmd, [CONFIG_DIR], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      let settled = false;
      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        resolve({ status: 500, body: { ok: false, error: `打开配置目录失败：${err.message}` } });
      });
      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({ status: 200, body: { ok: true, target: CONFIG_DIR } });
      });
    } catch (err) {
      resolve({ status: 500, body: { ok: false, error: `打开配置目录失败：${err.message}` } });
    }
  });
}

function syncJob() {
  return new Promise((resolve) => {
    const eri = commandExists('eri-ai-debug');
    const entry = path.join(__dirname, '..', 'index.js');
    let child;
    try {
      if (eri) child = spawnTool(eri, ['update'], HOME);
      else if (!IS_COMPILED && fs.existsSync(entry)) child = spawnTool(process.execPath, [entry, 'update'], HOME);
      else {
        resolve({ status: 400, body: { error: IS_COMPILED ? '未安装 eri-ai-debug 命令（npm i -g eri-ai-debug），无法同步' : '未找到 eri-ai-debug 命令或 index.js' } });
        return;
      }
    } catch (err) {
      resolve({ status: 500, body: { error: String((err && err.message) || err) } });
      return;
    }

    const maxChars = 4000;
    let out = '';
    let settled = false;
    const append = (chunk) => { out = (out + chunk.toString('utf8')).slice(-maxChars); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ status: 200, body: { ok: code === 0, code, out } });
    });
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ status: 500, body: { error: String((err && err.message) || err), out } });
    });
  });
}

function chatJob(body, ctx) {
  const requestedTool = String((body && body.tool) || '');
  const tool = TOOLS.find((t) => t.id === requestedTool);
  if (!tool) return { status: 400, body: { error: '未知的终端工具，请刷新工具列表后重试。' } };

  const message = String(body.message || '').trim();
  if (!message) return { status: 400, body: { error: '空消息' } };

  let cwd = HOME;
  if (typeof body.cwd === 'string' && body.cwd.trim()) {
    try {
      const candidate = path.resolve(body.cwd.trim());
      if (!fs.statSync(candidate).isDirectory()) {
        return { status: 400, body: { error: '工作目录不是目录：' + candidate } };
      }
      cwd = candidate;
    } catch {
      return { status: 400, body: { error: '工作目录不存在或无法访问：' + body.cwd } };
    }
  }

  // 自测假工具：不依赖任何 CLI。
  if (tool.id === 'echo') {
    return new Promise((resolve) => {
      let ended = false;
      ctx.emit({ t: 'meta', cmd: 'echo', cwd });
      const reply = '收到：' + message;
      let i = 0;
      const timer = setInterval(() => {
        if (i >= reply.length) {
          clearInterval(timer);
          if (!ended) {
            ended = true;
            ctx.emit({ t: 'end', code: 0 });
            resolve({ status: 200, body: { ok: true, code: 0 } });
          }
          return;
        }
        ctx.emit({ t: 'out', d: reply.slice(i, i + 2) });
        i += 2;
      }, 20);
      ctx.setStopper(() => {
        clearInterval(timer);
        if (!ended) {
          ended = true;
          ctx.emit({ t: 'end', code: -1 });
          resolve({ status: 200, body: { ok: false, code: -1 } });
        }
      });
    });
  }

  const spec = CHAT_ARGS[tool.id];
  if (!spec) {
    ctx.emit({ t: 'err', d: '该工具暂不支持非交互调用，无法在面板中聊天。' });
    ctx.emit({ t: 'end', code: -1 });
    return { status: 200, body: { ok: false, code: -1 } };
  }

  const exe = commandExists(tool.cmd);
  if (!exe) {
    ctx.emit({ t: 'err', d: '未检测到命令：' + tool.cmd });
    ctx.emit({ t: 'end', code: -1 });
    return { status: 200, body: { ok: false, code: -1 } };
  }

  let prompt = flat(message);
  if (body.inject !== false) {
    const hint = buildHint(loadSettings());
    if (hint) prompt = flat(hint) + ' --- ' + prompt;
  }

  const args = spec(prompt);
  ctx.emit({ t: 'meta', cmd: tool.cmd + ' ' + args.slice(0, -1).join(' '), cwd });

  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      const exitCode = Number.isInteger(code) ? code : -1;
      ctx.emit({ t: 'end', code: exitCode });
      resolve({ status: 200, body: { ok: exitCode === 0, code: exitCode } });
    };

    try {
      child = spawnTool(exe, args, cwd);
    } catch (err) {
      ctx.emit({ t: 'err', d: String((err && err.message) || err) });
      finish(-1);
      return;
    }

    child.stdout.on('data', (d) => ctx.emit({ t: 'out', d: d.toString('utf8') }));
    child.stderr.on('data', (d) => ctx.emit({ t: 'err', d: d.toString('utf8') }));
    child.once('error', (err) => {
      ctx.emit({ t: 'err', d: String((err && err.message) || err) });
      finish(-1);
    });
    child.once('close', (code) => finish(code == null ? -1 : code));
    ctx.setStopper(() => { try { child.kill(); } catch { /* ignore */ } });
  });
}

// 任务入口：{ path, method, body } → Promise<{ status, body }>
// ctx: { emit(ev), setStopper(fn) }；流式任务通过 emit 推送事件。
async function handle(job, ctx) {
  const p = (job && job.path) || '';
  const body = (job && job.body) || {};
  if (p === '/api/state') return { status: 200, body: buildState() };

  if (p === '/api/ui-state') {
    if (job.method === 'POST') {
      const cur = loadUiState();
      if (body.theme === 'light' || body.theme === 'dark') cur.theme = body.theme;
      if (typeof body.cwd === 'string') cur.cwd = body.cwd;
      try {
        saveUiState(cur);
        return { status: 200, body: { ok: true } };
      } catch (err) {
        return { status: 500, body: { ok: false, error: `保存面板状态失败：${err.message}` } };
      }
    }
    return { status: 200, body: loadUiState() };
  }

  if (p === '/api/tools') return { status: 200, body: { tools: TOOLS.map(toolInfo) } };
  if (p === '/api/current-agent') {
    const raw = currentSubagent();
    const known = agentsFromOpencode().some((a) => a.name === raw);
    return { status: 200, body: { agent: known ? raw : '', raw } };
  }
  if (p === '/api/open') return openJob();
  if (p === '/api/sync') return syncJob();
  if (p === '/api/chat') return chatJob(body, ctx);
  if (p === '/api/__report' && process.env.ERI_PANEL_AUTOTEST) {
    try {
      fs.writeFileSync(process.env.ERI_PANEL_AUTOTEST, JSON.stringify(body, null, 2));
      return { status: 200, body: { ok: true } };
    } catch (err) {
      return { status: 500, body: { ok: false, error: err.message } };
    }
  }
  return { status: 404, body: { error: 'not found' } };
}

module.exports = { handle, buildState, TOOLS, toolInfo };
