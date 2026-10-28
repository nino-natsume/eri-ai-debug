'use strict';

const readline = require('readline');
const PACKAGE_VERSION = require('../package.json').version;
const { stdin, stdout } = require('process');
const { DEFAULT_MODEL, FREE_MODELS, DEFAULT_TUI_FONT, DEFAULT_TUI_FONT_WEIGHT } = require('./config');

const NO_COLOR = Boolean(process.env.NO_COLOR) || !stdout.isTTY;
const C = {
  reset: '\x1b[0m', pink: '\x1b[38;5;213m', cyan: '\x1b[38;5;81m', dim: '\x1b[2m',
  green: '\x1b[38;5;114m', yellow: '\x1b[38;5;221m', red: '\x1b[38;5;203m',
  bold: '\x1b[1m', italic: '\x1b[3m', hero: '\x1b[1;3m', blue: '\x1b[38;5;111m',
};
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const paint = (s, color) => NO_COLOR ? String(s) : `${C[color] || ''}${s}${C.reset}`;
const clear = () => { if (stdout.isTTY) stdout.write('\x1b[2J\x1b[H'); };

function charWidth(char) {
  const cp = char.codePointAt(0);
  if (cp === undefined) return 0;
  if (cp === 0 || cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  // Combining marks, variation selectors and joiners occupy no extra terminal cells.
  if (/\p{Mark}/u.test(char) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  // CJK, full-width forms and emoji are normally rendered as two terminal cells.
  if (cp >= 0x1100 && (
    cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)
  )) return 2;
  return 1;
}

function visibleWidth(value) {
  return [...String(value).replace(ANSI_RE, '')].reduce((total, ch) => total + charWidth(ch), 0);
}

function fitAnsi(value, maxWidth) {
  const input = String(value);
  if (maxWidth <= 0) return '';
  if (visibleWidth(input) <= maxWidth) return input;
  const tokens = input.split(/(\u001b\[[0-?]*[ -/]*[@-~])/g).filter(Boolean);
  let out = '';
  let width = 0;
  let hasAnsi = false;
  for (const token of tokens) {
    if (ANSI_RE.test(token)) {
      ANSI_RE.lastIndex = 0;
      out += token;
      hasAnsi = true;
      continue;
    }
    for (const ch of token) {
      const w = charWidth(ch);
      if (width + w > maxWidth - 1) {
        out += '…';
        if (hasAnsi) out += C.reset;
        return out;
      }
      out += ch;
      width += w;
    }
  }
  if (hasAnsi) out += C.reset;
  return out;
}

function padAnsi(value, width) {
  const clipped = fitAnsi(value, width);
  const spaces = Math.max(0, width - visibleWidth(clipped));
  return clipped + ' '.repeat(spaces);
}

/**
 * Draws a TUI in a stable terminal screen region.
 *
 * The alternate screen keeps navigation out of the user's scrollback buffer.
 * Each redraw uses absolute cursor positioning and only rewrites changed rows;
 * it never emits line feeds, so arrow-key navigation cannot scroll the terminal.
 */
function createScreenRenderer(output = stdout) {
  let depth = 0;
  let previousLines = [];

  function begin() {
    if (!output.isTTY) return false;
    if (depth === 0) {
      output.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
      previousLines = [];
    }
    depth += 1;
    return true;
  }

  function end() {
    if (!output.isTTY || depth <= 0) return;
    depth -= 1;
    if (depth === 0) {
      output.write('\x1b[?25h\x1b[?1049l');
      previousLines = [];
    }
  }

  function invalidate() {
    // External command output or a readline prompt may have touched arbitrary rows.
    // A following draw should refresh all rows, but still without a clear or line feed.
    previousLines = [];
  }

  function beginPrompt() {
    if (!output.isTTY || depth <= 0) return false;
    const rows = Math.max(1, Number(output.rows) || 24);
    output.write(`\x1b[${rows};1H\x1b[2K\x1b[?25h`);
    invalidate();
    return true;
  }

  function endPrompt() {
    if (!output.isTTY || depth <= 0) return;
    output.write('\x1b[?25l');
    invalidate();
  }

  function draw(lines) {
    const input = Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
    if (!output.isTTY || depth === 0) {
      output.write(`${input.join('\n')}\n`);
      return;
    }

    // Keep one terminal column unused. Writing the last column can set delayed
    // wrap mode on some terminals, making the next update scroll unexpectedly.
    const width = Math.max(1, (Number(output.columns) || 80) - 1);
    const height = Math.max(1, Number(output.rows) || 24);
    const nextLines = input.slice(0, height).map((line) => padAnsi(String(line ?? ''), width));
    const rowsToUpdate = Math.max(previousLines.length, nextLines.length);

    for (let row = 0; row < rowsToUpdate; row += 1) {
      const next = nextLines[row] ?? '';
      if (previousLines[row] === next) continue;
      output.write(`\x1b[${row + 1};1H\x1b[2K${next}`);
    }

    previousLines = nextLines;
    // Keep the hidden cursor at the bottom row. If a question is required, the
    // prompt helpers clear that row and temporarily show the cursor there.
    output.write(`\x1b[?25l\x1b[${height};1H`);
  }

  return {
    begin,
    end,
    draw,
    invalidate,
    beginPrompt,
    endPrompt,
    isActive: () => depth > 0,
    depth: () => depth,
  };
}

const screen = createScreenRenderer(stdout);

function frameWidth() {
  const columns = Number(stdout.columns) || 80;
  return Math.max(24, Math.min(96, columns));
}

function renderFrame(title, subtitle, lines, footer = '↑/↓ 移动  Enter 选择  Esc 返回', options = {}) {
  const width = Math.max(24, Math.min(options.width || frameWidth(), 96));
  const contentWidth = Math.max(16, width - 4);
  const border = (left, fill, right, color = 'pink') => paint(`${left}${fill.repeat(Math.max(0, width - 2))}${right}`, color);
  const content = (text, color = null) => {
    const padded = `│ ${padAnsi(text, contentWidth)} │`;
    return color ? paint(padded, color) : `${paint('│', 'pink')} ${padAnsi(text, contentWidth)} ${paint('│', 'pink')}`;
  };
  const centerText = (text) => {
    const left = Math.max(0, Math.floor((contentWidth - visibleWidth(text)) / 2));
    return `${' '.repeat(left)}${text}`;
  };
  const section = (text) => {
    const start = `─ ${text} `;
    const rest = Math.max(0, contentWidth - visibleWidth(start));
    return content(`${paint(start, 'cyan')}${paint('─'.repeat(rest), 'dim')}`);
  };

  const titleLine = options.heroTitle ? paint(title, 'hero') : paint(title, 'bold');
  const subtitleLine = paint(subtitle, 'dim');
  const out = [
    border('╭', '─', '╮'),
    content(options.centerTitle ? centerText(titleLine) : titleLine),
    content(options.centerTitle ? centerText(subtitleLine) : subtitleLine),
    ...(options.headerBlank ? [content('')] : []),
    border('├', '─', '┤'),
  ];

  for (const row of lines || []) {
    if (row && typeof row === 'object' && row.type === 'section') {
      out.push(section(row.text));
    } else if (row && typeof row === 'object' && row.type === 'blank') {
      out.push(content(''));
    } else if (row && typeof row === 'object' && row.type === 'raw') {
      out.push(content(row.text || ''));
    } else {
      out.push(content(String(row ?? '')));
    }
  }
  out.push(border('├', '─', '┤'));
  out.push(content(paint(footer, 'dim')));
  out.push(border('╰', '─', '╯'));
  return out.join('\n');
}

const ERI_BANNER = [
  '███████╗  ██████╗   ███████╗',
  '██╔════╝  ██╔══██╗  ╚══███╔╝',
  '█████╗    ██████╔╝    ███╔╝ ',
  '██╔══╝    ██╔══██╗    ███║  ',
  '███████╗  ██║  ██║  ███████╗',
  '╚══════╝  ╚═╝  ╚═╝  ╚══════╝',
];

const BANNER_BLUE = [174, 189, 232];
const BANNER_CORAL = [227, 140, 154];
const BANNER_GLINT = [255, 235, 229];

function bannerColor(rgb) {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function mixRgb(a, b, ratio) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * ratio));
}

