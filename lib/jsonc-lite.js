'use strict';

// Minimal JSONC reader/editor for Eri's one-level OpenCode config keys.
// It strips comments only for validation and edits only the requested root value,
// preserving unrelated comments and formatting. No third-party runtime dependency.

function maskComments(source) {
  const out = source.split('');
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n' || ch === '\r') lineComment = false;
      else out[i] = ' ';
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
        blockComment = false;
      } else if (ch !== '\n' && ch !== '\r') {
        out[i] = ' ';
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '/' && next === '/') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 1;
      lineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 1;
      blockComment = true;
    }
  }

  if (blockComment) throw new SyntaxError('未结束的 JSONC 块注释');
  return out.join('');
}

function stripTrailingCommas(source) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j])) j += 1;
      if (source[j] === '}' || source[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function parse(source, errors = [], options = {}) {
  try {
    const masked = maskComments(String(source));
    const clean = stripTrailingCommas(masked);
    return JSON.parse(clean);
  } catch (error) {
    const message = String(error && error.message || error);
    const pos = message.match(/position\s+(\d+)/i);
    errors.push({ offset: pos ? Number(pos[1]) : 0, error: message });
    return undefined;
  }
}

function scanObjectAt(source, objectOpen = 0) {
  const masked = maskComments(String(source));
  let i = objectOpen;
  const skipWs = () => { while (i < masked.length && /\s/.test(masked[i])) i += 1; };
  skipWs();
  if (masked[i] !== '{') throw new SyntaxError(`JSONC 对象预期在 offset=${i}`);
  const open = i;
  i += 1;
  const members = [];
  let previousComma = null;
  let close = -1;

  while (i < masked.length) {
    skipWs();
    if (masked[i] === '}') { close = i; break; }
    const keyStart = i;
    if (masked[i] !== '"') throw new SyntaxError(`JSONC 对象字段名格式错误（offset=${i}）`);
    i += 1;
    let escaped = false;
    while (i < masked.length) {
      const ch = masked[i++];
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') break;
    }
    const keyEnd = i;
    const key = JSON.parse(source.slice(keyStart, keyEnd));
    skipWs();
    if (masked[i] !== ':') throw new SyntaxError(`JSONC 对象字段缺少冒号（offset=${i}）`);
    i += 1;
    skipWs();
    const valueStart = i;
    let depth = 0;
    let inString = false;
    escaped = false;
    let commaAfter = null;

    while (i < masked.length) {
      const ch = masked[i];
      if (inString) {
        i += 1;
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; i += 1; continue; }
      if (ch === '{' || ch === '[') { depth += 1; i += 1; continue; }
      if (ch === '}' || ch === ']') {
        if (depth > 0) { depth -= 1; i += 1; continue; }
        if (ch === '}' && depth === 0) { close = i; break; }
        throw new SyntaxError(`JSONC 括号不匹配（offset=${i}）`);
      }
      if (ch === ',' && depth === 0) { commaAfter = i; break; }
      i += 1;
    }

    let valueEnd = commaAfter === null ? (close === -1 ? i : close) : commaAfter;
    while (valueEnd > valueStart && /\s/.test(masked[valueEnd - 1])) valueEnd -= 1;
    members.push({ key, keyStart, keyEnd, valueStart, valueEnd, commaAfter, commaBefore: previousComma });

    if (commaAfter !== null) {
      previousComma = commaAfter;
      i = commaAfter + 1;
      continue;
    }
    if (close === -1) {
      skipWs();
      if (masked[i] !== '}') throw new SyntaxError('JSONC 对象未闭合');
      close = i;
    }
    break;
  }

  if (close < 0) throw new SyntaxError('JSONC 对象未闭合');
  return { open, close, members, masked };
}

function scanArrayAt(source, arrayOpen = 0) {
  const masked = maskComments(String(source));
  let i = arrayOpen;
  const skipWs = () => { while (i < masked.length && /\s/.test(masked[i])) i += 1; };
  skipWs();
  if (masked[i] !== '[') throw new SyntaxError(`JSONC 数组预期在 offset=${i}`);
  const open = i;
  i += 1;
  const items = [];
  let previousComma = null;
  let close = -1;

  while (i < masked.length) {
    skipWs();
    if (masked[i] === ']') { close = i; break; }
    const valueStart = i;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let commaAfter = null;
    while (i < masked.length) {
      const ch = masked[i];
      if (inString) {
        i += 1;
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; i += 1; continue; }
      if (ch === '{' || ch === '[') { depth += 1; i += 1; continue; }
      if (ch === '}' || ch === ']') {
        if (depth > 0) { depth -= 1; i += 1; continue; }
        if (ch === ']' && depth === 0) { close = i; break; }
        throw new SyntaxError(`JSONC 数组括号不匹配（offset=${i}）`);
      }
      if (ch === ',' && depth === 0) { commaAfter = i; break; }
      i += 1;
    }
    let valueEnd = commaAfter === null ? (close === -1 ? i : close) : commaAfter;
    while (valueEnd > valueStart && /\s/.test(masked[valueEnd - 1])) valueEnd -= 1;
    items.push({ valueStart, valueEnd, commaAfter, commaBefore: previousComma });
    if (commaAfter !== null) {
      previousComma = commaAfter;
      i = commaAfter + 1;
      continue;
    }
    if (close === -1) {
      skipWs();
      if (masked[i] !== ']') throw new SyntaxError('JSONC 数组未闭合');
      close = i;
    }
    break;
  }
  if (close < 0) throw new SyntaxError('JSONC 数组未闭合');
  return { open, close, items, masked };
}

function scanRoot(source) {
  const root = scanObjectAt(source, 0);
  const errors = [];
  const parsed = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyntaxError(`JSONC 根节点必须是有效对象${errors[0] ? `：${errors[0].error}` : ''}`);
  }
  return root;
}

function buildNestedValue(keys, value) {
  let result = value;
  for (let i = keys.length - 1; i >= 0; i -= 1) result = { [keys[i]]: result };
  return result;
}

function modifyObjectMember(source, scan, key, value, depth, options = {}) {
  const memberIndex = scan.members.findIndex((member) => member.key === key);
  const eol = options.formattingOptions && options.formattingOptions.eol
    || (source.includes('\r\n') ? '\r\n' : '\n');
  const keyIndent = '  '.repeat(depth + 1);

  if (memberIndex >= 0) {
    const member = scan.members[memberIndex];
    if (value !== undefined) {
      return [{ offset: member.valueStart, length: member.valueEnd - member.valueStart, content: JSON.stringify(value) }];
    }
    if (member.commaAfter !== null) {
      return [{ offset: member.keyStart, length: member.commaAfter + 1 - member.keyStart, content: '' }];
    }
    if (member.commaBefore !== null) {
      return [{ offset: member.commaBefore, length: member.valueEnd - member.commaBefore, content: '' }];
    }
    return [{ offset: member.keyStart, length: member.valueEnd - member.keyStart, content: '' }];
  }

  if (value === undefined) return [];
  const lastMember = scan.members[scan.members.length - 1];
  const hasMembers = scan.members.length > 0;
  let serialized = JSON.stringify(value, null, 2);
  if (serialized.includes('\n')) serialized = serialized.replace(/\n/g, `${eol}${keyIndent}`);

  // Insert before the closing brace's indentation when it sits on its own line.
  // This preserves the existing newline/indentation rather than duplicating it.
  const lineStart = source.lastIndexOf(eol, scan.close - 1) + eol.length;
  const prefixToClose = source.slice(lineStart, scan.close);
  const closeIsIndented = lineStart > scan.open && prefixToClose.trim() === '';
  const insertionOffset = closeIsIndented ? lineStart : scan.close;
  const insertion = closeIsIndented
    ? `${keyIndent}${JSON.stringify(key)}: ${serialized}${eol}`
    : `${eol}${keyIndent}${JSON.stringify(key)}: ${serialized}${eol}${'  '.repeat(depth)}`;

  if (hasMembers && lastMember.commaAfter === null) {
    // A compact one-line object can place the last value and closing brace at
    // the same offset. Combine the comma + insertion into one edit so edit
    // ordering cannot produce `"name": "x" "font": {...},}`.
    if (lastMember.valueEnd === insertionOffset) {
      return [{ offset: insertionOffset, length: 0, content: `,${insertion}` }];
    }
    return [
      { offset: lastMember.valueEnd, length: 0, content: ',' },
      { offset: insertionOffset, length: 0, content: insertion },
    ];
  }
  return [{ offset: insertionOffset, length: 0, content: insertion }];
}

function modify(source, path, value, options = {}) {
  if (!Array.isArray(path) || path.length === 0 || path.some((key) =>
    !(typeof key === 'string' && key.length > 0) && !(Number.isInteger(key) && key >= 0))) {
    throw new TypeError('jsonc-lite 路径必须是非空的字符串/数组索引序列');
  }
  if (typeof path[path.length - 1] !== 'string') {
    throw new TypeError('jsonc-lite 暂不支持直接替换整个数组元素；请修改对象属性');
  }
  const errors = [];
  const root = parse(source, errors, { allowTrailingComma: true });
  if (errors.length) throw new SyntaxError(`JSONC 解析失败：${errors[0].error}`);
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new SyntaxError('JSONC 根节点必须是对象');
  }

  let current = root;
  let containerOpen = scanRoot(source).open;
  let depthLevel = 0;
  for (let depth = 0; depth < path.length - 1; depth += 1) {
    const segment = path[depth];
    if (Array.isArray(current)) {
      if (!Number.isInteger(segment) || segment < 0 || segment >= current.length) {
        throw new RangeError(`JSONC 数组索引无效：${String(segment)}`);
      }
      const scan = scanArrayAt(source, containerOpen);
      const item = scan.items[segment];
      if (!item) throw new RangeError(`JSONC 数组索引不存在：${segment}`);
      current = current[segment];
      let valueStart = item.valueStart;
      while (valueStart < scan.masked.length && /\s/.test(scan.masked[valueStart])) valueStart += 1;
      if (!current || typeof current !== 'object') {
        throw new TypeError(`JSONC 路径索引 ${segment} 不是对象，拒绝覆盖`);
      }
      const expected = Array.isArray(current) ? '[' : '{';
      if (scan.masked[valueStart] !== expected) throw new SyntaxError(`JSONC 数组索引 ${segment} 的结构不匹配`);
      containerOpen = valueStart;
      depthLevel += 1;
      continue;
    }
    if (!current || typeof current !== 'object') {
      throw new TypeError(`JSONC 路径 ${path.slice(0, depth).join('.')} 不是对象，拒绝覆盖`);
    }
    if (typeof segment !== 'string') throw new TypeError('JSONC 对象路径段必须是字符串');
    const scan = scanObjectAt(source, containerOpen);
    const member = scan.members.find((candidate) => candidate.key === segment);
    if (!member) {
      if (value === undefined) return [];
      const rest = path.slice(depth + 1);
      if (rest.some((key) => typeof key !== 'string')) {
        throw new TypeError('无法在缺失对象路径下自动创建数组索引');
      }
      const nested = buildNestedValue(rest, value);
      return modifyObjectMember(source, scan, segment, nested, depthLevel, options);
    }
    const nextValue = current[segment];
    if (!nextValue || typeof nextValue !== 'object') {
      throw new TypeError(`JSONC 配置路径 ${path.slice(0, depth + 1).join('.')} 不是对象/数组，拒绝覆盖`);
    }
    let valueStart = member.valueStart;
    while (valueStart < scan.masked.length && /\s/.test(scan.masked[valueStart])) valueStart += 1;
    const expected = Array.isArray(nextValue) ? '[' : '{';
    if (scan.masked[valueStart] !== expected) {
      throw new TypeError(`JSONC 配置路径 ${path.slice(0, depth + 1).join('.')} 结构不匹配，拒绝覆盖`);
    }
    current = nextValue;
    containerOpen = valueStart;
    depthLevel += 1;
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new TypeError('JSONC 目标父路径不是对象，拒绝修改');
  }
  const targetScan = scanObjectAt(source, containerOpen);
  return modifyObjectMember(source, targetScan, path[path.length - 1], value, depthLevel, options);
}

function applyEdits(source, edits) {
  let result = String(source);
  const sorted = [...edits].sort((a, b) => b.offset - a.offset || b.length - a.length);
  for (const edit of sorted) {
    result = result.slice(0, edit.offset) + edit.content + result.slice(edit.offset + edit.length);
  }
  return result;
}

module.exports = { parse, modify, applyEdits, maskComments, stripTrailingCommas, scanObjectAt, scanArrayAt };
