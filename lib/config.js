'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MODEL = 'opencode/big-pickle';
// Preferred terminal font. The terminal emulator (not a Node TUI) performs actual font rendering.
const DEFAULT_TUI_FONT = 'JetBrains Maple Mono';
const DEFAULT_TUI_FONT_WEIGHT = 'Medium';
const DEFAULT_TUI_FONT_SOURCE = 'https://fonts.107211.xyz/';
const LEGACY_DEFAULT_MODELS = new Set(['opencode/glm-5.3-flash-free']);

function normalizeModel(model) {
  if (typeof model !== 'string' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(model)) return DEFAULT_MODEL;
  // 将本项目早期默认值迁移到目前文档列出的免费模型。
  if (LEGACY_DEFAULT_MODELS.has(model)) return DEFAULT_MODEL;
  return model;
}
const FREE_MODELS = [
  { id: DEFAULT_MODEL, name: 'Big Pickle（默认；限时免费）' },
  { id: 'opencode/glm-5.3-flash-free', name: 'GLM 5.3 Flash Free' },
  { id: 'opencode/deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash Free' },
  { id: 'opencode/beam-free', name: 'Beam Free' },
  { id: 'opencode/flint-40b-free', name: 'Flint 40B Free' },
  { id: 'opencode/mimo-v2.6-flash-free', name: 'MiMo V2.6 Flash Free' },
  { id: 'opencode/nemotron-3-ultra-free', name: 'Nemotron 3 Ultra Free' },
  { id: 'opencode/nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free' },
  { id: 'opencode/nemotron-3.5-super-vl-free', name: 'Nemotron 3.5 Super VL Free' },
];

function configPath() {
  if (process.env.ERI_CONFIG_PATH) return path.resolve(process.env.ERI_CONFIG_PATH);
  if (process.env.ERI_CONFIG_HOME) return path.join(path.resolve(process.env.ERI_CONFIG_HOME), 'config.json');
  const home = os.homedir();
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(base, 'eri-ai-debug', 'config.json');
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'eri-ai-debug', 'config.json');
}

function defaultConfig() {
  return {
    schemaVersion: 1,
    model: DEFAULT_MODEL,
    selectedTools: [],
    mode: 'normal',
    fontFamily: DEFAULT_TUI_FONT,
    fontWeight: DEFAULT_TUI_FONT_WEIGHT,
    fontSource: DEFAULT_TUI_FONT_SOURCE,
  };
}

function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return defaultConfig();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Eri 配置文件无法解析：${file}\n${error.message}\n请先备份该文件，再运行 eri-ai-debug init --reset-config。`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Eri 配置根节点必须是对象：${file}`);
  }
  const config = { ...defaultConfig(), ...parsed };
  config.model = normalizeModel(config.model);
  if (!Array.isArray(config.selectedTools)) config.selectedTools = [];
  config.selectedTools = [...new Set(config.selectedTools.filter((x) => typeof x === 'string'))];
  if (!['normal', 'dev'].includes(config.mode)) config.mode = 'normal';
  if (typeof config.fontFamily !== 'string' || !config.fontFamily.trim() || config.fontFamily === 'JetBrains Mono Maple Medium') config.fontFamily = DEFAULT_TUI_FONT;
  if (typeof config.fontWeight !== 'string' || !config.fontWeight.trim()) config.fontWeight = DEFAULT_TUI_FONT_WEIGHT;
  if (typeof config.fontSource !== 'string' || !config.fontSource.trim()) config.fontSource = DEFAULT_TUI_FONT_SOURCE;
  return config;
}

function saveConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('配置必须为对象');
  }
  const file = configPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const normalized = {
    ...defaultConfig(),
    ...config,
    model: normalizeModel(config.model),
    fontFamily: typeof config.fontFamily === 'string' && config.fontFamily.trim() && config.fontFamily !== 'JetBrains Mono Maple Medium' ? config.fontFamily.trim() : DEFAULT_TUI_FONT,
    fontWeight: typeof config.fontWeight === 'string' && config.fontWeight.trim() ? config.fontWeight.trim() : DEFAULT_TUI_FONT_WEIGHT,
    fontSource: typeof config.fontSource === 'string' && config.fontSource.trim() ? config.fontSource.trim() : DEFAULT_TUI_FONT_SOURCE,
    selectedTools: Array.isArray(config.selectedTools)
      ? [...new Set(config.selectedTools.filter((x) => typeof x === 'string'))] : [],
  };
  const tmp = `${file}.tmp-${process.pid}`;
  const data = `${JSON.stringify(normalized, null, 2)}\n`;
  try {
    fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
    if (process.platform === 'win32' && fs.existsSync(file)) {
      const old = `${tmp}.old`;
      fs.renameSync(file, old);
      try { fs.renameSync(tmp, file); }
      catch (error) {
        if (!fs.existsSync(file) && fs.existsSync(old)) fs.renameSync(old, file);
        throw error;
      }
      fs.rmSync(old, { force: true });
    } else {
      fs.renameSync(tmp, file);
      if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return file;
}

module.exports = { DEFAULT_MODEL, DEFAULT_TUI_FONT, DEFAULT_TUI_FONT_WEIGHT, DEFAULT_TUI_FONT_SOURCE, FREE_MODELS, configPath, defaultConfig, loadConfig, saveConfig, normalizeModel };