function renderGradientArt(line, row, tick = 0, forceColor = false) {
  const colorEnabled = forceColor || !NO_COLOR;
  // Miyu's splash uses a headline treatment rather than ordinary UI text.
  // Keep the actual terminal style italic even when NO_COLOR is requested;
  // only the RGB gradient is disabled in that mode.
  if (!colorEnabled) return `${C.italic}${line}\x1b[23m`;
  const chars = [...line];
  const total = Math.max(1, chars.length - 1);
  const cycle = Math.max(1, chars.length + 16);
  const glintX = (tick % (cycle + 22)) - 11;
  let out = C.hero;
  chars.forEach((char, column) => {
    if (char === ' ') { out += char; return; }
    const ratio = column / total;
    const rgb = Math.abs(column - glintX) < 1.2 ? BANNER_GLINT : mixRgb(BANNER_BLUE, BANNER_CORAL, ratio);
    out += `${bannerColor(rgb)}${char}`;
  });
  return `${out}${C.reset}`;
}

function renderBannerLine(line, row, tick = 0, forceColor = false) {
  const stars = [
    ['  .  ', '   + '],
    [' *   ', '  .  '],
    ['   + ', ' *   '],
    [' .   ', '    +'],
    ['  +  ', ' .   '],
    [' *   ', '   . '],
  ];
  const phase = Math.floor(tick / 4) % stars.length;
  const [leftStar, rightStar] = stars[(row + phase) % stars.length];
  const colorEnabled = forceColor || !NO_COLOR;
  const left = colorEnabled ? `${bannerColor(row % 2 ? BANNER_CORAL : BANNER_BLUE)}${leftStar}${C.reset}` : leftStar;
  const right = colorEnabled ? `${bannerColor(row % 2 ? BANNER_BLUE : BANNER_CORAL)}${rightStar}${C.reset}` : rightStar;
  return `${left}${renderGradientArt(line, row, tick, forceColor)}${right}`;
}

function renderHomeScreen(title, subtitle, items, cursor = 0, options = {}) {
  const width = Math.max(40, Math.min(options.width || frameWidth(), 100));
  const height = Math.max(16, options.height || Number(stdout.rows) || 24);
  const tick = Math.max(0, Number(options.tick) || 0);
  const line = (value = '') => padAnsi(value, width);
  const center = (value = '') => {
    const clipped = fitAnsi(value, width);
    const left = Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2));
    return `${' '.repeat(left)}${padAnsi(clipped, width - left)}`;
  };

  // Miyu-inspired splash: six-line ANSI Shadow lettering, blue-to-coral gradient,
  // sparse side stars and a sweeping glint. We intentionally emit no background SGR.
  const artRows = ERI_BANNER.map((art, index) => center(renderBannerLine(art, index, tick, options.forceColor === true)));
  const gapCount = height >= 30 ? 7 : height >= 26 ? 5 : height >= 23 ? 4 : height >= 20 ? 2 : 0;
  const rows = [
    line(''),
    ...artRows,
    center(paint(subtitle.replace(/^Eri\s*[·|—-]\s*/i, ''), 'dim')),
    line(''),
    center(paint('A little AI companion in your terminal', 'dim')),
    ...Array.from({ length: gapCount }, () => line('')),
    center(paint('────── MENU ──────', 'dim')),
    line(''),
  ];

  const menuWidth = Math.min(64, width - 4);
  const menuItems = (items || []).map((item, index) => {
    const marker = index === cursor ? paint('›', 'bold') : ' ';
    const number = paint(String(index + 1).padStart(2, '0'), 'dim');
    const label = index === cursor ? paint(item.label, 'bold') : item.label;
    const hint = item.hint ? paint(`  ${item.hint}`, 'dim') : '';
    const entry = fitAnsi(`${marker} ${number}  ${label}${hint}`, menuWidth);
    const left = Math.max(0, Math.floor((width - visibleWidth(entry)) / 2));
    return `${' '.repeat(left)}${padAnsi(entry, width - left)}`;
  });

  // Reserve one final row for key hints. When the terminal is short,
  // reserve one additional row for the menu viewport indicator.
  let maxMenuRows = Math.max(1, height - rows.length - 1);
  if (menuItems.length > maxMenuRows) maxMenuRows = Math.max(1, maxMenuRows - 1);
  const menuStart = visibleStart(cursor, menuItems.length, maxMenuRows);
  const visibleItems = menuItems.slice(menuStart, menuStart + maxMenuRows);
  rows.push(...visibleItems);
  if (menuItems.length > maxMenuRows) {
    rows.push(center(paint(`… 第 ${menuStart + 1}-${Math.min(menuItems.length, menuStart + maxMenuRows)} 项 / 共 ${menuItems.length} 项`, 'dim')));
  }
  rows.push(center(paint(options.footer || '↑/↓ 或 j/k 移动   Enter 选择   q/Esc 退出', 'dim')));
  return rows.slice(0, height).map((value) => line(value)).join('\n');
}

function makeFrame(title, subtitle, lines, footer, options = {}) {
  const frame = renderFrame(title, subtitle, lines, footer, options);
  if (screen.isActive()) screen.draw(frame.split('\n'));
  else {
    clear();
    stdout.write(`${frame}\n`);
  }
  return frame;
}

function rowsAvailable(prefixCount = 0, reserved = 7) {
  const rows = Number(stdout.rows) || 24;
  return Math.max(3, rows - prefixCount - reserved);
}

function visibleStart(cursor, length, count) {
  if (length <= count) return 0;
  const ideal = cursor - Math.floor(count / 2);
  return Math.max(0, Math.min(ideal, length - count));
}

function menuRows(items, cursor, maxRows) {
  maxRows = Math.max(2, maxRows);
  const targetItems = Math.max(1, maxRows - 4);
  let start = visibleStart(cursor, items.length, targetItems);

  const build = (from) => {
    const rows = [];
    let previousGroup = null;
    let end = from;
    for (let i = from; i < items.length; i += 1) {
      const item = items[i];
      const needsGroup = Boolean(item.group && item.group !== previousGroup);
      const needed = 1 + (needsGroup ? 1 : 0);
      if (rows.length + needed > maxRows) break;
      if (needsGroup) {
        rows.push({ type: 'section', text: item.group });
        previousGroup = item.group;
      }
      const marker = i === cursor ? paint('›', 'pink') : ' ';
      const label = i === cursor ? paint(item.label, 'bold') : item.label;
      const hint = item.hint ? paint(`  ${item.hint}`, 'dim') : '';
      rows.push(`${marker} ${String(i + 1).padStart(2, '0')}  ${label}${hint}`);
      end = i + 1;
    }
    return { rows, end };
  };

  let result = build(start);
  if (cursor >= result.end) {
    start = cursor;
    result = build(start);
  }
  // Keep the selected entry visible even on very short terminals.
  while (cursor >= result.end && start > 0) {
    start -= 1;
    result = build(start);
  }
  if (start > 0 && result.rows.length < maxRows) {
    result.rows.unshift({ type: 'raw', text: `… 已滚动到第 ${start + 1} 项` });
  }
  if (result.end < items.length && result.rows.length < maxRows) {
    result.rows.push({ type: 'raw', text: `… 还有 ${items.length - result.end} 项` });
  }
  return result.rows.slice(0, maxRows);
}

function fallbackChoose(title, subtitle, items) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write(`\n${title}\n${subtitle}\n`);
  items.forEach((item, i) => stdout.write(` ${i + 1}. ${item.label}${item.hint ? ` — ${item.hint}` : ''}\n`));
  return rl.question('输入编号（0 返回）：').then((answer) => {
    rl.close();
    const n = Number(answer.trim());
    return Number.isInteger(n) && n >= 1 && n <= items.length ? n - 1 : null;
  });
}

async function choose(title, subtitle, items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    return fallbackChoose(title, subtitle, items);
  }
  let index = Math.max(0, Math.min(Number(options.initial) || 0, items.length - 1));
  readline.emitKeypressEvents(stdin);
  const wasRaw = Boolean(stdin.isRaw);
  stdin.setRawMode(true);
  stdin.resume();
  const ownsScreen = screen.begin();
  let animationTick = 0;
  let animationTimer = null;
  const draw = () => {
    if (options.homeStyle) {
      const frame = renderHomeScreen(title, subtitle, items, index, { ...options, tick: animationTick });
      screen.draw(frame.split('\n'));
      return;
    }
    const prefix = typeof options.prefixLines === 'function' ? options.prefixLines() : (options.prefixLines || []);
    const maxRows = rowsAvailable(prefix.length, options.headerBlank ? 8 : 7);
    const rows = menuRows(items, index, maxRows);
    makeFrame(title, subtitle, [...prefix, ...rows], options.footer || '↑/↓ 或 j/k 移动  Enter 选择  q/Esc 返回', {
      centerTitle: Boolean(options.centerTitle),
      headerBlank: Boolean(options.headerBlank),
      heroTitle: Boolean(options.heroTitle),
    });
  };
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      stdin.removeListener('keypress', onKey);
      if (animationTimer) clearInterval(animationTimer);
      try { stdin.setRawMode(wasRaw); } catch { /* non-standard terminal */ }
      stdin.pause();
      if (ownsScreen) screen.end();
      resolve(value);
    };
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(null);
      if (key.name === 'escape' || key.name === 'q' || (str && str.toLowerCase() === 'q')) return finish(null);
      if (key.name === 'up' || str === 'k') index = (index - 1 + items.length) % items.length;
      else if (key.name === 'down' || str === 'j') index = (index + 1) % items.length;
      else if (key.name === 'home') index = 0;
      else if (key.name === 'end') index = items.length - 1;
      else if (key.name === 'return') return finish(index);
      draw();
    };
    stdin.on('keypress', onKey);
    draw();
    if (options.homeStyle) {
      animationTimer = setInterval(() => { animationTick += 1; draw(); }, 100);
      if (typeof animationTimer.unref === 'function') animationTimer.unref();
    }
  });
}

async function multiSelect(title, subtitle, items, initiallySelected = [], options = {}) {
  const chosen = new Set(initiallySelected);
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    stdout.write(`\n${title}\n${subtitle}\n`);
    if (options.prefixLines) for (const line of options.prefixLines) stdout.write(`${line}\n`);
    items.forEach((item, i) => stdout.write(` ${i + 1}. [${chosen.has(item.id) ? 'x' : ' '}] ${item.label}${item.hint ? ` — ${item.hint}` : ''}\n`));
    const answer = await rl.question('输入要启用的编号，逗号分隔；输入 a 全选；留空取消：');
    rl.close();
    const text = answer.trim().toLowerCase();
    if (!text) return null;
    if (text === 'a') return items.map((x) => x.id);
    const ids = text.split(/[,，\s]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length).map((n) => items[n - 1].id);
    return [...new Set(ids)];
  }
  let cursor = 0;
  readline.emitKeypressEvents(stdin);
  const wasRaw = Boolean(stdin.isRaw);
  stdin.setRawMode(true);
  stdin.resume();
  const ownsScreen = screen.begin();
  const draw = () => {
    const prefix = [
      `已勾选 ${chosen.size}/${items.length} 项`,
      ...(options.prefixLines || []),
    ];
    const maxItems = rowsAvailable(prefix.length, 9);
    const start = visibleStart(cursor, items.length, maxItems);
    const visible = items.slice(start, start + maxItems);
    const rows = visible.map((item, offset) => {
      const i = start + offset;
      const marker = i === cursor ? paint('›', 'pink') : ' ';
      const checkbox = chosen.has(item.id) ? paint('[✓]', 'green') : '[ ]';
      const label = i === cursor ? paint(item.label, 'bold') : item.label;
      const hint = item.hint ? paint(`  ${item.hint}`, 'dim') : '';
      return `${marker} ${String(i + 1).padStart(2, '0')} ${checkbox} ${label}${hint}`;
    });
    if (start > 0) rows.unshift({ type: 'raw', text: '… 上方还有项目' });
    if (start + visible.length < items.length) rows.push({ type: 'raw', text: '… 下方还有项目' });
    makeFrame(title, subtitle, [...prefix, ...rows], '↑/↓ 移动  Space 勾选  a 全选/取消  Enter 保存  Esc 取消');
  };
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      stdin.removeListener('keypress', onKey);
      try { stdin.setRawMode(wasRaw); } catch { /* ignore */ }
      stdin.pause();
      if (ownsScreen) screen.end();
      resolve(value);
    };
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(null);
      if (key.name === 'escape' || key.name === 'q' || (str && str.toLowerCase() === 'q')) return finish(null);
      if (key.name === 'up' || str === 'k') cursor = (cursor - 1 + items.length) % items.length;
      else if (key.name === 'down' || str === 'j') cursor = (cursor + 1) % items.length;
      else if (key.name === 'home') cursor = 0;
      else if (key.name === 'end') cursor = items.length - 1;
      else if (key.name === 'space') {
        const id = items[cursor].id;
        if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
      } else if (str && str.toLowerCase() === 'a') {
        if (chosen.size === items.length) chosen.clear();
        else items.forEach((item) => chosen.add(item.id));
      } else if (key.name === 'return') {
        return finish(items.filter((item) => chosen.has(item.id)).map((item) => item.id));
      }
      draw();
    };
    stdin.on('keypress', onKey);
    draw();
  });
}

async function ask(question, defaultValue = '') {
  const prompting = screen.beginPrompt();
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `);
    return answer.trim() || defaultValue;
  } finally {
    rl.close();
    if (prompting) screen.endPrompt();
  }
}

async function pause(message = '按 Enter 返回菜单…') {
  if (!stdin.isTTY || !stdout.isTTY) return;
  const prompting = screen.beginPrompt();
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    await rl.question(paint(message, 'dim'));
  } finally {
    rl.close();
    if (prompting) screen.endPrompt();
  }
}

function renderText(title, subtitle, lines) {
  makeFrame(title, subtitle, lines, '按 Enter 返回');
}

function mainMenuItems() {
  // Keep the landing screen deliberately minimal: each entry opens a dedicated submenu.
  return [
    { label: '开始使用', hint: '普通对话 / 开发模式' },
    { label: '工具与人格', hint: '终端 CLI / 人格部署' },
    { label: '模型与账号', hint: 'OpenCode Zen / 模型选择' },
    { label: '设置与诊断', hint: '状态 / 诊断 / 配置' },
    { label: '退出 Eri', hint: '返回终端' },
  ];
}

function renderMainMenuPreview(options = {}) {
  const version = options.version || PACKAGE_VERSION;
  const cursor = Number.isInteger(options.cursor) ? Math.max(0, Math.min(options.cursor, 4)) : 0;
  return renderHomeScreen('Eri', `绘里酱 · Terminal AI Assistant · v${version}`, mainMenuItems(), cursor, {
    width: options.width || 76,
    height: options.height || 24,
    heroTitle: true,
    forceColor: options.forceColor === true,
    tick: options.tick || 0,
    footer: '↑/↓ 或 j/k 移动   Enter 选择   q/Esc 退出',
  });
}

async function toolPicker(api, { deployAfter = false } = {}) {
  const config = api.loadConfig();
  const installed = new Set(api.installedTools().map((tool) => tool.id));
  const initial = config.selectedTools.length ? config.selectedTools : [...installed];
  const items = api.TOOLS.map((tool) => ({
    id: tool.id,
    label: tool.name,
    hint: installed.has(tool.id) ? `已安装 · ${tool.cmd}` : `未检测到 · ${tool.cmd}`,
  }));
  const selected = await multiSelect(
    '终端工具管理',
    '一次选择要部署 Eri 人格的终端工具；不会自动安装未检测到的第三方 CLI。',
    items,
    initial,
    { prefixLines: [`已检测 ${installed.size}/${api.TOOLS.length} 个工具`, '空格切换勾选，Enter 保存'] },
  );
  if (!selected) return false;
  config.selectedTools = selected;
  const file = api.saveConfig(config);
  console.log(`已保存工具选择：${file}`);
  console.log(`已选 ${selected.length} 个工具，其中已安装 ${selected.filter((id) => installed.has(id)).length} 个。`);
  if (deployAfter && selected.some((id) => installed.has(id))) {
    const confirm = (await ask('现在为这些已安装工具部署人格？输入 y 确认', 'n')).toLowerCase();
    if (confirm === 'y' || confirm === 'yes') await api.update(selected);
  }
  return true;
}

async function configMenu(api) {
  while (true) {
    const config = api.loadConfig();
    const items = [
      { group: '模型', label: '选择推荐免费模型', hint: config.model },
      { group: '模型', label: '恢复默认模型', hint: DEFAULT_MODEL },
      { group: '连接', label: '连接 OpenCode / OpenCode Zen', hint: '调用官方登录流程' },
      { group: '连接', label: '刷新并列出模型', hint: 'opencode models --refresh' },
      { group: '连接', label: '查看会话列表', hint: 'opencode session list' },
      { group: '配置', label: '显示当前配置' },
      { group: '配置', label: '导出配置' },
      { group: '配置', label: '导入配置' },
      { group: '返回', label: '返回主菜单' },
    ];
    const selected = await choose('模型与账号', '免费模型通常是限时/限额服务；实际可用性由 OpenCode 官方服务决定。', items, {
      prefixLines: [`当前模型  ${config.model}`, `配置文件  ${api.configPath()}`, { type: 'section', text: '设置项' }],
    });
    if (selected === null || selected === 8) return;
    if (selected === 0) {
      const modelItems = [
        ...FREE_MODELS.map((m) => ({ label: m.name, hint: m.id })),
        { label: '返回上一层' },
      ];
      const choice = await choose('选择模型', '模型与免费额度可能变化；请以 OpenCode 官方列表为准。', modelItems, {
        prefixLines: ['推荐模型列表仅作快捷选择，不承诺永久免费。'],
      });
      if (choice !== null && choice < FREE_MODELS.length) {
        config.model = FREE_MODELS[choice].id;
        api.saveConfig(config);
        console.log(`已设置默认模型：${config.model}`);
        await pause();
      }
    } else if (selected === 1) {
      config.model = DEFAULT_MODEL;
      api.saveConfig(config);
      console.log(`已恢复默认模型：${DEFAULT_MODEL}`);
      await pause();
    } else if (selected === 2) {
      await api.connect();
      await pause();
    } else if (selected === 3) {
      await api.models();
      await pause();
    } else if (selected === 4) {
      await api.sessions();
      await pause();
    } else if (selected === 5) {
      renderText('当前配置', api.configPath(), JSON.stringify(config, null, 2).split('\n'));
      await pause();
    } else if (selected === 6) {
      const target = await ask('导出到文件（留空使用默认文件名）');
      await api.exportConfig(target || undefined);
      await pause();
    } else if (selected === 7) {
      const source = await ask('输入要导入的 JSON 配置文件路径');
      if (source) await api.importConfig(source);
      await pause();
    }
  }
}

async function fontMenu(api) {
  while (true) {
    const config = api.loadConfig();
    const selected = await choose('字体设置', '执行字体安装或更新受支持终端的字体配置。', [
      { label: '安装并应用字体', hint: '下载字体并更新当前用户的终端配置' },
      { label: '应用字体配置', hint: '只更新受支持终端的字体设置' },
      { label: '返回设置与诊断' },
    ], {
      prefixLines: [
        `目标字体  ${config.fontFamily || DEFAULT_TUI_FONT} · ${config.fontWeight || DEFAULT_TUI_FONT_WEIGHT}`,
        { type: 'section', text: '操作' },
      ],
    });
    if (selected === null || selected === 2) return;
    if (selected === 0) {
      const result = await api.fontInstall();
      if (result?.cancelled) {
        console.log('操作已取消。');
      } else if (result?.installed) {
        console.log('字体操作已完成。请重新启动终端以应用外观设置。');
      } else {
        console.error(`字体操作未完成：${result?.message || '请检查网络和终端配置后重试。'}`);
      }
      await pause();
    } else if (selected === 1) {
      const result = api.fontApply();
      if (result?.applied) {
        console.log('终端字体配置操作已完成。请重新启动终端以应用外观设置。');
      } else {
        console.log('没有修改任何终端配置。');
      }
      for (const item of result?.results || []) {
        console.log(item.error
          ? `  ${item.terminal}: 配置失败（${item.error}）`
          : `  ${item.terminal}: 配置已更新${item.backup ? `（已创建备份）` : ''}`);
      }
      await pause();
    }
  }
}

async function importExportMenu(api) {
  while (true) {
    const selected = await choose('配置导入 / 导出', '配置不包含 OpenCode 认证凭据。', [
      { label: '导出配置', hint: '保存 Eri 模型与工具选择' },
      { label: '导入配置', hint: '从 JSON 文件恢复 Eri 设置' },
      { label: '返回设置与诊断' },
    ]);
    if (selected === null || selected === 2) return;
    if (selected === 0) {
      const target = await ask('导出到文件（留空使用默认文件名）');
      await api.exportConfig(target || undefined);
    } else if (selected === 1) {
      const source = await ask('输入要导入的 JSON 配置文件路径');
      if (source) await api.importConfig(source);
    }
    await pause();
  }
}

async function startMenu(api) {
  while (true) {
    const selected = await choose('开始使用', '选择对话模式；按 Esc/q 返回 Eri 首页。', [
      { label: '普通对话', hint: '使用当前默认模型' },
      { label: '开发模式', hint: '调用 OpenCode build agent' },
      { label: '返回主菜单' },
    ]);
    if (selected === null || selected === 2) return;
    await api.chat(selected === 1);
    await pause();
  }
}

async function toolsMenu(api) {
  while (true) {
    const selected = await choose('工具与人格', '统一管理受支持的终端 CLI 与 Eri 人格。', [
      { label: '终端工具选择', hint: '多选、查看检测状态并保存选择' },
      { label: 'OpenCode 深度集成', hint: 'skill / 子智慧体 / personality / mood' },
      { label: '更新人格', hint: '更新已选工具；未选择时更新所有已安装工具' },
      { label: '返回主菜单' },
    ]);
    if (selected === null || selected === 3) return;
    if (selected === 0) {
      const saved = await toolPicker(api, { deployAfter: true });
      if (saved) await pause();
    } else if (selected === 1) {
      await api.deep();
      await pause();
    } else if (selected === 2) {
      const config = api.loadConfig();
      await api.update(config.selectedTools.length ? config.selectedTools : null);
      await pause();
    }
  }
}

async function settingsMenu(api) {
  while (true) {
    const selected = await choose('设置与诊断', '系统状态、诊断、配置迁移和终端显示。', [
      { label: '状态总览', hint: '查看安装、模型和工具选择状态' },
      { label: '环境诊断', hint: '检查 Node、npm、OpenCode 与资源文件' },
      { label: '配置导入 / 导出', hint: '迁移 Eri 配置，不包含认证凭据' },
      { label: '字体设置', hint: '管理终端显示配置' },
      { label: '卸载 Eri 人格', hint: '不会卸载第三方 AI CLI' },
      { label: '返回主菜单' },
    ]);
    if (selected === null || selected === 5) return;
    if (selected === 0) {
      api.status();
      await pause();
    } else if (selected === 1) {
      api.doctor();
      await pause();
    } else if (selected === 2) {
      await importExportMenu(api);
    } else if (selected === 3) {
      await fontMenu(api);
    } else if (selected === 4) {
      await api.uninstall([]);
      return;
    }
  }
}

async function runTui(api) {
  // Do not enter alternate-screen mode when output is redirected or stdin is piped.
  const ownsScreen = stdin.isTTY && stdout.isTTY ? screen.begin() : false;
  try {
    while (true) {
      let config;
      try { config = api.loadConfig(); }
      catch (error) {
        console.error(error.message);
        await pause();
        return;
      }
      const items = mainMenuItems();
      const choice = await choose('Eri', `绘里酱 · Terminal AI Assistant · v${api.version || PACKAGE_VERSION}`, items, {
        homeStyle: true,
        heroTitle: true,
        footer: '↑/↓ 或 j/k 移动   Enter 选择   q/Esc 退出',
      });
      if (choice === null || choice === 4) return;
      try {
        if (choice === 0) await startMenu(api);
        else if (choice === 1) await toolsMenu(api);
        else if (choice === 2) await configMenu(api);
        else if (choice === 3) await settingsMenu(api);
      } catch (error) {
        console.error(`\n操作失败：${error.message}`);
        await pause();
      }
    }
  } finally {
    if (ownsScreen) screen.end();
  }
}

module.exports = {
  runTui, toolPicker, configMenu, choose, multiSelect,
  visibleWidth, fitAnsi, renderFrame, renderHomeScreen, renderMainMenuPreview, mainMenuItems,
  createScreenRenderer,
  fontMenu, importExportMenu, startMenu, toolsMenu, settingsMenu, ERI_BANNER, renderGradientArt,
};
